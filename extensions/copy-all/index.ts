import { isObjectValue, isString } from "../shared/runtime-values.ts";
import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";
import {
  copyToClipboard,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

function textFromContent(
  content: UserMessage["content"] | AssistantMessage["content"],
) {
  if (isString(content)) return content;

  if (!Array.isArray(content)) return "";

  const blocks: readonly unknown[] = content;
  const lines: string[] = [];

  for (const block of blocks) {
    if (!block || !isObjectValue(block) || !("type" in block)) continue;

    const type = block["type"];

    if (type === "image") {
      lines.push("[image]");
      continue;
    }

    if (type !== "text" || !("text" in block)) continue;
    const text = block["text"];

    if (isString(text) && text) lines.push(text);
  }

  return lines.join("\n");
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("copy-all", {
    description:
      "Copy all previous user and assistant messages in this thread to the clipboard",
    handler: async (_args, ctx) => {
      await ctx.waitForIdle();

      const sections = ctx.sessionManager
        .getBranch()
        .filter((entry) => entry.type === "message")
        .map((entry) => entry.message)
        .filter(
          (message) => message.role === "user" || message.role === "assistant",
        )
        .map((message) => ({
          role: message.role,
          content: textFromContent(message.content).trim(),
        }))
        .filter(({ content }) => content)
        .map(({ role, content }) => `${role.toUpperCase()}:\n${content}`);

      if (sections.length === 0) {
        ctx.ui.notify("No user or assistant messages to copy", "info");

        return;
      }

      await copyToClipboard(sections.join("\n\n---\n\n"));
      ctx.ui.notify(`Copied ${sections.length} messages to clipboard`, "info");
    },
  });
}
