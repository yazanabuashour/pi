import * as NodeFS from "node:fs";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { Parse } from "typebox/value";

const lifecycleSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  id: Type.String(),
  event: Type.String(),
  status: Type.String(),
  outcome: Type.Optional(Type.String()),
  exitCode: Type.Optional(Type.Number()),
});

const receiptEvents = [
  "session_start",
  "tool_execution_start",
  "tool_execution_end",
  "agent_settled",
  "session_shutdown",
] as const;

interface ProbeReceipt {
  type: (typeof receiptEvents)[number];
  sessionId: string;
  mode: ExtensionContext["mode"];
  sessionFile?: string;
  toolName?: string;
  isError?: boolean;
  lifecycle: ReadonlyArray<Static<typeof lifecycleSchema>>;
}

export function registerReceipts(pi: ExtensionAPI) {
  const receipt = process.env["DOTFILES_PI_PROBE_EVENTS"];

  const record = (
    event: Pick<ProbeReceipt, "type" | "toolName" | "isError">,
    context: ExtensionContext,
  ) => {
    if (!receipt) return;

    const entry: ProbeReceipt = {
      type: event.type,
      sessionId: context.sessionManager.getSessionId(),
      mode: context.mode,
      lifecycle: context.sessionManager
        .getBranch()
        .flatMap((entry) =>
          entry.type === "custom" &&
          entry.customType === "background-terminal-lifecycle"
            ? [Parse(lifecycleSchema, entry.data)]
            : [],
        ),
    };

    const sessionFile = context.sessionManager.getSessionFile();

    if (sessionFile !== undefined) entry.sessionFile = sessionFile;

    if (event.toolName !== undefined) entry.toolName = event.toolName;

    if (event.isError !== undefined) entry.isError = event.isError;
    NodeFS.appendFileSync(receipt, `${JSON.stringify(entry)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  };

  pi.on("session_start", record);
  pi.on("tool_execution_start", record);
  pi.on("tool_execution_end", record);
  pi.on("agent_settled", record);
  pi.on("session_shutdown", record);
}
