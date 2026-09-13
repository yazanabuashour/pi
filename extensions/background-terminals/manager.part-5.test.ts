import * as NodeAssert from "node:assert/strict";

import NodeTest from "node:test";
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

    // Abort the tool call immediately: the kill wait is interrupted, but the
    // SIGTERM→SIGKILL teardown must continue detached in the background.
    const controller = new AbortController();
    const killPromise = runTool(runtime, manager.kill([snap.id]), {
      signal: controller.signal,
      interruptMessage: "aborted",
    });
    controller.abort();
    await NodeAssert.rejects(killPromise, /aborted/);

    const { snap: after } = await settlement(manager, snap.id);
    NodeAssert.equal(after.status, "killed");
    if (hostPlatform !== "win32") NodeAssert.equal(after.signal, "SIGKILL");
    NodeAssert.ok(await pollUntil(() => processGone(pid)), "process is gone");
  });
});

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
