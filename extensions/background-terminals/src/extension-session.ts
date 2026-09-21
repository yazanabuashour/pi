import * as NodeCrypto from "node:crypto";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import {
  deliverCompletion,
  registerCompletionFlush,
} from "../../shared/completion-delivery.ts";
import {
  backgroundTerminalDetails,
  type BackgroundTerminalDetailsV1,
  type TerminalSnapshot,
} from "./domain.ts";
import { TerminalManager, type TerminalManagerService } from "./manager.ts";
import { buildTerminalResultMessage } from "./prompt.ts";
import { createDeferredResultDelivery } from "../../shared/result-delivery.ts";
import { createTerminalRuntime, type TerminalRuntime } from "./runtime.ts";
import { clearRunningWidget, setRunningWidget } from "./widget.ts";
import {
  disposeSessionRuntime,
  reportShutdownFailure,
  shutdownSnapshot,
  stopSessionTerminals,
} from "./session-shutdown.ts";

interface LifecycleEntry {
  sessionId: string;
  details: BackgroundTerminalDetailsV1;
}

export class BackgroundTerminalSession {
  private runtimeId = NodeCrypto.randomBytes(6).toString("hex");
  private runtime: TerminalRuntime | undefined;
  private managerPromise: Promise<TerminalManagerService> | undefined;
  private sessionContext: ExtensionContext | undefined;
  private ui: ExtensionUIContext | undefined;
  private unsubStatus: (() => void) | undefined;
  private closing = false;
  private shutdownReason: string | undefined;
  private lifecycleSessionId: string | undefined;
  private widgetRunning = 0;
  private readonly pendingLifecycleEntries = new Map<string, LifecycleEntry>();
  private readonly startedLifecycleIds = new Set<string>();
  private readonly settledLifecycleIds = new Set<string>();
  private readonly rejectedLifecycleIds = new Set<string>();
  private readonly resultDelivery =
    createDeferredResultDelivery<TerminalSnapshot>((result) => result.id);
  private readonly pi: ExtensionAPI;

  constructor(pi: ExtensionAPI) {
    this.pi = pi;
    pi.on("session_start", (_event, context) => this.startSession(context));
    registerCompletionFlush(pi, (wakeAgent) => this.flushResults(wakeAgent));
    pi.on("session_shutdown", (event) => this.shutdown(event.reason));
  }

  getRuntime() {
    return (this.runtime ??= createTerminalRuntime());
  }

  async getManager() {
    if (this.closing)
      throw new Error("Background terminal session is shutting down.");
    const owningRuntime = this.getRuntime();
    const runtimeId = this.runtimeId;
    this.managerPromise ??= owningRuntime
      .runPromise(TerminalManager)
      .then((manager) => {
        manager.view.setOnSettled((snapshot, consumed) => {
          if (this.runtimeId === runtimeId) this.onSettled(snapshot, consumed);
        });
        this.unsubStatus?.();
        this.unsubStatus = manager.view.subscribe(() =>
          this.updateWidget(manager),
        );
        this.updateWidget(manager);
        return manager;
      });
    const manager = await this.managerPromise;
    if (this.closing)
      throw new Error("Background terminal session is shutting down.");
    return manager;
  }

  details(
    snapshot: TerminalSnapshot,
    event: BackgroundTerminalDetailsV1["event"],
  ) {
    return backgroundTerminalDetails(
      snapshot,
      event,
      this.runtimeId,
      this.shutdownReason,
    );
  }

  recordStart(snapshot: TerminalSnapshot) {
    return !this.closing && this.recordLifecycleSnapshot(snapshot, "started");
  }

  consume(ids: ReadonlyArray<string>) {
    this.resultDelivery.consume(ids);
  }

  private startSession(context: ExtensionContext) {
    this.closing = false;
    this.runtimeId = NodeCrypto.randomBytes(6).toString("hex");
    this.shutdownReason = undefined;
    this.sessionContext = context;
    this.lifecycleSessionId = context.sessionManager.getSessionId();
    this.pendingLifecycleEntries.clear();
    this.startedLifecycleIds.clear();
    this.settledLifecycleIds.clear();
    this.rejectedLifecycleIds.clear();
    if (context.hasUI) this.ui = context.ui;
  }

  private updateWidget(manager: TerminalManagerService) {
    if (!this.ui) return;
    try {
      const running = manager.view
        .list()
        .filter((snapshot) => snapshot.status === "running").length;
      if (running === this.widgetRunning) return;
      this.widgetRunning = running;
      setRunningWidget(this.ui, running);
    } catch {
      // The user interface may already be unavailable during teardown.
    }
  }

  private appendLifecycle(entry: LifecycleEntry) {
    if (!this.sessionContext || this.lifecycleSessionId !== entry.sessionId)
      return false;
    if (
      entry.details.event === "settled" &&
      this.settledLifecycleIds.has(entry.details.id)
    )
      return true;
    try {
      this.pi.appendEntry("background-terminal-lifecycle", entry.details);
      if (entry.details.event === "settled") {
        this.settledLifecycleIds.add(entry.details.id);
      }
      this.pendingLifecycleEntries.delete(
        `${entry.details.id}:${entry.details.event}`,
      );
      return true;
    } catch (error) {
      if (entry.details.event !== "started") {
        this.pendingLifecycleEntries.set(
          `${entry.details.id}:${entry.details.event}`,
          entry,
        );
      } else {
        this.pendingLifecycleEntries.delete(
          `${entry.details.id}:${entry.details.event}`,
        );
      }
      console.error("background-terminals: failed to append lifecycle", error);
      return false;
    }
  }

  private recordLifecycleSnapshot(
    snapshot: TerminalSnapshot,
    event: "started" | "settled" | "cleanup-incomplete",
  ) {
    if (!this.lifecycleSessionId || this.rejectedLifecycleIds.has(snapshot.id))
      return false;
    const entry = {
      sessionId: this.lifecycleSessionId,
      details: this.details(snapshot, event),
    };
    if (event !== "started" && !this.startedLifecycleIds.has(snapshot.id)) {
      this.pendingLifecycleEntries.set(`${snapshot.id}:${event}`, entry);
      return true;
    }
    const recorded = this.appendLifecycle(entry);
    if (event !== "started") return recorded;
    if (!recorded) {
      this.rejectedLifecycleIds.add(snapshot.id);
      for (const [key, pending] of this.pendingLifecycleEntries) {
        if (pending.details.id === snapshot.id)
          this.pendingLifecycleEntries.delete(key);
      }
      return false;
    }
    this.startedLifecycleIds.add(snapshot.id);
    let complete = true;
    for (const pending of this.pendingLifecycleEntries.values()) {
      if (pending.details.id === snapshot.id && !this.appendLifecycle(pending))
        complete = false;
    }
    return complete;
  }

  private retrySettlements() {
    for (const entry of this.pendingLifecycleEntries.values()) {
      if (this.startedLifecycleIds.has(entry.details.id))
        this.appendLifecycle(entry);
    }
  }

  private deliverResult(snapshot: TerminalSnapshot, wakeAgent: boolean) {
    this.retrySettlements();
    try {
      deliverCompletion(
        this.pi,
        {
          customType: "background-terminal-result",
          content: buildTerminalResultMessage(snapshot),
          display: true,
          details: this.details(
            snapshot,
            snapshot.status === "running" ? "cleanup-incomplete" : "settled",
          ),
        },
        wakeAgent,
      );
      return true;
    } catch (error) {
      console.error("background-terminals: failed to deliver result", error);
      return false;
    }
  }

  private flushResults(wakeAgent: boolean) {
    for (const snapshot of this.resultDelivery.drain()) {
      if (!this.deliverResult(snapshot, wakeAgent))
        this.resultDelivery.defer(snapshot);
    }
  }

  private onSettled(snapshot: TerminalSnapshot, consumed: boolean) {
    this.recordLifecycleSnapshot(
      snapshot,
      snapshot.status === "running" ? "cleanup-incomplete" : "settled",
    );
    if (this.closing) return;
    if (consumed) {
      this.resultDelivery.consume([snapshot.id]);
      return;
    }
    this.resultDelivery.defer({
      ...snapshot,
      stdout: { ...snapshot.stdout },
      stderr: { ...snapshot.stderr },
    });
    if (this.sessionContext?.isIdle()) this.flushResults(true);
  }

  private recordShutdown(
    manager: TerminalManagerService | undefined,
    snapshots: ReadonlyArray<TerminalSnapshot>,
    disposalFailure?: string,
  ) {
    const incomplete: string[] = [];
    for (const initial of snapshots) {
      if (!this.startedLifecycleIds.has(initial.id))
        this.recordLifecycleSnapshot(initial, "started");
      const snapshot = shutdownSnapshot(
        manager?.view.get(initial.id) ?? initial,
        disposalFailure,
      );
      if (snapshot.cleanupIncomplete) incomplete.push(snapshot.id);
      this.recordLifecycleSnapshot(
        snapshot,
        snapshot.cleanupIncomplete ? "cleanup-incomplete" : "settled",
      );
    }
    this.retrySettlements();
    return incomplete;
  }

  private resetAfterShutdown() {
    const unpersisted =
      this.pendingLifecycleEntries.size + this.rejectedLifecycleIds.size;
    this.sessionContext = undefined;
    this.lifecycleSessionId = undefined;
    this.pendingLifecycleEntries.clear();
    this.startedLifecycleIds.clear();
    this.settledLifecycleIds.clear();
    this.rejectedLifecycleIds.clear();
    this.unsubStatus?.();
    this.unsubStatus = undefined;
    try {
      clearRunningWidget(this.ui);
    } catch {
      // The user interface may already be unavailable during teardown.
    }
    this.widgetRunning = 0;
    this.ui = undefined;
    return unpersisted;
  }

  private async shutdown(reason: string) {
    this.closing = true;
    this.shutdownReason = reason;
    this.resultDelivery.clear();
    let manager: TerminalManagerService | undefined;
    try {
      manager = this.managerPromise ? await this.managerPromise : undefined;
    } catch (error) {
      console.error("background-terminals: manager startup failed", error);
    }
    const snapshots = await stopSessionTerminals(manager, this.runtime);
    const closingRuntime = this.runtime;
    this.runtime = undefined;
    this.managerPromise = undefined;
    const disposalFailure = await disposeSessionRuntime(closingRuntime);
    const incomplete = this.recordShutdown(manager, snapshots, disposalFailure);
    manager?.view.setOnSettled(undefined);
    const unpersisted = this.resetAfterShutdown();
    reportShutdownFailure(incomplete, disposalFailure, unpersisted);
  }
}
