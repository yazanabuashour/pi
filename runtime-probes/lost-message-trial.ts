import * as NodeFS from "node:fs";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type Context,
} from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { Parse } from "typebox/value";
import { SwarmExtensionSession } from "../extensions/swarm/src/extension-session.ts";

const marker = "pi-trial1-child-progress-7e38932d";
const configuration = Type.Object({
  mode: Type.Union([
    Type.Literal("busy"),
    Type.Literal("idle"),
    Type.Literal("omitted-context"),
  ]),
  receipt: Type.String({ minLength: 1 }),
});

type TrialReceipt =
  | {
      event: "provider_request";
      request: number;
      messages: Pick<Context["messages"][number], "role" | "content">[];
      historyHasMarker: boolean;
    }
  | {
      event: "submit";
      isIdle: boolean;
      path: "installed-adapter";
    }
  | {
      event: "session_start";
      mode: Static<typeof configuration>["mode"];
      marker: string;
      isIdle: boolean;
    }
  | {
      event: "agent_settled" | "session_shutdown";
      isIdle: boolean;
      historyHasMarker: boolean;
    }
  | { event: "turn_end"; turnIndex: number }
  | { event: "tool_execution_end"; isError: boolean }
  | { event: "tool_pending" | "tool_release" };

function historyHasMarker(ctx: ExtensionContext) {
  return ctx.sessionManager
    .getEntries()
    .some(
      (entry) => entry.type === "custom_message" && entry.content === marker,
    );
}

function send(
  ctx: ExtensionContext,
  owner: SwarmExtensionSession,
  record: (entry: TrialReceipt) => void,
) {
  const isIdle = ctx.isIdle();
  record({
    event: "submit",
    isIdle,
    path: "installed-adapter",
  });
  owner.messages.receive(
    {
      schemaVersion: 1,
      id: "trial-message",
      from: "trial-child",
      to: "root",
      text: marker,
    },
    marker,
  );
}

function omitMarkerFromContext(pi: ExtensionAPI) {
  // Negative control: keep history and display intact, but omit the message
  // before native Pi constructs the provider request. Capture stays unchanged.
  pi.on("context", (event) => ({
    messages: event.messages.filter(
      (message) => message.role !== "custom" || message.content !== marker,
    ),
  }));
}

export default function (pi: ExtensionAPI) {
  const { mode, receipt } = Parse(configuration, {
    mode: process.env["PI_TRIAL_MODE"],
    receipt: process.env["PI_TRIAL_RECEIPT"],
  });
  const record = (entry: TrialReceipt) =>
    NodeFS.appendFileSync(receipt, `${JSON.stringify(entry)}\n`);
  const owner = new SwarmExtensionSession(pi);
  let currentContext: ExtensionContext | undefined;
  let request = 0;

  const capture = (context: Context) => {
    if (!currentContext) throw new Error("Missing trial session context");
    request += 1;
    // Capture at the provider boundary, not from Pi's history or context hook.
    record({
      event: "provider_request",
      request,
      messages: context.messages.map(({ role, content }) => ({
        role,
        content,
      })),
      historyHasMarker: historyHasMarker(currentContext),
    });
  };

  const faux = fauxProvider({
    provider: "pi-lost-message-trial",
    api: "pi-lost-message-trial",
    // Fixed chunking; no simulated wall-clock delays.
    tokenSize: { min: 1, max: 1 },
  });
  const finish = (context: Context) => {
    capture(context);
    return fauxAssistantMessage("pi-lost-message-trial-ok", { timestamp: 0 });
  };
  faux.setResponses(
    mode === "idle"
      ? [finish]
      : [
          (context) => {
            capture(context);
            return fauxAssistantMessage(
              fauxToolCall("trial_pending_tool", {}, { id: "trial-tool" }),
              { stopReason: "toolUse", timestamp: 0 },
            );
          },
          finish,
        ],
  );
  pi.registerProvider(faux.provider);

  if (mode === "omitted-context") omitMarkerFromContext(pi);

  pi.on("session_start", (_event, ctx) => {
    currentContext = ctx;
    record({ event: "session_start", mode, marker, isIdle: ctx.isIdle() });
  });
  pi.on("turn_end", (event) => {
    record({ event: "turn_end", turnIndex: event.turnIndex });
  });
  pi.on("tool_execution_end", (event) => {
    record({ event: "tool_execution_end", isError: event.isError });
  });
  pi.on("agent_settled", (_event, ctx) => {
    record({
      event: "agent_settled",
      isIdle: ctx.isIdle(),
      historyHasMarker: historyHasMarker(ctx),
    });
  });
  pi.on("session_shutdown", (_event, ctx) => {
    record({
      event: "session_shutdown",
      isIdle: ctx.isIdle(),
      historyHasMarker: historyHasMarker(ctx),
    });
  });

  pi.registerTool({
    name: "trial_pending_tool",
    label: "Trial pending tool",
    description: "Returns a fixed synthetic result after child delivery.",
    parameters: Type.Object({}),
    execute: async (_id, _params, _signal, _update, ctx) => {
      record({ event: "tool_pending" });
      // The synthetic child sends while this tool is in flight. Returning the
      // result releases the tool; native Pi owns turn end and continuation.
      send(ctx, owner, record);
      record({ event: "tool_release" });
      return {
        content: [{ type: "text", text: "tool-completed" }],
        details: {},
      };
    },
  });
  pi.registerCommand("trial-idle", {
    description: "Inject the synthetic child message into an idle root.",
    handler: async (_args, ctx) => {
      send(ctx, owner, record);
      await ctx.waitForIdle();
    },
  });
}
