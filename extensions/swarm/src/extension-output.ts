import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import { formatContextUtilization } from "../../shared/context-utilization.ts";
import { formatElapsed, type AgentSnapshot } from "./domain.ts";
import { buildAgentResultMessage } from "./prompt.ts";

const AGENT_OUTPUT_MAX_BYTES = 24 * 1024;
const WAIT_OUTPUT_MAX_BYTES = 48 * 1024;
const WAIT_PER_AGENT_MAX_BYTES = 16 * 1024;

export function describeAgent(snapshot: AgentSnapshot) {
  const details = [
    `pi: ${snapshot.meta.modelLabel ?? "?"}`,
    formatContextUtilization(snapshot.usage),
    formatElapsed(snapshot),
    snapshot.cwd,
  ].filter(Boolean);
  return `${snapshot.id} [${snapshot.status}] "${snapshot.title}" (${details.join(", ")})`;
}

export function truncatedOutput(
  snapshot: AgentSnapshot,
  maxBytes = AGENT_OUTPUT_MAX_BYTES,
) {
  const output = snapshot.finalText || "(no output)";
  const truncation = truncateHead(output, {
    maxBytes: Math.min(maxBytes, DEFAULT_MAX_BYTES),
    maxLines: Math.min(600, DEFAULT_MAX_LINES),
  });
  if (!truncation.truncated) return truncation.content;
  return `${truncation.content}\n\n[Output truncated: ${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)} shown. Full transcript in session file: ${snapshot.meta.sessionFilePath ?? "?"}]`;
}

function waitSection(snapshot: AgentSnapshot, remainingBytes: number) {
  const verb = snapshot.status === "error" ? "failed" : "finished";
  let section = `## ${snapshot.id} "${snapshot.title}" ${verb}`;
  if (snapshot.errorText) section += `\nError: ${snapshot.errorText}`;
  const headerBytes = Buffer.byteLength(section, "utf8") + 2;
  const outputBudget = Math.max(
    512,
    Math.min(WAIT_PER_AGENT_MAX_BYTES, remainingBytes - headerBytes),
  );
  return `${section}\n\n${truncatedOutput(snapshot, outputBudget)}`;
}

export function buildWaitOutput(snapshots: ReadonlyArray<AgentSnapshot>) {
  const sections: string[] = [];
  let remainingBytes = WAIT_OUTPUT_MAX_BYTES;
  for (const snapshot of snapshots) {
    const section = waitSection(snapshot, remainingBytes);
    const bytes = Buffer.byteLength(section, "utf8");
    if (bytes > remainingBytes) {
      sections.push(
        `## ${snapshot.id} "${snapshot.title}"\n\n[omitted: total wait output limit reached]`,
      );
      break;
    }
    sections.push(section);
    remainingBytes -= bytes;
  }
  const bounded = truncateHead(sections.join("\n\n---\n\n"), {
    maxBytes: WAIT_OUTPUT_MAX_BYTES - 128,
    maxLines: DEFAULT_MAX_LINES,
  });
  return bounded.truncated
    ? `${bounded.content}\n\n[wait output truncated at the total output limit]`
    : bounded.content;
}

export function buildAgentCompletionText(snapshot: AgentSnapshot) {
  const options: Parameters<typeof buildAgentResultMessage>[0] = {
    id: snapshot.id,
    title: snapshot.title,
    status: snapshot.status,
    output: truncatedOutput(snapshot),
  };
  if (snapshot.errorText !== undefined) options.errorText = snapshot.errorText;
  return buildAgentResultMessage(options);
}
