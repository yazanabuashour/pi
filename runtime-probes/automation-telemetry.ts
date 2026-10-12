import * as NodeFS from "node:fs";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type ActiveTool = {
  name: string;
  started: bigint;
};

type TelemetryEvent =
  | { event: "session_start"; model: string | null; reasoning: string | null }
  | { event: "agent_start" }
  | {
      event: "tool_start";
      toolCallId: string;
      toolName: string;
      concurrency: number;
    }
  | {
      event: "tool_end";
      toolCallId: string;
      toolName: string;
      durationMs: number | null;
      isError: boolean;
      concurrency: number;
      orphanEnd: boolean;
    }
  | { event: "agent_settled" }
  | {
      event: "tool_orphaned";
      toolCallId: string;
      toolName: string;
      durationMs: number;
    }
  | {
      event: "summary";
      settled: boolean;
      shutdownReason: string;
      calls: number;
      errors: number;
      maxConcurrency: number;
      summedToolDurationMs: number;
      orphanedTools: number;
    };

function milliseconds(started: bigint, ended = process.hrtime.bigint()) {
  return Number(ended - started) / 1_000_000;
}

function openWriter(path: string, automation: string, runId: string) {
  const descriptor = NodeFS.openSync(path, "a", 0o600);

  const close = () => {
    try {
      NodeFS.closeSync(descriptor);
    } catch (cause) {
      console.error("pi-telemetry-close-failed:", cause);
    }
  };

  try {
    NodeFS.fchmodSync(descriptor, 0o600);
  } catch (cause) {
    close();
    throw cause;
  }

  let failed = false;

  return {
    append(event: TelemetryEvent, started: bigint) {
      if (failed) return;

      try {
        const line = JSON.stringify({
          schema: "pi-automation-telemetry/v2",
          timestamp: new Date().toISOString(),
          elapsedMs: Number(milliseconds(started).toFixed(3)),
          automation,
          runId,
          ...event,
        });

        NodeFS.writeFileSync(descriptor, `${line}\n`);
      } catch (cause) {
        failed = true;
        console.error("pi-telemetry-write-failed: collection disabled", cause);
      }
    },
    close,
  };
}

function createState() {
  return {
    active: new Map<string, ActiveTool>(),
    started: process.hrtime.bigint(),
    settled: false,
    calls: 0,
    errors: 0,
    maxConcurrency: 0,
    summedToolMilliseconds: 0,
  };
}

export default function automationTelemetry(pi: ExtensionAPI) {
  const path = process.env["PI_AUTOMATION_TELEMETRY_PATH"];

  if (!path) return;

  const automation = process.env["PI_AUTOMATION_NAME"] ?? "unknown";
  const runId = process.env["PI_AUTOMATION_RUN_ID"] ?? "unknown";
  let state = createState();
  let writer: ReturnType<typeof openWriter> | undefined;

  const append = (event: TelemetryEvent) => {
    writer?.append(event, state.started);
  };

  pi.on("session_start", (_event, ctx) => {
    state = createState();

    try {
      writer = openWriter(path, automation, runId);
    } catch (cause) {
      console.error("pi-telemetry-open-failed: collection disabled", cause);

      return;
    }

    append({
      event: "session_start",
      model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : null,
      reasoning: ctx.thinkingLevel ?? null,
    });
  });
  pi.on("agent_start", () => {
    state.settled = false;
    append({ event: "agent_start" });
  });
  pi.on("tool_execution_start", (event) => {
    state.active.set(event.toolCallId, {
      name: event.toolName,
      started: process.hrtime.bigint(),
    });
    state.calls += 1;
    state.maxConcurrency = Math.max(state.maxConcurrency, state.active.size);
    append({
      event: "tool_start",
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      concurrency: state.active.size,
    });
  });
  pi.on("tool_execution_end", (event) => {
    const tool = state.active.get(event.toolCallId);
    state.active.delete(event.toolCallId);
    const duration = tool ? milliseconds(tool.started) : null;

    if (duration !== null) state.summedToolMilliseconds += duration;

    if (event.isError) state.errors += 1;

    append({
      event: "tool_end",
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      durationMs: duration === null ? null : Number(duration.toFixed(3)),
      isError: event.isError,
      concurrency: state.active.size,
      orphanEnd: tool === undefined,
    });
  });
  pi.on("agent_settled", () => {
    state.settled = true;
    append({ event: "agent_settled" });
  });
  pi.on("session_shutdown", (event) => {
    try {
      for (const [toolCallId, tool] of state.active) {
        append({
          event: "tool_orphaned",
          toolCallId,
          toolName: tool.name,
          durationMs: Number(milliseconds(tool.started).toFixed(3)),
        });
      }

      append({
        event: "summary",
        settled: state.settled,
        shutdownReason: event.reason,
        calls: state.calls,
        errors: state.errors,
        maxConcurrency: state.maxConcurrency,
        summedToolDurationMs: Number(state.summedToolMilliseconds.toFixed(3)),
        orphanedTools: state.active.size,
      });
    } finally {
      writer?.close();
      writer = undefined;
      state.active.clear();
    }
  });
}
