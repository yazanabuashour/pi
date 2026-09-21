import { Cause, Effect, Exit, Fiber } from "effect";
import {
  MAX_RUNNING,
  STOP_TIMEOUT_MS,
  type CancelResult,
  type Entry,
  type MutableSnapshot,
  type SwarmReadModel,
} from "./manager-contract.ts";
import { SendError, WaitError } from "./domain.ts";
import {
  addInterest,
  canAct,
  closeEntryBounded,
  recordCleanupIncomplete,
  nextChange,
  notify,
  pruneSettled,
  releaseInterest,
  runningCount,
  settle,
  type ManagerState,
} from "./manager-state.ts";

export function waitForAgents(
  state: ManagerState,
  ids: ReadonlyArray<string>,
  onPending?: (pending: string[]) => void,
) {
  return Effect.suspend(() => {
    const unique = [...new Set(ids)];
    addInterest(state, unique);
    const loop = Effect.gen(function* () {
      let previousPending: string[] = [];
      while (true) {
        const pending = unique.filter(
          (id) => state.entries.get(id)?.snapshot.status === "running",
        );
        const incomplete = pending.filter(
          (id) => state.entries.get(id)?.snapshot.cleanupIncomplete,
        );
        if (incomplete.length > 0)
          return yield* new WaitError({
            message: `Execution settlement is unconfirmed after incomplete cleanup: ${incomplete.join(", ")}. Inspect swarm_check; this wait cannot confirm completion.`,
          });
        if (pending.length === 0) {
          // Wait interest protects these runs only until the finalizer prunes.
          return unique.flatMap((id) => {
            const snapshot = state.entries.get(id)?.snapshot;
            return snapshot ? [structuredClone(snapshot)] : [];
          });
        }
        if (
          pending.length !== previousPending.length ||
          pending.some((id, index) => id !== previousPending[index])
        ) {
          previousPending = pending;
          onPending?.([...pending]);
        }
        yield* nextChange(state);
      }
    });
    return loop.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          releaseInterest(state, unique);
          pruneSettled(state);
        }),
      ),
    );
  });
}

export function abortEntry(state: ManagerState, entry: Entry) {
  return Effect.gen(function* () {
    entry.stopping = true;
    if (entry.snapshot.status !== "running") return;
    entry.snapshot.stopRequested = true;
    const graceful = yield* Effect.gen(function* () {
      yield* entry.session.interrupt;
      while (entry.snapshot.status === "running") yield* nextChange(state);
    }).pipe(Effect.timeout(STOP_TIMEOUT_MS), Effect.exit);
    if (Exit.isSuccess(graceful)) return;
    recordCleanupIncomplete(
      state,
      entry,
      `Interruption failed or settlement is still pending: ${Cause.pretty(graceful.cause)}`,
    );
    yield* closeEntryBounded(state, entry);
  });
}

export function cancelAgents(state: ManagerState, ids: ReadonlyArray<string>) {
  return Effect.suspend(() => {
    const branch = new Set(ids);
    let changed = true;
    while (changed) {
      changed = false;
      for (const entry of state.entries.values()) {
        if (
          branch.has(entry.snapshot.parentId) &&
          !branch.has(entry.snapshot.id)
        ) {
          branch.add(entry.snapshot.id);
          changed = true;
        }
      }
    }
    const unique = [...branch];
    const running = unique.flatMap((id) => {
      const entry = state.entries.get(id);
      if (entry) entry.stopping = true;
      return entry?.snapshot.status === "running" ? [entry] : [];
    });
    const runningIds = running.map((entry) => entry.snapshot.id);
    addInterest(state, runningIds);
    const work = Effect.gen(function* () {
      yield* Effect.forEach(running, (entry) => abortEntry(state, entry), {
        concurrency: "unbounded",
      });
    });
    return work.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          releaseInterest(state, runningIds);
          pruneSettled(state);
        }),
      ),
      Effect.map(
        (): ReadonlyArray<CancelResult> =>
          unique.map((id) => {
            const snapshot = state.entries.get(id)?.snapshot;
            const result: CancelResult = {
              id,
              title: snapshot?.title ?? "?",
              status: snapshot?.status ?? "error",
              cancelled:
                runningIds.includes(id) && snapshot?.outcome === "interrupted",
              stopRequested: runningIds.includes(id),
            };
            return snapshot?.cleanupIncomplete
              ? {
                  ...result,
                  cleanupIncomplete: snapshot.cleanupIncomplete,
                  pendingResources: snapshot.pendingResources,
                }
              : result;
          }),
      ),
    );
  });
}

function restartAgent(state: ManagerState, entry: Entry, text: string) {
  const id = entry.snapshot.id;
  if (entry.cleanup || entry.snapshot.cleanupIncomplete)
    return new SendError({
      message: `Swarm agent ${id} has incomplete cleanup or a disposed session; it cannot be restarted.`,
    });
  if (runningCount(state) + state.reserved >= MAX_RUNNING) {
    return new SendError({
      message: `Max ${MAX_RUNNING} agents can run concurrently; restarting "${id}" would exceed that.`,
    });
  }
  entry.stopping = false;
  if (!canAct(state, id)) {
    entry.stopping = true;
    return new SendError({ message: `Swarm ancestor of ${id} is cancelled.` });
  }
  entry.restarting = true;
  const admittedSnapshot: MutableSnapshot = {
    ...entry.snapshot,
    generation: entry.snapshot.generation + 1,
    status: "running",
    outcome: undefined,
    settledAt: undefined,
    errorText: undefined,
    stopRequested: undefined,
    cleanupIncomplete: undefined,
    pendingResources: undefined,
  };
  if (state.onStarted?.(admittedSnapshot) === false) {
    entry.restarting = false;
    return new SendError({
      message:
        "Agent restart was stopped because its lifecycle receipt could not be persisted.",
    });
  }
  Object.assign(entry.snapshot, admittedSnapshot);
  notify(state, id);
  return entry.session.send(text).pipe(
    Effect.onExit((exit) =>
      Exit.isSuccess(exit)
        ? Effect.void
        : Effect.sync(() => {
            entry.restarting = false;
            settle(state, entry, {
              _tag: "Failed",
              errorText: "Agent restart failed before it began",
            });
          }),
    ),
  );
}

function steerOrReadmit(state: ManagerState, entry: Entry, text: string) {
  return Effect.gen(function* () {
    const { id, generation } = entry.snapshot;
    if (yield* entry.session.steer(text)) return;
    // The adapter observed settlement. Wait for its event receipt before a new
    // manager admission, without consuming the previous run's completion.
    while (
      canAct(state, id) &&
      entry.snapshot.status === "running" &&
      entry.snapshot.generation === generation
    ) {
      yield* nextChange(state);
    }
    if (!canAct(state, id))
      return yield* new SendError({
        message: `Swarm agent ${id} stopped before message admission.`,
      });
    return yield* sendToAgent(state, id, text);
  });
}

export function sendToAgent(state: ManagerState, id: string, text: string) {
  return Effect.suspend((): Effect.Effect<void, SendError> => {
    const entry = state.entries.get(id);
    if (!entry || state.disposed) {
      return new SendError({
        message: `Agent "${id}" is no longer tracked.`,
      });
    }
    if (entry.restarting) {
      return new SendError({
        message: `Agent "${id}" is already restarting.`,
      });
    }
    if (entry.snapshot.status !== "running")
      return restartAgent(state, entry, text);
    if (!canAct(state, id))
      return new SendError({ message: `Swarm agent ${id} is stopping.` });
    return steerOrReadmit(state, entry, text);
  });
}

export function disposeAgents(state: ManagerState) {
  return Effect.gen(function* () {
    state.disposed = true;
    const all = [...state.entries.values()];
    yield* Effect.forEach(all, (entry) => closeEntryBounded(state, entry), {
      concurrency: "unbounded",
    });
    yield* Effect.forEach([...state.cleanups], (fiber) => Fiber.await(fiber), {
      concurrency: "unbounded",
    });
    yield* Effect.sync(() => notify(state));
  });
}

export function createReadModel(state: ManagerState): SwarmReadModel {
  return {
    list: () => [...state.entries.values()].map((entry) => entry.snapshot),
    get: (id) => state.entries.get(id)?.snapshot,
    size: () => state.entries.size,
    canAct: (id) => canAct(state, id),
    beginShutdown: () => {
      state.disposed = true;
      return [...state.entries.values()].flatMap(({ snapshot }) =>
        snapshot.status === "running" ? [snapshot] : [],
      );
    },
    cleanupFailures: () => [...state.cleanupFailures.values()],
    setOnCleanupIncomplete: (hook) => {
      state.onCleanupIncomplete = hook;
    },
    subscribe: (listener) => {
      state.listeners.add(listener);
      return () => state.listeners.delete(listener);
    },
    subscribeTo: (id, listener) => {
      let listeners = state.idListeners.get(id);
      if (!listeners) {
        listeners = new Set();
        state.idListeners.set(id, listeners);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) state.idListeners.delete(id);
      };
    },
    requestSend: (id, text) => {
      state.runDetached(sendToAgent(state, id, text).pipe(Effect.ignore));
    },
    requestAbort: (id) => {
      state.runDetached(cancelAgents(state, [id]).pipe(Effect.asVoid));
    },
    setOnStarted: (hook) => {
      state.onStarted = hook;
    },
    setOnSettled: (hook) => {
      state.onSettled = hook;
    },
  };
}
