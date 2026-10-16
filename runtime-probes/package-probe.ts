import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  getCurrentSystemPrompt,
  getCurrentTools,
  type TranscriptContext,
  type FauxResponseFactory,
  type ToolCall,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerReceipts } from "./package-probe-receipts.ts";
import { Type } from "typebox";
import { Parse } from "typebox/value";

const requiredTools = [
  "bg_start",
  "bg_status",
  "bg_list",
  "bg_kill",
  "bash",
  "read",
  "edit",
  "write",
  "fetch_content",
  "get_search_content",
  "source_check",
  "web_search",
];

const terminalFixture = "dotfiles-native-background-completed";

const startedSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  event: Type.Literal("started"),
  id: Type.String(),
  pid: Type.Number(),
  status: Type.Literal("running"),
  outcome: Type.Optional(Type.Never()),
  settledAt: Type.Optional(Type.Never()),
  exitCode: Type.Optional(Type.Never()),
});

function callTool(name: string, args: ToolCall["arguments"]) {
  return fauxAssistantMessage(
    fauxToolCall(name, args, { id: `probe-${name}` }),
    { stopReason: "toolUse" },
  );
}

function toolResult(context: TranscriptContext, name: string) {
  const result = context.messages.find(
    (message) => message.role === "toolResult" && message.toolName === name,
  );

  if (!result || result.role !== "toolResult") return undefined;

  if (result.isError)
    throw new Error(`failed ${name}: ${JSON.stringify(result)}`);

  return result;
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function parentResponse(context: TranscriptContext, releasePath: string) {
  if (!toolResult(context, "package_probe"))
    return callTool("package_probe", { value: "probe-receipt" });
  const started = toolResult(context, "bg_start");

  if (!started) {
    const script =
      `const fs = require("node:fs");` +
      `const timer = setInterval(() => {` +
      `if (!fs.existsSync(${JSON.stringify(releasePath)})) return;` +
      `clearInterval(timer); console.log(${JSON.stringify(terminalFixture)});` +
      `}, 10);`;

    return callTool("bg_start", {
      command: `node -e ${shellQuote(script)}`,
      title: "native package fixture",
    });
  }

  const receipt = Parse(startedSchema, started.details);

  // The process cannot finish until the provider observes its admission receipt.
  NodeFS.writeFileSync(releasePath, "release", { mode: 0o600 });

  if (
    !context.messages.some(
      (message) =>
        message.role === "user" &&
        JSON.stringify(message.content).includes(terminalFixture) &&
        JSON.stringify(message.content).includes(
          `Background terminal ${receipt.id} `,
        ) &&
        JSON.stringify(message.content).includes("exited (exit 0)"),
    )
  )
    return fauxAssistantMessage("dotfiles-package-probe-waiting");

  return fauxAssistantMessage("dotfiles-package-probe-ok");
}

function checkResources(
  pi: ExtensionAPI,
  context: TranscriptContext,
  browserSkillName: string | undefined,
) {
  const resources = {
    systemPrompt: getCurrentSystemPrompt(context.messages),
    tools: getCurrentTools(context.messages),
  };

  if (
    !browserSkillName ||
    !resources.systemPrompt.includes(`<name>${browserSkillName}</name>`)
  )
    throw new Error("upstream agent-browser skill was not discovered");

  for (const name of [
    "swarm",
    "workflow-authoring",
    "browser-resilience",
    "technical-writing",
  ]) {
    if (
      resources.systemPrompt.includes(`<name>${name}</name>`) ||
      pi.getCommands().some((command) => command.name === `skill:${name}`)
    )
      throw new Error(`removed or extracted skill was discovered: ${name}`);
  }

  if (pi.getCommands().some((command) => command.name === "swarm"))
    throw new Error("obsolete swarm command was registered");

  const names = new Set(resources.tools.map((tool) => tool.name));

  if (
    pi
      .getAllTools()
      .some(
        (tool) =>
          tool.name.startsWith("swarm_") ||
          tool.name === "ask_user" ||
          tool.name === "delegate" ||
          tool.name === "workflow",
      )
  )
    throw new Error("removed package tool was registered");

  for (const name of requiredTools) {
    if (!names.has(name)) throw new Error(`missing required tool: ${name}`);
  }
}

function recordProviderRequest(context: TranscriptContext) {
  const path = process.env["DOTFILES_PI_PROBE_PROVIDER_EVENTS"];

  if (!path) return;
  NodeFS.appendFileSync(
    path,
    `${JSON.stringify({
      type: "provider_request",
      messages: context.messages.map(({ role, content }) => ({
        role,
        content,
      })),
      tools: getCurrentTools(context.messages).map((tool) => tool.name),
    })}\n`,
    { mode: 0o600 },
  );
}

export default function (pi: ExtensionAPI) {
  const releasePath = NodePath.join(
    process.env["TMPDIR"] ?? NodeOS.tmpdir(),
    `pi-package-probe-release-${process.pid}`,
  );

  let browserSkillName: string | undefined;
  pi.on("session_start", () => {
    if (process.env["DOTFILES_PI_PROBE_MISSING_TOOL"] === "1")
      pi.setActiveTools(
        pi.getActiveTools().filter((name) => name !== "web_search"),
      );
  });
  pi.on("session_shutdown", () => {
    NodeFS.rmSync(releasePath, { force: true });
  });
  pi.on("before_agent_start", (event) => {
    const expectedSkill = process.env["DOTFILES_PI_PROBE_BROWSER_SKILL"];
    browserSkillName = event.systemPromptOptions.skills?.find(
      (skill) =>
        !skill.disableModelInvocation &&
        expectedSkill !== undefined &&
        NodeFS.realpathSync(skill.filePath) ===
          NodeFS.realpathSync(expectedSkill),
    )?.name;
  });

  const faux = fauxProvider({
    provider: "dotfiles-package-probe",
    api: "dotfiles-package-probe",
    models: [
      {
        id: "probe",
        reasoning: false,
        input: ["text"],
        contextWindow: 4096,
        maxTokens: 1024,
      },
    ],
    tokenSize: { min: 1000, max: 1000 },
  });

  const respond: FauxResponseFactory = (context) => {
    faux.appendResponses([respond]);
    recordProviderRequest(context);
    checkResources(pi, context, browserSkillName);

    return parentResponse(context, releasePath);
  };

  faux.setResponses([respond]);
  pi.registerProvider(faux.provider);
  pi.registerTool({
    name: "package_probe",
    label: "Package integration probe",
    description: "Returns a synthetic package integration result.",
    parameters: Type.Object({ value: Type.Literal("probe-receipt") }),
    execute: async (_toolCallId, params) => ({
      content: [{ type: "text", text: params.value }],
      details: {},
    }),
  });
  registerReceipts(pi);
}
