import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { Scope, Stream } from "effect";
import { Context, Effect, Semaphore } from "effect";
import type { SpawnError, SpawnTask, AgentEvent, AgentMeta } from "./domain.ts";
import { SendError } from "./domain.ts";
import { boundedError } from "./pi-events.ts";

/** The manager consumes events and owns the session scope through settlement. */
export interface WorkerSession {
  readonly meta: Effect.Effect<AgentMeta>;
  /** Each run terminates with RunSettled; closing the scope ends the stream. */
  readonly events: Stream.Stream<AgentEvent>;
  /** Start a manager-reserved run; never replace a streaming run. */
  send(text: string): Effect.Effect<void, SendError>;
  /** Admit steering, or return false once idle so the manager can reserve a new run. */
  steer(text: string): Effect.Effect<boolean, SendError>;
  /** Clear queued work and await owned prompt/abort settlement; failures are defects. */
  readonly interrupt: Effect.Effect<void>;
}

/** Create an idle scoped session. Only the manager dispatches the initial prompt after publication. */
export class SessionFactory extends Context.Service<
  SessionFactory,
  (task: SpawnTask) => Effect.Effect<WorkerSession, SpawnError, Scope.Scope>
>()("swarm/SessionFactory") {}

export type PromptSession = Pick<
  AgentSession,
  | "prompt"
  | "steer"
  | "abort"
  | "clearQueue"
  | "isStreaming"
  | "waitForIdle"
  | "sendCustomMessage"
  | "messages"
> & { readonly agent: Pick<AgentSession["agent"], "hasQueuedMessages"> };

interface PromptHooks {
  started(): void;
  settled(error?: SendError): void;
  interrupted(): void;
}

const CHILD_SHUTDOWN_TIMEOUT_MS = 5_000;

/** Own SDK admission and prompt promises independently of event translation. */
export class PiPromptLifecycle {
  private readonly admission = Semaphore.makeUnsafe(1);
  private readonly prompts = new Set<Promise<void>>();
  private readonly steering = new Set<Promise<void>>();
  private readonly defects: unknown[] = [];
  private run: Promise<void> | undefined;
  private stopping: Promise<void> | undefined;
  private disposal: Promise<void> | undefined;
  private stopGeneration = 0;
  private closed = false;

  private readonly session: PromptSession;
  private readonly hooks: PromptHooks;

  constructor(session: PromptSession, hooks: PromptHooks) {
    this.session = session;
    this.hooks = hooks;
  }

  get active() {
    return this.run !== undefined || this.stopping !== undefined;
  }

  private assertAdmission(signal: AbortSignal, generation: number) {
    signal.throwIfAborted();
    if (this.closed) throw new Error("Agent session is closed.");
    if (this.stopping || generation !== this.stopGeneration)
      throw new Error("Agent session was interrupted before admission.");
  }

  private submit(text: string, generation: number, fresh: boolean) {
    return Effect.callback<boolean, SendError>((resume, signal) => {
      let accepted = false;
      const operation = Promise.resolve().then(async () => {
        this.assertAdmission(signal, generation);
        if (!fresh) {
          if (!this.session.isStreaming) return false;
          await this.session.steer(text);
          return true;
        }
        this.hooks.started();
        await this.session.prompt(text, {
          expandPromptTemplates: false,
          preflightResult: (success) => {
            // false precedes the SDK rejection; retain its actual error.
            if (!success) return;
            this.assertAdmission(signal, generation);
            accepted = true;
            // Let the SDK enter its run before admitting the next sender.
            queueMicrotask(() => resume(Effect.succeed(true)));
          },
        });
        return true;
      });
      const observed = operation
        .then(
          async (submitted) => {
            if (fresh) await this.settleRun(generation);
            resume(Effect.succeed(submitted));
          },
          async (cause) => {
            const failure = new SendError({
              message: boundedError(cause),
              cause,
            });
            if (fresh) await this.settleRun(generation, failure);
            if (!accepted) resume(Effect.fail(failure));
          },
        )
        .catch((defect) => {
          // Event-translation defects remain observable even after admission.
          this.defects.push(defect);
          resume(Effect.die(defect));
        });
      if (fresh) this.run = observed;
      else this.steering.add(observed);
      this.prompts.add(observed);
      void observed.then(() => {
        this.prompts.delete(observed);
        this.steering.delete(observed);
      });
      return Effect.promise(async () => {
        if (fresh) await this.stop();
        else
          await operation.then(
            () => undefined,
            () => undefined,
          );
      });
    });
  }

  private async settleRun(generation: number, failure?: SendError) {
    while (true) {
      // A steer already in flight can enqueue after the SDK prompt resolves.
      if (this.steering.size > 0) {
        await Promise.all(this.steering);
        continue;
      }
      if (this.stopping || this.closed || generation !== this.stopGeneration)
        break;
      if (this.session.isStreaming) {
        // Extensions can start a continuation before the prior prompt returns.
        await this.session.waitForIdle();
        continue;
      }
      let stopReason: string | undefined;
      for (let index = this.session.messages.length - 1; index >= 0; index--) {
        const message = this.session.messages[index];
        if (message?.role !== "assistant") continue;
        stopReason = message.stopReason;
        break;
      }
      if (failure || stopReason === "aborted" || stopReason === "error") {
        this.session.clearQueue();
        break;
      }
      if (!this.session.agent.hasQueuedMessages()) break;
      try {
        // Wake the existing queue without replaying its text. AgentSession owns
        // post-run hooks/retries; raw agent.continue() would bypass that owner.
        await this.session.sendCustomMessage(
          {
            customType: "swarm-queue-drain",
            content: "Continue with the queued messages.",
            display: false,
          },
          { triggerTurn: true },
        );
      } catch (cause) {
        failure = new SendError({ message: boundedError(cause), cause });
      }
    }
    // No await between the final queue check and releasing this reservation.
    this.run = undefined;
    if (!this.stopping && !this.closed) this.hooks.settled(failure);
  }

  private admit(text: string, fresh: boolean) {
    return Effect.suspend(() => {
      const generation = this.stopGeneration;
      return this.admission
        .withPermit(
          Effect.sync(() =>
            this.run && !this.session.isStreaming ? this.run : undefined,
          ),
        )
        .pipe(
          // A continuation can execute tools while this run settles. Do not hold
          // its admission permit while waiting: those tools may send to it.
          Effect.flatMap((run) =>
            run ? Effect.promise(() => run) : Effect.void,
          ),
          Effect.andThen(
            this.admission.withPermit(
              Effect.suspend(() => {
                if (fresh && (this.run || this.session.isStreaming))
                  return new SendError({
                    message: "Cannot start an already active agent.",
                  });
                return this.submit(text, generation, fresh);
              }),
            ),
          ),
        );
    });
  }

  send = (text: string) => this.admit(text, true).pipe(Effect.asVoid);
  steer = (text: string) => this.admit(text, false);

  private stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopGeneration++;
    this.stopping = (async () => {
      const clear = Promise.resolve().then(() => this.session.clearQueue());
      const abort = Promise.resolve().then(() => this.session.abort());
      const [cleared, aborted] = await Promise.allSettled([
        clear,
        abort,
        ...this.prompts,
      ]);
      // A pending steer may have queued after the first clear.
      this.session.clearQueue();
      const failures = [
        ...this.defects,
        ...[cleared, aborted].flatMap((result) =>
          result.status === "rejected" ? [result.reason] : [],
        ),
      ];
      if (failures.length > 0)
        throw new AggregateError(failures, "Agent interruption failed.");
      if (!this.closed) this.hooks.interrupted();
      this.stopping = undefined;
    })();
    return this.stopping;
  }

  interrupt = Effect.promise(() => this.stop());

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.closed = true;
    this.disposal = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          this.stop(),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error(
                    "Agent shutdown deadline exceeded; prompt settlement is still pending.",
                  ),
                ),
              CHILD_SHUTDOWN_TIMEOUT_MS,
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    })();
    return this.disposal;
  }
}
