import type {
  ExtensionAPI,
  ExtensionContext,
  MessageEndEvent,
  MessageUpdateEvent,
} from "@earendil-works/pi-coding-agent";
import {
  emptyModelInfoState,
  MODEL_INFO_CHANNEL,
  REFRESH_CHANNEL,
} from "../shared/dashboard-state.ts";

// Approximate content-stream speed, not end-to-end provider throughput.
const CHARS_PER_ESTIMATED_TOKEN = 4;
const LIVE_UPDATE_INTERVAL_MS = 200;

// SDK pricing estimates for assistant messages on the current branch only.
// Not subscription billing; excludes nested tool work and summaries.
function getBranchAssistantEstimatedCost(ctx: ExtensionContext) {
  let cost = 0;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "message" && entry.message.role === "assistant") {
      cost += entry.message.usage.cost.total;
    }
  }
  return cost;
}

function estimateContentTokens(characters: number) {
  return Math.ceil(characters / CHARS_PER_ESTIMATED_TOKEN);
}

class ModelInfoController {
  private state = emptyModelInfoState();
  private contentStreamStart: number | null = null;
  private lastContentDeltaAt: number | null = null;
  private contentCharacters = 0;
  private firstContentDeltaCharacters = 0;
  private contentDeltaCount = 0;
  private sawToolCall = false;
  private runContentTokens = 0;
  private runContentStreamMs = 0;
  private lastLiveUpdate = 0;
  private currentContext: ExtensionContext | undefined;
  private stopRefreshListener: (() => void) | undefined;
  private readonly pi: ExtensionAPI;

  constructor(pi: ExtensionAPI) {
    this.pi = pi;
  }

  install() {
    this.stopRefreshListener = this.pi.events.on(REFRESH_CHANNEL, () => {
      if (this.currentContext) this.refresh(this.currentContext);
    });
    this.installSessionEvents();
    this.installMessageEvents();
    this.installSettlementEvents();
  }

  private publish() {
    this.pi.events.emit(MODEL_INFO_CHANNEL, { ...this.state });
  }

  private refresh(ctx: ExtensionContext) {
    this.currentContext = ctx;
    const model = ctx.model;
    const usage = ctx.getContextUsage();
    this.state = {
      ...this.state,
      provider: model?.provider ?? "",
      modelId: model?.id ?? "no-model",
      thinking: model?.reasoning ? this.pi.getThinkingLevel() : "off",
      contextWindow: usage?.contextWindow ?? model?.contextWindow ?? 0,
      contextPercent: usage?.percent ?? null,
      cost: getBranchAssistantEstimatedCost(ctx),
    };
    this.publish();
  }

  private resetMessageTracking() {
    this.contentStreamStart = null;
    this.lastContentDeltaAt = null;
    this.contentCharacters = 0;
    this.firstContentDeltaCharacters = 0;
    this.contentDeltaCount = 0;
    this.sawToolCall = false;
    this.lastLiveUpdate = 0;
  }

  private installSessionEvents() {
    this.pi.on("session_start", (_event, ctx) => {
      this.resetMessageTracking();
      this.runContentTokens = 0;
      this.runContentStreamMs = 0;
      this.state = { ...this.state, tokensPerSecond: null };
      this.refresh(ctx);
    });
    this.pi.on("model_select", (event, ctx) => {
      this.state = {
        ...this.state,
        provider: event.model.provider,
        modelId: event.model.id,
        thinking: event.model.reasoning ? this.pi.getThinkingLevel() : "off",
        contextWindow: event.model.contextWindow,
      };
      this.refresh(ctx);
    });
    this.pi.on("thinking_level_select", (event) => {
      this.state = { ...this.state, thinking: event.level };
      this.publish();
    });
    this.pi.on("agent_start", (_event, ctx) => {
      this.runContentTokens = 0;
      this.runContentStreamMs = 0;
      this.resetMessageTracking();
      this.state = { ...this.state, tokensPerSecond: null };
      this.refresh(ctx);
    });
  }

  private installMessageEvents() {
    this.pi.on("message_start", (event) => {
      if (event.message.role === "assistant") this.resetMessageTracking();
    });
    this.pi.on("message_update", (event) => this.handleMessageUpdate(event));
    this.pi.on("message_end", (event, ctx) =>
      this.handleMessageEnd(event, ctx),
    );
  }

  private handleMessageUpdate(event: MessageUpdateEvent) {
    if (event.message.role !== "assistant") return;
    const stream = event.assistantMessageEvent;
    if (stream.type === "toolcall_delta") {
      this.sawToolCall = true;
      return;
    }
    if (
      (stream.type !== "text_delta" && stream.type !== "thinking_delta") ||
      !stream.delta
    )
      return;
    const now = Date.now();
    if (this.contentStreamStart === null) {
      this.contentStreamStart = now;
      this.firstContentDeltaCharacters = stream.delta.length;
    }
    this.lastContentDeltaAt = now;
    this.contentCharacters += stream.delta.length;
    this.contentDeltaCount += 1;
    const elapsedMs = now - this.contentStreamStart;
    const streamedCharacters =
      this.contentCharacters - this.firstContentDeltaCharacters;
    if (
      this.contentDeltaCount < 2 ||
      elapsedMs <= 0 ||
      streamedCharacters <= 0 ||
      now - this.lastLiveUpdate < LIVE_UPDATE_INTERVAL_MS
    )
      return;
    this.lastLiveUpdate = now;
    this.state = {
      ...this.state,
      tokensPerSecond:
        estimateContentTokens(streamedCharacters) / (elapsedMs / 1000),
    };
    this.publish();
  }

  private handleMessageEnd(event: MessageEndEvent, ctx: ExtensionContext) {
    if (event.message.role !== "assistant") return;
    this.sawToolCall ||= event.message.content.some(
      (block) => block.type === "toolCall",
    );
    if (this.contentStreamStart !== null && this.contentCharacters > 0) {
      const streamEnd = this.lastContentDeltaAt ?? this.contentStreamStart;
      const streamMs = streamEnd - this.contentStreamStart;
      const firstTokens = estimateContentTokens(
        this.firstContentDeltaCharacters,
      );
      const streamedTokens =
        !this.sawToolCall && event.message.usage.output > 0
          ? Math.max(0, event.message.usage.output - firstTokens)
          : Math.max(
              0,
              estimateContentTokens(this.contentCharacters) - firstTokens,
            );
      if (this.contentDeltaCount >= 2 && streamMs >= 50 && streamedTokens > 0) {
        this.runContentTokens += streamedTokens;
        this.runContentStreamMs += streamMs;
        this.state = {
          ...this.state,
          tokensPerSecond:
            this.runContentTokens / (this.runContentStreamMs / 1000),
        };
      }
    }
    this.resetMessageTracking();
    this.refresh(ctx);
  }

  private installSettlementEvents() {
    this.pi.on("turn_end", (_event, ctx) => this.refresh(ctx));
    this.pi.on("agent_settled", (_event, ctx) => this.refresh(ctx));
    this.pi.on("session_shutdown", () => {
      this.stopRefreshListener?.();
      this.currentContext = undefined;
    });
  }
}

export default function modelInfo(pi: ExtensionAPI) {
  new ModelInfoController(pi).install();
}
