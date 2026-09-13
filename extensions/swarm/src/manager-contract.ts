import { Context, type Effect, type Scope } from "effect";
import type { WorkerSession } from "./session.ts";
import type {
  LiveToolState,
  SpawnTask,
  AgentMeta,
  AgentOutcome,
  AgentSnapshot,
  AgentStatus,
  TranscriptItem,
} from "./domain.ts";
import type { ConcurrencyLimitError, SendError, SpawnError } from "./domain.ts";

export const MAX_RUNNING = 4;
export const MAX_TRACKED = 64;
export const STOP_TIMEOUT_MS = 5_000;
export const SWARM_SHUTDOWN_TIMEOUT_MS = STOP_TIMEOUT_MS * 2;
const ERROR_TEXT_MAX_LENGTH = 4_096;
const TRANSCRIPT_TEXT_MAX_LENGTH = 64 * 1_024;
export const LIVE_ASSISTANT_MAX_LENGTH = 128 * 1_024;
export const FINAL_TEXT_MAX_LENGTH = 1_024 * 1_024;
const MAX_TRANSCRIPT_ITEMS = 512;

export function bounded(text: string) {
  return text.slice(0, ERROR_TEXT_MAX_LENGTH);
}

export function boundedTranscriptText(text: string) {
  return text.slice(0, TRANSCRIPT_TEXT_MAX_LENGTH);
}

export interface MutableSnapshot extends AgentSnapshot {
  generation: number;
  status: AgentStatus;
  outcome?: AgentOutcome | undefined;
  settledAt?: number | undefined;
  errorText?: string | undefined;
  meta: AgentMeta;
  usage: {
    tokens?: number | undefined;
    contextWindow?: number | undefined;
  };
  transcript: TranscriptItem[];
  liveAssistant?: { text: string; thinking: string } | undefined;
  liveTools: LiveToolState[];
  queued: AgentSnapshot["queued"];
  finalText: string;
  turns: number;
}

export function appendTranscript(
  snapshot: MutableSnapshot,
  item: TranscriptItem,
) {
  snapshot.transcript.push(item);
  if (snapshot.transcript.length > MAX_TRANSCRIPT_ITEMS) {
    snapshot.transcript.splice(
      0,
      snapshot.transcript.length - MAX_TRANSCRIPT_ITEMS,
    );
  }
}

export interface Entry {
  snapshot: MutableSnapshot;
  session: WorkerSession;
  scope: Scope.Closeable;
  liveToolMap: Map<string, LiveToolState>;
  restarting?: boolean;
  stopping?: boolean;
}

export interface SwarmReadModel {
  list(): ReadonlyArray<AgentSnapshot>;
  get(id: string): AgentSnapshot | undefined;
  size(): number;
  canAct(id: string): boolean;
  beginShutdown(): ReadonlyArray<AgentSnapshot>;
  subscribe(listener: () => void): () => void;
  subscribeTo(id: string, listener: () => void): () => void;
  requestSend(id: string, text: string): void;
  requestAbort(id: string): void;
  setOnStarted(hook: ((snapshot: AgentSnapshot) => boolean) | undefined): void;
  setOnSettled(
    hook: ((snapshot: AgentSnapshot, consumed: boolean) => void) | undefined,
  ): void;
}

export interface CancelResult {
  readonly id: string;
  readonly title: string;
  readonly status: AgentStatus;
  readonly cancelled: boolean;
}

export interface SwarmManagerService {
  spawn(
    task: SpawnTask,
  ): Effect.Effect<AgentSnapshot, SpawnError | ConcurrencyLimitError>;
  /** Returns copied settled snapshots in unique request order; unknown IDs are ignored. */
  waitFor(
    ids: ReadonlyArray<string>,
    onPending?: (pending: string[]) => void,
  ): Effect.Effect<ReadonlyArray<AgentSnapshot>>;
  cancel(
    ids: ReadonlyArray<string>,
  ): Effect.Effect<ReadonlyArray<CancelResult>>;
  send(id: string, text: string): Effect.Effect<void, SendError>;
  readonly view: SwarmReadModel;
}

export class SwarmManager extends Context.Service<
  SwarmManager,
  SwarmManagerService
>()("swarm/SwarmManager") {}
