import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type { Cause, Scope } from "effect";
import { Duration, Effect, Fiber, Queue, Ref, Stream } from "effect";
import type { WorkerSession } from "./src/session.ts";
import type {
  QueuedMessage,
  SpawnTask,
  AgentEvent,
  AgentMeta,
} from "./src/domain.ts";
import { SendError } from "./src/domain.ts";

const CONTEXT_WINDOW = 272_000;
const TOOL_NAME = "shell";
const CADENCE_MS = 30;

const STUB_DIR = NodePath.join(NodeOS.tmpdir(), "swarm-stub");
let sessionCounter = 0;

interface StubState {
  meta: AgentMeta;
  pending: string[];
  turnCount: number;
  closed: boolean;
  dispatching: boolean;
}

type Emit = (event: AgentEvent) => Effect.Effect<void>;

function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .find((line) => line.trim())
      ?.trim() ?? ""
  );
}

function chunked(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks;
}

function makeEmit(
  state: StubState,
  events: Queue.Queue<AgentEvent, Cause.Done>,
): Emit {
  return (event) =>
    Effect.suspend(() => {
      if (event._tag === "MetaChanged")
        state.meta = { ...state.meta, ...event.meta };
      return Queue.offer(events, event);
    }).pipe(Effect.orDie, Effect.asVoid);
}

function makeRunTurn(task: SpawnTask, sessionId: string, emit: Emit) {
  const pause = Effect.sleep(Duration.millis(CADENCE_MS));
  return (userText: string, turn: number) =>
    Effect.gen(function* () {
      yield* emit({ _tag: "RunStarted" });
      const thinking = "Looking at the task and planning an approach...";
      for (const delta of chunked(thinking, 16)) {
        yield* emit({ _tag: "AssistantDelta", kind: "thinking", delta });
        yield* pause;
      }
      const toolId = `${sessionId}-tool-${turn}`;
      const argsPreview = `{"command":"ls ${task.cwd}"}`;
      yield* emit({
        _tag: "AssistantMessage",
        parts: [
          { type: "thinking", text: thinking },
          {
            type: "text",
            text: `I'll run ${TOOL_NAME} to look around first.`,
          },
          { type: "toolCall", toolId, name: TOOL_NAME, argsPreview },
        ],
      });
      yield* emit({
        _tag: "ToolStart",
        toolId,
        name: TOOL_NAME,
      });
      yield* pause;
      yield* emit({
        _tag: "ToolUpdate",
        toolId,
        outputPreview: "src docs package.json",
      });
      yield* pause;
      yield* emit({
        _tag: "ToolEnd",
        toolId,
        name: TOOL_NAME,
        isError: false,
        outputPreview: "src docs package.json",
      });
      yield* emit({
        _tag: "UsageChanged",
        tokens: Math.min(CONTEXT_WINDOW, 2400 * (turn + 1)),
        contextWindow: CONTEXT_WINDOW,
      });
      if (userText.trimStart().startsWith("FAIL:")) {
        yield* pause;
        yield* emit({
          _tag: "RunSettled",
          outcome: {
            _tag: "Failed",
            errorText: "[stub] task failed as requested by FAIL: prefix",
          },
        });
        return;
      }
      const finalText =
        `[stub] completed: ${firstLine(userText).slice(0, 200)}\n\n` +
        `Scripted agent turn ${turn + 1}.`;
      for (const delta of chunked(finalText, 24)) {
        yield* emit({ _tag: "AssistantDelta", kind: "text", delta });
        yield* pause;
      }
      yield* emit({
        _tag: "AssistantMessage",
        parts: [{ type: "text", text: finalText }],
      });
      yield* emit({
        _tag: "UsageChanged",
        tokens: Math.min(CONTEXT_WINDOW, 2400 * (turn + 1) + 900),
        contextWindow: CONTEXT_WINDOW,
      });
      yield* emit({
        _tag: "RunSettled",
        outcome: { _tag: "Completed", finalText },
      });
    });
}

function queuedView(state: StubState): ReadonlyArray<QueuedMessage> {
  return state.pending.map((text) => ({ text, kind: "steer" }));
}

function makeDriver(
  state: StubState,
  inbox: Queue.Queue<string, Cause.Done>,
  activeTurn: Ref.Ref<Fiber.Fiber<void> | undefined>,
  emit: Emit,
  runTurn: ReturnType<typeof makeRunTurn>,
) {
  return Effect.gen(function* () {
    while (true) {
      const text = yield* Queue.take(inbox);
      state.dispatching = true;
      state.pending.shift();
      yield* emit({ _tag: "QueueChanged", queued: queuedView(state) });
      yield* emit({ _tag: "UserMessage", text });
      const turn = state.turnCount++;
      const fiber = yield* Effect.forkChild(
        runTurn(text, turn).pipe(
          Effect.onInterrupt(() =>
            emit({ _tag: "RunSettled", outcome: { _tag: "Interrupted" } }).pipe(
              Effect.ignore,
            ),
          ),
        ),
      );
      yield* Ref.set(activeTurn, fiber);
      state.dispatching = false;
      yield* Fiber.await(fiber);
      yield* Ref.set(activeTurn, undefined);
    }
  });
}

function makeSubmit(
  state: StubState,
  inbox: Queue.Queue<string, Cause.Done>,
  activeTurn: Ref.Ref<Fiber.Fiber<void> | undefined>,
  emit: Emit,
) {
  return (text: string) =>
    Effect.gen(function* () {
      if (state.closed)
        return yield* new SendError({ message: "Agent session is closed." });
      state.pending.push(text);
      if ((yield* Ref.get(activeTurn)) !== undefined) {
        yield* emit({ _tag: "QueueChanged", queued: queuedView(state) });
      }
      yield* Queue.offer(inbox, text).pipe(Effect.orDie);
    });
}

function makeInterrupt(
  state: StubState,
  inbox: Queue.Queue<string, Cause.Done>,
  activeTurn: Ref.Ref<Fiber.Fiber<void> | undefined>,
  emit: Emit,
) {
  return Effect.gen(function* () {
    yield* Queue.clear(inbox).pipe(Effect.orElseSucceed(() => []));
    state.pending = [];
    yield* emit({ _tag: "QueueChanged", queued: [] });
    while (true) {
      const fiber = yield* Ref.get(activeTurn);
      if (fiber) {
        yield* Fiber.interrupt(fiber);
        break;
      }
      if (!state.dispatching) break;
      yield* Effect.sleep(Duration.millis(5));
    }
    yield* emit({ _tag: "RunSettled", outcome: { _tag: "Interrupted" } });
  });
}

export function spawnStubSession(
  task: SpawnTask,
): Effect.Effect<WorkerSession, never, Scope.Scope> {
  return Effect.gen(function* () {
    const sessionId = `stub-${++sessionCounter}`;
    const sessionFile = NodePath.join(STUB_DIR, `${sessionId}.jsonl`);
    const state: StubState = {
      meta: {
        modelLabel: "stub-model",
        contextWindow: CONTEXT_WINDOW,
        sessionFilePath: sessionFile,
      },
      pending: [],
      turnCount: 0,
      closed: false,
      dispatching: false,
    };
    const events = yield* Queue.make<AgentEvent, Cause.Done>();
    const inbox = yield* Queue.make<string, Cause.Done>();
    const activeTurn = yield* Ref.make<Fiber.Fiber<void> | undefined>(
      undefined,
    );
    const emit = makeEmit(state, events);
    const runTurn = makeRunTurn(task, sessionId, emit);
    yield* Effect.forkScoped(
      makeDriver(state, inbox, activeTurn, emit, runTurn).pipe(Effect.ignore),
    );
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        state.closed = true;
        yield* Queue.end(inbox).pipe(Effect.ignore);
        yield* Queue.end(events).pipe(Effect.ignore);
      }),
    );
    const submit = makeSubmit(state, inbox, activeTurn, emit);
    yield* emit({ _tag: "MetaChanged", meta: state.meta });
    return {
      meta: Effect.sync(() => state.meta),
      events: Stream.fromQueue(events),
      send: submit,
      steer: (text) =>
        Effect.gen(function* () {
          if (
            !state.dispatching &&
            state.pending.length === 0 &&
            (yield* Ref.get(activeTurn)) === undefined
          )
            return false;
          yield* submit(text);
          return true;
        }),
      interrupt: makeInterrupt(state, inbox, activeTurn, emit),
    };
  });
}
