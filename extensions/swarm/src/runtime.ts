/**
 * Layer composition and the async entry-point boundary.
 *
 * Everything inside the extension is Effect generators; this module is where
 * tool handlers (plain async functions) run those effects against one shared
 * ManagedRuntime.
 */

import { Cause, Exit, Layer, ManagedRuntime, type Effect } from "effect";
import { PiSessionLive } from "./pi.ts";
import { SwarmManagerLive } from "./manager.ts";

const AppLayer = SwarmManagerLive.pipe(Layer.provide(PiSessionLive));

export function createSwarmRuntime() {
  return ManagedRuntime.make(AppLayer);
}

export type SwarmRuntime = ReturnType<typeof createSwarmRuntime>;

/**
 * Run an effect from an async tool handler. Typed failures and defects are
 * converted to thrown Errors (what pi's tool contract expects); interruption
 * (tool AbortSignal) throws `interruptMessage`.
 */
export async function runTool<A, E>(
  runtime: SwarmRuntime,
  effect: Effect.Effect<A, E>,
  options: {
    signal?: AbortSignal | undefined;
    interruptMessage?: string | undefined;
  } = {},
) {
  options.signal?.throwIfAborted();
  const exit = await runtime.runPromiseExit(
    effect,
    options.signal ? { signal: options.signal } : undefined,
  );
  if (Exit.isSuccess(exit)) return exit.value;
  if (Cause.hasInterruptsOnly(exit.cause)) {
    throw new Error(options.interruptMessage ?? "Operation was aborted.", {
      cause: options.signal?.reason ?? exit.cause,
    });
  }
  const [first] = Cause.prettyErrors(exit.cause);
  throw new Error(first?.message ?? Cause.pretty(exit.cause), {
    cause: exit.cause,
  });
}
