import { Effect, Layer } from "effect";
import { SessionFactory } from "./session.ts";
import { SwarmManager, type SwarmManagerService } from "./manager-contract.ts";
import {
  cancelAgents,
  createReadModel,
  disposeAgents,
  sendToAgent,
  waitForAgents,
} from "./manager-operations.ts";
import { spawnAgent } from "./manager-spawn.ts";
import { createManagerState } from "./manager-state.ts";

export * from "./manager-contract.ts";

const makeManager = Effect.gen(function* () {
  const createSession = yield* SessionFactory;
  const runDetached = Effect.runForkWith(yield* Effect.context());
  const state = createManagerState(runDetached);
  yield* Effect.addFinalizer(() => disposeAgents(state));
  return SwarmManager.of({
    spawn: (task) => spawnAgent(state, createSession, task),
    waitFor: (ids, onPending) => waitForAgents(state, ids, onPending),
    cancel: (ids) => cancelAgents(state, ids),
    send: (id, text) => sendToAgent(state, id, text),
    view: createReadModel(state),
  } satisfies SwarmManagerService);
});

export const SwarmManagerLive: Layer.Layer<
  SwarmManager,
  never,
  SessionFactory
> = Layer.effect(SwarmManager, makeManager);
