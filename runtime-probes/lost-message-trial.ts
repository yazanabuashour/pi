import * as NodeFS from "node:fs";
import * as NodeTimersPromises from "node:timers/promises";

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

const hostPrompt = "pi-trial-explicit-host-turn";

const configuration = Type.Object({
  mode: Type.Union([
    Type.Literal("busy"),
    Type.Literal("idle"),
    Type.Literal("host-busy"),
    Type.Literal("host-idle"),
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
      policy: "automatic" | "host";
      isIdle: boolean;
    }
  | {
      event: "agent_settled";
      isIdle: boolean;
      historyHasMarker: boolean;
    }
  | {
      event: "idle_observed" | "session_shutdown";
      isIdle: boolean;
      historyHasMarker: boolean;
      providerRequests: number;
      submissions: unknown[];
    }
  | { event: "host_turn"; prompt: string; providerRequests: number }
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

function backgroundSubmissions(ctx: ExtensionContext) {
  return ctx.sessionManager
    .getEntries()
    .flatMap((entry) =>
      entry.type === "custom" && entry.customType === "background-delivery"
        ? [entry.data]
        : [],
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
  // Negative control: keep history and message events intact, but omit the message
  // before native Pi constructs the provider request. Capture stays unchanged.
  pi.on("context", (event) => ({
    messages: event.messages.filter(
      (message) => message.role !== "custom" || message.content !== marker,
    ),
  }));
}

function registerTrialProvider(
  pi: ExtensionAPI,
  mode: Static<typeof configuration>["mode"],
  capture: (context: Context) => void,
) {
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
    mode === "idle" || mode === "host-idle"
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

  registerTrialProvider(pi, mode, (context) => {
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
  });

  if (mode === "omitted-context") omitMarkerFromContext(pi);

  pi.on("session_start", (_event, ctx) => {
    currentContext = ctx;
    record({
      event: "session_start",
      mode,
      marker,
      policy: owner.delivery.policy,
      isIdle: ctx.isIdle(),
    });
  });
  pi.on("before_agent_start", (event) => {
    if (mode === "host-idle") {
      if (event.prompt !== hostPrompt)
        throw new Error("Expected the explicit host prompt");
      record({
        event: "host_turn",
        prompt: event.prompt,
        providerRequests: request,
      });
    }
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
      providerRequests: request,
      submissions: backgroundSubmissions(ctx),
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

      if (mode === "host-idle") {
        // Let queued callbacks run before the CLI supplies its separate prompt.
        await NodeTimersPromises.setImmediate();
        record({
          event: "idle_observed",
          isIdle: ctx.isIdle(),
          historyHasMarker: historyHasMarker(ctx),
          providerRequests: request,
          submissions: backgroundSubmissions(ctx),
        });
      }
    },
  });
}
