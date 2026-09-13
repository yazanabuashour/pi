import * as NodeChildProcess from "node:child_process";
import { Effect } from "effect";
import { hostPlatform } from "../../shared/host-runtime.ts";
import { FORCE_KILL_AFTER_MS } from "./manager-contract.ts";

export function shellInvocation(command: string) {
  if (hostPlatform === "win32") {
    return {
      shell: process.env["ComSpec"] ?? "cmd.exe",
      args: ["/d", "/s", "/c", command],
    };
  }
  return { shell: "/bin/sh", args: ["-c", command] };
}

function killTree(
  child: NodeChildProcess.ChildProcess,
  signal: NodeJS.Signals,
) {
  if (hostPlatform === "win32" && child.pid) {
    try {
      const killer = NodeChildProcess.spawn(
        "taskkill",
        [
          "/pid",
          String(child.pid),
          "/T",
          ...(signal === "SIGKILL" ? ["/F"] : []),
        ],
        { stdio: "ignore", windowsHide: true },
      );
      const fallback = () => {
        try {
          child.kill(signal);
        } catch {
          /* Process already exited. */
        }
      };
      killer.once("error", fallback);
      killer.once("exit", (code) => {
        if (code !== 0) fallback();
      });
      killer.unref();
      return;
    } catch {
      // Fall through to direct signaling.
    }
  }
  if (hostPlatform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall through to direct signaling.
    }
  }
  try {
    child.kill(signal);
  } catch {
    /* Process already exited. */
  }
}

function awaitChildClose(
  child: NodeChildProcess.ChildProcess,
  closed: () => boolean,
) {
  return Effect.callback<void>((resume) => {
    if (closed()) {
      resume(Effect.void);
      return;
    }
    const onClose = () => resume(Effect.void);
    child.once("close", onClose);
    return Effect.sync(() => child.off("close", onClose));
  });
}

export function terminateChild(
  child: NodeChildProcess.ChildProcess,
  closed: () => boolean,
  onSignal: () => void,
) {
  return Effect.suspend(() => {
    if (closed()) return Effect.void;
    return Effect.gen(function* () {
      yield* Effect.sync(() => {
        onSignal();
        killTree(child, "SIGTERM");
      });
      yield* awaitChildClose(child, closed).pipe(
        Effect.timeout(FORCE_KILL_AFTER_MS),
        Effect.ignore,
      );
      if (closed()) return;
      yield* Effect.sync(() => killTree(child, "SIGKILL"));
      yield* awaitChildClose(child, closed).pipe(
        Effect.timeout(500),
        Effect.ignore,
      );
    });
  });
}
