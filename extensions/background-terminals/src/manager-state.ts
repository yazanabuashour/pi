import { Cause, Deferred, Effect, Exit, Scope } from "effect";
import {
  MAX_SETTLED_HISTORY,
  bounded,
  MAX_TRACKED,
  SETTLE_GRACE_MS,
  STOP_TIMEOUT_MS,
  type Entry,
  type KillResult,
} from "./manager-contract.ts";
import {
  formatExit,
  UnknownTerminalError,
  type TerminalSnapshot,
} from "./domain.ts";
import { flushSpillStreams } from "./manager-spill.ts";

export interface ManagerState {
  readonly entries: Map<string, Entry>;
  readonly settledHistory: Map<
    string,
    Pick<
      KillResult,
      "title" | "status" | "exit" | "stopRequested" | "cleanupIncomplete"
    >
  >;
  readonly killInterest: Map<string, number>;
  readonly listeners: Set<() => void>;
  readonly idListeners: Map<string, Set<() => void>>;
  readonly runCleanup: (effect: Effect.Effect<void>) => void;
  counter: number;
  reserved: number;
  disposed: boolean;
  spillDir: string | undefined | null;
  onSettled:
    | ((snapshot: TerminalSnapshot, consumed: boolean) => void)
    | undefined;
}

export function createManagerState(
  runCleanup: (effect: Effect.Effect<void>) => void,
): ManagerState {
  return {
    entries: new Map(),
    settledHistory: new Map(),
    killInterest: new Map(),
    listeners: new Set(),
    idListeners: new Map(),
    runCleanup,
    counter: 0,
    reserved: 0,
    disposed: false,
    spillDir: undefined,
    onSettled: undefined,
  };
}

export function notify(state: ManagerState, id?: string) {
  for (const listener of state.listeners) {
    try {
      listener();
    } catch {
      // A failed render listener must not corrupt lifecycle state.
    }
  }
  if (!id) return;
  for (const listener of state.idListeners.get(id) ?? []) {
    try {
      listener();
    } catch {
      // A failed render listener must not corrupt lifecycle state.
    }
  }
}

export function runningCount(state: ManagerState) {
  return [...state.entries.values()].filter(
    (entry) => entry.snapshot.status === "running",
  ).length;
}

export function addKillInterest(
  state: ManagerState,
  ids: ReadonlyArray<string>,
) {
  for (const id of ids) {
    state.killInterest.set(id, (state.killInterest.get(id) ?? 0) + 1);
  }
}

export function releaseKillInterest(
  state: ManagerState,
  ids: ReadonlyArray<string>,
) {
  for (const id of ids) {
    const count = (state.killInterest.get(id) ?? 1) - 1;
    if (count <= 0) state.killInterest.delete(id);
    else state.killInterest.set(id, count);
  }
}

export function closeEntryScope(entry: Entry) {
  return Scope.close(entry.scope, Exit.void).pipe(
    Effect.catchCause((cause) =>
      Effect.sync(() => {
        entry.stdioCleanupIncomplete = false;
        entry.snapshot.cleanupIncomplete = bounded(
          `Terminal scope cleanup failed: ${Cause.pretty(cause)}`,
        );
      }),
    ),
  );
}

export function pruneSettled(state: ManagerState) {
  if (state.entries.size <= MAX_TRACKED) return;
  const candidates = [...state.entries.values()]
    .filter(
      (entry) =>
        entry.snapshot.status !== "running" &&
        !state.killInterest.has(entry.snapshot.id),
    )
    .sort(
      (left, right) =>
        (left.snapshot.settledAt ?? left.snapshot.createdAt) -
        (right.snapshot.settledAt ?? right.snapshot.createdAt),
    );
  for (const entry of candidates) {
    if (state.entries.size <= MAX_TRACKED) break;
    state.entries.delete(entry.snapshot.id);
    state.runCleanup(closeEntryScope(entry));
  }
}

function rememberSettlement(state: ManagerState, entry: Entry) {
  const snapshot = entry.snapshot;
  state.settledHistory.set(snapshot.id, {
    title: snapshot.title,
    status: snapshot.status,
    exit: formatExit(snapshot),
    stopRequested: snapshot.stopRequested,
    cleanupIncomplete: snapshot.cleanupIncomplete,
  });
  while (state.settledHistory.size > MAX_SETTLED_HISTORY) {
    const oldest = state.settledHistory.keys().next().value;
    if (oldest === undefined) break;
    state.settledHistory.delete(oldest);
  }
}

export function settle(state: ManagerState, entry: Entry) {
  const snapshot = entry.snapshot;
  if (snapshot.status !== "running") return;
  if (entry.exited) {
    snapshot.settledAt = Date.now();
    snapshot.status = entry.processErrored
      ? "failed"
      : snapshot.exitCode !== undefined
        ? snapshot.exitCode === 0
          ? "done"
          : "failed"
        : entry.stopRequestedBeforeExit && snapshot.signal
          ? "killed"
          : "failed";
    rememberSettlement(state, entry);
  }
  entry.settling = false;
  const consumed = (state.killInterest.get(snapshot.id) ?? 0) > 0;
  Deferred.doneUnsafe(entry.settled, Effect.void);
  notify(state, snapshot.id);
  try {
    if (!state.disposed) state.onSettled?.(snapshot, consumed);
  } catch {
    // The parent session may be unavailable; settlement stays final.
  }
  pruneSettled(state);
}

export function settleAfterFlush(state: ManagerState, entry: Entry) {
  if (entry.settling || entry.snapshot.status !== "running") return;
  entry.settling = true;
  state.runCleanup(
    flushSpillStreams(entry).pipe(
      Effect.andThen(Effect.sync(() => settle(state, entry))),
    ),
  );
}

export function scheduleExitCleanup(state: ManagerState, entry: Entry) {
  if (entry.exitCleanupStarted) return;
  entry.exitCleanupStarted = true;
  state.runCleanup(
    Effect.sleep(SETTLE_GRACE_MS).pipe(
      Effect.andThen(
        Effect.suspend(() =>
          entry.snapshot.status === "running" && !entry.stdioClosed
            ? closeEntryScope(entry).pipe(
                Effect.timeout(STOP_TIMEOUT_MS),
                Effect.ignore,
              )
            : Effect.void,
        ),
      ),
    ),
  );
}

export function terminalStatus(state: ManagerState, id: string) {
  return Effect.suspend(
    (): Effect.Effect<TerminalSnapshot, UnknownTerminalError> => {
      const entry = state.entries.get(id);
      if (entry) return Effect.succeed(entry.snapshot);
      const known = [...state.entries.keys()];
      return new UnknownTerminalError({
        message: `Unknown terminal id "${id}". Known: ${known.join(", ") || "none"}.`,
      });
    },
  );
}
