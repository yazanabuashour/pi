import * as NodeFS from "node:fs";

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
import { Check, Parse } from "typebox/value";

const requiredTools = [
  "ask_user",
  "bg_start",
  "bg_status",
  "bg_list",
  "bg_kill",
  "delegate",
  "bash",
  "read",
  "edit",
  "write",
  "fetch_content",
  "get_search_content",
  "source_check",
  "web_search",
];

const childFixture = "dotfiles-native-delegate-completed";

const childPrompt = "Return the synthetic native delegate fixture.";

const helperPrompt = "Return the synthetic native workflow fixture.";

const invalidHelperPrompt = "Return an invalid synthetic workflow fixture.";

const failedHelperPrompt = "Fail the synthetic native workflow fixture.";

const childPromptSchema = Type.Union([
  Type.Literal(`Task: ${childPrompt}`),
  Type.Tuple([
    Type.Object({
      type: Type.Literal("text"),
      text: Type.Literal(`Task: ${childPrompt}`),
    }),
  ]),
]);

const delegateSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  event: Type.Literal("started"),
  id: Type.String(),
  pid: Type.Number(),
  delegate: Type.Object({
    model: Type.Literal("dotfiles-package-probe/probe"),
    sessionId: Type.String(),
  }),
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

function parentResponse(context: TranscriptContext) {
  if (!toolResult(context, "package_probe"))
    return callTool("package_probe", { value: "probe-receipt" });
  const delegated = toolResult(context, "delegate");

  if (!delegated)
    return callTool("delegate", {
      prompt: childPrompt,
      title: "native package fixture",
    });

  const receipt = Parse(delegateSchema, delegated.details);

  if (
    !context.messages.some(
      (message) =>
        message.role === "user" &&
        JSON.stringify(message.content).includes(childFixture) &&
        JSON.stringify(message.content).includes(receipt.delegate.sessionId),
    )
  )
    return fauxAssistantMessage("dotfiles-package-probe-waiting");

  return fauxAssistantMessage("dotfiles-package-probe-ok");
}

function checkResources(
  pi: ExtensionAPI,
  context: TranscriptContext,
  browserSkillName: string | undefined,
  child: boolean,
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

  if (resources.systemPrompt.includes("<name>swarm</name>"))
    throw new Error("obsolete swarm skill was discovered");

  for (const name of ["workflow-authoring", "technical-writing"]) {
    if (resources.systemPrompt.includes(`<name>${name}</name>`))
      throw new Error(`manual skill is advertised to the model: ${name}`);
  }

  if (
    !child &&
    !pi
      .getCommands()
      .some((command) => command.name === "skill:workflow-authoring")
  )
    throw new Error("manual workflow skill command is missing");

  if (pi.getCommands().some((command) => command.name === "swarm"))
    throw new Error("obsolete swarm command was registered");

  const names = new Set(resources.tools.map((tool) => tool.name));

  if (
    [...names].some((name) => name.startsWith("swarm_") || name === "workflow")
  )
    throw new Error("obsolete swarm or workflow tool was registered");

  const parentOnly = new Set(["ask_user", "delegate"]);

  for (const name of requiredTools) {
    if (child && parentOnly.has(name)) {
      if (names.has(name))
        throw new Error(`child received parent tool: ${name}`);
    } else if (!names.has(name))
      throw new Error(`missing required tool: ${name}`);
  }

  if (
    child &&
    Object.keys(process.env).some((name) => name.startsWith("PI_AUTOMATION_"))
  )
    throw new Error("delegated child inherited automation telemetry variables");
}

function helperResponse(context: TranscriptContext, prompts: string[]) {
  if (prompts.some((prompt) => prompt.includes(`Task: ${failedHelperPrompt}`)))
    throw new Error("synthetic workflow provider failure");

  const structured = context.messages.find(
    (message) =>
      message.role === "toolResult" && message.toolName === "structured_output",
  );

  if (structured)
    return fauxAssistantMessage("dotfiles-native-workflow-completed");

  return callTool("structured_output", {
    result: prompts.some((prompt) =>
      prompt.includes(`Task: ${invalidHelperPrompt}`),
    )
      ? 42
      : "dotfiles-native-workflow-completed",
  });
}

function recordProviderRequest(
  context: TranscriptContext,
  child: boolean,
  helper: boolean,
) {
  const path = process.env["DOTFILES_PI_PROBE_PROVIDER_EVENTS"];

  if (!path) return;
  NodeFS.appendFileSync(
    path,
    `${JSON.stringify({
      type: "provider_request",
      child,
      helper,
      tmpdir: process.env["TMPDIR"],
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
  let browserSkillName: string | undefined;
  pi.on("session_start", () => {
    if (process.env["DOTFILES_PI_PROBE_MISSING_TOOL"] === "1")
      pi.setActiveTools(
        pi.getActiveTools().filter((name) => name !== "web_search"),
      );
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

    const prompts = context.messages
      .filter((message) => message.role === "user")
      .map((message) => JSON.stringify(message.content));

    const helper = prompts.some((prompt) =>
      [helperPrompt, invalidHelperPrompt, failedHelperPrompt].some((task) =>
        prompt.includes(`Task: ${task}`),
      ),
    );

    const child =
      helper ||
      context.messages.some(
        (message) =>
          message.role === "user" && Check(childPromptSchema, message.content),
      );

    recordProviderRequest(context, child, helper);
    checkResources(pi, context, browserSkillName, child);

    if (helper) return helperResponse(context, prompts);

    return child ? fauxAssistantMessage(childFixture) : parentResponse(context);
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
