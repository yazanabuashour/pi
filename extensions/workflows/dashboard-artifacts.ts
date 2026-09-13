import type { RuntimeRecord } from "../shared/runtime-values.ts";
import {
  isNumber,
  isRuntimeRecord,
  isString,
} from "../shared/runtime-values.ts";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import {
  getAgentDir,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  displayInterruptedWorkflow,
  type AgentRecord,
  type TranscriptEntry,
  type WorkflowDetails,
} from "./model.ts";

export interface RunEntry {
  runId: string;
  details: WorkflowDetails;
  live: boolean;
}

export function runsDir() {
  return NodePath.join(getAgentDir(), "workflows");
}

function normalizeTranscript<Input1>(value: Input1): TranscriptEntry[] {
  if (!Array.isArray(value)) return [];
  const transcript: TranscriptEntry[] = [];
  for (const item of value) {
    if (!isRuntimeRecord(item)) continue;
    const entry = item;
    const role = entry["role"];
    if (
      role !== "user" &&
      role !== "assistant" &&
      role !== "thinking" &&
      role !== "tool" &&
      role !== "toolResult"
    ) {
      continue;
    }
    const text = entry["text"];
    if (!isString(text)) continue;
    const normalized: TranscriptEntry = { role, text };
    const name = entry["name"];
    if (isString(name)) normalized.name = name;
    if (entry["isError"] === true) normalized.isError = true;
    const timestamp = entry["timestamp"];
    if (isNumber(timestamp)) normalized.timestamp = timestamp;
    transcript.push(normalized);
  }
  return transcript;
}

function normalizeAgents(
  record: RuntimeRecord,
  startedAt: number,
): AgentRecord[] {
  const agents: AgentRecord[] = [];
  for (const item of Array.isArray(record["agents"]) ? record["agents"] : []) {
    if (!isRuntimeRecord(item)) continue;
    const agent = item;
    const rawState = agent["state"];
    const state =
      rawState === "error" || rawState === "running" || rawState === "done"
        ? rawState
        : undefined;
    if (!state) continue;
    const index = agent["index"];
    const label = agent["label"];
    const rawStartedAt = agent["startedAt"];
    const preview = agent["preview"];
    const normalized: AgentRecord = {
      index: isNumber(index) ? index : agents.length + 1,
      label: isString(label) ? label : `agent-${agents.length + 1}`,
      state,
      startedAt: isNumber(rawStartedAt) ? rawStartedAt : startedAt,
      preview: isString(preview) ? preview : "",
      usage: normalizeUsage(agent["usage"]),
      transcript: normalizeTranscript(agent["transcript"]),
    };
    const phase = agent["phase"];
    if (isString(phase)) normalized.phase = phase;
    const model = agent["model"];
    if (isString(model)) normalized.model = model;
    const contextWindow = agent["contextWindow"];
    if (
      isNumber(contextWindow) &&
      Number.isFinite(contextWindow) &&
      contextWindow > 0
    ) {
      normalized.contextWindow = contextWindow;
    }
    const finishedAt = agent["finishedAt"];
    if (isNumber(finishedAt)) normalized.finishedAt = finishedAt;
    const error = agent["error"];
    if (isString(error) && error !== "[undefined]") normalized.error = error;
    agents.push(normalized);
  }
  return agents;
}

function normalizePhases(record: RuntimeRecord): WorkflowDetails["phases"] {
  const raw = Array.isArray(record["phases"]) ? record["phases"] : [];
  const phases: WorkflowDetails["phases"] = [];
  for (const item of raw) {
    if (!isRuntimeRecord(item)) continue;
    const title = item["title"];
    if (!isString(title)) continue;
    const phase: WorkflowDetails["phases"][number] = { title };
    const detail = item["detail"];
    if (isString(detail)) phase.detail = detail;
    phases.push(phase);
  }
  return phases;
}

export function normalizeWorkflowDetails<Input1>(
  runId: string,
  raw: Input1,
): WorkflowDetails | undefined {
  if (!isRuntimeRecord(raw)) return undefined;
  const record = raw;
  if (record["schemaVersion"] !== 1) return undefined;
  const rawStartedAt = record["startedAt"];
  const startedAt = isNumber(rawStartedAt) ? rawStartedAt : 0;
  const agents = normalizeAgents(record, startedAt);
  const phases = normalizePhases(record);

  const rawStatus = record["status"];
  const status =
    rawStatus === "running" ||
    rawStatus === "completed" ||
    rawStatus === "failed" ||
    rawStatus === "aborted"
      ? rawStatus
      : undefined;
  if (!status) return undefined;

  const details: WorkflowDetails = {
    schemaVersion: 1,
    runId,
    background: record["background"] === true,
    status,
    startedAt,
    phases,
    agents,
  };
  const sessionId = record["sessionId"];
  if (isString(sessionId)) details.sessionId = sessionId;
  const name = record["name"];
  if (isString(name)) details.name = name;
  const description = record["description"];
  if (isString(description)) details.description = description;
  const finishedAt = record["finishedAt"];
  if (isNumber(finishedAt)) details.finishedAt = finishedAt;
  const currentPhase = record["currentPhase"];
  if (isString(currentPhase)) details.currentPhase = currentPhase;
  if (record["result"] !== undefined) details.result = record["result"];
  const resultArtifact = record["resultArtifact"];
  if (isString(resultArtifact)) details.resultArtifact = resultArtifact;
  const transcriptArtifact = record["transcriptArtifact"];
  if (isString(transcriptArtifact)) {
    details.transcriptArtifact = transcriptArtifact;
  }
  const error = record["error"];
  if (isString(error)) details.error = error;
  return details;
}

function normalizeUsage<Input1>(value: Input1): AgentRecord["usage"] {
  const usage: RuntimeRecord = isRuntimeRecord(value) ? value : {};
  return {
    input: isNumber(usage["input"]) ? usage["input"] : 0,
    output: isNumber(usage["output"]) ? usage["output"] : 0,
    cacheRead: isNumber(usage["cacheRead"]) ? usage["cacheRead"] : 0,
    cacheWrite: isNumber(usage["cacheWrite"]) ? usage["cacheWrite"] : 0,
    cost: isNumber(usage["cost"]) ? usage["cost"] : 0,
    turns: isNumber(usage["turns"]) ? usage["turns"] : 0,
  };
}

export function sessionWorkflowRunIds(ctx: ExtensionContext): Set<string> {
  const runIds = new Set<string>();
  for (const entry of ctx.sessionManager.getEntries()) {
    if (
      entry.type !== "message" ||
      entry.message.role !== "toolResult" ||
      entry.message.toolName !== "workflow"
    ) {
      continue;
    }
    const details = entry.message.details;
    if (!isRuntimeRecord(details)) continue;
    const runId = details["runId"];
    if (isString(runId)) runIds.add(runId);
  }
  return runIds;
}

function readArtifact(runId: string, name: string) {
  const value: unknown = JSON.parse(
    NodeFS.readFileSync(
      NodePath.join(runsDir(), runId, NodePath.basename(name)),
      "utf8",
    ),
  );
  return value;
}

function artifactFailure(cause: unknown) {
  if (cause instanceof SyntaxError) return "invalid JSON";
  if (cause instanceof Error && "code" in cause && isString(cause.code))
    return cause.code;
  return "read failed";
}

export function loadRunEntries(
  active: Map<string, WorkflowDetails>,
  sessionId: string,
  referencedRunIds: ReadonlySet<string>,
) {
  const notices: string[] = [];
  let names: string[] = [];
  try {
    names = NodeFS.readdirSync(runsDir()).filter((name) =>
      name.startsWith("wf_"),
    );
  } catch (cause) {
    if (artifactFailure(cause) !== "ENOENT")
      notices.push(`Cannot list workflow runs: ${artifactFailure(cause)}`);
  }
  const entries: RunEntry[] = [];
  for (const runId of names) {
    const live = active.get(runId);
    if (live) {
      entries.push({ runId, details: live, live: true });
      continue;
    }
    try {
      let details = normalizeWorkflowDetails(
        runId,
        readArtifact(runId, "workflow.json"),
      );
      if (!details)
        notices.push(`${runId}/workflow.json: invalid workflow state`);
      if (
        details &&
        (details.sessionId === sessionId || referencedRunIds.has(runId))
      ) {
        details = displayInterruptedWorkflow(details);
        if (details.resultArtifact) {
          try {
            details.result = readArtifact(runId, details.resultArtifact);
          } catch (cause) {
            // Keep the result artifact marker from workflow.json.
            notices.push(`${runId}/result: ${artifactFailure(cause)}`);
          }
        }
        if (details.transcriptArtifact) {
          try {
            const transcripts = readArtifact(runId, details.transcriptArtifact);
            if (!isRuntimeRecord(transcripts)) {
              notices.push(`${runId}/transcript: invalid transcript map`);
            } else {
              for (const agent of details.agents) {
                const raw = transcripts[String(agent.index)];
                if (raw === undefined) continue;
                const transcript = normalizeTranscript(raw);
                if (!Array.isArray(raw) || transcript.length !== raw.length)
                  notices.push(
                    `${runId}/transcript: invalid entries for agent ${agent.index}`,
                  );
                agent.transcript = transcript;
              }
            }
          } catch (cause) {
            // Keep inline transcripts when the separate artifact is partial.
            notices.push(`${runId}/transcript: ${artifactFailure(cause)}`);
          }
        }
        entries.push({ runId, details, live: false });
      }
    } catch (cause) {
      notices.push(`${runId}/workflow.json: ${artifactFailure(cause)}`);
    }
  }
  return {
    entries: entries.sort((a, b) => b.details.startedAt - a.details.startedAt),
    notice: notices.length
      ? notices.join("; ").replace(/\p{Cc}/gu, "")
      : undefined,
  };
}
