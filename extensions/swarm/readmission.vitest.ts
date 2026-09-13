import * as NodeAssert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Queue, Result, Stream } from "effect";
import type { SpawnTask, AgentEvent } from "./src/domain.ts";
import { MAX_RUNNING, SwarmManager, SwarmManagerLive } from "./src/manager.ts";
import { SessionFactory } from "./src/session.ts";

const task = (title: string): SpawnTask => ({
  title,
  prompt: title,
  cwd: process.cwd(),
  parent: { projectTrusted: false },
});

function boundarySend(boundary: "capacity" | "cancel" | "readmit") {
  return Effect.gen(function* () {
    const steering = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const queues = new Map<string, Queue.Queue<AgentEvent>>();
    const starts: string[] = [];
    const receipts: string[] = [];
    const layer = SwarmManagerLive.pipe(
      Layer.provide(
        Layer.succeed(SessionFactory, (spawnTask) =>
          Effect.gen(function* () {
            const events = yield* Queue.make<AgentEvent>();
            queues.set(spawnTask.title, events);
            return {
              meta: Effect.succeed({}),
              events: Stream.fromQueue(events),
              send: () =>
                Effect.sync(() => {
                  starts.push(spawnTask.title);
                }).pipe(
                  Effect.andThen(Queue.offer(events, { _tag: "RunStarted" })),
                  Effect.asVoid,
                ),
              steer: () =>
                Effect.gen(function* () {
                  yield* Deferred.succeed(steering, undefined);
                  yield* Deferred.await(release);
                  return false;
                }),
              interrupt: Queue.offer(events, {
                _tag: "RunSettled",
                outcome: { _tag: "Interrupted" },
              }).pipe(Effect.asVoid),
            };
          }),
        ),
      ),
    );
    yield* Effect.gen(function* () {
      const manager = yield* SwarmManager;
      manager.view.setOnStarted((snapshot) => {
        receipts.push(`${snapshot.id}:${snapshot.generation}:start`);
        return true;
      });
      manager.view.setOnSettled((snapshot) => {
        receipts.push(`${snapshot.id}:${snapshot.generation}:settle`);
      });
      const target = yield* manager.spawn(task("target"));
      for (let i = 1; i < MAX_RUNNING; i++)
        yield* manager.spawn(task(`peer-${i}`));
      const send = yield* Effect.forkChild(
        manager.send(target.id, "more work").pipe(Effect.result),
      );
      yield* Deferred.await(steering);
      const events = queues.get("target");
      NodeAssert.ok(events);
      yield* Queue.offer(events, {
        _tag: "RunSettled",
        outcome: { _tag: "Completed", finalText: "first run" },
      });
      yield* manager.waitFor([target.id]);
      if (boundary === "capacity") yield* manager.spawn(task("replacement"));
      if (boundary === "cancel") yield* manager.cancel([target.id]);
      yield* Deferred.succeed(release, undefined);
      const result = yield* Fiber.join(send);
      if (boundary === "readmit") {
        NodeAssert.ok(Result.isSuccess(result));
        NodeAssert.deepEqual(
          receipts.filter((receipt) => receipt.startsWith(`${target.id}:`)),
          [
            `${target.id}:1:start`,
            `${target.id}:1:settle`,
            `${target.id}:2:start`,
          ],
        );
        NodeAssert.equal(
          starts.filter((title) => title === "target").length,
          2,
        );
      } else {
        NodeAssert.ok(Result.isFailure(result));
        NodeAssert.match(
          result.failure.message,
          boundary === "capacity" ? /Max .*agents/ : /stopped/,
        );
        NodeAssert.equal(
          starts.filter((title) => title === "target").length,
          1,
        );
        NodeAssert.equal(manager.view.get(target.id)?.generation, 1);
      }
    }).pipe(Effect.provide(layer));
  });
}

it.live(
  "a boundary-crossing send rechecks capacity before starting another run",
  () => boundarySend("capacity"),
);
it.live("cancelling an idle recipient revokes an already pending send", () =>
  boundarySend("cancel"),
);
it.live("a boundary-crossing send records a fresh manager admission", () =>
  boundarySend("readmit"),
);
