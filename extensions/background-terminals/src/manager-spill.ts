import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { Effect } from "effect";
import {
  MAX_SPILL_BYTES_PER_STREAM,
  SPILL_FLUSH_TIMEOUT_MS,
  bounded,
  boundedError,
  type Entry,
} from "./manager-contract.ts";
import type { ManagerState } from "./manager-state.ts";

export function flushSpillStreams(entry: Entry) {
  const streams = entry.spillStreams;
  entry.spillStreams = [];
  return Effect.forEach(
    streams,
    (stream) =>
      Effect.callback<void>((resume) => {
        const done = () => resume(Effect.void);
        try {
          stream.end(done);
        } catch {
          done();
        }
      }),
    { concurrency: "unbounded", discard: true },
  ).pipe(
    Effect.timeoutOrElse({
      duration: SPILL_FLUSH_TIMEOUT_MS,
      orElse: () =>
        Effect.sync(() => {
          entry.stdoutBuf.spillPath = undefined;
          entry.stderrBuf.spillPath = undefined;
          entry.snapshot.errorText ??=
            "Full-log spill flush timed out; full output may be incomplete";
        }),
    }),
  );
}

function resolveSpillDir(state: ManagerState) {
  if (state.spillDir !== undefined) return state.spillDir ?? undefined;
  try {
    const base = NodePath.join(NodeOS.tmpdir(), "pi-background-terminals");
    NodeFS.mkdirSync(base, { recursive: true, mode: 0o700 });
    NodeFS.chmodSync(base, 0o700);
    state.spillDir = NodeFS.mkdtempSync(NodePath.join(base, "session-"));
    NodeFS.chmodSync(state.spillDir, 0o700);
  } catch {
    state.spillDir = null;
  }
  return state.spillDir ?? undefined;
}

function noteSpillFailure(
  entry: Entry | undefined,
  stream: "stdout" | "stderr",
  spillPath: string,
  error: Error,
) {
  if (!entry) return;
  const buffer = stream === "stdout" ? entry.stdoutBuf : entry.stderrBuf;
  buffer.spillPath = undefined;
  entry.snapshot.errorText ??= bounded(
    `Full-log spill to ${spillPath} failed: ${boundedError(error)}`,
  );
}

function noteSpillCap(entry: Entry | undefined, stream: "stdout" | "stderr") {
  if (!entry) return;
  const buffer = stream === "stdout" ? entry.stdoutBuf : entry.stderrBuf;
  buffer.spillPath = undefined;
  entry.snapshot.errorText ??= bounded(
    `${stream} full-log spill reached the ${MAX_SPILL_BYTES_PER_STREAM}-byte safety limit`,
  );
}

export function createSpill(
  state: ManagerState,
  entry: () => Entry | undefined,
  id: string,
  stream: "stdout" | "stderr",
  resumeSource: () => void,
) {
  const dir = resolveSpillDir(state);
  if (!dir) return undefined;
  const spillPath = NodePath.join(dir, `${id}.${stream}.log`);
  try {
    const file = NodeFS.createWriteStream(spillPath, {
      flags: "a",
      mode: 0o600,
    });
    let broken = false;
    let capped = false;
    let writtenBytes = 0;
    file.on("error", (error) => {
      broken = true;
      resumeSource();
      noteSpillFailure(entry(), stream, spillPath, error);
    });
    return {
      spillPath,
      file,
      write: (chunk: string) => {
        if (broken || capped || file.writableEnded) return true;
        const chunkBytes = Buffer.byteLength(chunk, "utf8");
        if (writtenBytes + chunkBytes > MAX_SPILL_BYTES_PER_STREAM) {
          capped = true;
          noteSpillCap(entry(), stream);
          return true;
        }
        writtenBytes += chunkBytes;
        const accepted = file.write(chunk);
        if (!accepted) file.once("drain", resumeSource);
        return accepted;
      },
    };
  } catch {
    return undefined;
  }
}
