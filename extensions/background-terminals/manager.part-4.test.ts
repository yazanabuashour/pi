import * as NodeAssert from "node:assert/strict";

import * as NodeFS from "node:fs";

import * as NodePath from "node:path";

import NodeTest from "node:test";

import {
  cwd,
  nodeCmd,
  settlement,
  withManager,
} from "./manager.test-support.ts";
import type { TerminalSnapshot } from "./src/domain.ts";
import { MAX_TRACKED, TerminalManager } from "./src/manager.ts";
import { createTerminalRuntime, runTool } from "./src/runtime.ts";

NodeTest(
  "pruning drops the oldest settled entries past MAX_TRACKED, never running ones",
  async () => {
    await withManager(async (manager, runtime) => {
      const keeper = await runTool(
        runtime,
        manager.start({
          command: nodeCmd("setInterval(() => {}, 1000)"),
          title: "keeper",
          cwd,
        }),
      );

      const settledIds: string[] = [];
      let oldestLog: string | undefined;
      for (let i = 0; i < MAX_TRACKED + 4; i++) {
        const snap = await runTool(
          runtime,
          manager.start({ command: "true", title: `quick-${i}`, cwd }),
        );
        settledIds.push(snap.id);
        await settlement(manager, snap.id);
        if (i === 0) oldestLog = snap.stdout.spillPath;
      }

      const oldestId = settledIds[0];
      const latestId = settledIds.at(-1);
      NodeAssert.ok(oldestId);
      NodeAssert.ok(latestId);

      const remaining = manager.view.list().map((snap) => snap.id);
      NodeAssert.equal(remaining.length <= MAX_TRACKED, true);
      // The running entry survived pruning.
      NodeAssert.equal(remaining.includes(keeper.id), true);
      // The earliest settled entries were pruned first.
      NodeAssert.equal(remaining.includes(oldestId), false);
      NodeAssert.ok(oldestLog);
      NodeAssert.equal(
        NodeFS.existsSync(oldestLog),
        true,
        "record pruning leaves session log files",
      );
      // The latest settled entries survive.
      NodeAssert.equal(remaining.includes(latestId), true);

      const [historical] = await runTool(runtime, manager.kill([oldestId]));
      NodeAssert.ok(historical);
      NodeAssert.equal(historical.title, "quick-0");
      NodeAssert.equal(historical.status, "done");
      NodeAssert.equal(historical.wasRunning, false);
      NodeAssert.equal(historical.killed, false);
    });
  },
);

NodeTest("runtime disposal removes the private spill directory", async () => {
  const runtime = createTerminalRuntime();
  const manager = await runtime.runPromise(TerminalManager);
  const snap = await runTool(
    runtime,
    manager.start({ command: "node --version", title: "cleanup", cwd }),
  );
  const { snap: done } = await settlement(manager, snap.id);
  const spillPath = done.stdout.spillPath;
  NodeAssert.ok(spillPath);
  const spillDir = NodePath.dirname(spillPath);
  NodeAssert.equal(NodeFS.existsSync(spillDir), true);

  await runtime.dispose();

  NodeAssert.equal(NodeFS.existsSync(spillDir), false);
});

NodeTest(
  "an unknown command settles failed with the platform shell's non-zero exit",
  async () => {
    await withManager(async (manager, runtime) => {
      const snap = await runTool(
        runtime,
        manager.start({
          command: "definitely-not-a-real-binary-12345",
          title: "bogus",
          cwd,
        }),
      );
      const { snap: failed } = await settlement(manager, snap.id);
      NodeAssert.equal(failed.status, "failed");
      // The platform shell reports a non-zero exit and explains the failure.
      NodeAssert.notEqual(failed.exitCode, 0);
      NodeAssert.ok(
        failed.stderr.text.length > 0,
        "stderr explains the failure",
      );
    });
  },
);

NodeTest(
  "a process 'error' event settles failed with errorText and no bogus exit code",
  async () => {
    await withManager(async (manager, runtime) => {
      // spawn() with a nonexistent cwd emits ENOENT via the 'error' event
      // (the tool layer validates cwd; the manager must still be correct).
      const snap = await runTool(
        runtime,
        manager.start({
          command: "true",
          title: "bad-cwd",
          cwd: "/definitely/not/a/real/dir-12345",
        }),
      );
      const { snap: failed } = await settlement(manager, snap.id);
      NodeAssert.equal(failed.status, "failed");
      NodeAssert.match(failed.errorText ?? "", /ENOENT/);
      // Node's 'close' after a spawn 'error' reports the errno (e.g. -2) as
      // its code; that must not leak into exitCode.
      NodeAssert.equal(failed.exitCode, undefined);
      NodeAssert.equal(failed.signal, undefined);
    });
  },
);

NodeTest(
  "the spill file holds the complete capture when the settle hook fires, beyond the in-memory cap",
  async () => {
    await withManager(async (manager, runtime) => {
      const chunk = 1 << 16; // 64 KiB per write
      const writes = 48; // 3 MiB total > 2 MiB RETAINED_PER_STREAM
      const totalBytes = chunk * writes;

      let spillSizeAtSettle = -1;
      const settledOnce = new Promise<TerminalSnapshot>((resolve) => {
        manager.view.setOnSettled((snap) => {
          // Measured inside the hook: the full capture must already be on disk
          // when the completion follow-up (which cites this path) is queued.
          if (snap.stdout.spillPath) {
            spillSizeAtSettle = NodeFS.statSync(snap.stdout.spillPath).size;
          }
          resolve(snap);
        });
      });

      const snap = await runTool(
        runtime,
        manager.start({
          command: nodeCmd(
            `const s = "x".repeat(${chunk}); for (let i = 0; i < ${writes}; i++) process.stdout.write(s);`,
          ),
          title: "firehose",
          cwd,
        }),
      );
      const done = await settledOnce;
      NodeAssert.equal(done.id, snap.id);
      NodeAssert.equal(done.status, "done");
      NodeAssert.equal(done.stdout.totalBytes, totalBytes);
      // In-memory retention is bounded; the head was dropped.
      NodeAssert.ok(
        done.stdout.truncatedBytes > 0,
        "head was truncated in memory",
      );
      NodeAssert.ok(
        Buffer.byteLength(done.stdout.text) <= 2 * 1024 * 1024,
        "retained text within the cap",
      );
      if (done.stdout.spillPath) {
        NodeAssert.equal(
          spillSizeAtSettle,
          totalBytes,
          "spill file was fully flushed before the settle hook",
        );
      }
    });
  },
);
