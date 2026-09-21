import { Cause, Effect, Exit, Scope, Stream } from "effect";
import type { SessionFactory } from "./session.ts";
import { MAX_RUNNING, type Entry } from "./manager-contract.ts";
import { foldEvent } from "./manager-events.ts";
import { abortEntry } from "./manager-operations.ts";
import {
  notify,
  canAct,
  runningCount,
  settle,
  type ManagerState,
} from "./manager-state.ts";
import type { SpawnTask } from "./domain.ts";
import { ConcurrencyLimitError, SpawnError } from "./domain.ts";

function reserveSpawn(state: ManagerState) {
  return Effect.suspend(
    (): Effect.Effect<void, SpawnError | ConcurrencyLimitError> => {
      if (state.disposed) {
        return new SpawnError({
          message: "Swarm manager is shutting down.",
        });
      }
      if (runningCount(state) + state.reserved >= MAX_RUNNING) {
        return new ConcurrencyLimitError({
          message: `Max ${MAX_RUNNING} agents can run concurrently. Wait for one to finish before spawning another.`,
        });
      }
      state.reserved++;
      return Effect.void;
    },
  );
}

function createEntry(
  state: ManagerState,
  task: SpawnTask,
  createSession: SessionFactory["Service"],
  scope: Scope.Closeable,
) {
  return Effect.gen(function* () {
    const origin = task.origin ?? "model";
    const parentId = task.swarm?.parentId ?? "root";
    const parentGeneration = state.entries.get(parentId)?.snapshot.generation;
    const parentIsCurrent = () =>
      parentId === "root" ||
      (canAct(state, parentId) &&
        state.entries.get(parentId)?.snapshot.generation === parentGeneration);
    if (!parentIsCurrent())
      return yield* new SpawnError({
        message: "Swarm parent is no longer active.",
      });
    const id =
      origin === "model"
        ? `sa-${++state.modelCounter}`
        : `${origin}-${++state.userCounter}`;
    const session = yield* Scope.provide(
      createSession({
        ...task,
        customTools: task.swarm?.toolsFor(id) ?? [],
      }),
      scope,
    );
    const meta = yield* session.meta;
    if (state.disposed || !parentIsCurrent()) {
      return yield* new SpawnError({
        message: "Swarm parent or manager stopped while creating the child.",
      });
    }
    return {
      snapshot: {
        id,
        origin,
        parentId,
        canSpawn: task.swarm?.canSpawn ?? false,
        title: task.title,
        prompt: task.prompt,
        cwd: task.cwd,
        generation: 1,
        status: "running",
        createdAt: Date.now(),
        meta,
        usage: { contextWindow: meta.contextWindow },
        transcript: [],
        liveTools: [],
        queued: [],
        finalText: "",
        turns: 0,
      },
      session,
      scope,
      liveToolMap: new Map(),
    } satisfies Entry;
  });
}

function startPump(state: ManagerState, entry: Entry) {
  const pump = Stream.runForEach(entry.session.events, (event) =>
    Effect.sync(() =>
      foldEvent(state, entry, event, (target) => abortEntry(state, target)),
    ),
  ).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        if (
          state.entries.get(entry.snapshot.id) === entry &&
          !state.disposed &&
          !entry.stopping &&
          entry.snapshot.status === "running"
        ) {
          settle(state, entry, {
            _tag: "Failed",
            errorText: "Agent event stream ended unexpectedly",
          });
        }
      }),
    ),
  );
  return Scope.provide(Effect.forkScoped(pump), entry.scope);
}

function spawnReserved(
  state: ManagerState,
  createSession: SessionFactory["Service"],
  task: SpawnTask,
  releaseReservation: () => void,
) {
  return Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      let entry: Entry | undefined;
      return yield* restore(
        Effect.gen(function* () {
          entry = yield* createEntry(state, task, createSession, scope);
          state.entries.set(entry.snapshot.id, entry);
          releaseReservation();
          if (state.onStarted?.(entry.snapshot) === false) {
            return yield* new SpawnError({
              message:
                "Agent spawn was stopped because its lifecycle receipt could not be persisted.",
            });
          }
          yield* startPump(state, entry);
          if (!canAct(state, entry.snapshot.id)) {
            return yield* new SpawnError({
              message:
                "Agent stopped before its initial prompt was dispatched.",
            });
          }
          yield* entry.session
            .send(task.prompt)
            .pipe(Effect.mapError((error) => new SpawnError(error)));
          if (!canAct(state, entry.snapshot.id)) {
            return yield* new SpawnError({
              message: "Agent stopped during initial prompt admission.",
            });
          }
          notify(state, entry.snapshot.id);
          return entry.snapshot;
        }),
      ).pipe(
        Effect.onError((cause) =>
          Effect.gen(function* () {
            if (entry) {
              settle(
                state,
                entry,
                Cause.hasInterruptsOnly(cause)
                  ? { _tag: "Interrupted" }
                  : { _tag: "Failed", errorText: Cause.pretty(cause) },
              );
              state.entries.delete(entry.snapshot.id);
            }
            yield* Scope.close(scope, Exit.void);
          }),
        ),
      );
    }),
  );
}

export function spawnAgent(
  state: ManagerState,
  createSession: SessionFactory["Service"],
  task: SpawnTask,
) {
  return Effect.gen(function* () {
    yield* reserveSpawn(state);
    let reserved = true;
    const releaseReservation = () => {
      if (!reserved) return;
      reserved = false;
      state.reserved--;
    };
    return yield* spawnReserved(
      state,
      createSession,
      task,
      releaseReservation,
    ).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          releaseReservation();
          notify(state);
        }),
      ),
    );
  });
}
