import * as NodeAssert from "node:assert/strict";

import * as NodeFS from "node:fs";

import * as NodePath from "node:path";

import NodeTest from "node:test";
import { hostPlatform } from "../shared/host-runtime.ts";

import {
  cwd,
  nodeCmd,
  pollUntil,
  settlement,
  withManager,
} from "./manager.test-support.ts";
import { runTool } from "./src/runtime.ts";

NodeTest(
  "happy path: stdout and stderr captured separately, settles done, hook fires once unconsumed",
  async () => {
    await withManager(async (manager, runtime) => {
      const settled: Array<{ id: string; status: string; consumed: boolean }> =
        [];
      manager.view.setOnSettled((snap, consumed) =>
        settled.push({ id: snap.id, status: snap.status, consumed }),
      );

      const snap = await runTool(
        runtime,
        manager.start({
          command: nodeCmd(
            'process.stdout.write("out-line\\n"); process.stderr.write("err-line\\n");',
          ),
          title: "happy",
          cwd,
        }),
      );
      NodeAssert.equal(snap.status, "running");
      NodeAssert.ok(snap.pid);
      NodeAssert.equal(snap.command.includes("out-line"), true);

      const { snap: done } = await settlement(manager, snap.id);
      NodeAssert.equal(done.status, "done");
      NodeAssert.equal(done.exitCode, 0);
      NodeAssert.equal(done.signal, undefined);
      NodeAssert.equal(done.stdout.text, "out-line\n");
      NodeAssert.equal(done.stderr.text, "err-line\n");
      NodeAssert.ok(done.settledAt);
      NodeAssert.deepEqual(settled, [
        { id: snap.id, status: "done", consumed: false },
      ]);

      // Spill files hold the full capture.
      if (done.stdout.spillPath) {
        NodeAssert.equal(
          NodeFS.readFileSync(done.stdout.spillPath, "utf8"),
          "out-line\n",
        );
        if (hostPlatform !== "win32") {
          NodeAssert.equal(
            NodeFS.statSync(done.stdout.spillPath).mode & 0o777,
            0o600,
          );
          NodeAssert.equal(
            NodeFS.statSync(NodePath.dirname(done.stdout.spillPath)).mode &
              0o777,
            0o700,
          );
        }
      }
      if (done.stderr.spillPath) {
        NodeAssert.equal(
          NodeFS.readFileSync(done.stderr.spillPath, "utf8"),
          "err-line\n",
        );
      }
    });
  },
);

NodeTest("non-zero exit settles as failed with the exit code", async () => {
  await withManager(async (manager, runtime) => {
    const snap = await runTool(
      runtime,
      manager.start({
        command: nodeCmd("process.exit(3)"),
        title: "fails",
        cwd,
      }),
    );
    const { snap: failed } = await settlement(manager, snap.id);
    NodeAssert.equal(failed.status, "failed");
    NodeAssert.equal(failed.exitCode, 3);
  });
});

NodeTest(
  "kill settles a never-exiting process as killed and resolves after settle; repeat kill is a no-op",
  async () => {
    await withManager(async (manager, runtime) => {
      const snap = await runTool(
        runtime,
        manager.start({
          command: nodeCmd("setInterval(() => {}, 1000)"),
          title: "immortal",
          cwd,
        }),
      );
      NodeAssert.equal(snap.status, "running");

      const report = await runTool(runtime, manager.kill([snap.id]));
      NodeAssert.equal(report.length, 1);
      const [result] = report;
      NodeAssert.ok(result);
      NodeAssert.equal(result.id, snap.id);
      NodeAssert.equal(result.title, "immortal");
      NodeAssert.equal(result.status, "killed");
      NodeAssert.equal(result.killed, true);
      NodeAssert.equal(result.wasRunning, true);
      NodeAssert.match(result.exit, /^SIG/);
      const after = manager.view.get(snap.id);
      NodeAssert.equal(after?.status, "killed");
      NodeAssert.ok(after?.signal);

      const second = await runTool(runtime, manager.kill([snap.id]));
      const [secondResult] = second;
      NodeAssert.ok(secondResult);
      NodeAssert.equal(secondResult.killed, false);
      NodeAssert.equal(secondResult.wasRunning, false);
      NodeAssert.equal(secondResult.status, "killed");
    });
  },
);

NodeTest(
  "a SIGTERM-resistant child is escalated to SIGKILL within the teardown bound",
  { skip: hostPlatform === "win32" },
  async () => {
    await withManager(async (manager, runtime) => {
      const snap = await runTool(
        runtime,
        manager.start({
          command: `exec ${nodeCmd(
            'process.on("SIGTERM", () => process.stdout.write("term\\n")); process.stdout.write("ready\\n"); setInterval(() => {}, 1000);',
          )}`,
          title: "term-resistant",
          cwd,
        }),
      );
      NodeAssert.ok(
        await pollUntil(() =>
          (manager.view.get(snap.id)?.stdout.text ?? "").includes("ready"),
        ),
        "child installed its SIGTERM handler",
      );

      const startedAt = Date.now();
      const [result] = await runTool(runtime, manager.kill([snap.id]));
      const elapsed = Date.now() - startedAt;

      NodeAssert.ok(result);
      NodeAssert.equal(result.status, "killed");
      NodeAssert.equal(manager.view.get(snap.id)?.signal, "SIGKILL");
      NodeAssert.match(manager.view.get(snap.id)?.stdout.text ?? "", /term/);
      NodeAssert.ok(
        elapsed >= 1_500,
        `SIGKILL was not immediate (${elapsed}ms)`,
      );
      NodeAssert.ok(
        elapsed < 4_500,
        `termination exceeded its bound (${elapsed}ms)`,
      );
    });
  },
);
