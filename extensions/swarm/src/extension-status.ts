import type {
  ExtensionAPI,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import type { AgentSnapshot } from "./domain.ts";
import { truncatedOutput } from "./extension-output.ts";
import { formatActivityStatus } from "../../shared/activity-status.ts";
import type { SwarmManagerService } from "./manager.ts";

export interface BtwResultData {
  readonly id: string;
  readonly title: string;
  readonly status: AgentSnapshot["status"];
  readonly errorText?: string | undefined;
  readonly prompt: string;
  readonly answer: string;
  readonly sessionFilePath?: string | undefined;
}

export const agentRunId = (
  snapshot: Pick<AgentSnapshot, "id" | "generation">,
) => `${snapshot.id}:${snapshot.generation}`;

export function updateSwarmStatus(
  ui: ExtensionUIContext,
  manager: SwarmManagerService,
) {
  const snapshots = manager.view.list();
  if (snapshots.length === 0) {
    ui.setStatus("swarm", undefined);
    return;
  }
  const running = snapshots.filter(
    (snapshot) => snapshot.status === "running",
  ).length;
  const failed = snapshots.filter(
    (snapshot) => snapshot.status === "error",
  ).length;
  ui.setStatus(
    "swarm",
    formatActivityStatus(ui.theme, "swarm", {
      running,
      failed,
      done: snapshots.length - running - failed,
    }),
  );
}

export function deliverBtwResult(
  pi: ExtensionAPI,
  ui: ExtensionUIContext | undefined,
  snapshot: AgentSnapshot,
) {
  pi.appendEntry<BtwResultData>("btw-result", {
    id: snapshot.id,
    title: snapshot.title,
    status: snapshot.status,
    errorText: snapshot.errorText,
    prompt: snapshot.prompt,
    answer: truncatedOutput(snapshot),
    sessionFilePath: snapshot.meta.sessionFilePath,
  });
  ui?.notify(
    snapshot.status === "error"
      ? `by the way “${snapshot.title}” failed — reopen it with /swarm`
      : `by the way “${snapshot.title}” answered — reopen it with /swarm`,
    snapshot.status === "error" ? "error" : "info",
  );
}
