import * as NodeAssert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { spawnStubSession } from "./manager.test-support.ts";
import { SendError, type SpawnTask } from "./src/domain.ts";
import { SwarmManager, SwarmManagerLive } from "./src/manager.ts";
import { SessionFactory } from "./src/session.ts";

const task = (title: string): SpawnTask => ({
  title,
  prompt: title,
  cwd: process.cwd(),
  parent: { projectTrusted: false },
});

it.live(
  "cancelling a parent revokes an in-flight descendant acquisition before dispatch",
  () =>
    Effect.gen(function* () {
      const creating = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const disposed = yield* Deferred.make<void>();
      let dispatched = false;
      const layer = SwarmManagerLive.pipe(
        Layer.provide(
          Layer.succeed(SessionFactory, (spawnTask) =>
            Effect.gen(function* () {
              if (spawnTask.title === "child") {
                yield* Deferred.succeed(creating, undefined);
                yield* Deferred.await(release);
                yield* Effect.addFinalizer(() =>
                  Deferred.succeed(disposed, undefined),
                );
              }
              const session = yield* spawnStubSession(spawnTask);
              return {
                ...session,
                send: (text: string) => {
                  if (spawnTask.title === "child") dispatched = true;
                  return session.send(text);
                },
              };
            }),
          ),
        ),
      );
      yield* Effect.gen(function* () {
        const manager = yield* SwarmManager;
        const parent = yield* manager.spawn(task("parent"));
        const child = yield* Effect.forkChild(
          manager
            .spawn({
              ...task("child"),
              swarm: {
                parentId: parent.id,
                canSpawn: false,
                toolsFor: () => [],
              },
            })
            .pipe(Effect.result),
        );
        yield* Deferred.await(creating);
        yield* manager.cancel([parent.id]);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(child);
        yield* Deferred.await(disposed);
        NodeAssert.equal(dispatched, false);
        NodeAssert.equal(manager.view.size(), 1);
      }).pipe(Effect.provide(layer));
    }),
);

it.live("failed initial admission closes its published lifecycle receipt", () =>
  Effect.gen(function* () {
    const receipts: string[] = [];
    const layer = SwarmManagerLive.pipe(
      Layer.provide(
        Layer.succeed(SessionFactory, (spawnTask) =>
          Effect.map(spawnStubSession(spawnTask), (session) => ({
            ...session,
            send: () =>
              Effect.fail(new SendError({ message: "preflight rejected" })),
          })),
        ),
      ),
    );
    yield* Effect.gen(function* () {
      const manager = yield* SwarmManager;
      manager.view.setOnStarted((snapshot) => {
        receipts.push(`${snapshot.id}:started`);
        return true;
      });
      manager.view.setOnSettled((snapshot) =>
        receipts.push(`${snapshot.id}:${snapshot.outcome}`),
      );
      yield* Effect.flip(manager.spawn(task("rejected")));
      NodeAssert.deepEqual(receipts, ["sa-1:started", "sa-1:failed"]);
      NodeAssert.equal(manager.view.size(), 0);
    }).pipe(Effect.provide(layer));
  }),
);

it.live("abort defects fail visibly and still close the owned session", () =>
  Effect.gen(function* () {
    let closed = false;
    const layer = SwarmManagerLive.pipe(
      Layer.provide(
        Layer.succeed(SessionFactory, (spawnTask) =>
          Effect.gen(function* () {
            const session = yield* spawnStubSession(spawnTask);
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                closed = true;
              }),
            );
            return {
              ...session,
              interrupt: Effect.die(new Error("fixture abort failure")),
            };
          }),
        ),
      ),
    );
    yield* Effect.gen(function* () {
      const manager = yield* SwarmManager;
      const child = yield* manager.spawn(task("child"));
      yield* manager.cancel([child.id]);
      const result = manager.view.get(child.id);
      NodeAssert.equal(result?.outcome, "failed");
      NodeAssert.match(result?.errorText ?? "", /fixture abort failure/);
      NodeAssert.equal(manager.view.canAct(child.id), false);
      NodeAssert.equal(closed, true);
    }).pipe(Effect.provide(layer));
  }),
);
