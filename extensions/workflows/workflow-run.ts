import * as NodeCrypto from "node:crypto";
import * as NodePath from "node:path";
import {
  getAgentDir,
  type AgentToolUpdateCallback,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { createWorkflowPersistence, persistWorkflowJson } from "./artifacts.ts";
import { RunController } from "./controller.ts";
import { errorText, type WorkflowInput } from "./extension-contract.ts";
import type { WorkflowExtensionSession } from "./extension-session.ts";
import type { RuntimeValue } from "../shared/runtime-values.ts";
import { prepareWorkflowScript, type PreparedWorkflowScript } from "./meta.ts";
import type { WorkflowDetails } from "./model.ts";
import { toSerializable, writeFileAtomic } from "./serialization.ts";
import { runWorkflowWorker } from "./worker.ts";
import { WorkflowAgentExecutor } from "./workflow-agent.ts";
import { WorkflowProgress } from "./workflow-progress.ts";

interface StartWorkflowOptions {
  pi: ExtensionAPI;
  session: WorkflowExtensionSession;
  params: WorkflowInput;
  context: ExtensionContext;
  signal?: AbortSignal | undefined;
  onUpdate?: AgentToolUpdateCallback<WorkflowDetails> | undefined;
}

function parsedArgs(value: string | undefined): RuntimeValue {
  if (value === undefined) return undefined;
  try {
    return toSerializable(JSON.parse(value));
  } catch {
    return value;
  }
}

/** Owns admission, live updates, and terminal persistence for one workflow. */
export class WorkflowRun {
  private finalized = false;
  private readonly state: WorkflowDetails;
  private readonly controller: RunController;
  private readonly prepared: PreparedWorkflowScript;
  private readonly args: RuntimeValue;
  private readonly context: ExtensionContext;
  private readonly session: WorkflowExtensionSession;
  private readonly progress: WorkflowProgress;
  private readonly agents: WorkflowAgentExecutor;
  readonly runDir: string;
  readonly completion: Promise<void>;

  static start(options: StartWorkflowOptions) {
    return new WorkflowRun(options);
  }

  private constructor(options: StartWorkflowOptions) {
    const { pi, session, params, context, signal, onUpdate } = options;
    if (session.isClosing)
      throw new Error("Workflow session is shutting down.");
    try {
      this.prepared = prepareWorkflowScript(params.script);
    } catch (error) {
      throw new Error(`Workflow script failed to parse: ${errorText(error)}`, {
        cause: error,
      });
    }
    const runId = `wf_${NodeCrypto.randomBytes(6).toString("hex")}`;
    this.runDir = NodePath.join(getAgentDir(), "workflows", runId);
    this.context = context;
    this.session = session;
    this.args = parsedArgs(params.args);
    this.state = {
      schemaVersion: 1,
      runId,
      background: (params.background ?? false) && context.hasUI,
      status: "running",
      startedAt: Date.now(),
      phases: [...this.prepared.meta.phases],
      agents: [],
    };
    const sessionId = context.sessionManager.getSessionId();
    if (sessionId !== undefined) this.state.sessionId = sessionId;
    if (this.prepared.meta.name !== undefined)
      this.state.name = this.prepared.meta.name;
    if (this.prepared.meta.description !== undefined)
      this.state.description = this.prepared.meta.description;
    this.admit(params);
    this.controller = new RunController(
      this.state.background ? undefined : signal,
    );
    this.progress = new WorkflowProgress(
      this.state,
      createWorkflowPersistence(this.runDir, this.state),
      this.state.background,
      onUpdate,
    );
    this.agents = new WorkflowAgentExecutor(
      pi,
      context,
      this.controller,
      this.state,
      this.progress,
    );
    // Register before executing even a synchronous worker adapter.
    this.completion = Promise.resolve()
      .then(() => this.execute())
      .finally(() => session.finish(this));
    session.setUi(context);
    session.register(this);
  }

  /** Observers cannot mutate the run or retain live agent records. */
  get details(): WorkflowDetails {
    return structuredClone(this.state);
  }

  abort(reason: string) {
    this.controller.abort(reason);
  }

  private admit(params: WorkflowInput) {
    writeFileAtomic(NodePath.join(this.runDir, "script.js"), params.script);
    if (params.args !== undefined)
      writeFileAtomic(NodePath.join(this.runDir, "args.json"), params.args);
    if (!this.session.acceptsSession(this.state.sessionId)) {
      this.state.status = "aborted";
      this.state.finishedAt = Date.now();
      this.state.error = "Workflow session shut down before admission";
      persistWorkflowJson(this.runDir, this.state);
      throw new Error(this.state.error);
    }
    persistWorkflowJson(this.runDir, this.state);
    if (!this.session.recordStarted(this.state)) {
      this.state.status = "failed";
      this.state.finishedAt = Date.now();
      this.state.error = "Workflow start lifecycle could not be persisted";
      persistWorkflowJson(this.runDir, this.state);
      throw new Error(this.state.error);
    }
  }

  private phase = <Input1>(title: Input1) => {
    if (!this.progress.active) return;
    const text = String(title);
    this.state.currentPhase = text;
    if (!this.state.phases.some((phase) => phase.title === text))
      this.state.phases.push({ title: text });
    this.progress.emit();
  };

  forceInterrupted() {
    if (this.finalized) return;
    this.abort("Session is shutting down");
    this.state.error ??= "Interrupted before workflow cleanup settled";
    this.finalize("aborted", true);
  }

  private finishRunningAgents(message: string) {
    for (const record of this.state.agents) {
      if (record.state !== "running") continue;
      record.state = "error";
      record.error ??= message;
      record.finishedAt = Date.now();
    }
  }

  private async executeScript(): Promise<WorkflowDetails["status"]> {
    if (this.finalized) return "aborted";
    try {
      this.controller.signal.throwIfAborted();
      const result = await runWorkflowWorker({
        source: this.prepared.source,
        args: this.args,
        cwd: this.context.cwd,
        signal: this.controller.signal,
        onAgent: this.agents.agent,
        onPhase: this.phase,
      });
      if (this.finalized) return "aborted";
      this.controller.signal.throwIfAborted();
      this.state.result = result;
      return "completed";
    } catch (error) {
      if (this.finalized) return "aborted";
      this.state.error = errorText(error);
      const status = this.controller.signal.aborted ? "aborted" : "failed";
      this.controller.abort("Workflow script failed");
      return status;
    }
  }

  private persistFinal() {
    try {
      this.progress.flushPersistence();
      return false;
    } catch (error) {
      this.state.status = "failed";
      this.state.error = this.state.error
        ? `${this.state.error}; artifact persistence failed: ${errorText(error)}`
        : `Artifact persistence failed: ${errorText(error)}`;
      try {
        persistWorkflowJson(this.runDir, this.state);
      } catch (retryError) {
        this.state.error += `; failed-state persistence failed: ${errorText(retryError)}`;
      }
      return true;
    }
  }

  private recordFinalLifecycle(persistenceFailed: boolean) {
    if (this.session.recordSettled(this.state)) return persistenceFailed;
    this.state.status = "failed";
    this.state.error = this.state.error
      ? `${this.state.error}; workflow settlement lifecycle could not be persisted`
      : "Workflow settlement lifecycle could not be persisted";
    try {
      persistWorkflowJson(this.runDir, this.state);
    } catch (error) {
      this.state.error += `; artifact persistence failed: ${errorText(error)}`;
    }
    return true;
  }

  private finalize(status: WorkflowDetails["status"], forced = false) {
    this.finalized = true;
    this.progress.invalidate();
    this.finishRunningAgents(
      forced
        ? "Interrupted by Pi session shutdown"
        : "Agent did not settle before run cleanup",
    );
    this.state.status = status;
    this.state.finishedAt = Date.now();
    const persistenceFailed = this.recordFinalLifecycle(this.persistFinal());
    if (!forced) this.progress.finish();
    return persistenceFailed;
  }

  private async execute() {
    let status = await this.executeScript();
    const settled = await this.controller.settle({
      abort: status !== "completed",
    });
    if (this.finalized) return;
    if (!settled) {
      this.state.error = this.state.error
        ? `${this.state.error}; agent shutdown deadline exceeded`
        : "Agent shutdown deadline exceeded";
      status = "failed";
    }
    if (this.finalize(status)) throw new Error(this.state.error);
  }
}
