import { Effect, Match, Predicate } from "effect";
import {
  LIVE_ASSISTANT_MAX_LENGTH,
  appendTranscript,
  boundedTranscriptText,
  type Entry,
} from "./manager-contract.ts";
import { notify, settle, type ManagerState } from "./manager-state.ts";
import { RunOutcome, type AgentEvent } from "./domain.ts";

type Event<Tag extends AgentEvent["_tag"]> = Extract<AgentEvent, { _tag: Tag }>;

function foldAssistantDelta(entry: Entry, event: Event<"AssistantDelta">) {
  const live = entry.snapshot.liveAssistant ?? { text: "", thinking: "" };
  entry.snapshot.liveAssistant =
    event.kind === "text"
      ? {
          ...live,
          text: (live.text + event.delta).slice(-LIVE_ASSISTANT_MAX_LENGTH),
        }
      : {
          ...live,
          thinking: (live.thinking + event.delta).slice(
            -LIVE_ASSISTANT_MAX_LENGTH,
          ),
        };
}

function foldAssistantMessage(entry: Entry, event: Event<"AssistantMessage">) {
  appendTranscript(entry.snapshot, {
    kind: "assistant",
    parts: event.parts.map((part) => {
      if (part.type !== "toolCall")
        return { ...part, text: boundedTranscriptText(part.text) };

      return {
        ...part,
        argsPreview: part.argsPreview
          ? boundedTranscriptText(part.argsPreview)
          : undefined,
      };
    }),
  });
  entry.snapshot.liveAssistant = undefined;
  entry.snapshot.turns++;
}

function foldToolStart(entry: Entry, event: Event<"ToolStart">) {
  entry.liveToolMap.set(event.toolId, {
    toolId: event.toolId,
    name: event.name,
  });
  entry.snapshot.liveTools = [...entry.liveToolMap.values()];
}

function foldToolUpdate(entry: Entry, event: Event<"ToolUpdate">) {
  const current = entry.liveToolMap.get(event.toolId);

  if (!current) return;
  entry.liveToolMap.set(event.toolId, {
    ...current,
    outputPreview: event.outputPreview
      ? boundedTranscriptText(event.outputPreview)
      : current.outputPreview,
  });
  entry.snapshot.liveTools = [...entry.liveToolMap.values()];
}

function foldToolEnd(entry: Entry, event: Event<"ToolEnd">) {
  entry.liveToolMap.delete(event.toolId);
  entry.snapshot.liveTools = [...entry.liveToolMap.values()];
  appendTranscript(entry.snapshot, {
    kind: "toolResult",
    toolId: event.toolId,
    name: event.name,
    isError: event.isError,
    outputPreview: event.outputPreview
      ? boundedTranscriptText(event.outputPreview)
      : undefined,
  });
}

function foldRunStarted(
  state: ManagerState,
  entry: Entry,
  abort: (entry: Entry) => Effect.Effect<void>,
) {
  const snapshot = entry.snapshot;
  const restarted = snapshot.status !== "running";
  entry.restarting = false;

  if (restarted) snapshot.generation++;
  snapshot.status = "running";
  snapshot.outcome = undefined;
  snapshot.settledAt = undefined;
  snapshot.errorText = undefined;

  if (restarted && state.onStarted?.(snapshot) === false) {
    settle(
      state,
      entry,
      RunOutcome.Failed({
        errorText: "Run lifecycle could not be persisted",
      }),
    );
    state.runDetached(abort(entry).pipe(Effect.ignore));
  }
}

export function foldEvent(
  state: ManagerState,
  entry: Entry,
  event: AgentEvent,
  abort: (entry: Entry) => Effect.Effect<void>,
) {
  const snapshot = entry.snapshot;

  if (Predicate.isTagged(event, "RunSettled")) {
    settle(state, entry, event.outcome);

    return;
  }

  Match.value(event).pipe(
    Match.tagsExhaustive({
      RunStarted: () => foldRunStarted(state, entry, abort),
      UserMessage: (event) =>
        appendTranscript(snapshot, {
          kind: "user",
          text: boundedTranscriptText(event.text),
        }),
      AssistantDelta: (event) => foldAssistantDelta(entry, event),
      AssistantMessage: (event) => foldAssistantMessage(entry, event),
      ToolStart: (event) => foldToolStart(entry, event),
      ToolUpdate: (event) => foldToolUpdate(entry, event),
      ToolEnd: (event) => foldToolEnd(entry, event),
      QueueChanged: (event) => {
        snapshot.queued = event.queued;
      },
      UsageChanged: (event) => {
        snapshot.usage = {
          tokens: event.tokens ?? snapshot.usage.tokens,
          contextWindow: event.contextWindow ?? snapshot.usage.contextWindow,
        };
      },
      MetaChanged: (event) => {
        snapshot.meta = { ...snapshot.meta, ...event.meta };
      },
    }),
  );

  notify(state, snapshot.id);
}
