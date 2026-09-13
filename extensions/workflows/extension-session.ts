import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { formatActivityStatus } from "../shared/activity-status.ts";
import type { ActiveWorkflowRun } from "./extension-contract.ts";
import type { WorkflowDetails } from "./model.ts";

function appendLifecycle(
  pi: ExtensionAPI,
  details: WorkflowDetails,
  event: "started" | "settled",
) {
  try {
    pi.appendEntry("workflow-lifecycle", {
      schemaVersion: 1,
      event,
      runId: details.runId,
      name: details.name,
      background: details.background,
      status: details.status,
      currentPhase: details.currentPhase,
      startedAt: details.startedAt,
      finishedAt: details.finishedAt,
      error: details.error,
    });
    return true;
  } catch (error) {
    console.error(`workflows: failed to append ${event} lifecycle`, error);
    return false;
  }
}

export class WorkflowExtensionSession {
  private readonly activeRuns = new Map<string, ActiveWorkflowRun>();
  private lifecycleSessionId: string | undefined;
  private lastUi: ExtensionContext["ui"] | undefined;
  private closing = false;
  private completedRuns = 0;
  private failedRuns = 0;
  private readonly pi: ExtensionAPI;

  constructor(pi: ExtensionAPI) {
    this.pi = pi;
    pi.on("session_start", (_event, context) => this.start(context));
    pi.on("session_shutdown", () => this.shutdown());
  }

  get isClosing() {
    return this.closing;
  }

  activeDetails() {
    return new Map(
      [...this.activeRuns].map(([id, run]) => [id, run.details] as const),
    );
  }

  setUi(context: ExtensionContext) {
    if (context.hasUI) this.lastUi = context.ui;
  }

  recordStarted(details: WorkflowDetails) {
    return appendLifecycle(this.pi, details, "started");
  }

  recordSettled(details: WorkflowDetails) {
    return this.lifecycleSessionId
      ? appendLifecycle(this.pi, details, "settled")
      : false;
  }

  ownsCurrentSession(details: WorkflowDetails) {
    return (
      !this.closing &&
      this.lifecycleSessionId !== undefined &&
      details.sessionId === this.lifecycleSessionId
    );
  }

  acceptsSession(sessionId: string | undefined) {
    return !this.closing && this.lifecycleSessionId === sessionId;
  }

  register(run: ActiveWorkflowRun) {
    this.activeRuns.set(run.details.runId, run);
    this.updateIndicator();
  }

  finish(run: ActiveWorkflowRun) {
    this.activeRuns.delete(run.details.runId);
    if (!this.ownsCurrentSession(run.details)) return false;
    if (run.details.status === "completed") this.completedRuns++;
    else this.failedRuns++;
    this.updateIndicator();
    return true;
  }

  acknowledgeFinished() {
    this.completedRuns = 0;
    this.failedRuns = 0;
    this.updateIndicator();
  }

  updateIndicator() {
    const ui = this.lastUi;
    if (!ui) return;
    try {
      const running = this.activeRuns.size;
      if (running === 0 && this.completedRuns === 0 && this.failedRuns === 0) {
        ui.setStatus("workflows", undefined);
        return;
      }
      ui.setStatus(
        "workflows",
        formatActivityStatus(ui.theme, "workflows", {
          running,
          done: this.completedRuns,
          failed: this.failedRuns,
        }),
      );
    } catch {
      // The user interface may already be unavailable during teardown.
    }
  }

  private start(context: ExtensionContext) {
    this.closing = false;
    this.lifecycleSessionId = context.sessionManager.getSessionId();
    this.setUi(context);
    this.updateIndicator();
  }

  private async awaitShutdown(runs: ActiveWorkflowRun[]) {
    if (runs.length === 0) return true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), 12_000);
      timer.unref?.();
    });
    const completed = await Promise.race([
      Promise.allSettled(runs.map((run) => run.completion)).then(
        () => true as const,
      ),
      timeout,
    ]);
    if (timer) clearTimeout(timer);
    return completed;
  }

  private async shutdown() {
    this.closing = true;
    const runs = [...this.activeRuns.values()];
    for (const run of runs) run.abort("Session is shutting down");
    if (!(await this.awaitShutdown(runs))) {
      for (const run of runs) {
        run.forceInterrupted();
        void run.completion.catch(() => {});
      }
    }
    this.activeRuns.clear();
    this.lifecycleSessionId = undefined;
    try {
      this.lastUi?.setStatus("workflows", undefined);
    } catch {
      // The user interface may already be unavailable during teardown.
    } finally {
      this.lastUi = undefined;
    }
  }
}
