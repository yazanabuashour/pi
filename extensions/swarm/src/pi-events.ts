import { isRuntimeRecord, isString } from "../../shared/runtime-values.ts";
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { TranscriptPart } from "./domain.ts";

export function messageRole<Input1>(msg: Input1): Message["role"] | undefined {
  if (!isRuntimeRecord(msg)) return undefined;
  const role = msg["role"];
  return role === "user" || role === "assistant" || role === "toolResult"
    ? role
    : undefined;
}

export function lastAssistantMessage(
  session: AgentSession,
): AssistantMessage | undefined {
  for (let index = session.messages.length - 1; index >= 0; index--) {
    const message = session.messages[index];
    if (message?.role === "assistant") return message;
  }
  return undefined;
}

export function finalOutput(session: AgentSession): string {
  for (let index = session.messages.length - 1; index >= 0; index--) {
    const message = session.messages[index];
    if (message?.role !== "assistant") continue;
    const text = message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim();
    if (text) return text;
  }
  return "";
}

export function safeJson<Input1>(value: Input1): string | undefined {
  try {
    const text = JSON.stringify(value);
    return text === "{}" ? undefined : text.slice(0, 4_096);
  } catch {
    return undefined;
  }
}

export function toolPreview<Input1>(value: Input1): string | undefined {
  if (isString(value))
    return value
      .split("\n")
      .find((line) => line.trim())
      ?.trim();
  if (!isRuntimeRecord(value) || !Array.isArray(value["content"]))
    return undefined;
  for (const part of value["content"]) {
    if (
      !isRuntimeRecord(part) ||
      part["type"] !== "text" ||
      !isString(part["text"])
    )
      continue;
    const firstLine = part["text"]
      .split("\n")
      .find((line: string) => line.trim());
    if (firstLine) return firstLine.trim();
  }
  return undefined;
}

export function assistantParts(message: AssistantMessage): TranscriptPart[] {
  const parts: TranscriptPart[] = [];
  for (const part of message.content) {
    if (part.type === "text") parts.push({ type: "text", text: part.text });
    else if (part.type === "thinking") {
      parts.push({
        type: "thinking",
        text: part.redacted ? "" : part.thinking,
        redacted: part.redacted,
      });
    } else if (part.type === "toolCall") {
      parts.push({
        type: "toolCall",
        toolId: part.id,
        name: part.name,
        argsPreview: safeJson(part.arguments),
      });
    }
  }
  return parts;
}

export function userText(message: Message): string {
  if (isString(message.content)) return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .flatMap((part) =>
      isRuntimeRecord(part) && part["type"] === "text" && isString(part["text"])
        ? [part["text"]]
        : [],
    )
    .join("\n");
}

export function boundedError<Input1>(error: Input1) {
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    4096,
  );
}
