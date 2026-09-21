import * as NodeAssert from "node:assert/strict";

import * as NodeFS from "node:fs";

import * as NodeOS from "node:os";

import * as NodePath from "node:path";

import NodeTest from "node:test";
import { hostPlatform } from "../shared/host-runtime.ts";

import { Effect } from "effect";

import {
  cwd,
  nodeCmd,
  pollUntil,
  processGone,
  withManager,
} from "./manager.test-support.ts";
import { runTool } from "./src/runtime.ts";

NodeTest(
  "concurrent overlapping multi-id kills observe each settlement exactly once",
  async () => {
    await withManager(async (manager, runtime) => {
      const settled: Array<{ id: string; consumed: boolean }> = [];
      manager.view.setOnSettled((snap, consumed) =>
        settled.push({ id: snap.id, consumed }),
      );
      const [first, second] = await runTool(
        runtime,
        Effect.forEach(
          ["first", "second"],
          (title) =>
            manager.start({
              command: nodeCmd("setInterval(() => {}, 1000)"),
              title,
              cwd,
            }),
          { concurrency: "unbounded" },
        ),
      );

      NodeAssert.ok(first);
      NodeAssert.ok(second);

      const reports = await runTool(
        runtime,
        Effect.all(
          [
            manager.kill([first.id, second.id, first.id]),
            manager.kill([second.id, first.id]),
          ],
          { concurrency: "unbounded" },
        ),
      );

      NodeAssert.deepEqual(
        reports.map((report) => report.map((entry) => entry.id)),
        [
          [first.id, second.id],
          [second.id, first.id],
        ],
      );
      NodeAssert.ok(reports.flat().every((entry) => entry.status === "killed"));
      NodeAssert.deepEqual(
        settled.sort((a, b) => a.id.localeCompare(b.id)),
        [
          { id: first.id, consumed: true },
          { id: second.id, consumed: true },
        ].sort((a, b) => a.id.localeCompare(b.id)),
      );
    });
  },
);

NodeTest(
  "kill terminates descendants that remain in the process group",
  { skip: hostPlatform === "win32" },
  async () => {
    await withManager(async (manager, runtime) => {
      const sentinelDir = NodeFS.mkdtempSync(
        NodePath.join(NodeOS.tmpdir(), "bt-tree-test-"),
      );
      const sentinel = NodePath.join(sentinelDir, "heartbeat");
      const snap = await runTool(
        runtime,
        manager.start({
          // sh spawns node in the background and prints the grandchild pid,
          // then waits forever so the group stays alive.
          command: `node -e 'const fs = require("node:fs"); const file = ${JSON.stringify(sentinel)}; let n = 0; fs.writeFileSync(file, String(n)); setInterval(() => fs.writeFileSync(file, String(++n)), 25)' & echo "child:$!"; wait`,
          title: "tree",
          cwd,
        }),
      );

      // Wait for the grandchild pid line.
      NodeAssert.ok(
        await pollUntil(() =>
          (manager.view.get(snap.id)?.stdout.text ?? "").includes("child:"),
        ),
        "grandchild pid was printed",
      );
      const text = manager.view.get(snap.id)?.stdout.text ?? "";
      const match = /child:(\d+)/.exec(text);
      NodeAssert.ok(match, "parsed grandchild pid");
      const grandchild = Number(match[1]);
      NodeAssert.equal(processGone(grandchild), false);
      NodeAssert.ok(
        await pollUntil(() => NodeFS.existsSync(sentinel)),
        "heartbeat exists",
      );
      const heartbeatBefore = NodeFS.readFileSync(sentinel, "utf8");
      NodeAssert.ok(
        await pollUntil(
          () => NodeFS.readFileSync(sentinel, "utf8") !== heartbeatBefore,
        ),
        "heartbeat belongs to the live grandchild",
      );

      await runTool(runtime, manager.kill([snap.id]));
      NodeAssert.ok(
        await pollUntil(() => processGone(grandchild)),
        "grandchild process is gone after group kill",
      );
      const stoppedAt = NodeFS.readFileSync(sentinel, "utf8");
      await new Promise((resolve) => setTimeout(resolve, 100));
      NodeAssert.equal(
        NodeFS.readFileSync(sentinel, "utf8"),
        stoppedAt,
        "the unique grandchild heartbeat stopped",
      );
      NodeFS.rmSync(sentinelDir, { recursive: true, force: true });
    });
  },
);

NodeTest(
  "a shell exit with inherited pipes open settles naturally and reaps descendants",
  { skip: hostPlatform === "win32" },
  async () => {
    await withManager(async (manager, runtime) => {
      const snap = await runTool(
        runtime,
        manager.start({
          command: `node -e "setInterval(()=>{},1e3)" & echo "child:$!"; exit 0`,
          title: "exited-shell",
          cwd,
        }),
      );
      NodeAssert.ok(
        await pollUntil(() =>
          (manager.view.get(snap.id)?.stdout.text ?? "").includes("child:"),
        ),
        "descendant pid was printed",
      );
      const match = /child:(\d+)/.exec(
        manager.view.get(snap.id)?.stdout.text ?? "",
      );
      NodeAssert.ok(match);
      const grandchild = Number(match[1]);
      const pid = snap.pid;
      NodeAssert.ok(pid);
      NodeAssert.ok(await pollUntil(() => processGone(pid)), "shell exited");
      NodeAssert.equal(manager.view.get(snap.id)?.status, "running");

      NodeAssert.ok(
        await pollUntil(
          () => manager.view.get(snap.id)?.status !== "running",
          7_000,
        ),
        "entry settled after the bounded post-exit grace",
      );
      NodeAssert.equal(manager.view.get(snap.id)?.status, "done");
      NodeAssert.equal(manager.view.get(snap.id)?.exitCode, 0);
      NodeAssert.ok(
        await pollUntil(() => processGone(grandchild)),
        "surviving process-group descendant was reaped",
      );
    });
  },
);
