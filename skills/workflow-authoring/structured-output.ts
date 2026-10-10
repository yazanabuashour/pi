import * as NodeFS from "node:fs";
import * as NodeProcess from "node:process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Value } from "typebox/value";

const schemaObject = Type.Record(Type.String(), Type.Unknown());

/** Pi checks tool arguments against the caller's schema before execute runs. */
export default function structuredOutput(pi: ExtensionAPI) {
  const schemaPath = NodeProcess.env["PI_STRUCTURED_OUTPUT_SCHEMA"];

  if (!schemaPath) return;
  const schema: unknown = JSON.parse(NodeFS.readFileSync(schemaPath, "utf8"));

  if (!Value.Check(schemaObject, schema))
    throw new Error(
      "PI_STRUCTURED_OUTPUT_SCHEMA must name a JSON Schema object.",
    );

  pi.registerTool({
    name: "structured_output",
    label: "Structured Output",
    description:
      "Return your final result as structured data matching the required schema. Call this exactly once, as your last action.",
    promptSnippet: "Return the final result as schema-checked structured data.",
    promptGuidelines: [
      "When the task is complete, call structured_output exactly once as your final action.",
    ],
    parameters: Type.Unsafe(schema),
    async execute(_toolCallId, params) {
      return {
        content: [{ type: "text", text: "Recorded structured result." }],
        details: params,
        terminate: true,
      };
    },
  });
}
