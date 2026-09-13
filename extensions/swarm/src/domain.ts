/** Pi session events normalized for the manager, tools, and UI. */

import type { Api, Model } from "@earendil-works/pi-ai";
import type {
  ModelRegistry,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Data } from "effect";

/** User asides stay out of model tools. */
export type AgentOrigin = "model" | "btw";

/** Pi thinking levels. Omission inherits the calling session's effort. */
export const REASONING_EFFORTS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export type AgentStatus = "running" | "done" | "error";
export type AgentOutcome = "completed" | "failed" | "interrupted";

/** Parent-session context resolved by the tool layer and passed opaquely. */
export interface ParentContext {
  readonly projectTrusted: boolean;
  /** The exact parent model object. Spawning fails when it is missing. */
  readonly inheritedModel?: Model<Api> | undefined;
  readonly inheritedThinkingLevel?: ReasoningEffort | undefined;
  /** Parent registry for response-model metadata and context capacity. */
  readonly modelRegistry?: ModelRegistry | undefined;
}

export interface SpawnTask {
  /** Omitted for normal tool-driven spawns. */
  readonly origin?: "model" | "btw" | undefined;
  readonly prompt: string;
  readonly title: string;
  readonly cwd: string;
  /** Overrides only thinking effort, never the inherited model. */
  readonly reasoningEffort?: ReasoningEffort | undefined;
  readonly parent: ParentContext;
  readonly swarm?:
    | {
        readonly parentId: string;
        readonly canSpawn: boolean;
        readonly toolsFor: (id: string) => ToolDefinition[];
      }
    | undefined;
  /** Bound by the manager after allocating the child identity. */
  readonly customTools?: ToolDefinition[] | undefined;
}

export interface AgentMeta {
  /** Resolved provider/model ID for observability, not selection. */
  readonly modelLabel?: string | undefined;
  /** Context window capacity for utilization display, when known. */
  readonly contextWindow?: number | undefined;
  readonly sessionFilePath?: string | undefined;
}

// --- Transcript ------------------------------------------------------------

export type TranscriptPart =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "thinking";
      readonly text: string;
      readonly redacted?: boolean | undefined;
    }
  | {
      readonly type: "toolCall";
      readonly toolId: string;
      readonly name: string;
      readonly argsPreview?: string | undefined;
    };

export type TranscriptItem =
  | { readonly kind: "user"; readonly text: string }
  | {
      readonly kind: "assistant";
      readonly parts: ReadonlyArray<TranscriptPart>;
    }
  | {
      readonly kind: "toolResult";
      readonly toolId: string;
      readonly name: string;
      readonly isError: boolean;
      readonly outputPreview?: string | undefined;
    };

export interface LiveToolState {
  readonly toolId: string;
  readonly name: string;
  readonly outputPreview?: string | undefined;
}

export interface QueuedMessage {
  readonly text: string;
  readonly kind: "steer" | "follow-up";
}

// --- Events ------------------------------------------------------------------

export type RunOutcome =
  | { readonly _tag: "Completed"; readonly finalText: string }
  | {
      readonly _tag: "Failed";
      readonly errorText: string;
      readonly partialText?: string | undefined;
    }
  | {
      readonly _tag: "Interrupted";
      readonly partialText?: string | undefined;
    };

/**
 * Normalized activity stream. Previews (`argsPreview`, `outputPreview`) are
 * pre-flattened single-line strings because the UI only ever renders one
 * sanitized line.
 */
export type AgentEvent =
  // lifecycle (a session can run multiple turns via send())
  | { readonly _tag: "RunStarted" }
  | { readonly _tag: "RunSettled"; readonly outcome: RunOutcome }
  // transcript building blocks
  | { readonly _tag: "UserMessage"; readonly text: string }
  | {
      readonly _tag: "AssistantDelta";
      readonly kind: "text" | "thinking";
      readonly delta: string;
    }
  | {
      readonly _tag: "AssistantMessage";
      readonly parts: ReadonlyArray<TranscriptPart>;
    }
  | {
      readonly _tag: "ToolStart";
      readonly toolId: string;
      readonly name: string;
    }
  | {
      readonly _tag: "ToolUpdate";
      readonly toolId: string;
      readonly outputPreview?: string | undefined;
    }
  | {
      readonly _tag: "ToolEnd";
      readonly toolId: string;
      readonly name: string;
      readonly isError: boolean;
      readonly outputPreview?: string | undefined;
    }
  // bookkeeping
  | {
      readonly _tag: "QueueChanged";
      readonly queued: ReadonlyArray<QueuedMessage>;
    }
  | {
      readonly _tag: "UsageChanged";
      readonly tokens?: number | undefined;
      readonly contextWindow?: number | undefined;
    }
  | { readonly _tag: "MetaChanged"; readonly meta: Partial<AgentMeta> };

// --- Snapshot ---------------------------------------------------------------

/**
 * The manager folds `AgentEvent`s into one snapshot per agent. This is
 * everything the tools, footer status, and both TUI views read.
 */
export interface AgentSnapshot {
  readonly id: string;
  readonly parentId: string;
  readonly canSpawn: boolean;
  readonly origin: AgentOrigin;
  readonly title: string;
  readonly prompt: string;
  readonly cwd: string;
  /** Increments whenever this agent starts another run. */
  readonly generation: number;
  readonly status: AgentStatus;
  readonly outcome?: AgentOutcome | undefined;
  readonly createdAt: number;
  readonly settledAt?: number | undefined;
  readonly errorText?: string | undefined;
  readonly meta: AgentMeta;
  readonly usage: {
    readonly tokens?: number | undefined;
    readonly contextWindow?: number | undefined;
  };
  readonly transcript: ReadonlyArray<TranscriptItem>;
  /** Streaming assistant buffers, cleared when the finalized message lands. */
  readonly liveAssistant?:
    | { readonly text: string; readonly thinking: string }
    | undefined;
  readonly liveTools: ReadonlyArray<LiveToolState>;
  readonly queued: ReadonlyArray<QueuedMessage>;
  /** Final text of the most recent completed run. */
  readonly finalText: string;
  /** Count of finalized assistant messages (for swarm_check). */
  readonly turns: number;
}

export interface AgentDetails {
  readonly schemaVersion: 1;
  readonly event: "started" | "snapshot" | "settled";
  readonly runtimeId: string;
  readonly id: string;
  readonly parentId: string;
  readonly canSpawn: boolean;
  readonly generation: number;
  readonly origin: AgentOrigin;
  readonly title: string;
  readonly cwd: string;
  readonly harness: "pi";
  readonly model?: string | undefined;
  readonly status: AgentStatus;
  readonly outcome?: AgentOutcome | undefined;
  readonly createdAt: number;
  readonly settledAt?: number | undefined;
  readonly turns: number;
  readonly errorText?: string | undefined;
  readonly shutdownReason?: string | undefined;
}

/** Stable machine details for tool results and durable lifecycle entries. */
export function agentDetails(
  snapshot: AgentSnapshot,
  event: AgentDetails["event"],
  runtimeId: string,
  shutdownReason?: string,
): AgentDetails {
  return {
    schemaVersion: 1,
    event,
    runtimeId,
    id: snapshot.id,
    parentId: snapshot.parentId,
    canSpawn: snapshot.canSpawn,
    generation: snapshot.generation,
    origin: snapshot.origin,
    title: snapshot.title,
    cwd: snapshot.cwd,
    harness: "pi",
    model: snapshot.meta.modelLabel,
    status: event === "started" ? "running" : snapshot.status,
    outcome: event === "started" ? undefined : snapshot.outcome,
    createdAt: snapshot.createdAt,
    settledAt: event === "started" ? undefined : snapshot.settledAt,
    turns:
      event === "started" && snapshot.generation === 1 ? 0 : snapshot.turns,
    errorText: event === "started" ? undefined : snapshot.errorText,
    shutdownReason,
  };
}

/** Final text, or the live streaming buffer while a run is active. */
export function latestText(snap: AgentSnapshot) {
  const live = snap.liveAssistant?.text.trim();
  if (live) return live;
  return snap.finalText;
}

export function formatElapsed(snap: AgentSnapshot) {
  const end = snap.settledAt ?? Date.now();
  const totalSeconds = Math.max(0, Math.round((end - snap.createdAt) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0
    ? `${minutes}m${seconds.toString().padStart(2, "0")}s`
    : `${seconds}s`;
}

// --- Errors -------------------------------------------------------------------

export class SpawnError extends Data.TaggedError("SpawnError")<{
  readonly message: string;
}> {}

export class ConcurrencyLimitError extends Data.TaggedError(
  "ConcurrencyLimitError",
)<{
  readonly message: string;
}> {}

export class SendError extends Data.TaggedError("SendError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
