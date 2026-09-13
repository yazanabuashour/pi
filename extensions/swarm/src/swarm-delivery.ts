import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AgentSnapshot } from "./domain.ts";
import type { SwarmExtensionSession } from "./extension-session.ts";
import { buildAgentCompletionText } from "./extension-output.ts";
import { runTool } from "./runtime.ts";

interface SwarmMessage {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly text: string;
}

interface ForwardingFailure {
  readonly parentId: string;
  readonly childId: string;
  readonly status: "failed";
}

export class SwarmDelivery {
  private readonly pending = new Set<Promise<void>>();

  private readonly pi: ExtensionAPI;
  private readonly owner: SwarmExtensionSession;

  constructor(pi: ExtensionAPI, owner: SwarmExtensionSession) {
    this.pi = pi;
    this.owner = owner;
  }

  record(
    details: SwarmMessage & { status: "submitted" | "failed"; error?: string },
  ) {
    this.owner.assertCurrent(this.owner.identity);
    this.pi.appendEntry("swarm-message", details);
  }

  receive(details: SwarmMessage | ForwardingFailure, content: string) {
    this.owner.assertCurrent(this.owner.identity);
    this.pi.sendMessage(
      { customType: "swarm-message", content, display: true, details },
      {
        deliverAs: "steer",
        // Pi 0.85.1 treats explicit false as history-only during an active
        // loop. True uses the steering queue when busy and wakes an idle root.
        triggerTurn: true,
      },
    );
  }

  forwardCompletion(snapshot: AgentSnapshot) {
    const parentId = snapshot.parentId;
    if (parentId === "root" || snapshot.outcome === "interrupted") return;
    const runtimeId = this.owner.identity;
    const content = buildAgentCompletionText(snapshot);
    const delivery = this.forward(parentId, content, runtimeId)
      .catch((error) => {
        console.error(
          `swarm: completion forwarding to ${parentId} failed`,
          error,
        );
        // The root already gets the result. Expose failed parent delivery there,
        // without retrying an admission whose outcome could be uncertain.
        if (this.owner.isCurrent(runtimeId))
          this.receive(
            { parentId, childId: snapshot.id, status: "failed" },
            `Could not forward ${snapshot.id}'s completion to ${parentId}: ${String(error)}`,
          );
      })
      .catch((error) =>
        console.error("swarm: delivery diagnostic failed", error),
      );
    this.pending.add(delivery);
    void delivery.finally(() => this.pending.delete(delivery));
  }

  private async forward(parentId: string, content: string, runtimeId: string) {
    const manager = await this.owner.getManager();
    this.owner.assertCurrent(runtimeId);
    const parent = manager.view.get(parentId);
    if (
      !parent ||
      parent.origin !== "model" ||
      parent.outcome === "interrupted" ||
      !manager.view.canAct(parentId)
    )
      return;
    await runTool(this.owner.getRuntime(), manager.send(parentId, content));
  }

  async settled() {
    await Promise.all(this.pending);
  }
}
