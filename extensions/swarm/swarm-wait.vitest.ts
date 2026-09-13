import * as NodeAssert from "node:assert/strict";
import { Effect, Queue, Stream } from "effect";
import { expect, it, vi } from "vitest";
import type { AgentEvent } from "./src/domain.ts";
import { MAX_TRACKED } from "./src/manager.ts";
import type { SessionFactory } from "./src/session.ts";
import { harness } from "./swarm.test-support.ts";

function deferred() {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  NodeAssert.ok(resolve);
  return { promise, resolve };
}

function controlledSessions() {
  const queues = new Map<string, Queue.Queue<AgentEvent>>();
  const createSession: SessionFactory["Service"] = (task) =>
    Effect.gen(function* () {
      const events = yield* Queue.make<AgentEvent>();
      queues.set(task.title, events);
      return {
        meta: Effect.succeed({}),
        events: Stream.fromQueue(events),
        send: (text: string) =>
          Queue.offerAll(events, [
            { _tag: "RunStarted" },
            { _tag: "UserMessage", text },
          ]).pipe(Effect.asVoid),
        steer: () => Effect.succeed(true),
        interrupt: Queue.offer(events, {
          _tag: "RunSettled",
          outcome: { _tag: "Interrupted" },
        }).pipe(Effect.asVoid),
      };
    });
  const emit = (title: string, event: AgentEvent) => {
    const events = queues.get(title);
    NodeAssert.ok(events);
    Effect.runSync(Queue.offer(events, event));
  };
  const complete = (title: string, finalText: string) =>
    emit(title, {
      _tag: "RunSettled",
      outcome: { _tag: "Completed", finalText },
    });
  return { createSession, emit, complete };
}

it("only reports pending IDs initially and when they change", async () => {
  const { createSession, emit, complete } = controlledSessions();
  const h = await harness(createSession);
  const first = await h.spawn(h.root, "first");
  const second = await h.spawn(h.root, "second");
  const unrelated = await h.spawn(h.root, "unrelated");
  const started = deferred();
  const reduced = deferred();
  const onPending = vi.fn((pending: string[]) => {
    started.resolve();
    if (pending.length === 1) reduced.resolve();
  });
  const waiting = h.runtime.runPromise(
    h.manager.waitFor([first.id, second.id, first.id], onPending),
  );
  await started.promise;
  for (const child of [first, unrelated]) {
    const changed = deferred();
    const unsubscribe = h.manager.view.subscribeTo(child.id, changed.resolve);
    try {
      emit(child.title, {
        _tag: "AssistantDelta",
        kind: "text",
        delta: "progress",
      });
      await changed.promise;
    } finally {
      unsubscribe();
    }
  }
  complete(first.title, "first result");
  await reduced.promise;
  complete(second.title, "second result");
  const results = await waiting;
  expect(onPending.mock.calls).toEqual([
    [[first.id, second.id]],
    [[second.id]],
  ]);
  expect(results).toMatchObject([
    { id: first.id, generation: 1, status: "done", finalText: "first result" },
    {
      id: second.id,
      generation: 1,
      status: "done",
      finalText: "second result",
    },
  ]);
});

it("returns waited runs after retention pruning and before a newer generation", async () => {
  const { createSession, complete } = controlledSessions();
  const h = await harness(createSession);
  for (let index = 0; index < MAX_TRACKED; index++) {
    const child = await h.spawn(h.root, `retained-${index}`);
    await h.runtime.runPromise(
      h.manager.waitFor(
        [child.id],
        vi
          .fn()
          .mockImplementationOnce(() => complete(child.title, child.title)),
      ),
    );
  }
  const oldest = h.manager.view.list()[0];
  NodeAssert.ok(oldest);
  const latest = await h.spawn(h.root, "latest");
  expect(h.manager.view.size()).toBe(MAX_TRACKED + 1);
  const consume = vi.spyOn(h.session, "consume");
  const waitFor = h.manager.waitFor;
  // Restart after the join releases interest, before the tool continuation runs.
  vi.spyOn(h.manager, "waitFor").mockImplementation((ids, onPending) =>
    waitFor(ids, onPending).pipe(
      Effect.tap(() =>
        h.manager.send(latest.id, "next generation").pipe(Effect.orDie),
      ),
    ),
  );
  const result = await h.call(
    h.root,
    "swarm_wait",
    { ids: [oldest.id, latest.id, oldest.id] },
    vi
      .fn()
      .mockImplementationOnce(() =>
        complete(latest.title, "latest first result"),
      ),
  );
  expect(h.manager.view.get(oldest.id)).toBeUndefined();
  expect(h.manager.view.size()).toBe(MAX_TRACKED);
  expect(result.content).toEqual([
    {
      type: "text",
      text: `## ${oldest.id} "${oldest.title}" finished\n\n${oldest.title}\n\n---\n\n## ${latest.id} "latest" finished\n\nlatest first result`,
    },
  ]);
  expect(result.details).toMatchObject({
    results: [oldest.id, latest.id].map((id) => ({
      id,
      generation: 1,
      status: "done",
      outcome: "completed",
    })),
  });
  expect(consume).toHaveBeenCalledWith([
    expect.objectContaining({ id: oldest.id, generation: 1 }),
    expect.objectContaining({ id: latest.id, generation: 1 }),
  ]);
  expect(h.manager.view.get(latest.id)).toMatchObject({
    generation: 2,
    status: "running",
  });
  complete(latest.title, "latest second result");
  await h.resultReceived;
  expect(h.messages).toEqual([
    [
      expect.objectContaining({
        customType: "swarm-result",
        details: expect.objectContaining({ id: latest.id, generation: 2 }),
      }),
      { deliverAs: "followUp", triggerTurn: true },
    ],
  ]);
});
