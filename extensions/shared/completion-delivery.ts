import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type CompletionMessage = Parameters<ExtensionAPI["sendMessage"]>[0];

export function registerCompletionFlush(
  pi: ExtensionAPI,
  flush: (wakeAgent: boolean) => void,
) {
  pi.on("turn_end", () => flush(false));
  pi.on("agent_settled", () => flush(false));
}

export function deliverCompletion(
  pi: ExtensionAPI,
  message: CompletionMessage,
  wakeAgent: boolean,
) {
  pi.sendMessage(
    message,
    wakeAgent
      ? { deliverAs: "followUp", triggerTurn: true }
      : { deliverAs: "steer" },
  );
}
