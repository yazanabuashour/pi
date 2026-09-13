import * as NodeAssert from "node:assert/strict";
import NodeTest from "node:test";
import { MAX_AGENT_CALLS, RunController } from "./controller.ts";
import { runWorkflowWorker } from "./worker.ts";
import * as NodeEvents from "node:events";
import * as NodeModule from "node:module";
// The mutable CommonJS export lets the pre-abort test observe real spawn calls.
// oxlint-disable-next-line project/namespace-node-imports
import NodeChildProcess from "node:child_process";

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

NodeTest(
  "RunController reserves calls synchronously and caps global fanout",
  async () => {
    const controller = new RunController(undefined, 4);
    let active = 0;
    let peak = 0;
    const tasks = Array.from({ length: 12 }, (_, index) =>
      controller.schedule(async () => {
        active++;
        peak = Math.max(peak, active);
        await delay(5);
        active--;
        return index;
      }),
    );
    NodeAssert.deepEqual(
      await Promise.all(tasks),
      Array.from({ length: 12 }, (_, i) => i),
    );
    NodeAssert.equal(peak, 4);
    NodeAssert.equal(await controller.settle(), true);
  },
);

NodeTest(
  "RunController propagates invocation cancellation without aborting the run",
  async () => {
    const controller = new RunController(undefined, 1);
    const invocation = new AbortController();
    const pending = controller.schedule(
      (signal) =>
        new Promise<string>((resolve) => {
          signal.addEventListener("abort", () => resolve("stopped"), {
            once: true,
          });
        }),
      invocation.signal,
    );

    invocation.abort(new Error("Workflow agent request was cancelled"));
    await NodeAssert.rejects(pending, /request was cancelled/);
    NodeAssert.equal(controller.signal.aborted, false);
    NodeAssert.equal(
      await controller.schedule(async () => "recovered"),
      "recovered",
    );
    NodeAssert.equal(await controller.settle(), true);
  },
);

NodeTest(
  "RunController enforces call budget and aborts queued tasks",
  async () => {
    const controller = new RunController(undefined, 1);
    const blocker = controller.schedule(
      (signal) =>
        new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        ),
    );
    const queued = Array.from({ length: MAX_AGENT_CALLS - 1 }, () =>
      controller.schedule(async () => "queued"),
    );
    await NodeAssert.rejects(
      controller.schedule(async () => "too many"),
      /exceeded the limit/,
    );
    controller.abort();
    await NodeAssert.rejects(blocker, /Workflow was aborted/);
    const results = await Promise.allSettled(queued);
    NodeAssert.ok(results.every((result) => result.status === "rejected"));
    NodeAssert.equal(await controller.settle({ abort: true }), true);
  },
);

NodeTest("worker pre-abort preserves the reason before admission", async () => {
  // Bun does not synchronize named builtin exports. Both runtimes check the
  // pre-abort result; Node additionally observes spawn with a verified spy.
  const canSpy = !process.versions["bun"];
  const spawn = NodeChildProcess.spawn;
  let calls = 0;
  if (canSpy) {
    NodeChildProcess.spawn = () => {
      calls++;
      throw new Error("must not spawn");
    };
    NodeModule.syncBuiltinESMExports();
  }
  try {
    const controller = new AbortController();
    const reason = new Error("pre-abort fixture");
    const run = () =>
      runWorkflowWorker({
        source: "return 1;",
        args: undefined,
        cwd: process.cwd(),
        signal: controller.signal,
        onAgent: async () => ({ ok: true, output: "unused" }),
        onPhase: () => {},
      });
    if (canSpy) {
      await NodeAssert.rejects(run(), /must not spawn/);
      NodeAssert.equal(calls, 1);
    }
    controller.abort(reason);
    await NodeAssert.rejects(run(), (error) => error === reason);
    NodeAssert.equal(calls, canSpy ? 1 : 0);
    NodeAssert.equal(
      NodeEvents.EventEmitter.getEventListeners(controller.signal, "abort")
        .length,
      0,
    );
  } finally {
    if (canSpy) {
      NodeChildProcess.spawn = spawn;
      NodeModule.syncBuiltinESMExports();
    }
  }
});

NodeTest(
  "RunController owns ignored-signal tasks after worker exit",
  async () => {
    const parent = new AbortController();
    const controller = new RunController(parent.signal);
    const reason = new Error("cancel pending fixture");
    let start: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      start = resolve;
    });
    let release: (() => void) | undefined;
    const ignored = new Promise<void>((resolve) => {
      release = resolve;
    });
    let agentSignal: AbortSignal | undefined;
    let pid = 0;
    const pending = runWorkflowWorker({
      source: 'phase(String(process.pid)); return await agent("pending");',
      args: undefined,
      cwd: process.cwd(),
      signal: controller.signal,
      onPhase: (title) => {
        pid = Number(title);
      },
      onAgent: (_prompt, _options, signal) =>
        controller.schedule(async (taskSignal) => {
          agentSignal = taskSignal;
          start?.();
          await ignored;
          return { ok: true, output: "late" };
        }, signal),
    });
    await started;
    parent.abort(reason);
    await NodeAssert.rejects(pending, (error) => error === reason);
    NodeAssert.ok(pid > 0);
    NodeAssert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    NodeAssert.equal(agentSignal?.reason, reason);
    let settled = false;
    const settlement = controller.settle().then((value) => {
      settled = true;
      return value;
    });
    await Promise.resolve();
    NodeAssert.equal(settled, false);
    release?.();
    NodeAssert.equal(await settlement, true);
    NodeAssert.equal(
      NodeEvents.EventEmitter.getEventListeners(parent.signal, "abort").length,
      0,
    );
  },
);
