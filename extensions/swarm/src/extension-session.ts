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
  agentDetails,
  type AgentDetails,
  type AgentSnapshot,
} from "./domain.ts";
import { buildAgentCompletionText } from "./extension-output.ts";
import {
  deliverBtwResult,
  agentRunId,
  updateSwarmStatus,
} from "./extension-status.ts";
import {
  SwarmManager,
  SWARM_SHUTDOWN_TIMEOUT_MS,
  type SwarmManagerService,
} from "./manager.ts";
import { createDeferredResultDelivery } from "../../shared/result-delivery.ts";
import { SwarmDelivery } from "./swarm-delivery.ts";
import { SwarmLifecycle } from "./lifecycle.ts";
import { createSwarmRuntime, runTool, type SwarmRuntime } from "./runtime.ts";

export class SwarmExtensionSession {
  private runtimeId = NodeCrypto.randomBytes(6).toString("hex");
  private runtime: SwarmRuntime | undefined;
  private managerPromise: Promise<SwarmManagerService> | undefined;
  private sessionContext: ExtensionContext | undefined;
  private ui: ExtensionUIContext | undefined;
  private unsubStatus: (() => void) | undefined;
  private closing = false;
  private shutdownReason: string | undefined;
  private readonly lifecycle: SwarmLifecycle;
  private readonly resultDelivery =
    createDeferredResultDelivery<AgentSnapshot>(agentRunId);
  private readonly pi: ExtensionAPI;
  readonly messages: SwarmDelivery;

  constructor(pi: ExtensionAPI) {
    this.pi = pi;
    this.messages = new SwarmDelivery(pi, this);
    this.lifecycle = new SwarmLifecycle(pi, (snapshot, event) =>
      this.details(snapshot, event),
    );
    pi.on("session_start", (_event, context) => this.startSession(context));
    registerCompletionFlush(pi, (wakeAgent) => this.flushResults(wakeAgent));
    pi.on("session_shutdown", (event) => this.shutdown(event.reason));
  }

  get identity() {
    return this.runtimeId;
  }

  isCurrent(runtimeId: string) {
    return (
      !this.closing && !!this.sessionContext && this.runtimeId === runtimeId
    );
  }

  assertCurrent(runtimeId: string) {
    if (!this.isCurrent(runtimeId))
      throw new Error("Swarm session is no longer active.");
  }

  getRuntime() {
    return (this.runtime ??= createSwarmRuntime());
  }

  async getManager() {
    if (this.closing) throw new Error("Swarm session is shutting down.");
    const runtime = this.getRuntime();
    this.managerPromise ??= runtime.runPromise(SwarmManager).then((manager) => {
      manager.view.setOnStarted((snapshot) => this.onStarted(snapshot));
      manager.view.setOnSettled((snapshot, consumed) =>
        this.onSettled(snapshot, consumed),
      );
      this.unsubStatus?.();
      this.unsubStatus = manager.view.subscribe(() =>
        this.updateStatus(manager),
      );
      this.updateStatus(manager);
      return manager;
    });
    const manager = await this.managerPromise;
    if (this.closing) throw new Error("Swarm session is shutting down.");
    return manager;
  }

  details(snapshot: AgentSnapshot, event: AgentDetails["event"]) {
    return agentDetails(snapshot, event, this.runtimeId, this.shutdownReason);
  }

  consume(snapshots: ReadonlyArray<AgentSnapshot>) {
    this.resultDelivery.consume(snapshots.map(agentRunId));
  }

  private startSession(context: ExtensionContext) {
    this.closing = false;
    this.runtimeId = NodeCrypto.randomBytes(6).toString("hex");
    this.shutdownReason = undefined;
    this.sessionContext = context;
    this.lifecycle.start(context.sessionManager.getSessionId());
    if (context.hasUI) this.ui = context.ui;
  }

  private updateStatus(manager: SwarmManagerService) {
    if (!this.ui) return;
    try {
      updateSwarmStatus(this.ui, manager);
    } catch (error) {
      console.error("swarm: failed to update status UI", error);
    }
  }

  private deliverResult(snapshot: AgentSnapshot, wakeAgent: boolean) {
    this.lifecycle.retrySettlements();
    deliverCompletion(
      this.pi,
      {
        customType: "swarm-result",
        content: buildAgentCompletionText(snapshot),
        display: true,
        details: this.details(snapshot, "settled"),
      },
      wakeAgent,
    );
  }

  private flushResults(wakeAgent: boolean) {
    for (const snapshot of this.resultDelivery.drain())
      this.deliverResult(snapshot, wakeAgent);
  }

  private onStarted(snapshot: AgentSnapshot) {
    return (
      !this.closing &&
      !!this.sessionContext &&
      this.lifecycle.record(snapshot, "started")
    );
  }

  private onSettled(snapshot: AgentSnapshot, consumed: boolean) {
    if (!this.sessionContext) return;
    this.lifecycle.record(snapshot, "settled");
    if (this.closing) return;
    if (snapshot.origin === "model") this.messages.forwardCompletion(snapshot);
    if (snapshot.origin !== "model") {
      deliverBtwResult(this.pi, this.ui, {
        ...snapshot,
        meta: { ...snapshot.meta },
      });
    } else if (consumed) {
      this.resultDelivery.consume([agentRunId(snapshot)]);
    } else {
      this.resultDelivery.defer({ ...snapshot, meta: { ...snapshot.meta } });
      if (this.sessionContext.isIdle()) this.flushResults(true);
    }
  }

  private async stopRunning(manager: SwarmManagerService | undefined) {
    const snapshots = manager?.view.beginShutdown() ?? [];
    const ids = snapshots.map((snapshot) => snapshot.id);
    if (manager && ids.length > 0) {
      try {
        await runTool(this.getRuntime(), manager.cancel(ids), {
          signal: AbortSignal.timeout(SWARM_SHUTDOWN_TIMEOUT_MS),
          interruptMessage:
            "Swarm shutdown deadline reached; runtime disposal will finish cleanup.",
        });
      } catch (error) {
        console.error("swarm: shutdown cancellation failed", error);
      }
    }
    return snapshots;
  }

  private recordShutdown(
    manager: SwarmManagerService | undefined,
    snapshots: ReadonlyArray<AgentSnapshot>,
  ) {
    for (const initial of snapshots) {
      if (!this.lifecycle.hasStarted(initial))
        this.lifecycle.record(initial, "started");
      const settled = manager?.view.get(initial.id) ?? initial;
      this.lifecycle.record(
        settled.status === "running"
          ? {
              ...settled,
              status: "error",
              outcome: "interrupted",
              settledAt: settled.settledAt ?? Date.now(),
              errorText:
                settled.errorText ?? "Interrupted by Pi session shutdown",
            }
          : settled,
        "settled",
      );
    }
    this.lifecycle.retrySettlements();
  }

  private resetAfterShutdown() {
    const unpersisted = this.lifecycle.clear();
    this.sessionContext = undefined;
    this.unsubStatus?.();
    this.unsubStatus = undefined;
    try {
      this.ui?.setStatus("swarm", undefined);
    } catch {
      // The user interface may already be unavailable during teardown.
    }
    this.ui = undefined;
    return unpersisted;
  }

  private async shutdown(reason: string) {
    this.closing = true;
    this.shutdownReason = reason;
    this.resultDelivery.clear();
    let manager: SwarmManagerService | undefined;
    try {
      manager = this.managerPromise ? await this.managerPromise : undefined;
    } catch (error) {
      console.error("swarm: manager startup failed", error);
    }
    const snapshots = await this.stopRunning(manager);
    const runtime = this.runtime;
    this.runtime = undefined;
    this.managerPromise = undefined;
    await runtime?.dispose();
    await this.messages.settled();
    this.recordShutdown(manager, snapshots);
    const unpersisted = this.resetAfterShutdown();
    if (unpersisted > 0) {
      throw new Error(
        `Swarm shutdown left ${unpersisted} lifecycle receipt(s) unpersisted.`,
      );
    }
  }
}
