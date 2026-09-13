import * as NodeFS from "node:fs";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type Context,
  type FauxResponseFactory,
  type ToolCall,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerReceipts } from "./package-probe-receipts.ts";
import { Type } from "typebox";
import { Check } from "typebox/value";

const requiredTools = [
  "ask_user",
  "bg_start",
  "bg_list",
  "swarm_spawn",
  "swarm_send",
  "swarm_wait",
  "swarm_cancel",
  "swarm_check",
  "swarm_list",
  "workflow",
  "bash",
  "read",
  "edit",
  "write",
  "fetch_content",
  "get_search_content",
  "source_check",
  "web_search",
];

const workerFixture = "dotfiles-native-worker-completed";
const childFixture = "dotfiles-native-swarm-completed";
const childPrompt = "Return the synthetic native swarm fixture.";
const progressFixture = "dotfiles-native-swarm-progress";
const childPromptSchema = Type.Union([
  Type.Literal(childPrompt),
  Type.Tuple([
    Type.Object({
      type: Type.Literal("text"),
      text: Type.Literal(childPrompt),
    }),
  ]),
]);
const workflowSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  background: Type.Literal(false),
  status: Type.Literal("completed"),
  result: Type.Literal(workerFixture),
  finishedAt: Type.Number(),
});
const spawnSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  event: Type.Literal("started"),
  id: Type.String(),
  harness: Type.Literal("pi"),
  model: Type.Literal("dotfiles-package-probe/probe"),
});
const waitSchema = Type.Object({
  results: Type.Tuple([
    Type.Object({
      schemaVersion: Type.Literal(1),
      event: Type.Literal("settled"),
      id: Type.String(),
      harness: Type.Literal("pi"),
      model: Type.Literal("dotfiles-package-probe/probe"),
      status: Type.Literal("done"),
      outcome: Type.Literal("completed"),
      settledAt: Type.Number(),
    }),
  ]),
});

function callTool(name: string, args: ToolCall["arguments"]) {
  return fauxAssistantMessage(
    fauxToolCall(name, args, { id: `probe-${name}` }),
    { stopReason: "toolUse" },
  );
}

function toolResult(context: Context, name: string) {
  const result = context.messages.find(
    (message) => message.role === "toolResult" && message.toolName === name,
  );
  if (!result || result.role !== "toolResult") return undefined;
  if (result.isError)
    throw new Error(`failed ${name}: ${JSON.stringify(result)}`);
  return result;
}

function parentResponse(context: Context) {
  const probe = toolResult(context, "package_probe");
  if (!probe) return callTool("package_probe", { value: "probe-receipt" });
  const workflow = toolResult(context, "workflow");
  if (!workflow)
    return callTool("workflow", {
      script: `return ${JSON.stringify(workerFixture)};`,
      background: false,
    });
  if (!Check(workflowSchema, workflow.details))
    throw new Error("workflow did not return its completed worker fixture");
  const spawn = toolResult(context, "swarm_spawn");
  if (!spawn)
    return callTool("swarm_spawn", {
      prompt: childPrompt,
      name: "native-package-fixture",
    });
  if (!Check(spawnSchema, spawn.details))
    throw new Error("invalid swarm spawn receipt");
  const waited = toolResult(context, "swarm_wait");
  if (!waited) return callTool("swarm_wait", { ids: [spawn.details.id] });
  if (
    !Check(waitSchema, waited.details) ||
    waited.details.results[0].id !== spawn.details.id ||
    !waited.content.some(
      (part) =>
        part.type === "text" && part.text.endsWith(`\n\n${childFixture}`),
    )
  )
    throw new Error(
      "swarm agent did not complete with its fixture before shutdown",
    );
  if (
    !context.messages.some((message) =>
      JSON.stringify(message.content).includes(progressFixture),
    )
  )
    throw new Error(
      "Swarm progress was not delivered to the root model context.",
    );
  return fauxAssistantMessage("dotfiles-package-probe-ok");
}

function checkResources(
  pi: ExtensionAPI,
  context: Context,
  browserSkillName: string | undefined,
  child: boolean,
) {
  if (
    !browserSkillName ||
    !context.systemPrompt?.includes(`<name>${browserSkillName}</name>`)
  )
    throw new Error("upstream agent-browser skill was not discovered");
  if (!context.systemPrompt?.includes("<name>swarm</name>"))
    throw new Error("swarm skill was not discovered");
  for (const name of ["workflow-authoring", "technical-writing"]) {
    if (context.systemPrompt?.includes(`<name>${name}</name>`))
      throw new Error(`manual skill is advertised to the model: ${name}`);
  }
  if (
    !child &&
    !pi
      .getCommands()
      .some((command) => command.name === "skill:workflow-authoring")
  )
    throw new Error("manual workflow skill command is missing");
  if (!child && !pi.getCommands().some((command) => command.name === "swarm"))
    throw new Error("swarm management command is missing");
  const spawn = context.tools?.find((tool) => tool.name === "swarm_spawn");
  if (spawn) {
    if (
      !Check(
        Type.Object({ properties: Type.Record(Type.String(), Type.Unknown()) }),
        spawn.parameters,
      )
    )
      throw new Error("swarm_spawn has no object parameter schema");
    for (const field of ["harness", "model", "provider"]) {
      if (Object.hasOwn(spawn.parameters.properties, field))
        throw new Error(`swarm_spawn still advertises ${field}`);
    }
  }
  const names = new Set(context.tools?.map((tool) => tool.name));
  const parentOnly = new Set([
    "ask_user",
    "swarm_spawn",
    "swarm_wait",
    "swarm_cancel",
    "workflow",
  ]);
  for (const name of requiredTools) {
    if (child && parentOnly.has(name)) {
      if (names.has(name))
        throw new Error(`child received parent tool: ${name}`);
    } else if (!names.has(name))
      throw new Error(`missing required tool: ${name}`);
  }
}

export default function (pi: ExtensionAPI) {
  let browserSkillName: string | undefined;
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
    const child = context.messages.some(
      (message) =>
        message.role === "user" && Check(childPromptSchema, message.content),
    );
    checkResources(pi, context, browserSkillName, child);
    if (!child) return parentResponse(context);
    if (!toolResult(context, "swarm_send"))
      return callTool("swarm_send", { to: "root", message: progressFixture });
    return fauxAssistantMessage(childFixture);
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
