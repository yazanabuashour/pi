import * as NodeAssert from "node:assert/strict";
import { Effect, Exit, Scope } from "effect";
import {
  defineTool,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { SessionFactory } from "./src/session.ts";
import { PiSessionLayer } from "./src/pi.ts";
import { it, vi } from "vitest";
import { PiPromptLifecycle, type PromptSession } from "./src/session.ts";
import { receipt, factoryFixture } from "./pi-session.test-support.ts";

it("keeps ignored raw tool execution owned after SDK prompt abort and bounds disposal honestly", async () => {
  const raw = receipt();
  const invoked = receipt();
  const definition = defineTool({
    name: "ignored_abort",
    label: "fixture",
    description: "fixture",
    parameters: Type.Object({}),
    async execute() {
      invoked.resolve();
      await raw.promise;
      return { content: [], details: {} };
    },
  });
  const f = await factoryFixture([definition]);
  const controller = new AbortController();
  const scope = Effect.runSync(Scope.make());
  const child = await Effect.runPromise(
    Scope.provide(
      Effect.flatMap(SessionFactory, (factory) => factory(f.task)).pipe(
        Effect.provide(PiSessionLayer(async () => f.session)),
      ),
      scope,
    ),
  );
  const tool = f.session.getToolDefinition("ignored_abort");
  NodeAssert.ok(tool);
  vi.mocked(f.session.prompt).mockImplementation(async (_text, options) => {
    options?.preflightResult?.(true);
    // SAFETY: this fixture tool does not read its extension context.
    const context = {} as ExtensionContext;
    await tool.execute("call-1", {}, controller.signal, undefined, context);
  });
  f.session.abort = async () => {
    controller.abort(new Error("stop requested"));
  };
  await Effect.runPromise(child.send("start"));
  await invoked.promise;
  let stopped = false;
  const interrupt = Effect.runPromise(child.interrupt).then(() => {
    stopped = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  NodeAssert.equal(stopped, false);
  NodeAssert.ok(child.pendingResources?.().includes("ignored_abort:call-1"));
  vi.useFakeTimers();
  try {
    const closing = Effect.runPromiseExit(Scope.close(scope, Exit.void));
    await vi.advanceTimersByTimeAsync(5_001);
    NodeAssert.ok(Exit.isFailure(await closing));
    NodeAssert.equal(vi.mocked(f.session.dispose).mock.calls.length, 1);
    NodeAssert.equal(stopped, false);
    raw.reject(new Error("late tool rejection"));
    await interrupt;
    NodeAssert.deepEqual(child.pendingResources?.(), []);
  } finally {
    raw.resolve();
    vi.useRealTimers();
  }
});

it("steering at the SDK idle boundary returns for manager readmission rather than starting a turn", async () => {
  const firstFinished = receipt();
  const secondFinished = receipt();
  const secondStarted = receipt();
  const drainStarted = receipt();
  const drainSteered = receipt();
  const drainFinished = receipt();
  let queued = true;
  let streaming = false;
  const session: PromptSession = {
    get isStreaming() {
      return streaming;
    },
    waitForIdle: async () => {},
    messages: [],
    agent: { hasQueuedMessages: () => queued },
    sendCustomMessage: vi.fn(async () => {
      streaming = true;
      drainStarted.resolve();
      NodeAssert.equal(
        await Effect.runPromise(lifecycle.steer("from drain")),
        true,
      );
      drainSteered.resolve();
      await drainFinished.promise;
      queued = false;
      streaming = false;
    }),
    prompt: vi.fn(async (text, options) => {
      options?.preflightResult?.(true);
      if (text === "first") await firstFinished.promise;
      else {
        secondStarted.resolve();
        await secondFinished.promise;
      }
    }),
    steer: vi.fn(async () => {}),
    clearQueue: () => ({ steering: [], followUp: [] }),
    abort: async () => {},
  };
  const lifecycle = new PiPromptLifecycle(session, {
    started() {},
    settled() {},
    interrupted() {},
  });
  await Effect.runPromise(lifecycle.send("first"));
  let returnedToManager = false;
  const steer = Effect.runPromise(lifecycle.steer("second")).then((result) => {
    returnedToManager = true;
    return result;
  });
  firstFinished.resolve();
  await drainStarted.promise;
  NodeAssert.equal(returnedToManager, false);
  NodeAssert.equal(lifecycle.active, true);
  NodeAssert.equal(vi.mocked(session.prompt).mock.calls.length, 1);
  await drainSteered.promise;
  drainFinished.resolve();
  NodeAssert.equal(await steer, false);
  NodeAssert.equal(vi.mocked(session.prompt).mock.calls.length, 1);
  const second = Effect.runPromise(lifecycle.send("second"));
  await secondStarted.promise;
  await second;
  NodeAssert.equal(vi.mocked(session.prompt).mock.calls.length, 2);
  NodeAssert.deepEqual(vi.mocked(session.steer).mock.calls, [["from drain"]]);
  secondFinished.resolve();
  await lifecycle.dispose();
});

it("cancelling a pending peer steer observes it without aborting the recipient", async () => {
  const steerStarted = receipt();
  const steerFinished = receipt();
  const session: PromptSession = {
    isStreaming: true,
    waitForIdle: async () => {},
    messages: [],
    agent: { hasQueuedMessages: () => false },
    sendCustomMessage: vi.fn(async () => {}),
    prompt: vi.fn(async () => {}),
    steer: vi.fn(async () => {
      steerStarted.resolve();
      await steerFinished.promise;
    }),
    clearQueue: () => ({ steering: [], followUp: [] }),
    abort: vi.fn(async () => {}),
  };
  const lifecycle = new PiPromptLifecycle(session, {
    started() {},
    settled() {},
    interrupted() {},
  });
  const controller = new AbortController();
  const send = Effect.runPromiseExit(lifecycle.steer("peer update"), {
    signal: controller.signal,
  });
  await steerStarted.promise;
  controller.abort(new Error("sender cancelled"));
  steerFinished.resolve();
  NodeAssert.ok(Exit.isFailure(await send));
  NodeAssert.equal(vi.mocked(session.abort).mock.calls.length, 0);
  await lifecycle.dispose();
});
