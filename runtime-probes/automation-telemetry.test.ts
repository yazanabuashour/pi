import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionEvent,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Parse } from "typebox/value";
import automationTelemetry from "./automation-telemetry.ts";

const EventsSchema = Type.Array(
  Type.Object({
    event: Type.String(),
    settled: Type.Optional(Type.Boolean()),
    calls: Type.Optional(Type.Number()),
    errors: Type.Optional(Type.Number()),
    orphanedTools: Type.Optional(Type.Number()),
  }),
);

await NodeTest.test(
  "telemetry resets settlement on restart and counters on session replacement",
  (t) => {
    const directory = NodeFS.mkdtempSync(
      NodePath.join(NodeOS.tmpdir(), "pi-telemetry-test-"),
    );

    const path = NodePath.join(directory, "events.jsonl");
    const previousPath = process.env["PI_AUTOMATION_TELEMETRY_PATH"];
    process.env["PI_AUTOMATION_TELEMETRY_PATH"] = path;
    t.after(() => {
      if (previousPath === undefined)
        delete process.env["PI_AUTOMATION_TELEMETRY_PATH"];
      else process.env["PI_AUTOMATION_TELEMETRY_PATH"] = previousPath;
      NodeFS.rmSync(directory, { recursive: true });
    });

    type Handler = (event: ExtensionEvent, ctx: ExtensionContext) => void;

    const handlers = new Map<string, Handler>();

    const api: ExtensionAPI = Object.assign(Object.create(null), {
      on: (name: string, handler: Handler) => handlers.set(name, handler),
    });

    const context: ExtensionContext = Object.assign(Object.create(null), {});

    const dispatch = (event: ExtensionEvent) => {
      const handler = handlers.get(event.type);
      NodeAssert.ok(handler, `Missing handler for ${event.type}`);
      handler(event, context);
    };

    automationTelemetry(api);
    dispatch({ type: "session_start", reason: "startup" });
    dispatch({ type: "agent_start" });
    dispatch({ type: "agent_settled" });
    dispatch({ type: "agent_start" });
    dispatch({
      type: "tool_execution_start",
      toolCallId: "interrupted",
      toolName: "read",
      args: { path: "private-input" },
    });
    dispatch({ type: "session_shutdown", reason: "new" });
    dispatch({ type: "session_start", reason: "new" });
    dispatch({ type: "agent_start" });
    dispatch({ type: "agent_settled" });
    dispatch({ type: "session_shutdown", reason: "quit" });

    const text = NodeFS.readFileSync(path, "utf8");

    const events = Parse(
      EventsSchema,
      text
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line)),
    );

    NodeAssert.deepEqual(
      events
        .filter((event) => event.event === "summary")
        .map(({ settled, calls, errors, orphanedTools }) => ({
          settled,
          calls,
          errors,
          orphanedTools,
        })),
      [
        { settled: false, calls: 1, errors: 0, orphanedTools: 1 },
        { settled: true, calls: 0, errors: 0, orphanedTools: 0 },
      ],
    );
    NodeAssert.ok(events.some((event) => event.event === "tool_orphaned"));
    NodeAssert.equal(text.includes("private-input"), false);
    NodeAssert.equal(NodeFS.statSync(path).mode & 0o777, 0o600);
  },
);
