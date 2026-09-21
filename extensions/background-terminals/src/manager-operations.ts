import * as NodeFS from "node:fs";
import { Deferred, Effect, FiberSet } from "effect";
import {
  STOP_TIMEOUT_MS,
  type Entry,
  type KillResult,
  type TerminalReadModel,
} from "./manager-contract.ts";
import { formatExit } from "./domain.ts";
import {
  addKillInterest,
  closeEntryScope,
  notify,
  pruneSettled,
  releaseKillInterest,
  settle,
  type ManagerState,
} from "./manager-state.ts";

export function killEntry(state: ManagerState, entry: Entry) {
  return Effect.sync(() => {
    if (entry.snapshot.status !== "running" || entry.snapshot.stopRequested)
      return;
    entry.snapshot.stopRequested = true;
    notify(state, entry.snapshot.id);
    state.runCleanup(
      closeEntryScope(entry).pipe(
        Effect.timeout(STOP_TIMEOUT_MS),
        Effect.ignore,
        Effect.ensuring(
          Effect.sync(() => {
            if (
              entry.snapshot.status !== "running" ||
              entry.settling ||
              Deferred.isDoneUnsafe(entry.settled)
            )
              return;
            entry.snapshot.cleanupIncomplete ??=
              "Cleanup ended without observing process exit";
            settle(state, entry);
          }),
        ),
      ),
    );
  });
}

function killReport(
  state: ManagerState,
  ids: ReadonlyArray<string>,
  entries: ReadonlyMap<string, Entry>,
  runningIds: ReadonlyArray<string>,
) {
  return ids.map((id): KillResult => {
    const snapshot = entries.get(id)?.snapshot;
    const history = state.settledHistory.get(id);
    const known = snapshot ?? history;
    const status = known?.status ?? "running";
    const cleanupIncomplete =
      known?.cleanupIncomplete ??
      (!known ? "Terminal is no longer tracked; exit is unknown" : undefined);
    const wasRunning = runningIds.includes(id);
    return {
      id,
      title: snapshot?.title ?? history?.title ?? "?",
      status,
      wasRunning,
      killed: wasRunning && status === "killed",
      stopRequested: known?.stopRequested,
      cleanupIncomplete,
      exit: snapshot ? formatExit(snapshot) : (history?.exit ?? "unknown"),
    };
  });
}

export function killTerminals(state: ManagerState, ids: ReadonlyArray<string>) {
  return Effect.suspend(() => {
    const unique = [...new Set(ids)];
    const byId = new Map(
      unique.flatMap((id) => {
        const entry = state.entries.get(id);
        return entry ? [[entry.snapshot.id, entry] as const] : [];
      }),
    );
    const running = [...byId.values()].filter(
      (entry) => entry.snapshot.status === "running",
    );
    const runningIds = running.map((entry) => entry.snapshot.id);
    addKillInterest(state, runningIds);
    const work = Effect.gen(function* () {
      yield* Effect.forEach(running, (entry) => killEntry(state, entry), {
        concurrency: "unbounded",
      });
      yield* Effect.forEach(running, (entry) => Deferred.await(entry.settled), {
        concurrency: "unbounded",
        discard: true,
      });
      return killReport(state, unique, byId, runningIds);
    });
    return work.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          releaseKillInterest(state, runningIds);
          pruneSettled(state);
        }),
      ),
    );
  });
}

export function disposeTerminals(
  state: ManagerState,
  cleanupFibers: FiberSet.FiberSet<unknown, unknown>,
) {
  return Effect.gen(function* () {
    state.disposed = true;
    const all = [...state.entries.values()];
    state.entries.clear();
    yield* Effect.forEach(
      all,
      (entry) =>
        closeEntryScope(entry).pipe(
          Effect.timeout(STOP_TIMEOUT_MS),
          Effect.ignore,
        ),
      { concurrency: "unbounded" },
    );
    yield* FiberSet.awaitEmpty(cleanupFibers).pipe(
      Effect.timeout(STOP_TIMEOUT_MS),
      Effect.ignore,
    );
    yield* Effect.sync(() => {
      const dir = state.spillDir;
      state.spillDir = null;
      if (dir) NodeFS.rmSync(dir, { recursive: true, force: true });
      notify(state);
    });
  });
}

export function createReadModel(state: ManagerState): TerminalReadModel {
  return {
    list: () => [...state.entries.values()].map((entry) => entry.snapshot),
    get: (id) => state.entries.get(id)?.snapshot,
    size: () => state.entries.size,
    beginShutdown: () => {
      state.disposed = true;
      return [...state.entries.values()].map(({ snapshot }) => snapshot);
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
    requestKill: (id) => {
      const entry = state.entries.get(id);
      if (entry) state.runCleanup(killEntry(state, entry).pipe(Effect.ignore));
    },
    setOnSettled: (hook) => {
      state.onSettled = hook;
    },
  };
}
