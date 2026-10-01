import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTimersPromises from "node:timers/promises";
import NodeTest from "node:test";
import { Cause, Effect } from "effect";
import { runCommand } from "./src/process.ts";
import { createRuntime, runEffect } from "./src/runtime.ts";

const runtime = createRuntime();

NodeTest.after(async () => {
  await runtime.dispose();
});

const runNode = (source: string, timeout = 1_000) =>
  runtime.runPromise(
    runCommand(
      process.execPath,
      ["--input-type=module", "--eval", source],
      process.cwd(),
      timeout,
    ),
  );

// Register the whole suite before awaiting, so its after hook disposes once.
await Promise.all([
  NodeTest("captures output and tolerates command failures", async () => {
    const success = await runNode(
      'process.stdout.write("out"); process.stderr.write("err")',
    );

    NodeAssert.deepEqual(success, { code: 0, stderr: "err", stdout: "out" });

    const failure = await runNode("process.exitCode = 7");
    NodeAssert.equal(failure.code, 7);
  }),

  NodeTest(
    "renders platform failures without making callers handle them",
    async () => {
      const command = "git-info-command-that-does-not-exist";

      const result = await runtime.runPromise(
        runCommand(command, [], process.cwd(), 1_000),
      );

      NodeAssert.equal(result.code, 1);
      NodeAssert.match(result.stderr, new RegExp(`Failed to run ${command}:`));
      NodeAssert.match(result.stderr, /NotFound|not found|ENOENT/i);
    },
  ),

  NodeTest("reports command timeouts as failures", async () => {
    const result = await runNode("setTimeout(() => {}, 1_000)", 20);
    NodeAssert.equal(result.code, -1);
  }),
  NodeTest(
    "pre-aborted commands preserve the reason without starting work",
    async () => {
      const reason = new Error("refresh replaced");
      let started = false;

      await NodeAssert.rejects(
        runEffect(
          runtime,
          Effect.sync(() => {
            started = true;
          }),
          {
            signal: AbortSignal.abort(reason),
            interruptMessage: "Refresh cancelled.",
          },
        ),
        { message: "Refresh cancelled.", cause: reason },
      );
      NodeAssert.equal(started, false);
    },
  ),

  NodeTest(
    "cancellation waits for a SIGTERM-resistant command to exit",
    { timeout: 15_000 },
    async (t) => {
      const directory = NodeFS.mkdtempSync(
        NodePath.join(NodeOS.tmpdir(), "git-info-abort-"),
      );

      const pidFile = NodePath.join(directory, "pid");
      const termFile = NodePath.join(directory, "term");
      const controller = new AbortController();
      const reason = new Error("session changed");
      const childRuntime = createRuntime();
      t.after(async () => {
        controller.abort(reason);
        await childRuntime.dispose();
        NodeFS.rmSync(directory, { recursive: true, force: true });
      });

      const source = `
      import { writeFileSync } from "node:fs";
      process.on("SIGTERM", () => writeFileSync(process.argv[2], "received"));
      writeFileSync(process.argv[1], String(process.pid));
      setInterval(() => {}, 1_000);
    `;

      let settled = false;

      const running = runEffect(
        childRuntime,
        runCommand(
          process.execPath,
          ["--input-type=module", "--eval", source, pidFile, termFile],
          process.cwd(),
          30_000,
        ),
        { signal: controller.signal },
      ).finally(() => {
        settled = true;
      });

      const rejection = NodeAssert.rejects(running, {
        message: "Operation was aborted.",
        cause: reason,
      });

      const ready = AbortSignal.timeout(5_000);

      while (!NodeFS.existsSync(pidFile))
        await NodeTimersPromises.setTimeout(10, undefined, { signal: ready });
      const pid = Number(NodeFS.readFileSync(pidFile, "utf8"));
      NodeAssert.ok(Number.isSafeInteger(pid) && pid > 0);
      controller.abort(reason);

      while (!NodeFS.existsSync(termFile))
        await NodeTimersPromises.setTimeout(10, undefined, { signal: ready });
      NodeAssert.equal(
        settled,
        false,
        "interruption owns the command until cleanup finishes",
      );
      await rejection;
      NodeAssert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    },
  ),

  NodeTest(
    "runtime errors preserve typed failures, defects, and cleanup causes",
    async () => {
      const failure = new Error("command boundary failure");

      for (const effect of [Effect.fail(failure), Effect.die(failure)]) {
        await NodeAssert.rejects(runEffect(runtime, effect), (error) => {
          NodeAssert.ok(error instanceof Error);
          NodeAssert.equal(error.message, failure.message);
          NodeAssert.ok(Cause.isCause(error.cause));
          NodeAssert.equal(Cause.squash(error.cause), failure);

          return true;
        });
      }

      const cleanup = new Error("cleanup failed");
      const controller = new AbortController();
      let signalStarted = () => {};

      const started = new Promise<void>((resolve) => {
        signalStarted = resolve;
      });

      const effect = Effect.callback<void>((_resume, _signal) => {
        signalStarted();

        return Effect.die(cleanup);
      });

      const result = NodeAssert.rejects(
        runEffect(runtime, effect, { signal: controller.signal }),
        (error) => {
          NodeAssert.ok(error instanceof Error);
          NodeAssert.equal(error.message, cleanup.message);
          NodeAssert.ok(Cause.isCause(error.cause));
          NodeAssert.ok(Cause.hasInterrupts(error.cause));
          NodeAssert.equal(Cause.squash(error.cause), cleanup);

          return true;
        },
      );

      await started;
      controller.abort(new Error("refresh cancelled"));
      await result;
    },
  ),
]);
