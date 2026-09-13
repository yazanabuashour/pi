import * as NodeAssert from "node:assert/strict";
import NodeTest from "node:test";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ModelRegistry,
} from "@earendil-works/pi-coding-agent";
import { Effect } from "effect";
import { Value } from "typebox/value";
import type { AgentSnapshot, SpawnTask } from "./src/domain.ts";
import { registerSwarmCommands } from "./src/extension-commands.ts";
import { registerSwarmTools } from "./src/extension-tools.ts";
import type { SwarmExtensionSession } from "./src/extension-session.ts";

type CommandOptions = Parameters<ExtensionAPI["registerCommand"]>[1];
type Tool = Parameters<ExtensionAPI["registerTool"]>[0];

function snapshotFor(task: SpawnTask): AgentSnapshot {
  return {
    id: `${task.origin}-1`,
    parentId: "root",
    canSpawn: false,
    origin: task.origin ?? "model",
    title: task.title,
    prompt: task.prompt,
    cwd: task.cwd,
    generation: 1,
    status: "running",
    createdAt: Date.now(),
    meta: {},
    usage: {},
    transcript: [],
    liveTools: [],
    queued: [],
    finalText: "",
    turns: 0,
  };
}

NodeTest(
  "only btw and swarm commands remain; commands and tools inherit the parent model and effort",
  async () => {
    const commands = new Map<string, CommandOptions>();
    const tools = new Map<string, Tool>();
    const api: ExtensionAPI = Object.assign(Object.create(null), {
      getThinkingLevel: () => "high",
      registerCommand: (name: string, options: CommandOptions) =>
        commands.set(name, options),
      registerTool: (tool: Tool) => tools.set(tool.name, tool),
    });

    let spawnedTask: SpawnTask | undefined;
    let snapshot: AgentSnapshot | undefined;
    let takeoverOpened = false;
    let closeOnSpawn = false;
    let closing = false;
    const manager = {
      spawn: (task: SpawnTask) =>
        Effect.sync(() => {
          spawnedTask = task;
          snapshot = snapshotFor(task);
          if (closeOnSpawn) closing = true;
          return snapshot;
        }),
      view: {
        get: (id: string) => (snapshot?.id === id ? snapshot : undefined),
      },
    };
    const session: SwarmExtensionSession = Object.assign(Object.create(null), {
      identity: "test-runtime",
      isCurrent: (runtimeId: string) =>
        !closing && runtimeId === "test-runtime",
      assertCurrent: () => undefined,
      getManager: async () => manager,
      getRuntime: () => ({ runPromiseExit: Effect.runPromiseExit }),
      details: (snapshot: AgentSnapshot) => snapshot,
    });
    // SAFETY: The command passes the registry through opaquely; this test never calls it.
    const modelRegistry = Object.create(null) as ModelRegistry;
    const context: ExtensionCommandContext = Object.assign(
      Object.create(null),
      {
        mode: "tui",
        hasUI: true,
        cwd: process.cwd(),
        model: { provider: "openai-codex", id: "parent-model" },
        modelRegistry,
        thinkingLevel: "high",
        isProjectTrusted: () => true,
        ui: {
          custom: async () => {
            takeoverOpened = true;
            return null;
          },
          input: async () => undefined,
          notify: () => undefined,
        },
      },
    );

    registerSwarmCommands(api, session);
    NodeAssert.deepEqual([...commands.keys()].sort(), ["btw", "swarm"]);
    const btw = commands.get("btw");
    NodeAssert.ok(btw);
    await btw.handler("  explain the intended changes  ", context);

    NodeAssert.equal(spawnedTask?.origin, "btw");
    NodeAssert.equal(spawnedTask?.prompt, "explain the intended changes");
    NodeAssert.equal(spawnedTask?.parent.inheritedModel, context.model);
    NodeAssert.equal(spawnedTask?.parent.inheritedThinkingLevel, "high");
    NodeAssert.equal(spawnedTask?.reasoningEffort, undefined);
    NodeAssert.ok(spawnedTask && !("model" in spawnedTask));
    NodeAssert.equal(takeoverOpened, true);

    registerSwarmTools(api, session);
    const spawn = tools.get("swarm_spawn");
    NodeAssert.ok(spawn);
    const params = { prompt: "Inspect the changes", name: "inspection" };
    NodeAssert.ok(Value.Check(spawn.parameters, params));
    for (const field of ["model", "provider", "role", "harness"]) {
      NodeAssert.equal(
        Value.Check(spawn.parameters, { ...params, [field]: "override" }),
        false,
      );
    }
    for (const reasoning_effort of [undefined, "off"] as const) {
      await spawn.execute(
        "test-spawn",
        { ...params, reasoning_effort },
        undefined,
        undefined,
        context,
      );
      NodeAssert.equal(spawnedTask?.parent.inheritedModel, context.model);
      NodeAssert.equal(spawnedTask?.parent.inheritedThinkingLevel, "high");
      NodeAssert.equal(spawnedTask?.reasoningEffort, reasoning_effort);
      NodeAssert.ok(spawnedTask && !("model" in spawnedTask));
    }

    closeOnSpawn = true;
    takeoverOpened = false;
    await btw.handler("shutdown during spawn", context);
    NodeAssert.equal(takeoverOpened, false);
  },
);
