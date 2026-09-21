import * as NodeAssert from "node:assert/strict";

import NodeTest from "node:test";
import * as NodeChildProcess from "node:child_process";
import * as NodeModule from "node:module";
import { TERMINAL_SHUTDOWN_TIMEOUT_MS } from "./src/manager.ts";
import { hostPlatform } from "../shared/host-runtime.ts";

import {
  cwd,
  nodeCmd,
  pollUntil,
  processGone,
  settlement,
  withManager,
} from "./manager.test-support.ts";
import { runTool } from "./src/runtime.ts";

NodeTest("aborting the kill wait does not cancel the termination", async () => {
  await withManager(async (manager, runtime) => {
    const snap = await runTool(
      runtime,
      manager.start({
        command:
          hostPlatform === "win32"
            ? nodeCmd("setInterval(() => {}, 1000)")
            : `exec ${nodeCmd(
                'process.on("SIGTERM", () => process.stdout.write("term\\n")); process.stdout.write("ready\\n"); setInterval(() => {}, 1000);',
              )}`,
        title: "abort-race",
        cwd,
      }),
    );
    const pid = snap.pid;
    NodeAssert.ok(pid);
    if (hostPlatform !== "win32") {
      NodeAssert.ok(
        await pollUntil(() =>
          (manager.view.get(snap.id)?.stdout.text ?? "").includes("ready"),
        ),
        "child installed its SIGTERM handler",
      );
    }

    const reason = new Error("caller stopped waiting");
    const preAborted = new AbortController();
    preAborted.abort(reason);
    await NodeAssert.rejects(
      runTool(runtime, manager.kill([snap.id]), { signal: preAborted.signal }),
      { cause: reason },
    );
    NodeAssert.equal(
      snap.stopRequested,
      undefined,
      "pre-aborted wait never accepted a kill",
    );

    // Once accepted, interrupt only the caller's wait, not owned cleanup.
    const controller = new AbortController();
    const killPromise = runTool(runtime, manager.kill([snap.id]), {
      signal: controller.signal,
      interruptMessage: "aborted",
    });
    NodeAssert.ok(await pollUntil(() => snap.stopRequested === true));
    controller.abort(reason);
    await NodeAssert.rejects(killPromise, {
      message: "aborted",
      cause: reason,
    });

    const { snap: after } = await settlement(manager, snap.id);
    NodeAssert.equal(after.status, "killed");
    if (hostPlatform !== "win32") NodeAssert.equal(after.signal, "SIGKILL");
    NodeAssert.ok(await pollUntil(() => processGone(pid)), "process is gone");
  });
});

NodeTest(
  "normal exit after a stop request preserves its exit code",
  { skip: hostPlatform === "win32" },
  async () => {
    await withManager(async (manager, runtime) => {
      for (const code of [0, 7]) {
        const snap = await runTool(
          runtime,
          manager.start({
            command: `exec ${nodeCmd(`process.on("SIGTERM", () => process.exit(${code})); process.stdout.write("ready\\n"); setInterval(() => {}, 1000);`)}`,
            title: "normal-exit-on-stop",
            cwd,
          }),
        );
        NodeAssert.ok(
          await pollUntil(() => snap.stdout.text.includes("ready")),
        );
        const [result] = await runTool(runtime, manager.kill([snap.id]));
        NodeAssert.equal(result?.stopRequested, true);
        NodeAssert.equal(result?.killed, false);
        NodeAssert.equal(result?.status, code === 0 ? "done" : "failed");
        NodeAssert.equal(snap.exitCode, code);
        NodeAssert.equal(snap.signal, undefined);
      }
    });
  },
);

for (const exitTiming of ["before-stop", "after-cleanup"] as const) {
  NodeTest(
    `incomplete cleanup preserves an exit observed ${exitTiming}, before stdio closes`,
    async (context) => {
      const child = new NodeChildProcess.ChildProcess();
      // Defined pid models successful spawn; zero avoids signaling a real group.
      Object.defineProperty(child, "pid", { value: 0 });
      // No real process is spawned or signaled by this fixture.
      const signals: Array<NodeJS.Signals | number | undefined> = [];
      context.mock.method(child, "kill", (signal?: NodeJS.Signals | number) => {
        signals.push(signal);
        return false;
      });
      const mutableChildProcess: typeof NodeChildProcess =
        NodeModule.createRequire(import.meta.url)("node:child_process");
      const spawn = context.mock.method(
        mutableChildProcess,
        "spawn",
        () => child,
      );
      NodeModule.syncBuiltinESMExports();
      try {
        await withManager(async (manager, runtime) => {
          const events: string[] = [];
          manager.view.setOnSettled((snapshot) => events.push(snapshot.status));
          const snap = await runTool(
            runtime,
            manager.start({ command: "ignored", title: "ignored", cwd }),
          );
          child.emit("error", new Error("fixture signal failure after spawn"));
          if (exitTiming === "before-stop") child.emit("exit", null, "SIGSEGV");
          const [result] = await runTool(runtime, manager.kill([snap.id]), {
            signal: AbortSignal.timeout(TERMINAL_SHUTDOWN_TIMEOUT_MS),
          });
          NodeAssert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
          NodeAssert.equal(
            result?.status,
            exitTiming === "before-stop" ? "failed" : "running",
          );
          NodeAssert.equal(result?.killed, false);
          NodeAssert.equal(result?.stopRequested, true);
          NodeAssert.match(
            result?.cleanupIncomplete ?? "",
            exitTiming === "before-stop"
              ? /stdio did not close/
              : /exit was not observed/,
          );
          if (exitTiming === "after-cleanup")
            NodeAssert.equal(snap.settledAt, undefined);
          NodeAssert.equal(snap.exitCode, undefined);
          NodeAssert.equal(
            snap.stdout.spillPath,
            undefined,
            "early capture is not advertised as a full log",
          );
          if (exitTiming === "after-cleanup") child.emit("exit", 7, null);
          NodeAssert.ok(
            await pollUntil(() => snap.status === "failed"),
            "observed exit settles without waiting for stdio close",
          );
          NodeAssert.ok(snap.settledAt);
          NodeAssert.equal(
            snap.exitCode,
            exitTiming === "before-stop" ? undefined : 7,
          );
          NodeAssert.equal(
            snap.signal,
            exitTiming === "before-stop" ? "SIGSEGV" : undefined,
          );
          NodeAssert.match(snap.cleanupIncomplete ?? "", /stdio did not close/);
          NodeAssert.deepEqual(
            events,
            exitTiming === "before-stop" ? ["failed"] : ["running", "failed"],
          );
          child.emit(
            "close",
            exitTiming === "before-stop" ? null : 7,
            exitTiming === "before-stop" ? "SIGSEGV" : null,
          );
          NodeAssert.equal(snap.cleanupIncomplete, undefined);
        });
      } finally {
        spawn.mock.restore();
        NodeModule.syncBuiltinESMExports();
      }
    },
  );
}

NodeTest(
  "status returns the snapshot and rejects unknown ids with the known list",
  async () => {
    await withManager(async (manager, runtime) => {
      const snap = await runTool(
        runtime,
        manager.start({ command: "true", title: "status", cwd }),
      );
      const seen = await runTool(runtime, manager.status(snap.id));
      NodeAssert.equal(seen.id, snap.id);
      await NodeAssert.rejects(
        runTool(runtime, manager.status("bt-999")),
        /Unknown terminal id "bt-999"\. Known: bt-1\./,
      );
    });
  },
);
