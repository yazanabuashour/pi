import { Effect, FiberSet, Layer } from "effect";
import {
  TerminalManager,
  type TerminalManagerService,
} from "./manager-contract.ts";
import {
  createReadModel,
  disposeTerminals,
  killTerminals,
} from "./manager-operations.ts";
import { createManagerState, terminalStatus } from "./manager-state.ts";
import { startTerminal } from "./manager-start.ts";

export * from "./manager-contract.ts";

const makeManager = Effect.gen(function* () {
  const cleanupFibers = yield* FiberSet.make();
  const runCleanup = yield* FiberSet.runtime(cleanupFibers)();
  const state = createManagerState(runCleanup);
  const disposeAll = disposeTerminals(state, cleanupFibers);
  yield* Effect.addFinalizer(() => disposeAll);
  return TerminalManager.of({
    start: (options) => startTerminal(state, options),
    status: (id) => terminalStatus(state, id),
    kill: (ids) => killTerminals(state, ids),
    list: Effect.sync(() =>
      [...state.entries.values()].map((entry) => entry.snapshot),
    ),
    disposeAll,
    view: createReadModel(state),
  } satisfies TerminalManagerService);
});

export const TerminalManagerLive: Layer.Layer<TerminalManager> = Layer.effect(
  TerminalManager,
  makeManager,
);
