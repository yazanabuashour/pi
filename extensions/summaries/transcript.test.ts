import * as NodeAssert from "node:assert/strict";
import NodeTest from "node:test";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import {
  createRunBoundary,
  getRunEntries,
  serializeRunTranscript,
  TRANSCRIPT_MAX_BYTES,
} from "./src/transcript.ts";

const usage = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function entry(
  id: string,
  message: Extract<SessionEntry, { type: "message" }>["message"],
): SessionEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: new Date(0).toISOString(),
    message,
  };
}

NodeTest("run boundaries replace stale starts and settle exactly once", () => {
  const boundary = createRunBoundary();
  boundary.begin("before-run");
  boundary.begin("new-top-level-run");

  NodeAssert.deepEqual(boundary.settle(), {
    baselineLeafId: "new-top-level-run",
  });
  NodeAssert.equal(boundary.settle(), undefined);
});

NodeTest("run slicing starts after the before_agent_start leaf", () => {
  const entries = [
    entry("old", { role: "user", content: "old", timestamp: 0 }),
    entry("new", { role: "user", content: "new", timestamp: 1 }),
  ];
  NodeAssert.deepEqual(
    getRunEntries(entries, "old").map((item) => item.id),
    ["new"],
  );
  NodeAssert.deepEqual(getRunEntries(entries, "missing"), []);
});

NodeTest(
  "transcript omits thinking, images, and recap entries while redacting tool data",
  () => {
    const entries: SessionEntry[] = [
      entry("user", {
        role: "user",
        content: [
          { type: "text", text: "Update the client" },
          { type: "image", data: "base64-image-bytes", mimeType: "image/png" },
        ],
        timestamp: 0,
      }),
      entry("assistant", {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "hidden chain of thought" },
          {
            type: "toolCall",
            id: "call-1",
            name: "bash",
            arguments: {
              command:
                "curl -H 'Authorization: Bearer very-secret-token' https://example.test",
              apiKey: "sk-super-secret-value",
              payload: "x".repeat(10_000),
            },
          },
          { type: "text", text: "Updated the client." },
        ],
        api: "openai-codex-responses",
        provider: "openai-codex",
        model: "summary-model",
        usage,
        stopReason: "toolUse",
        timestamp: 1,
      }),
      entry("result", {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "bash",
        content: [{ type: "text", text: "token=another-secret\nfinished" }],
        isError: false,
        timestamp: 2,
      }),
      {
        type: "custom",
        id: "old-recap",
        parentId: "result",
        timestamp: new Date(0).toISOString(),
        customType: "summary-recap",
        data: { recap: "old recap" },
      },
    ];

    const transcript = serializeRunTranscript(entries);
    NodeAssert.match(transcript, /Update the client/);
    NodeAssert.match(transcript, /TOOL CALL bash/);
    NodeAssert.match(transcript, /Updated the client/);
    NodeAssert.doesNotMatch(transcript, /hidden chain of thought/);
    NodeAssert.doesNotMatch(transcript, /base64-image-bytes/);
    NodeAssert.doesNotMatch(transcript, /very-secret-token/);
    NodeAssert.doesNotMatch(transcript, /another-secret/);
    NodeAssert.doesNotMatch(transcript, /old recap/);
    NodeAssert.match(transcript, /\[REDACTED\]/);
    NodeAssert.match(transcript, /tool arguments capped/);
  },
);

NodeTest("transcript enforces per-result and total byte caps", () => {
  const entries = Array.from({ length: 20 }, (_, index) =>
    entry(`result-${index}`, {
      role: "toolResult",
      toolCallId: `call-${index}`,
      toolName: "bash",
      content: [{ type: "text", text: `${index}:${"x".repeat(10_000)}` }],
      isError: false,
      timestamp: index,
    }),
  );

  const transcript = serializeRunTranscript(entries);
  NodeAssert.ok(Buffer.byteLength(transcript, "utf8") <= TRANSCRIPT_MAX_BYTES);
  NodeAssert.match(transcript, /transcript capped/);
  NodeAssert.match(transcript, /tool result capped/);
});
