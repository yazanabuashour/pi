import type * as NodeChildProcess from "node:child_process";
import type * as NodeFS from "node:fs";
import { Context, type Deferred, type Effect, type Scope } from "effect";
import type {
  ConcurrencyLimitError,
  SpawnError,
  TerminalSnapshot,
  TerminalStatus,
  UnknownTerminalError,
} from "./domain.ts";
import type { OutputBuffer } from "./output.ts";

export const MAX_RUNNING = 8;
export const MAX_TRACKED = 32;
export const MAX_SETTLED_HISTORY = MAX_TRACKED * 4;
export const RETAINED_PER_STREAM = 2 * 1024 * 1024;
export const MAX_SPILL_BYTES_PER_STREAM = 256 * 1024 * 1024;
export const STOP_TIMEOUT_MS = 5_000;
export const FORCE_KILL_AFTER_MS = 2_000;
export const SETTLE_GRACE_MS = 1_000;
export const TERMINAL_SHUTDOWN_TIMEOUT_MS = STOP_TIMEOUT_MS + SETTLE_GRACE_MS;
export const SPILL_FLUSH_TIMEOUT_MS = 1_500;
const ERROR_TEXT_MAX_LENGTH = 4_096;

export function bounded(text: string) {
  return text.slice(0, ERROR_TEXT_MAX_LENGTH);
}

export function boundedError<Input1>(error: Input1) {
  return bounded(error instanceof Error ? error.message : String(error));
}

export interface MutableSnapshot extends TerminalSnapshot {
  status: TerminalStatus;
  pid?: number;
  settledAt?: number;
  exitCode?: number;
  signal?: string;
  errorText?: string;
}

export interface Entry {
  snapshot: MutableSnapshot;
  child: NodeChildProcess.ChildProcess;
  scope: Scope.Closeable;
  stdoutBuf: OutputBuffer;
  stderrBuf: OutputBuffer;
  spillStreams: NodeFS.WriteStream[];
  killSignaled: boolean;
  processErrored: boolean;
  exited: boolean;
  stdioClosed: boolean;
  settling: boolean;
  exitCleanupStarted: boolean;
  settled: Deferred.Deferred<void>;
}

export interface StartOptions {
  readonly command: string;
  readonly title: string;
  readonly cwd: string;
}

export interface KillResult {
  readonly id: string;
  readonly title: string;
  readonly status: TerminalStatus;
  readonly wasRunning: boolean;
  readonly killed: boolean;
  readonly exit: string;
}

export interface TerminalReadModel {
  list(): ReadonlyArray<TerminalSnapshot>;
  get(id: string): TerminalSnapshot | undefined;
  size(): number;
  beginShutdown(): ReadonlyArray<TerminalSnapshot>;
  subscribe(listener: () => void): () => void;
  subscribeTo(id: string, listener: () => void): () => void;
  requestKill(id: string): void;
  setOnSettled(
    hook: ((snap: TerminalSnapshot, consumed: boolean) => void) | undefined,
  ): void;
}

export interface TerminalManagerService {
  start(
    options: StartOptions,
  ): Effect.Effect<TerminalSnapshot, SpawnError | ConcurrencyLimitError>;
  status(id: string): Effect.Effect<TerminalSnapshot, UnknownTerminalError>;
  kill(ids: ReadonlyArray<string>): Effect.Effect<ReadonlyArray<KillResult>>;
  readonly list: Effect.Effect<ReadonlyArray<TerminalSnapshot>>;
  readonly disposeAll: Effect.Effect<void>;
  readonly view: TerminalReadModel;
}

export class TerminalManager extends Context.Service<
  TerminalManager,
  TerminalManagerService
>()("background-terminals/TerminalManager") {}
