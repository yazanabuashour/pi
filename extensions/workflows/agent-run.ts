import type { RuntimeValue } from "../shared/runtime-values.ts";
import { isNumber } from "../shared/runtime-values.ts";
import type {
  AgentSession,
  AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import { Cause, Effect, Exit } from "effect";
import { shutdownAndDisposeChildSession } from "../shared/child-session.ts";
import {
  AGENT_OUTPUT_MAX_BYTES,
  createFirstResponseWatchdog,
  errorText,
  finalOutput,
  isAssistantResponseEvent,
  type AgentOutcome,
  type RunAgentOptions,
} from "./runner.ts";
import { emptyUsage } from "./model.ts";
import {
  computeUsage,
  recordToolExecutionTiming,
  transcriptFromMessages,
  type ToolExecutionTiming,
} from "./runner-transcript.ts";
import { truncateUtf8 } from "./serialization.ts";
import { createWorkflowSession } from "./agent-session.ts";

class AgentRun {
  private usage = emptyUsage();
  private modelId: string | undefined;
  private contextWindow: number | undefined;
  private stopReason: string | undefined;
  private errorMessage: string | undefined;
  private readonly toolTimings = new Map<string, ToolExecutionTiming>();
  private markFirstResponse = () => {};
  private aborted = false;
  private abortPromise: Promise<void> | undefined;
  private promptPromise: Promise<void> | undefined;
  private resolveAbortSignal: (() => void) | undefined;
  private readonly abortSignal: Promise<void>;
  private readonly options: RunAgentOptions;
  private readonly session: AgentSession;
  private readonly structured: () => RuntimeValue | undefined;

  constructor(
    options: RunAgentOptions,
    session: AgentSession,
    structured: () => RuntimeValue | undefined,
  ) {
    this.options = options;
    this.session = session;
    this.structured = structured;
    this.modelId = session.model?.id ?? options.model?.id;
    this.contextWindow = session.model?.contextWindow;
    this.abortSignal = new Promise((resolve) => {
      this.resolveAbortSignal = resolve;
    });
  }

  private sync() {
    const messages = this.session.messages;
    this.usage = computeUsage(messages);
    const sessionModel = this.session.model;
    this.modelId = sessionModel?.id ?? this.modelId;
    this.contextWindow = sessionModel?.contextWindow ?? this.contextWindow;
    const context = this.session.getContextUsage();
    if (
      isNumber(context?.tokens) &&
      Number.isFinite(context.tokens) &&
      context.tokens >= 0
    ) {
      this.usage.contextTokens = context.tokens;
    }
    if (
      isNumber(context?.contextWindow) &&
      Number.isFinite(context.contextWindow) &&
      context.contextWindow > 0
    )
      this.contextWindow = context.contextWindow;
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index];
      if (!message || message.role !== "assistant") continue;
      const responseMatchesSession =
        !sessionModel ||
        (message.provider === sessionModel.provider &&
          message.model === sessionModel.id);
      const reported = responseMatchesSession
        ? this.options.modelRegistry.find(
            message.provider,
            message.responseModel ?? message.model,
          )
        : undefined;
      if (reported) {
        this.modelId = reported.id;
        this.contextWindow = reported.contextWindow;
      }
      if (message.stopReason) this.stopReason = message.stopReason;
      if (message.errorMessage) this.errorMessage = message.errorMessage;
      break;
    }
  }

  private handleEvent = (event: AgentSessionEvent) => {
    if (isAssistantResponseEvent(event)) this.markFirstResponse();
    if (
      event.type === "tool_execution_start" ||
      event.type === "tool_execution_end"
    ) {
      recordToolExecutionTiming(this.toolTimings, event);
    } else if (event.type !== "message_end" && event.type !== "compaction_end")
      return;
    this.sync();
    this.options.onProgress?.({
      preview: finalOutput(this.session.messages),
      usage: this.usage,
      model: this.modelId,
      contextWindow: this.contextWindow,
      transcript: transcriptFromMessages(
        this.session.messages,
        this.toolTimings,
      ),
    });
  };

  private onAbort = () => {
    this.aborted = true;
    this.resolveAbortSignal?.();
    this.abortPromise ??= this.session.abort().catch(() => {});
  };

  private async waitForAbort() {
    if (!this.abortPromise) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      this.abortPromise,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 5_000);
        timer.unref?.();
      }),
    ]);
    if (timer) clearTimeout(timer);
  }

  async execute(): Promise<AgentOutcome> {
    const unsubscribe = this.session.subscribe(this.handleEvent);
    if (this.options.signal?.aborted) this.onAbort();
    else
      this.options.signal?.addEventListener("abort", this.onAbort, {
        once: true,
      });
    let output = "";
    let transcript = transcriptFromMessages([], this.toolTimings);
    try {
      await this.prompt();
    } catch (error) {
      this.errorMessage ??= errorText(error);
      this.stopReason ??= "error";
    } finally {
      this.options.signal?.removeEventListener("abort", this.onAbort);
      await this.waitForAbort();
      if (this.aborted) await shutdownAndDisposeChildSession(this.session);
      for (const pending of [this.abortPromise, this.promptPromise])
        pending?.catch(() => {});
      unsubscribe();
      this.sync();
      output = truncateUtf8(
        finalOutput(this.session.messages),
        AGENT_OUTPUT_MAX_BYTES,
      );
      transcript = transcriptFromMessages(
        this.session.messages,
        this.toolTimings,
      );
    }
    return this.outcome(output, transcript);
  }

  private async prompt() {
    if (this.aborted) return;
    const watchdog = createFirstResponseWatchdog(() => this.session.abort(), {
      timeoutMs: this.options.firstResponseTimeoutMs,
      model: this.modelId,
    });
    this.markFirstResponse = watchdog.markResponse;
    this.promptPromise = watchdog.waitFor(
      this.session.prompt(this.options.prompt),
    );
    void this.promptPromise.catch(() => {});
    await Promise.race([this.promptPromise, this.abortSignal]);
  }

  private outcome(
    output: string,
    transcript: AgentOutcome["transcript"],
  ): AgentOutcome {
    const common = {
      output,
      usage: this.usage,
      model: this.modelId,
      contextWindow: this.contextWindow,
      transcript,
    };
    if (this.aborted || this.stopReason === "aborted") {
      return {
        ...common,
        ok: false,
        structured: this.structured(),
        error: errorText(this.options.signal?.reason ?? "Agent was aborted"),
        aborted: true,
      };
    }
    if (this.stopReason === "error" || this.errorMessage !== undefined) {
      return {
        ...common,
        ok: false,
        structured: this.structured(),
        error: this.errorMessage ?? "Agent failed",
        aborted: false,
      };
    }
    if (this.options.schema !== undefined && this.structured() === undefined) {
      return {
        ...common,
        ok: false,
        error:
          "Agent finished without calling structured_output; no structured result matching the schema was produced.",
        aborted: false,
      };
    }
    return {
      ...common,
      ok: true,
      structured: this.structured(),
      aborted: false,
    };
  }
}

export async function runAgent(
  options: RunAgentOptions,
): Promise<AgentOutcome> {
  let structured: RuntimeValue | undefined;
  let outcome: AgentOutcome | undefined;
  const exit = await Effect.runPromiseExit(
    Effect.scoped(
      Effect.gen(function* () {
        const { session } = yield* createWorkflowSession(options, (value) => {
          structured = value;
        });
        const run = new AgentRun(options, session, () => structured);
        return yield* Effect.callback<AgentOutcome>((resume) => {
          const settled = run.execute().then(
            (result) => {
              outcome = result;
              resume(Effect.succeed(result));
            },
            (error) => resume(Effect.die(error)),
          );
          // Keep the existing prompt abort/grace policy, but never release the
          // session while its execution owner is still collecting the outcome.
          return Effect.promise(() => settled);
        });
      }),
    ),
    options.signal ? { signal: options.signal } : undefined,
  );
  if (Exit.isSuccess(exit)) return exit.value;
  if (outcome && Cause.hasInterruptsOnly(exit.cause)) return outcome;
  const aborted = options.signal?.aborted ?? false;
  const [failure] = Cause.prettyErrors(exit.cause);
  return {
    ok: false,
    output: "",
    error: aborted
      ? errorText(options.signal?.reason ?? "Agent was aborted")
      : (failure?.message ?? Cause.pretty(exit.cause)),
    aborted,
    usage: emptyUsage(),
    model: options.model?.id,
    contextWindow: options.model?.contextWindow,
    transcript: [],
  };
}
