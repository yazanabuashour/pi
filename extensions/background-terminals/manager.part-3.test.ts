import * as NodeAssert from "node:assert/strict";

import NodeTest from "node:test";
import { hostPlatform } from "../shared/host-runtime.ts";

import { Effect } from "effect";

import {
  cwd,
  nodeCmd,
  pollUntil,
  processGone,
  settlement,
  withManager,
} from "./manager.test-support.ts";
import { MAX_RUNNING, TerminalManager } from "./src/manager.ts";
import { createTerminalRuntime, runTool } from "./src/runtime.ts";

NodeTest(
  "kill preserves a natural exit observed before the signal point",
  { skip: hostPlatform === "win32" },
  async () => {
    await withManager(async (manager, runtime) => {
      const snap = await runTool(
        runtime,
        manager.start({
          command: `node -e "setInterval(()=>{},1e3)" & echo "child:$!"; exit 0`,
          title: "natural-race",
          cwd,
        }),
      );
      NodeAssert.ok(
        await pollUntil(() =>
          (manager.view.get(snap.id)?.stdout.text ?? "").includes("child:"),
        ),
      );
      const match = /child:(\d+)/.exec(
        manager.view.get(snap.id)?.stdout.text ?? "",
      );
      NodeAssert.ok(match);
      const grandchild = Number(match[1]);
      const pid = snap.pid;
      NodeAssert.ok(pid);
      NodeAssert.ok(await pollUntil(() => processGone(pid)));
      NodeAssert.equal(manager.view.get(snap.id)?.status, "running");

      const [result] = await runTool(runtime, manager.kill([snap.id]));
      NodeAssert.ok(result);
      NodeAssert.equal(result.wasRunning, true);
      NodeAssert.equal(result.killed, false);
      NodeAssert.equal(result.status, "done");
      NodeAssert.equal(result.exit, "exit 0");
      NodeAssert.ok(await pollUntil(() => processGone(grandchild)));
    });
  },
);

NodeTest(
  "concurrency cap rejects an extra start; a failed spawn releases its slot",
  async () => {
    await withManager(async (manager, runtime) => {
      const spawns = await runTool(
        runtime,
        Effect.forEach(
          Array.from({ length: MAX_RUNNING }, (_, n) => n),
          (n) =>
            manager.start({
              command: nodeCmd("setInterval(() => {}, 1000)"),
              title: `filler-${n}`,
              cwd,
            }),
          { concurrency: "unbounded" },
        ),
      );
      NodeAssert.equal(spawns.length, MAX_RUNNING);
      await NodeAssert.rejects(
        runTool(
          runtime,
          manager.start({ command: "true", title: "extra", cwd }),
        ),
        new RegExp(`Max ${MAX_RUNNING} background terminals`),
      );

      // Free one slot; a bogus binary settles as failed near-instantly (the
      // 'error'/'exit' path), leaving the slot free again.
      const firstSpawn = spawns[0];
      NodeAssert.ok(firstSpawn);
      await runTool(runtime, manager.kill([firstSpawn.id]));
      const bogus = await runTool(
        runtime,
        manager.start({
          command: "definitely-not-a-real-binary-12345",
          title: "bogus",
          cwd,
        }),
      );
      const { snap: settled } = await settlement(manager, bogus.id);
      NodeAssert.equal(settled.status, "failed");
      // The settled bogus entry does not occupy a running slot.
      const again = await runTool(
        runtime,
        manager.start({
          command: nodeCmd("setInterval(() => {}, 1000)"),
          title: "refill",
          cwd,
        }),
      );
      NodeAssert.equal(again.status, "running");
    });
  },
);

NodeTest(
  "a settle during an in-flight kill reports consumed: true",
  async () => {
    await withManager(async (manager, runtime) => {
      const settled: Array<{ id: string; consumed: boolean }> = [];
      manager.view.setOnSettled((snap, consumed) =>
        settled.push({ id: snap.id, consumed }),
      );
      const snap = await runTool(
        runtime,
        manager.start({
          command: nodeCmd("setInterval(() => {}, 1000)"),
          title: "consumed",
          cwd,
        }),
      );
      await runTool(runtime, manager.kill([snap.id]));
      NodeAssert.deepEqual(settled, [{ id: snap.id, consumed: true }]);
    });
  },
);

NodeTest("UI requestKill settles as killed and is NOT consumed", async () => {
  await withManager(async (manager, runtime) => {
    const settled: Array<{ id: string; status: string; consumed: boolean }> =
      [];
    manager.view.setOnSettled((snap, consumed) =>
      settled.push({ id: snap.id, status: snap.status, consumed }),
    );
    const snap = await runTool(
      runtime,
      manager.start({
        command: nodeCmd("setInterval(() => {}, 1000)"),
        title: "ui-kill",
        cwd,
      }),
    );
    manager.view.requestKill(snap.id);
    const { snap: after } = await settlement(manager, snap.id);
    NodeAssert.equal(after.status, "killed");
    NodeAssert.deepEqual(settled, [
      { id: snap.id, status: "killed", consumed: false },
    ]);
  });
});

NodeTest(
  "beginShutdown closes admission and returns every running terminal",
  async () => {
    await withManager(async (manager, runtime) => {
      const running = await runTool(
        runtime,
        manager.start({
          command: nodeCmd("setInterval(() => {}, 1_000)"),
          title: "shutdown admission",
          cwd,
        }),
      );

      NodeAssert.deepEqual(
        manager.view.beginShutdown().map((snapshot) => snapshot.id),
        [running.id],
      );
      await NodeAssert.rejects(
        runTool(
          runtime,
          manager.start({ command: "true", title: "too late", cwd }),
        ),
        /manager is shutting down/,
      );
    });
  },
);

NodeTest(
  "runtime.dispose kills running processes; no settle hook fires after dispose",
  async () => {
    const runtime = createTerminalRuntime();
    const manager = await runtime.runPromise(TerminalManager);
    const settled: string[] = [];
    manager.view.setOnSettled((snap) => settled.push(snap.id));

    const snap = await runTool(
      runtime,
      manager.start({
        command: nodeCmd("setInterval(() => {}, 1000)"),
        title: "disposed",
        cwd,
      }),
    );
    const pid = snap.pid;
    NodeAssert.ok(pid);

    await runtime.dispose();
    NodeAssert.ok(await pollUntil(() => processGone(pid)), "process killed");
    // The disposed guard suppressed the hook.
    NodeAssert.deepEqual(settled, []);
    // start after dispose is rejected (by the runtime itself, or by the
    // manager's disposed guard if the effect still runs).
    await NodeAssert.rejects(
      runTool(runtime, manager.start({ command: "true", title: "late", cwd })),
      /shutting down|disposed/,
    );
  },
);
