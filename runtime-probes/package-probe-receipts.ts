import * as NodeFS from "node:fs";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

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
  toolName?: string;
  isError?: boolean;
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
    };
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
