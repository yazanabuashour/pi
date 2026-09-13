import { Effect, Exit, Fiber, Scope } from "effect";
import {
  FINAL_TEXT_MAX_LENGTH,
  MAX_TRACKED,
  bounded,
  type Entry,
} from "./manager-contract.ts";
import type { RunOutcome, AgentSnapshot } from "./domain.ts";

export interface ManagerState {
  readonly entries: Map<string, Entry>;
  readonly waitInterest: Map<string, number>;
  readonly listeners: Set<() => void>;
  readonly idListeners: Map<string, Set<() => void>>;
  readonly cleanups: Set<Fiber.Fiber<unknown>>;
  readonly runDetached: (effect: Effect.Effect<void>) => Fiber.Fiber<unknown>;
  changeWaiters: Array<() => void>;
  modelCounter: number;
  userCounter: number;
  reserved: number;
  disposed: boolean;
  onStarted: ((snapshot: AgentSnapshot) => boolean) | undefined;
  onSettled: ((snapshot: AgentSnapshot, consumed: boolean) => void) | undefined;
}

export function createManagerState(
  runDetached: (effect: Effect.Effect<void>) => Fiber.Fiber<unknown>,
): ManagerState {
  return {
    entries: new Map(),
    waitInterest: new Map(),
    listeners: new Set(),
    idListeners: new Map(),
    cleanups: new Set(),
    runDetached,
    changeWaiters: [],
    modelCounter: 0,
    userCounter: 0,
    reserved: 0,
    disposed: false,
    onStarted: undefined,
    onSettled: undefined,
  };
}

export function notify(state: ManagerState, id?: string) {
  const waiters = state.changeWaiters;
  state.changeWaiters = [];
  for (const waiter of waiters) waiter();
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

export function nextChange(state: ManagerState) {
  return Effect.callback<void>((resume) => {
    const waiter = () => resume(Effect.void);
    state.changeWaiters.push(waiter);
    return Effect.sync(() => {
      const index = state.changeWaiters.indexOf(waiter);
      if (index >= 0) state.changeWaiters.splice(index, 1);
    });
  });
}

export function canAct(state: ManagerState, id: string): boolean {
  if (state.disposed) return false;
  let entry = state.entries.get(id);
  if (!entry || entry.stopping) return false;
  while (entry.snapshot.parentId !== "root") {
    entry = state.entries.get(entry.snapshot.parentId);
    if (!entry || entry.stopping) return false;
  }
  return true;
}

export function runningCount(state: ManagerState) {
  return [...state.entries.values()].filter(
    (entry) => entry.snapshot.status === "running" || entry.restarting === true,
  ).length;
}

export function addInterest(state: ManagerState, ids: ReadonlyArray<string>) {
  for (const id of ids) {
    state.waitInterest.set(id, (state.waitInterest.get(id) ?? 0) + 1);
  }
}

export function releaseInterest(
  state: ManagerState,
  ids: ReadonlyArray<string>,
) {
  for (const id of ids) {
    const count = (state.waitInterest.get(id) ?? 1) - 1;
    if (count <= 0) state.waitInterest.delete(id);
    else state.waitInterest.set(id, count);
  }
}

export function closeEntryScope(entry: Entry) {
  return Scope.close(entry.scope, Exit.void).pipe(Effect.ignore);
}

export function pruneSettled(state: ManagerState) {
  if (state.entries.size <= MAX_TRACKED) return;
  const parents = new Set(
    [...state.entries.values()].map((entry) => entry.snapshot.parentId),
  );
  const candidates = [...state.entries.values()]
    .filter(
      (entry) =>
        entry.snapshot.status !== "running" &&
        !parents.has(entry.snapshot.id) &&
        !state.waitInterest.has(entry.snapshot.id),
    )
    .sort(
      (left, right) =>
        (left.snapshot.settledAt ?? left.snapshot.createdAt) -
        (right.snapshot.settledAt ?? right.snapshot.createdAt),
    );
  for (const entry of candidates) {
    if (state.entries.size <= MAX_TRACKED) break;
    state.entries.delete(entry.snapshot.id);
    const fiber = state.runDetached(closeEntryScope(entry));
    state.cleanups.add(fiber);
    fiber.addObserver(() => state.cleanups.delete(fiber));
  }
}

function applyOutcome(entry: Entry, outcome: RunOutcome) {
  const snapshot = entry.snapshot;
  switch (outcome._tag) {
    case "Completed":
      snapshot.status = "done";
      snapshot.outcome = "completed";
      snapshot.errorText = undefined;
      snapshot.finalText = outcome.finalText.slice(0, FINAL_TEXT_MAX_LENGTH);
      break;
    case "Failed":
      snapshot.status = "error";
      snapshot.outcome = "failed";
      snapshot.errorText = bounded(outcome.errorText);
      snapshot.finalText = (outcome.partialText ?? "").slice(
        0,
        FINAL_TEXT_MAX_LENGTH,
      );
      break;
    case "Interrupted":
      snapshot.status = "error";
      snapshot.outcome = "interrupted";
      snapshot.errorText = "Run was aborted";
      snapshot.finalText = (outcome.partialText ?? "").slice(
        0,
        FINAL_TEXT_MAX_LENGTH,
      );
  }
}

export function settle(state: ManagerState, entry: Entry, outcome: RunOutcome) {
  const snapshot = entry.snapshot;
  entry.restarting = false;
  if (snapshot.status !== "running") return;
  snapshot.settledAt = Date.now();
  applyOutcome(entry, outcome);
  snapshot.liveAssistant = undefined;
  entry.liveToolMap.clear();
  snapshot.liveTools = [];
  snapshot.queued = [];
  const consumed = (state.waitInterest.get(snapshot.id) ?? 0) > 0;
  try {
    if (!state.disposed) state.onSettled?.(snapshot, consumed);
  } catch {
    // The parent session may be unavailable; settlement stays final.
  }
  notify(state, snapshot.id);
  pruneSettled(state);
}
