import * as NodeAssert from "node:assert/strict";

import * as NodeFS from "node:fs";

import * as NodePath from "node:path";

import NodeTest from "node:test";
import * as NodeOS from "node:os";
import { flushSpillStreams } from "./src/manager-spill.ts";
import type { Entry } from "./src/manager-contract.ts";

import {
  cwd,
  nodeCmd,
  pollUntil,
  settlement,
  withManager,
} from "./manager.test-support.ts";
import type { TerminalSnapshot } from "./src/domain.ts";
import { MAX_TRACKED, TerminalManager } from "./src/manager.ts";
import { createTerminalRuntime, runTool } from "./src/runtime.ts";

await NodeTest(
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

await NodeTest(
  "runtime disposal removes the private spill directory",
  async () => {
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
  },
);

await NodeTest(
  "a process 'error' event settles failed with errorText and no bogus exit code",
  async () => {
    await withManager(async (manager, runtime) => {
      // The manager must handle ENOENT even when tool-layer cwd validation is bypassed.
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
      // Node's close event can carry errno after a spawn error, not a process exit code.
      NodeAssert.equal(failed.exitCode, undefined);
      NodeAssert.equal(failed.signal, undefined);
    });
  },
);

await NodeTest(
  "stalled spill flush keeps resource ownership through late close",
  async (test) => {
    const dir = NodeFS.mkdtempSync(
      NodePath.join(NodeOS.tmpdir(), "spill-stall-"),
    );

    test.after(() => NodeFS.rmSync(dir, { recursive: true, force: true }));
    let releaseWrite: (() => void) | undefined;

    const file = NodeFS.createWriteStream(NodePath.join(dir, "log"), {
      fs: {
        open: NodeFS.open,
        close: NodeFS.close,
        write: (_fd, buffer, _offset, length, _position, callback) => {
          releaseWrite = () => {
            releaseWrite = undefined;
            callback(null, length, buffer);
          };
        },
      },
    });

    const streamErrors: Error[] = [];
    file.on("error", (error) => streamErrors.push(error));
    const closed = new Promise<void>((resolve) => file.once("close", resolve));
    test.after(async () => {
      file.destroy();
      releaseWrite?.();
      await closed;
    });

    const fd = await new Promise<number>((resolve) =>
      file.once("open", resolve),
    );

    file.write("fixture");
    NodeAssert.ok(await pollUntil(() => releaseWrite !== undefined));

    const entry: Entry = Object.assign(Object.create(null), {
      spillStreams: [file],
      stdoutBuf: { spillPath: "log" },
      stderrBuf: { spillPath: "log" },
      snapshot: {},
    });

    await withManager(async (_manager, runtime) => {
      await runTool(runtime, flushSpillStreams(entry));
    });
    NodeAssert.match(entry.snapshot.cleanupIncomplete ?? "", /flush timed out/);
    NodeAssert.equal(entry.stdoutBuf.spillPath, undefined);
    NodeAssert.equal(
      file.destroyed,
      true,
      "timeout requests stream cancellation",
    );
    NodeAssert.ok(
      entry.spillStreams.includes(file),
      "ignored cancellation remains owned until close",
    );
    releaseWrite?.();
    await closed;
    NodeAssert.throws(
      () => NodeFS.fstatSync(fd),
      { code: "EBADF" },
      "late callback closes the real descriptor",
    );
    NodeAssert.deepEqual(entry.spillStreams, []);
    NodeAssert.ok(
      streamErrors.every((error) =>
        error.message.includes("stream was destroyed"),
      ),
    );
  },
);

await NodeTest(
  "the spill file holds the complete capture when the settle hook fires, beyond the in-memory cap",
  async () => {
    await withManager(async (manager, runtime) => {
      const chunk = 1 << 16; // 64 KiB per write
      const writes = 48; // 3 MiB total > 2 MiB RETAINED_PER_STREAM
      const totalBytes = chunk * writes;

      let spillSizeAtSettle = -1;

      const settledOnce = new Promise<TerminalSnapshot>((resolve) => {
        manager.view.setOnSettled((snap) => {
          // The full capture must be on disk before completion cites its path.
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

      NodeAssert.ok(done.stdout.spillPath);
      NodeAssert.equal(
        spillSizeAtSettle,
        totalBytes,
        "spill file was fully flushed before the settle hook",
      );
    });
  },
);
