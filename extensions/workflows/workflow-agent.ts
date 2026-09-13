import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  isRuntimeRecord,
  isString,
  type RuntimeRecord,
} from "../shared/runtime-values.ts";
import { RunController } from "./controller.ts";
import {
  PREVIEW_LENGTH,
  THINKING_LEVELS,
  errorText,
  type ScriptAgentResult,
} from "./extension-contract.ts";
import { emptyUsage, type AgentRecord, type WorkflowDetails } from "./model.ts";
import {
  type RunAgentOptions,
  type ThinkingLevel,
  type WorkflowModel,
} from "./runner.ts";
import { runAgent } from "./agent-run.ts";
import type { WorkflowProgress } from "./workflow-progress.ts";

function optionString(options: RuntimeRecord, key: string) {
  return isString(options[key]) ? options[key] : undefined;
}

export class WorkflowAgentExecutor {
  private counter = 0;
  private readonly parentModel: WorkflowModel | undefined;
  private readonly parentThinkingLevel: ThinkingLevel;
  private readonly context: ExtensionContext;
  private readonly controller: RunController;
  private readonly details: WorkflowDetails;
  private readonly progress: WorkflowProgress;

  constructor(
    pi: ExtensionAPI,
    context: ExtensionContext,
    controller: RunController,
    details: WorkflowDetails,
    progress: WorkflowProgress,
  ) {
    this.parentModel = context.model;
    this.parentThinkingLevel = pi.getThinkingLevel();
    this.context = context;
    this.controller = controller;
    this.details = details;
    this.progress = progress;
  }

  private createRecord(options: RuntimeRecord) {
    const index = ++this.counter;
    const optionLabel = optionString(options, "label");
    const optionPhase = optionString(options, "phase");
    const record: AgentRecord = {
      index,
      label: optionLabel?.trim()
        ? optionLabel.trim().slice(0, 160)
        : `agent-${index}`,
      state: "running",
      startedAt: Date.now(),
      preview: "",
      usage: emptyUsage(),
      transcript: [],
    };
    const phase = optionPhase?.slice(0, 160) ?? this.details.currentPhase;
    if (phase !== undefined) record.phase = phase;
    if (this.parentModel) {
      record.model = this.parentModel.id;
      record.contextWindow = this.parentModel.contextWindow;
    }
    this.details.agents.push(record);
    this.progress.checkpoint(true);
    this.progress.emit(false);
    return record;
  }

  private fail(record: AgentRecord, message: string): ScriptAgentResult {
    if (!this.progress.active) return this.progress.inactiveResult();
    record.state = "error";
    record.error = message;
    record.finishedAt = Date.now();
    this.progress.emit();
    return { ok: false, output: "", error: message };
  }

  private resolveThinking(
    options: RuntimeRecord,
    label: string,
  ):
    | { level: ThinkingLevel; error?: never }
    | { level?: never; error: string } {
    if (options["effort"] === undefined) {
      return { level: this.parentThinkingLevel };
    }
    const effort = String(options["effort"]);
    const level = THINKING_LEVELS.find((candidate) => candidate === effort);
    return level
      ? { level }
      : {
          error: `agent "${label}": invalid effort "${effort}" (use ${THINKING_LEVELS.join("|")})`,
        };
  }

  private applyOutcome(
    record: AgentRecord,
    outcome: Awaited<ReturnType<typeof runAgent>>,
  ) {
    record.usage = outcome.usage;
    if (outcome.model !== undefined) record.model = outcome.model;
    if (outcome.contextWindow !== undefined) {
      record.contextWindow = outcome.contextWindow;
    }
    record.transcript = outcome.transcript;
    record.preview = (outcome.output || record.preview).slice(
      0,
      PREVIEW_LENGTH,
    );
    record.finishedAt = Date.now();
    record.state = outcome.ok ? "done" : "error";
    if (outcome.ok) delete record.error;
    else record.error = outcome.error ?? "Agent failed";
    this.progress.emit();
    const result: ScriptAgentResult = {
      ok: outcome.ok,
      output: outcome.output,
    };
    if (outcome.structured !== undefined)
      result.structured = outcome.structured;
    if (outcome.error !== undefined) result.error = outcome.error;
    return result;
  }

  private async execute(
    record: AgentRecord,
    prompt: string,
    options: RuntimeRecord,
    signal: AbortSignal,
  ) {
    if (!this.parentModel)
      return this.fail(
        record,
        "Workflow requires a model in the calling thread",
      );
    const resolvedThinking = this.resolveThinking(options, record.label);
    if (resolvedThinking.error !== undefined)
      return this.fail(record, resolvedThinking.error);
    const runOptions: RunAgentOptions = {
      prompt,
      model: this.parentModel,
      thinkingLevel: resolvedThinking.level,
      cwd: this.context.cwd,
      projectTrusted: this.context.isProjectTrusted(),
      modelRegistry: this.context.modelRegistry,
      signal,
      onProgress: (update) => {
        if (!this.progress.active || signal.aborted) return;
        record.preview = update.preview.slice(0, PREVIEW_LENGTH);
        record.usage = update.usage;
        if (update.model !== undefined) record.model = update.model;
        if (update.contextWindow !== undefined) {
          record.contextWindow = update.contextWindow;
        }
        record.transcript = update.transcript;
        this.progress.emit();
      },
    };
    if (options["schema"] !== undefined) {
      runOptions.schema = options["schema"];
    }
    const outcome = await runAgent(runOptions);
    signal.throwIfAborted();
    return this.progress.active
      ? this.applyOutcome(record, outcome)
      : this.progress.inactiveResult();
  }

  agent = async <Input1, Input2>(
    promptValue: Input1,
    optionsValue?: Input2,
    invocationSignal?: AbortSignal,
  ): Promise<ScriptAgentResult> => {
    if (!this.progress.active) return this.progress.inactiveResult();
    const options = isRuntimeRecord(optionsValue) ? optionsValue : {};
    const record = this.createRecord(options);
    const prompt = isString(promptValue)
      ? promptValue
      : String(promptValue ?? "");
    if (!prompt.trim())
      return this.fail(record, "agent() requires a non-empty prompt string");
    if (this.controller.signal.aborted) {
      return this.fail(
        record,
        "Workflow was aborted before this agent started",
      );
    }
    return this.controller
      .schedule(
        (signal) => this.execute(record, prompt, options, signal),
        invocationSignal,
      )
      .catch((error) =>
        invocationSignal?.aborted || this.controller.signal.aborted
          ? { ok: false, output: "", error: errorText(error) }
          : this.fail(record, errorText(error)),
      );
  };
}
