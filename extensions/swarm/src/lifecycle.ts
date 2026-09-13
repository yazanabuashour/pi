import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AgentDetails, AgentSnapshot } from "./domain.ts";
import { agentRunId } from "./extension-status.ts";

type LifecycleEvent = "started" | "settled";
interface LifecycleEntry {
  sessionId: string;
  details: AgentDetails;
}

/** Admission requires a start receipt; failed settlement writes remain retryable. */
export class SwarmLifecycle {
  private sessionId: string | undefined;
  private readonly pending = new Map<string, LifecycleEntry>();
  private readonly started = new Set<string>();
  private readonly settled = new Set<string>();
  private readonly rejected = new Set<string>();
  private readonly pi: ExtensionAPI;
  private readonly details: (
    snapshot: AgentSnapshot,
    event: LifecycleEvent,
  ) => AgentDetails;

  constructor(
    pi: ExtensionAPI,
    details: (snapshot: AgentSnapshot, event: LifecycleEvent) => AgentDetails,
  ) {
    this.pi = pi;
    this.details = details;
  }

  start(sessionId: string) {
    this.clear();
    this.sessionId = sessionId;
  }

  hasStarted(snapshot: AgentSnapshot) {
    return this.started.has(agentRunId(snapshot));
  }

  record(snapshot: AgentSnapshot, event: LifecycleEvent) {
    const id = agentRunId(snapshot);
    if (event === "started" && this.started.has(id)) return true;
    if (!this.sessionId || this.rejected.has(id)) return false;
    const entry = {
      sessionId: this.sessionId,
      details: this.details(snapshot, event),
    };
    if (event === "settled" && !this.started.has(id)) return false;
    const recorded = this.append(entry);
    if (event !== "started") return recorded;
    if (!recorded) {
      this.rejected.add(id);
      this.pending.delete(id);
      return false;
    }
    this.started.add(id);
    return true;
  }

  private append(entry: LifecycleEntry) {
    const id = agentRunId(entry.details);
    if (this.sessionId !== entry.sessionId) return false;
    if (entry.details.event === "settled" && this.settled.has(id)) return true;
    try {
      this.pi.appendEntry("swarm-lifecycle", entry.details);
      if (entry.details.event === "settled") this.settled.add(id);
      this.pending.delete(id);
      return true;
    } catch (error) {
      if (entry.details.event === "settled") this.pending.set(id, entry);
      else this.pending.delete(id);
      console.error("swarm: failed to append lifecycle", error);
      return false;
    }
  }

  retrySettlements() {
    for (const entry of this.pending.values()) {
      if (this.started.has(agentRunId(entry.details))) this.append(entry);
    }
  }

  clear() {
    const unpersisted = this.pending.size + this.rejected.size;
    this.sessionId = undefined;
    this.pending.clear();
    this.started.clear();
    this.settled.clear();
    this.rejected.clear();
    return unpersisted;
  }
}
