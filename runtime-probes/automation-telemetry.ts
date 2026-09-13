import * as NodeFS from "node:fs";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { Check } from "typebox/value";

type ActiveTool = {
  name: string;
  started: bigint;
};

type TelemetryEvent =
  | { event: "session_start"; model: string | null; reasoning: string | null }
  | {
      event: "tool_start";
      toolCallId: string;
      toolName: string;
      queryCount: number;
      concurrency: number;
    }
  | {
      event: "tool_end";
      toolCallId: string;
      toolName: string;
      durationMs: number | null;
      isError: boolean;
      partialRateLimit: boolean;
      concurrency: number;
      orphanEnd: boolean;
    }
  | { event: "provider_response"; status: number; rateLimited: boolean }
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
      queries: number;
      maxConcurrency: number;
      totalToolDurationMs: number;
      providerResponses: number;
      rateLimits: number;
      orphanedTools: number;
    };

type TelemetryState = {
  active: Map<string, ActiveTool>;
  started: bigint;
  settled: boolean;
  calls: number;
  errors: number;
  queries: number;
  maxConcurrency: number;
  totalToolMilliseconds: number;
  providerResponses: number;
  rateLimits: number;
};

const QueryArgumentsSchema = Type.Object(
  {
    query: Type.Optional(Type.String()),
    queries: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: true },
);
type QueryArguments = Static<typeof QueryArgumentsSchema>;

const ToolResultSchema = Type.Object({
  content: Type.Array(
    Type.Object({ type: Type.String(), text: Type.Optional(Type.String()) }),
  ),
});

function milliseconds(
  started: bigint,
  ended = process.hrtime.bigint(),
): number {
  return Number(ended - started) / 1_000_000;
}

function openWriter(
  path: string,
  automation: string,
  runId: string,
  state: TelemetryState,
) {
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
    append(event: TelemetryEvent) {
      if (failed) return;
      try {
        const line = JSON.stringify({
          schema: "pi-automation-telemetry/v1",
          timestamp: new Date().toISOString(),
          elapsedMs: Number(milliseconds(state.started).toFixed(3)),
          automation,
          runId,
          ...event,
        });
        NodeFS.writeSync(descriptor, `${line}\n`);
        NodeFS.fdatasyncSync(descriptor);
      } catch (cause) {
        failed = true;
        console.error("pi-telemetry-write-failed: collection disabled", cause);
      }
    },
    close,
  };
}

function registerToolEvents(
  pi: ExtensionAPI,
  state: TelemetryState,
  append: (event: TelemetryEvent) => void,
) {
  pi.on("tool_execution_start", (event) => {
    const now = process.hrtime.bigint();
    const args: QueryArguments = Check(QueryArgumentsSchema, event.args)
      ? event.args
      : {};
    const queryCount =
      args.query !== undefined ? 1 : (args.queries?.length ?? 0);
    state.active.set(event.toolCallId, { name: event.toolName, started: now });
    state.calls += 1;
    state.queries += queryCount;
    state.maxConcurrency = Math.max(state.maxConcurrency, state.active.size);
    append({
      event: "tool_start",
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      queryCount,
      concurrency: state.active.size,
    });
  });

  pi.on("tool_execution_end", (event) => {
    const now = process.hrtime.bigint();
    const tool = state.active.get(event.toolCallId);
    state.active.delete(event.toolCallId);
    const duration = tool ? milliseconds(tool.started, now) : null;
    if (duration !== null) state.totalToolMilliseconds += duration;
    if (event.isError) state.errors += 1;
    const partialRateLimit =
      Check(ToolResultSchema, event.result) &&
      event.result.content.some(
        (part) =>
          part.type === "text" &&
          /(?:rate[ _-]?limit|\b429\b)/i.test(part.text ?? ""),
      );
    if (partialRateLimit) state.rateLimits += 1;
    append({
      event: "tool_end",
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      durationMs: duration === null ? null : Number(duration.toFixed(3)),
      isError: event.isError,
      partialRateLimit,
      concurrency: state.active.size,
      orphanEnd: tool === undefined,
    });
  });
}

export default function automationTelemetry(pi: ExtensionAPI) {
  const path = process.env["PI_AUTOMATION_TELEMETRY_PATH"];
  if (!path) return;

  const automation = process.env["PI_AUTOMATION_NAME"] ?? "unknown";
  const runId = process.env["PI_AUTOMATION_RUN_ID"] ?? "unknown";
  const state: TelemetryState = {
    active: new Map(),
    started: process.hrtime.bigint(),
    settled: false,
    calls: 0,
    errors: 0,
    queries: 0,
    maxConcurrency: 0,
    totalToolMilliseconds: 0,
    providerResponses: 0,
    rateLimits: 0,
  };
  let writer: ReturnType<typeof openWriter> | undefined;
  const append = (event: TelemetryEvent) => {
    writer?.append(event);
  };

  registerToolEvents(pi, state, append);
  pi.on("session_start", (_event, ctx) => {
    state.started = process.hrtime.bigint();
    try {
      writer = openWriter(path, automation, runId, state);
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
  pi.on("after_provider_response", (event) => {
    state.providerResponses += 1;
    const rateLimited = event.status === 429;
    if (rateLimited) state.rateLimits += 1;
    append({ event: "provider_response", status: event.status, rateLimited });
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
        queries: state.queries,
        maxConcurrency: state.maxConcurrency,
        totalToolDurationMs: Number(state.totalToolMilliseconds.toFixed(3)),
        providerResponses: state.providerResponses,
        rateLimits: state.rateLimits,
        orphanedTools: state.active.size,
      });
    } finally {
      writer?.close();
      writer = undefined;
      state.active.clear();
    }
  });
}
