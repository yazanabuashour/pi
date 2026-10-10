import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import type { DelegateInfo } from "./domain.ts";
import type { StartOptions } from "./manager.ts";
import { DELEGATE_PARAMETER_DESCRIPTIONS } from "./prompt.ts";

export const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

/** Children cannot delegate further or block on a user they cannot reach. */
const CHILD_EXCLUDED_TOOLS = ["delegate", "ask_user"];

const TOOL_NAME = /^[\w][\w-]*$/;

export const delegateParameters = Type.Object({
  prompt: Type.String({ description: DELEGATE_PARAMETER_DESCRIPTIONS.prompt }),
  title: Type.String({ description: DELEGATE_PARAMETER_DESCRIPTIONS.title }),
  model: Type.Optional(
    Type.String({ description: DELEGATE_PARAMETER_DESCRIPTIONS.model }),
  ),
  thinking: Type.Optional(
    StringEnum(THINKING_LEVELS, {
      description: DELEGATE_PARAMETER_DESCRIPTIONS.thinking,
    }),
  ),
  tools: Type.Optional(
    Type.Array(Type.String(), {
      description: DELEGATE_PARAMETER_DESCRIPTIONS.tools,
    }),
  ),
  working_dir: Type.Optional(
    Type.String({ description: DELEGATE_PARAMETER_DESCRIPTIONS.workingDir }),
  ),
});

export type DelegateParams = Static<typeof delegateParameters>;

export interface PiInvocation {
  readonly file: string;
  readonly args: ReadonlyArray<string>;
}

export type DelegateContext = Pick<
  ExtensionContext,
  "cwd" | "isProjectTrusted" | "model" | "modelRegistry" | "thinkingLevel"
>;

/** Run the same Pi build as the parent, including compiled native binaries. */
export function currentPiInvocation(
  execPath = process.execPath,
  script: string | undefined = process.argv[1],
): PiInvocation {
  const runtime = NodePath.basename(execPath).toLowerCase();

  if (!/^(node|bun)(\.exe)?$/.test(runtime))
    return { file: execPath, args: [] };

  if (script && !script.startsWith("/$bunfs/") && NodeFS.existsSync(script)) {
    return { file: execPath, args: [script] };
  }

  return { file: "pi", args: [] };
}

function modelName(model: { provider: string; id: string }) {
  return `${model.provider}/${model.id}`;
}

function resolveModel(spec: string | undefined, context: DelegateContext) {
  if (spec === undefined) {
    if (!context.model)
      throw new Error("This session has no model; pass model explicitly.");

    return modelName(context.model);
  }

  const slash = spec.indexOf("/");

  const model =
    slash > 0
      ? context.modelRegistry.find(spec.slice(0, slash), spec.slice(slash + 1))
      : undefined;

  if (model && context.modelRegistry.hasConfiguredAuth(model))
    return modelName(model);
  const available = context.modelRegistry.getAvailable().map(modelName);
  throw new Error(
    `Model "${spec}" is not available with configured credentials. Available: ${available.join(", ") || "none"}.`,
  );
}

function validateTools(tools: ReadonlyArray<string> | undefined) {
  if (tools === undefined) return undefined;

  if (tools.length === 0)
    throw new Error("tools must name at least one tool, or be omitted.");

  for (const tool of tools) {
    if (!TOOL_NAME.test(tool)) throw new Error(`Invalid tool name: '${tool}'.`);

    if (CHILD_EXCLUDED_TOOLS.includes(tool))
      throw new Error(`'${tool}' is never available to delegated sessions.`);
  }

  return [...new Set(tools)];
}

function childEnvironment(env: NodeJS.ProcessEnv) {
  // Automation receipts belong to one session, not its independent children.
  return Object.fromEntries(
    Object.entries(env).filter(([name]) => !name.startsWith("PI_AUTOMATION_")),
  );
}

/** A same-directory child keeps the parent's live, possibly one-time trust decision. */
function trustArgs(cwd: string, context: DelegateContext) {
  if (cwd !== NodePath.resolve(context.cwd)) return [];

  return [context.isProjectTrusted() ? "--approve" : "--no-approve"];
}

/** Translate a delegate call into a direct `pi --print` launch. */
export function buildDelegateLaunch(
  params: DelegateParams,
  context: DelegateContext,
  options: {
    readonly pi?: PiInvocation;
    readonly env?: NodeJS.ProcessEnv;
    readonly sessionId?: string;
  } = {},
): StartOptions {
  const prompt = params.prompt.trim();

  if (!prompt) throw new Error("prompt must not be empty.");
  const cwd = NodePath.resolve(context.cwd, params.working_dir ?? ".");

  if (!NodeFS.existsSync(cwd) || !NodeFS.statSync(cwd).isDirectory()) {
    throw new Error(`working_dir is not a directory: ${cwd}`);
  }

  const title =
    params.title.replace(/\s+/g, " ").trim().slice(0, 80) || "delegate";

  const model = resolveModel(params.model, context);
  const thinking = params.thinking ?? context.thinkingLevel;
  const tools = validateTools(params.tools);
  const sessionId = options.sessionId ?? NodeCrypto.randomUUID();
  const pi = options.pi ?? currentPiInvocation();

  // --tools alone leaves MCP tools callable; an explicit allowlist must not.
  const excluded =
    tools && !tools.some((name) => name.startsWith("mcp__"))
      ? [...CHILD_EXCLUDED_TOOLS, "mcp__*"]
      : CHILD_EXCLUDED_TOOLS;

  const piArgs = [
    "--print",
    "--model",
    model,
    ...(thinking ? ["--thinking", thinking] : []),
    "--session-id",
    sessionId,
    "--name",
    `delegate: ${title}`,
    ...trustArgs(cwd, context),
    ...(tools ? ["--tools", tools.join(",")] : []),
    "--exclude-tools",
    excluded.join(","),
    // A leading @ would make Pi read the prompt as a file path.
    `Task: ${prompt}`,
  ];

  let delegate: DelegateInfo = { model, sessionId };

  if (thinking) delegate = { ...delegate, thinking };

  if (tools) delegate = { ...delegate, tools };

  return {
    command: `pi ${piArgs.slice(0, -1).join(" ")} <prompt: ${prompt.length} chars>`,
    title,
    cwd,
    argv: { file: pi.file, args: [...pi.args, ...piArgs] },
    env: childEnvironment(options.env ?? process.env),
    delegate,
  };
}
