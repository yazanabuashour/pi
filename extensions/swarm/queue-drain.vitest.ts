import * as NodeAssert from "node:assert/strict";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { Effect } from "effect";
import { it } from "vitest";
import { fixture, receipt } from "./pi-session.test-support.ts";

it("owns late steering submission and repeated queue drains until their settlement receipts", async () => {
  const f = fixture();
  const promptFinished = receipt();
  const promptReturned = receipt();
  const steerStarted = receipt();
  const steerFinished = receipt();
  const drainStarted = receipt();
  const drainFinished = receipt();
  f.session.prompt.mockImplementation(async (_text, options) => {
    options?.preflightResult?.(true);
    f.session.isStreaming = true;
    await promptFinished.promise;
    f.session.isStreaming = false;
    promptReturned.resolve();
  });
  f.session.steer.mockImplementation(async () => {
    steerStarted.resolve();
    await steerFinished.promise;
    f.session.agent.hasQueuedMessages.mockReturnValue(true);
  });
  f.session.sendCustomMessage.mockImplementation(async () => {
    drainStarted.resolve();
    await drainFinished.promise;
    // A message queued in the first wake's cleanup requires another wake.
    f.session.agent.hasQueuedMessages.mockReturnValue(
      f.session.sendCustomMessage.mock.calls.length === 1,
    );
  });
  await Effect.runPromise(f.lifecycle.send("first"));
  const steer = Effect.runPromise(f.lifecycle.steer("late"));
  await steerStarted.promise;
  promptFinished.resolve();
  await promptReturned.promise;
  NodeAssert.equal(f.hooks.settled.mock.calls.length, 0);
  NodeAssert.equal(f.session.sendCustomMessage.mock.calls.length, 0);
  steerFinished.resolve();
  await steer;
  await drainStarted.promise;
  NodeAssert.equal(f.lifecycle.active, true);
  NodeAssert.equal(f.hooks.settled.mock.calls.length, 0);
  drainFinished.resolve();
  await f.finished.promise;
  NodeAssert.equal(f.session.sendCustomMessage.mock.calls.length, 2);
  NodeAssert.deepEqual(f.session.sendCustomMessage.mock.calls[0], [
    {
      customType: "swarm-queue-drain",
      content: "Continue with the queued messages.",
      display: false,
    },
    { triggerTurn: true },
  ]);
  NodeAssert.equal(f.session.steer.mock.calls.length, 1);
  NodeAssert.equal(f.session.prompt.mock.calls.length, 1);
  NodeAssert.equal(f.hooks.settled.mock.calls.length, 1);
  await f.lifecycle.dispose();
});

it("waits for an extension-started continuation before draining its remaining queue", async () => {
  const f = fixture();
  const waiting = receipt();
  const continued = receipt();
  f.session.prompt.mockImplementation(async (_text, options) => {
    options?.preflightResult?.(true);
    f.session.isStreaming = true;
    f.session.agent.hasQueuedMessages.mockReturnValue(true);
  });
  f.session.waitForIdle.mockImplementation(async () => {
    waiting.resolve();
    await continued.promise;
    f.session.isStreaming = false;
  });
  f.session.sendCustomMessage.mockImplementation(async () => {
    if (f.session.isStreaming)
      throw new Error("Cannot drain an active continuation");
    f.session.agent.hasQueuedMessages.mockReturnValue(false);
  });
  await Effect.runPromise(f.lifecycle.send("first"));
  await Promise.race([waiting.promise, f.finished.promise]);
  NodeAssert.equal(f.session.waitForIdle.mock.calls.length, 1);
  NodeAssert.equal(f.session.sendCustomMessage.mock.calls.length, 0);
  NodeAssert.equal(f.lifecycle.active, true);
  continued.resolve();
  await f.finished.promise;
  NodeAssert.equal(f.session.sendCustomMessage.mock.calls.length, 1);
  NodeAssert.equal(f.hooks.settled.mock.calls.length, 1);
  await f.lifecycle.dispose();
});

it("interruption observes an ignored queue drain and never wakes its late queue again", async () => {
  const f = fixture();
  const drainStarted = receipt();
  const drainFinished = receipt();
  const aborted = receipt();
  f.session.prompt.mockImplementation(async (_text, options) => {
    options?.preflightResult?.(true);
    f.session.agent.hasQueuedMessages.mockReturnValue(true);
  });
  f.session.sendCustomMessage.mockImplementation(async () => {
    drainStarted.resolve();
    await drainFinished.promise;
    f.session.agent.hasQueuedMessages.mockReturnValue(true);
  });
  f.session.clearQueue.mockImplementation(() => {
    f.session.agent.hasQueuedMessages.mockReturnValue(false);
    return { steering: [], followUp: [] };
  });
  f.session.abort.mockImplementation(async () => aborted.resolve());
  await Effect.runPromise(f.lifecycle.send("first"));
  await drainStarted.promise;
  let interrupted = false;
  const interrupt = Effect.runPromise(f.lifecycle.interrupt).then(() => {
    interrupted = true;
  });
  await aborted.promise;
  NodeAssert.equal(interrupted, false);
  drainFinished.resolve();
  await interrupt;
  NodeAssert.equal(f.session.sendCustomMessage.mock.calls.length, 1);
  NodeAssert.equal(f.session.agent.hasQueuedMessages(), false);
  NodeAssert.equal(f.hooks.settled.mock.calls.length, 0);
  NodeAssert.equal(f.hooks.interrupted.mock.calls.length, 1);
  await f.lifecycle.dispose();
});

it("interruption waits for a late steering submission and clears it before any restart", async () => {
  const f = fixture();
  const promptFinished = receipt();
  const steerStarted = receipt();
  const steerFinished = receipt();
  const aborted = receipt();
  f.session.prompt.mockImplementation(async (_text, options) => {
    options?.preflightResult?.(true);
    f.session.isStreaming = true;
    await promptFinished.promise;
    f.session.isStreaming = false;
  });
  f.session.steer.mockImplementation(async () => {
    steerStarted.resolve();
    await steerFinished.promise;
    f.session.agent.hasQueuedMessages.mockReturnValue(true);
  });
  f.session.clearQueue.mockImplementation(() => {
    f.session.agent.hasQueuedMessages.mockReturnValue(false);
    return { steering: [], followUp: [] };
  });
  f.session.abort.mockImplementation(async () => aborted.resolve());
  await Effect.runPromise(f.lifecycle.send("first"));
  const steer = Effect.runPromise(f.lifecycle.steer("late"));
  await steerStarted.promise;
  let interrupted = false;
  const interrupt = Effect.runPromise(f.lifecycle.interrupt).then(() => {
    interrupted = true;
  });
  await aborted.promise;
  promptFinished.resolve();
  NodeAssert.equal(interrupted, false);
  steerFinished.resolve();
  await Promise.all([steer, interrupt]);
  NodeAssert.equal(f.session.agent.hasQueuedMessages(), false);
  NodeAssert.equal(f.session.sendCustomMessage.mock.calls.length, 0);
  await Effect.runPromise(f.lifecycle.send("manager restart"));
  await f.finished.promise;
  NodeAssert.equal(f.session.sendCustomMessage.mock.calls.length, 0);
  await f.lifecycle.dispose();
});

it("does not wake queued work after an SDK-reported abort", async () => {
  const f = fixture();
  f.session.prompt.mockImplementation(async (_text, options) => {
    options?.preflightResult?.(true);
    f.session.messages.push(
      fauxAssistantMessage("partial", { stopReason: "aborted" }),
    );
    f.session.agent.hasQueuedMessages.mockReturnValue(true);
  });
  await Effect.runPromise(f.lifecycle.send("first"));
  await f.finished.promise;
  NodeAssert.equal(f.session.sendCustomMessage.mock.calls.length, 0);
  NodeAssert.equal(f.session.clearQueue.mock.calls.length, 1);
  await f.lifecycle.dispose();
});

it("reports drain rejection as run failure and clears undelivered work", async () => {
  const f = fixture();
  const cause = new Error("wake failed");
  f.session.prompt.mockImplementation(async (_text, options) => {
    options?.preflightResult?.(true);
    f.session.agent.hasQueuedMessages.mockReturnValue(true);
  });
  f.session.sendCustomMessage.mockRejectedValue(cause);
  await Effect.runPromise(f.lifecycle.send("first"));
  await f.finished.promise;
  NodeAssert.equal(f.hooks.settled.mock.calls[0]?.[0]?.cause, cause);
  NodeAssert.equal(f.session.clearQueue.mock.calls.length, 1);
  await f.lifecycle.dispose();
});
