import type { AgentToolUpdateCallback } from "@earendil-works/pi-coding-agent";
import type { createWorkflowPersistence } from "./artifacts.ts";
import {
  EMIT_INTERVAL_MS,
  type ScriptAgentResult,
  summaryLine,
} from "./extension-contract.ts";
import type { WorkflowDetails } from "./model.ts";
import { safeStringify } from "./serialization.ts";

type Persistence = ReturnType<typeof createWorkflowPersistence>;
type OnUpdate = AgentToolUpdateCallback<WorkflowDetails> | undefined;

function compactToolDetails(details: WorkflowDetails): WorkflowDetails {
  const compact: WorkflowDetails = {
    ...details,
    phases: details.phases.map((phase) => ({ ...phase })),
    agents: details.agents.map((agent) => ({
      ...agent,
      usage: { ...agent.usage },
      transcript: [],
    })),
  };
  if (details.result !== undefined) {
    compact.result = JSON.parse(
      safeStringify(details.result, { maxBytes: 64 * 1024 }),
    );
  }
  return compact;
}

export class WorkflowProgress {
  private acceptingUpdates = true;
  private emitTimer: ReturnType<typeof setTimeout> | undefined;
  private lastEmit = 0;
  private readonly details: WorkflowDetails;
  private readonly persistence: Persistence;
  private readonly background: boolean;
  private readonly onUpdate: OnUpdate;

  constructor(
    details: WorkflowDetails,
    persistence: Persistence,
    background: boolean,
    onUpdate: OnUpdate,
  ) {
    this.details = details;
    this.persistence = persistence;
    this.background = background;
    this.onUpdate = onUpdate;
  }

  get active() {
    return this.acceptingUpdates;
  }

  checkpoint(immediate = false) {
    if (!this.acceptingUpdates) return;
    this.persistence.checkpoint(immediate ? { immediate: true } : undefined);
  }

  emit(checkpoint = true) {
    if (!this.acceptingUpdates) return;
    if (checkpoint) this.persistence.checkpoint();
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(
      () => this.flush(),
      Math.max(0, EMIT_INTERVAL_MS - (Date.now() - this.lastEmit)),
    );
  }

  finish() {
    this.invalidate();
    this.flush(true);
  }

  flushPersistence() {
    this.persistence.flush();
  }

  inactiveResult(): ScriptAgentResult {
    return { ok: false, output: "", error: "Workflow is no longer active" };
  }

  invalidate() {
    this.acceptingUpdates = false;
    if (this.emitTimer) clearTimeout(this.emitTimer);
    this.emitTimer = undefined;
    this.persistence.cancel();
  }

  private flush(final = false) {
    this.emitTimer = undefined;
    if (!this.acceptingUpdates && !final) return;
    this.lastEmit = Date.now();
    if (this.background) return;
    this.onUpdate?.({
      content: [{ type: "text", text: summaryLine(this.details) }],
      details: compactToolDetails(this.details),
    });
  }
}

export { compactToolDetails };
