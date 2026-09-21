import * as NodeChildProcess from "node:child_process";
import type * as NodeFS from "node:fs";
import { Deferred, Effect, Scope } from "effect";
import { hostPlatform } from "../../shared/host-runtime.ts";
import {
  MAX_RUNNING,
  RETAINED_PER_STREAM,
  SETTLE_GRACE_MS,
  boundedError,
  type Entry,
  type MutableSnapshot,
  type StartOptions,
} from "./manager-contract.ts";
import { shellInvocation, terminateChild } from "./manager-process.ts";
import { createSpill, flushSpillStreams } from "./manager-spill.ts";
import {
  closeEntryScope,
  notify,
  runningCount,
  scheduleExitCleanup,
  settle,
  settleAfterFlush,
  type ManagerState,
} from "./manager-state.ts";
import { ConcurrencyLimitError, SpawnError } from "./domain.ts";
import { OutputBuffer } from "./output.ts";

function reserveStart(state: ManagerState) {
  return Effect.suspend(
    (): Effect.Effect<void, SpawnError | ConcurrencyLimitError> => {
      if (state.disposed) {
        return new SpawnError({
          message: "Background terminal manager is shutting down.",
        });
      }
      if (runningCount(state) + state.reserved >= MAX_RUNNING) {
        return new ConcurrencyLimitError({
          message: `Max ${MAX_RUNNING} background terminals can run concurrently. Stop one with bg_kill before starting another.`,
        });
      }
      state.reserved++;
      return Effect.void;
    },
  );
}

function spawnChild(options: StartOptions) {
  const { shell, args } = shellInvocation(options.command);
  return Effect.try({
    try: () =>
      NodeChildProcess.spawn(shell, args, {
        cwd: options.cwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
        detached: hostPlatform !== "win32",
      }),
    catch: (error) => new SpawnError({ message: boundedError(error) }),
  });
}

function createBuffers(
  state: ManagerState,
  child: NodeChildProcess.ChildProcess,
  id: string,
) {
  const entryRef = () => state.entries.get(id);
  const stdoutSpill = createSpill(state, entryRef, id, "stdout", () =>
    child.stdout?.resume(),
  );
  const stderrSpill = createSpill(state, entryRef, id, "stderr", () =>
    child.stderr?.resume(),
  );
  const stdoutBuf = new OutputBuffer(RETAINED_PER_STREAM, stdoutSpill?.write);
  const stderrBuf = new OutputBuffer(RETAINED_PER_STREAM, stderrSpill?.write);
  stdoutBuf.spillPath = stdoutSpill?.spillPath;
  stderrBuf.spillPath = stderrSpill?.spillPath;
  return { stdoutBuf, stderrBuf, stdoutSpill, stderrSpill };
}

function createEntry(
  state: ManagerState,
  options: StartOptions,
  child: NodeChildProcess.ChildProcess,
) {
  return Effect.gen(function* () {
    const id = `bt-${++state.counter}`;
    const buffers = createBuffers(state, child, id);
    const snapshot: MutableSnapshot = {
      id,
      command: options.command,
      title: options.title,
      cwd: options.cwd,
      status: "running",
      createdAt: Date.now(),
      get stdout() {
        return buffers.stdoutBuf.view();
      },
      get stderr() {
        return buffers.stderrBuf.view();
      },
    };
    if (child.pid !== undefined) snapshot.pid = child.pid;
    const scope = yield* Scope.make();
    const settled = yield* Deferred.make<void>();
    const spillStreams = [
      buffers.stdoutSpill?.file,
      buffers.stderrSpill?.file,
    ].filter((file): file is NodeFS.WriteStream => file !== undefined);
    return {
      snapshot,
      child,
      scope,
      stdoutBuf: buffers.stdoutBuf,
      stderrBuf: buffers.stderrBuf,
      spillStreams,
      processErrored: false,
      exited: false,
      stopRequestedBeforeExit: false,
      stdioClosed: false,
      stdioCleanupIncomplete: false,
      settling: false,
      exitCleanupStarted: false,
      settled,
    } satisfies Entry;
  });
}

function wireOutput(state: ManagerState, entry: Entry) {
  const { child, snapshot, stdoutBuf, stderrBuf } = entry;
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    if (!stdoutBuf.push(chunk)) child.stdout?.pause();
    notify(state, snapshot.id);
  });
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    if (!stderrBuf.push(chunk)) child.stderr?.pause();
    notify(state, snapshot.id);
  });
}

function wireLifecycle(state: ManagerState, entry: Entry) {
  const { child, snapshot } = entry;
  child.once("error", (error) => {
    snapshot.errorText ??= boundedError(error);
    // A spawn error proves no child was started. Other errors (including
    // failed signals) do not prove that an existing child exited.
    if (child.pid !== undefined) return;
    entry.processErrored = true;
    entry.exited = true;
    settleAfterFlush(state, entry);
  });
  child.once("exit", (code, signal) => {
    entry.stopRequestedBeforeExit = snapshot.stopRequested === true;
    entry.exited = true;
    if (entry.stdioCleanupIncomplete) {
      snapshot.cleanupIncomplete =
        "Process exit observed, but stdio did not close";
    }
    if (code !== null) snapshot.exitCode = code;
    if (signal !== null) snapshot.signal = signal;
    // Bounded cleanup may already have closed the scope without observing exit.
    if (Deferred.isDoneUnsafe(entry.settled)) settleAfterFlush(state, entry);
    else scheduleExitCleanup(state, entry);
  });
  child.once("close", (code, signal) => {
    if (!entry.exited)
      entry.stopRequestedBeforeExit = snapshot.stopRequested === true;
    entry.exited = true;
    entry.stdioClosed = true;
    if (entry.stdioCleanupIncomplete) {
      entry.stdioCleanupIncomplete = false;
      delete snapshot.cleanupIncomplete;
      notify(state, snapshot.id);
    }
    if (!entry.processErrored) {
      if (snapshot.exitCode === undefined && code !== null) {
        snapshot.exitCode = code;
      }
      if (snapshot.signal === undefined && signal !== null) {
        snapshot.signal = signal;
      }
    }
    settleAfterFlush(state, entry);
  });
}

function forceSettlement(state: ManagerState, entry: Entry) {
  return Effect.gen(function* () {
    if (entry.snapshot.status !== "running" || entry.settling) return;
    if (!entry.stdioClosed) {
      entry.stdioCleanupIncomplete = true;
      entry.snapshot.cleanupIncomplete = entry.exited
        ? "Process exit observed, but stdio did not close; output may be incomplete"
        : "Process exit was not observed after termination; stdio remains open";
      entry.snapshot.errorText ??=
        "Output capture closed before stdio; output may be incomplete";
      entry.stdoutBuf.spillPath = undefined;
      entry.stderrBuf.spillPath = undefined;
    }
    entry.settling = true;
    yield* flushSpillStreams(entry);
    settle(state, entry);
  });
}

function installFinalizer(state: ManagerState, entry: Entry) {
  const finalizer = Effect.gen(function* () {
    yield* terminateChild(
      entry.child,
      () => entry.stdioClosed,
      () => {
        entry.snapshot.stopRequested = true;
        notify(state, entry.snapshot.id);
      },
    );
    if (entry.snapshot.status === "running") {
      yield* Deferred.await(entry.settled).pipe(
        Effect.timeout(SETTLE_GRACE_MS),
        Effect.ignore,
      );
    }
    yield* forceSettlement(state, entry);
  });
  return Scope.provide(
    Effect.addFinalizer(() => finalizer),
    entry.scope,
  );
}

function startReserved(state: ManagerState, options: StartOptions) {
  return Effect.gen(function* () {
    const child = yield* spawnChild(options);
    const entry = yield* createEntry(state, options, child);
    wireOutput(state, entry);
    wireLifecycle(state, entry);
    yield* installFinalizer(state, entry);
    if (state.disposed) {
      yield* closeEntryScope(entry);
      return yield* new SpawnError({
        message: "Background terminal manager shut down while starting.",
      });
    }
    state.entries.set(entry.snapshot.id, entry);
    notify(state, entry.snapshot.id);
    return entry.snapshot;
  });
}

export function startTerminal(state: ManagerState, options: StartOptions) {
  return Effect.gen(function* () {
    yield* reserveStart(state);
    return yield* startReserved(state, options).pipe(
      Effect.uninterruptible,
      Effect.ensuring(
        Effect.sync(() => {
          state.reserved--;
          notify(state);
        }),
      ),
    );
  });
}
