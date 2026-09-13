import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import NodeTest from "node:test";
import { workflowToolMetadata } from "./extension-contract.ts";

const skill = NodeFS.readFileSync(
  new URL("../../skills/workflow-authoring/SKILL.md", import.meta.url),
  "utf8",
);

NodeTest("lazy workflow metadata stays compact", () => {
  const definition = JSON.stringify(workflowToolMetadata);
  // Receipt: the compact definition is below 1 KiB; the former always-active
  // definition was 3,871 bytes before guidance moved into the skill.
  NodeAssert.ok(Buffer.byteLength(definition) <= 1024);
  NodeAssert.equal("promptSnippet" in workflowToolMetadata, false);
  NodeAssert.equal("promptGuidelines" in workflowToolMetadata, false);
});

NodeTest("workflow authoring skill is hidden from model discovery", () => {
  NodeAssert.match(skill, /^disable-model-invocation: true$/m);
});
