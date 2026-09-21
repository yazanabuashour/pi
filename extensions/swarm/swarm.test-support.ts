import * as NodeAssert from "node:assert/strict";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionEvent,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Effect, Layer, ManagedRuntime } from "effect";
import { onTestFinished, vi } from "vitest";
import { spawnStubSession } from "./manager.test-support.ts";
import type { SpawnTask } from "./src/domain.ts";
import { SwarmExtensionSession } from "./src/extension-session.ts";
import { createSwarmTools } from "./src/extension-tools.ts";
import { SwarmManagerLive } from "./src/manager.ts";
import { SessionFactory } from "./src/session.ts";

type RootMessage = Parameters<ExtensionAPI["sendMessage"]>;
type Handler = (
  event: ExtensionEvent,
  ctx: ExtensionContext,
) => void | Promise<void>;
interface ToolInput {
  prompt?: string;
  name?: string;
  allow_spawn?: boolean;
  id?: string;
  ids?: readonly string[];
  to?: string;
  message?: string;
}

function injectedTools(tasks: SpawnTask[], title: string) {
  const tools = tasks.find((task) => task.title === title)?.customTools;
  NodeAssert.ok(tools, `Missing injected tools for ${title}`);
  return tools;
}

export async function harness(
  createSession: SessionFactory["Service"] = spawnStubSession,
) {
  const tasks: SpawnTask[] = [];
  const appendEntry = vi.fn<ExtensionAPI["appendEntry"]>();
  const messages: RootMessage[] = [];
  const sends: Array<{ title: string; text: string }> = [];
  let onResult = () => {};
  const resultReceived = new Promise<void>((resolve) => {
    onResult = resolve;
  });
  const handlers = new Map<string, Handler>();
  const pi: ExtensionAPI = Object.assign(Object.create(null), {
    on: (name: string, handler: Handler) => handlers.set(name, handler),
    appendEntry,
    sendMessage: (...args: RootMessage) => {
      messages.push(args);
      if (args[0].customType === "swarm-result") onResult();
    },
  });
  const runtime = ManagedRuntime.make(
    SwarmManagerLive.pipe(
      Layer.provide(
        Layer.succeed(SessionFactory, (task) =>
          Effect.gen(function* () {
            tasks.push(task);
            const child = yield* createSession(task);
            return {
              ...child,
              send: (text: string) =>
                Effect.suspend(() => {
                  sends.push({ title: task.title, text });
                  return child.send(text);
                }),
              steer: (text: string) =>
                Effect.suspend(() => {
                  sends.push({ title: task.title, text });
                  return child.steer(text);
                }),
            };
          }),
        ),
      ),
    ),
  );
  const context: ExtensionContext = Object.assign(Object.create(null), {
    cwd: process.cwd(),
    hasUI: false,
    isIdle: () => true,
    isProjectTrusted: () => false,
    sessionManager: { getSessionId: () => "swarm-test" },
  });
  // Keep real lifecycle and delivery; replace only the session factory's runtime.
  const session = new SwarmExtensionSession(pi);
  Object.assign(session, { runtime });
  async function emit(event: ExtensionEvent) {
    const handler = handlers.get(event.type);
    NodeAssert.ok(handler, `Missing ${event.type} handler`);
    await handler(event, context);
  }
  onTestFinished(() => emit({ type: "session_shutdown", reason: "quit" }));
  await emit({ type: "session_start", reason: "startup" });
  const manager = await session.getManager();
  const call = (
    tools: ToolDefinition[],
    name: string,
    params: ToolInput = {},
    onUpdate?: Parameters<ToolDefinition["execute"]>[3],
    signal?: AbortSignal,
  ) => {
    const tool = tools.find((candidate) => candidate.name === name);
    NodeAssert.ok(tool, `Missing ${name}`);
    return tool.execute("swarm-test", params, signal, onUpdate, context);
  };
  const spawn = async (
    tools: ToolDefinition[],
    name: string,
    allow_spawn = false,
  ) => {
    await call(tools, "swarm_spawn", { prompt: name, name, allow_spawn });
    const snapshot = manager.view.list().find((entry) => entry.title === name);
    NodeAssert.ok(snapshot);
    return snapshot;
  };
  return {
    session,
    emit,
    runtime,
    manager,
    root: createSwarmTools(session),
    context,
    appendEntry,
    messages,
    sends,
    resultReceived,
    call,
    spawn,
    toolsFor: (title: string) => injectedTools(tasks, title),
  };
}
