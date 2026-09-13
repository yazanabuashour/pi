import type {
  Api,
  AssistantMessage,
  Message,
  Model,
} from "@earendil-works/pi-ai";
import type {
  AgentSession,
  AgentSessionEvent,
  ModelRegistry,
} from "@earendil-works/pi-coding-agent";
import type { Cause } from "effect";
import { Effect, Queue, Stream } from "effect";
import { createToolCallTimeoutGuard } from "../../shared/tool-call-timeout.ts";
import { PiPromptLifecycle, type WorkerSession } from "./session.ts";
import type { AgentEvent, AgentMeta } from "./domain.ts";
import {
  assistantParts,
  boundedError,
  finalOutput,
  lastAssistantMessage,
  messageRole,
  toolPreview,
  userText,
} from "./pi-events.ts";

interface PiSessionState {
  closed: boolean;
  runError: string | undefined;
  settled: boolean;
}

export class PiSessionAdapter {
  private readonly state: PiSessionState = {
    closed: false,
    runError: undefined,
    settled: false,
  };
  private readonly toolTimeout = createToolCallTimeoutGuard();
  private unsubscribe: (() => void) | undefined;
  private readonly lifecycle: PiPromptLifecycle;
  private disposal: Promise<void> | undefined;
  private readonly session: AgentSession;
  private readonly registry: ModelRegistry;
  private readonly events: Queue.Queue<AgentEvent, Cause.Done>;

  constructor(
    session: AgentSession,
    registry: ModelRegistry,
    events: Queue.Queue<AgentEvent, Cause.Done>,
  ) {
    this.session = session;
    this.registry = registry;
    this.events = events;
    this.toolTimeout.apply(session);
    this.lifecycle = new PiPromptLifecycle(session, {
      started: () => {
        this.state.runError = undefined;
        this.state.settled = false;
      },
      settled: (error) => {
        this.state.runError = error?.message;
        this.settle();
      },
      interrupted: () => {
        if (this.state.settled) return;
        this.state.settled = true;
        this.emit({
          _tag: "RunSettled",
          outcome: {
            _tag: "Interrupted",
            partialText: finalOutput(this.session) || undefined,
          },
        });
      },
    });
  }

  install() {
    this.unsubscribe = this.session.subscribe(this.handleEvent);
  }

  private emit(event: AgentEvent) {
    if (!this.state.closed) Queue.offerUnsafe(this.events, event);
  }

  private activeModel(): Model<Api> | undefined {
    const sessionModel = this.session.model;
    const last = lastAssistantMessage(this.session);
    if (!last) return sessionModel;
    if (
      sessionModel &&
      (last.provider !== sessionModel.provider ||
        last.model !== sessionModel.id)
    ) {
      return sessionModel;
    }
    return (
      this.registry.find(last.provider, last.responseModel ?? last.model) ??
      sessionModel
    );
  }

  currentMeta = (): AgentMeta => {
    const model = this.activeModel();
    return {
      modelLabel: model ? `${model.provider}/${model.id}` : undefined,
      contextWindow: model?.contextWindow,
      sessionFilePath: this.session.sessionFile,
    };
  };

  private emitUsage() {
    const usage = this.session.getContextUsage();
    const tokens = usage?.tokens ?? undefined;
    const contextWindow =
      this.activeModel()?.contextWindow ?? usage?.contextWindow;
    this.emit({ _tag: "UsageChanged", tokens, contextWindow });
  }

  private settle() {
    if (this.state.settled || this.state.closed) return;
    this.state.settled = true;
    const last = lastAssistantMessage(this.session);
    const partialText = finalOutput(this.session) || undefined;
    if (!this.state.runError && last?.stopReason === "aborted") {
      this.emit({
        _tag: "RunSettled",
        outcome: { _tag: "Interrupted", partialText },
      });
      return;
    }
    const errorText =
      this.state.runError ??
      (last?.stopReason === "error"
        ? (last.errorMessage ?? "Run failed")
        : undefined);
    if (errorText !== undefined) {
      this.emit({
        _tag: "RunSettled",
        outcome: {
          _tag: "Failed",
          errorText: boundedError(errorText),
          partialText,
        },
      });
      return;
    }
    this.emit({
      _tag: "RunSettled",
      outcome: { _tag: "Completed", finalText: finalOutput(this.session) },
    });
  }

  private readonly handleEvent = (event: AgentSessionEvent) => {
    if (this.state.closed) return;
    if (this.handleLifecycleEvent(event)) return;
    if (this.handleMessageEvent(event)) return;
    this.handleToolEvent(event);
  };

  private handleLifecycleEvent(event: AgentSessionEvent) {
    if (event.type === "agent_start") {
      this.toolTimeout.apply(this.session);
      this.state.settled = false;
      this.emit({ _tag: "RunStarted" });
      return true;
    }
    if (event.type === "queue_update") {
      this.emit({
        _tag: "QueueChanged",
        queued: [
          ...event.steering.map((text) => ({ text, kind: "steer" as const })),
          ...event.followUp.map((text) => ({
            text,
            kind: "follow-up" as const,
          })),
        ],
      });
      return true;
    }
    if (event.type === "agent_settled") {
      // The owned run includes SDK post-run hooks, retries, and late-queue
      // reconciliation. Only its lifecycle can release the run reservation.
      if (!this.lifecycle.active) this.settle();
      return true;
    }
    return false;
  }

  private handleMessageEvent(event: AgentSessionEvent) {
    if (event.type === "message_update") {
      const stream = event.assistantMessageEvent;
      if (stream.type === "text_delta" || stream.type === "thinking_delta") {
        this.emit({
          _tag: "AssistantDelta",
          kind: stream.type === "text_delta" ? "text" : "thinking",
          delta: stream.delta,
        });
      }
      return true;
    }
    if (event.type !== "message_end") return false;
    const role = messageRole(event.message);
    if (role === "user") {
      // SAFETY: messageRole decoded the SDK event's discriminant as a user message.
      const text = userText(event.message as Message);
      if (text.trim()) this.emit({ _tag: "UserMessage", text });
    } else if (role === "assistant") {
      // SAFETY: messageRole decoded the SDK event's discriminant as an assistant message.
      this.emit({
        _tag: "AssistantMessage",
        parts: assistantParts(event.message as AssistantMessage),
      });
      this.emitUsage();
      this.emit({ _tag: "MetaChanged", meta: this.currentMeta() });
    }
    return true;
  }

  private handleToolEvent(event: AgentSessionEvent) {
    if (event.type === "tool_execution_start") {
      this.emit({
        _tag: "ToolStart",
        toolId: event.toolCallId,
        name: event.toolName,
      });
    } else if (event.type === "tool_execution_update") {
      this.emit({
        _tag: "ToolUpdate",
        toolId: event.toolCallId,
        outputPreview: toolPreview(event.partialResult),
      });
    } else if (event.type === "tool_execution_end") {
      this.emit({
        _tag: "ToolEnd",
        toolId: event.toolCallId,
        name: event.toolName,
        isError: event.isError,
        outputPreview: toolPreview(event.result),
      });
    }
  }

  announceMeta() {
    this.emit({ _tag: "MetaChanged", meta: this.currentMeta() });
  }

  dispose(shutdown: (session: AgentSession) => Promise<void>): Promise<void> {
    if (this.disposal) return this.disposal;
    this.state.closed = true;
    this.unsubscribe?.();
    this.disposal = this.lifecycle.dispose().finally(async () => {
      try {
        await shutdown(this.session);
      } finally {
        Queue.endUnsafe(this.events);
      }
    });
    return this.disposal;
  }

  toSession(): WorkerSession {
    return {
      meta: Effect.sync(this.currentMeta),
      events: Stream.fromQueue(this.events),
      send: this.lifecycle.send,
      steer: this.lifecycle.steer,
      interrupt: this.lifecycle.interrupt,
    };
  }
}
