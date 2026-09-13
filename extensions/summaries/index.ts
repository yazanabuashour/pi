import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import * as NodeUtil from "node:util";
import { Cause } from "effect";
import { isNumber } from "../shared/runtime-values.ts";
import {
  loadSummaryConfig,
  saveSummaryConfig,
  type SummaryConfig,
} from "./src/config.ts";
import { summarizeRun } from "./src/summarizer.ts";
import {
  buildFallbackRecap,
  createRunBoundary,
  getRunEntries,
  serializeRunTranscript,
} from "./src/transcript.ts";
import {
  openModelPicker,
  openReasoningPicker,
  renderRecap,
  type RecapEntryData,
} from "./src/ui.ts";

const RECAP_ENTRY_TYPE = "summary-recap";
const STATUS_KEY = "summaries";
const SHUTDOWN_WAIT_MS = 1_000;

async function waitForCancellation(
  tasks: readonly Promise<void>[],
  timeoutMs: number,
) {
  if (tasks.length === 0) return;

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.allSettled(tasks),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

interface SummaryState {
  runBoundary: ReturnType<typeof createRunBoundary>;
  active: Map<AbortController, Promise<void>>;
  sessionActive: boolean;
  statusContext: ExtensionContext | undefined;
}

function updateStatus(state: SummaryState) {
  state.statusContext?.ui.setStatus(
    STATUS_KEY,
    state.active.size > 0
      ? state.statusContext.ui.theme.fg("muted", "✦ summarizing run…")
      : undefined,
  );
}

function startSummary(
  pi: ExtensionAPI,
  state: SummaryState,
  ctx: ExtensionContext,
) {
  const run = state.runBoundary.settle();
  if (!run || ctx.mode !== "tui" || !state.sessionActive) return;
  const entries = getRunEntries(
    ctx.sessionManager.getBranch(),
    run.baselineLeafId,
  );
  if (entries.length === 0) return;
  let config: SummaryConfig | undefined;
  const includeTitle = !pi.getSessionName();
  const controller = new AbortController();
  state.statusContext = ctx;
  const task = Promise.resolve()
    .then(() => {
      config = loadSummaryConfig();
      const model = config
        ? ctx.modelRegistry.find(config.provider, config.model)
        : ctx.model;
      if (!model) {
        throw new Error(
          config
            ? `Summary model is unavailable: ${config.provider}/${config.model}`
            : "No current session model is available for run recaps.",
        );
      }
      config ??= {
        provider: model.provider,
        model: model.id,
        reasoning: ctx.thinkingLevel ?? pi.getThinkingLevel(),
      };
      return summarizeRun({
        modelRegistry: ctx.modelRegistry,
        model,
        reasoning: config.reasoning,
        transcript: serializeRunTranscript(entries),
        includeTitle,
        signal: controller.signal,
      });
    })
    .then((generated) => ({ ...generated, ...config }))
    .catch((error): RecapEntryData | undefined => {
      if (controller.signal.aborted || !state.sessionActive) return;
      const detail = error instanceof Error ? ` ${error.message}` : "";
      ctx.ui.notify(
        `The summary model failed; showing a concise local fallback.${detail}`,
        "warning",
      );
      return { ...buildFallbackRecap(entries), ...config, fallback: true };
    })
    .then((recap) => {
      if (recap && state.sessionActive && !controller.signal.aborted) {
        pi.appendEntry(RECAP_ENTRY_TYPE, recap);
        if (includeTitle && recap.title && !pi.getSessionName())
          pi.setSessionName(recap.title);
      }
    })
    .catch((error) => {
      if (controller.signal.aborted || !state.sessionActive) return;
      ctx.ui.notify(
        `Could not save the run recap or session title: ${error instanceof Error ? error.message : String(error)}`,
        "warning",
      );
    })
    .finally(() => {
      state.active.delete(controller);
      updateStatus(state);
    });
  state.active.set(controller, task);
  updateStatus(state);
}

function configSaveFailure(cause: unknown) {
  const failure =
    cause instanceof Error && cause.cause instanceof Error
      ? cause.cause
      : cause;
  if (Cause.isTimeoutError(failure)) return "save timed out";
  if (failure instanceof Error && "errno" in failure) {
    const errno = failure.errno;
    if (isNumber(errno) && Number.isSafeInteger(errno) && errno < 0)
      return NodeUtil.getSystemErrorName(errno);
  }
  return "save failed without a system error code";
}

function registerSummaryCommand(pi: ExtensionAPI) {
  pi.registerCommand("summary-model", {
    description:
      "Use the current session for run recaps (recommended), or choose an override",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        if (ctx.hasUI)
          ctx.ui.notify(
            "Summary model selection is only available in the TUI.",
            "error",
          );
        return;
      }
      let current: SummaryConfig | undefined;
      try {
        current = loadSummaryConfig();
      } catch (error) {
        ctx.ui.notify(
          error instanceof Error ? error.message : String(error),
          "warning",
        );
      }
      const model = await openModelPicker(ctx);
      if (model === undefined) return;
      let config: SummaryConfig | undefined;
      if (model !== "session") {
        const reasoning = await openReasoningPicker(
          ctx,
          model,
          current?.reasoning ?? ctx.thinkingLevel ?? pi.getThinkingLevel(),
        );
        if (!reasoning) return;
        config = { provider: model.provider, model: model.id, reasoning };
      }
      try {
        await saveSummaryConfig(config);
      } catch (cause) {
        ctx.ui.notify(
          `Could not save the private summary model config: ${configSaveFailure(cause)}.`,
          "error",
        );
        return;
      }
      ctx.ui.notify(
        config
          ? `Summary model: ${config.provider}/${config.model} · ${config.reasoning}`
          : "Run recaps now use the current session model and effort.",
        "info",
      );
    },
  });
}

export default function (pi: ExtensionAPI) {
  const state: SummaryState = {
    runBoundary: createRunBoundary(),
    active: new Map(),
    sessionActive: false,
    statusContext: undefined,
  };

  pi.registerEntryRenderer<RecapEntryData>(
    RECAP_ENTRY_TYPE,
    (entry, { expanded }, theme) => renderRecap(entry.data, expanded, theme),
  );

  pi.on("session_start", (_event, ctx) => {
    state.sessionActive = ctx.mode === "tui";
    state.statusContext = ctx;
    state.runBoundary.reset();
  });

  pi.on("before_agent_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    state.runBoundary.begin(ctx.sessionManager.getLeafId());
  });

  pi.on("agent_settled", (_event, ctx) => {
    startSummary(pi, state, ctx);
  });

  pi.on("session_shutdown", async () => {
    state.sessionActive = false;
    state.runBoundary.reset();
    const summaries = [...state.active.entries()];
    for (const [controller] of summaries) controller.abort();
    await waitForCancellation(
      summaries.map(([, task]) => task),
      SHUTDOWN_WAIT_MS,
    );
    state.active.clear();
    state.statusContext?.ui.setStatus(STATUS_KEY, undefined);
    state.statusContext = undefined;
  });
  registerSummaryCommand(pi);
}
