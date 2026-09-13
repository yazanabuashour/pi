import * as NodeAssert from "node:assert/strict";
import { Effect, Exit } from "effect";
import { it, vi } from "vitest";
import { PiPromptLifecycle, type PromptSession } from "./src/session.ts";
import { receipt } from "./pi-session.test-support.ts";

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
