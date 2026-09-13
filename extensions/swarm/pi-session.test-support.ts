import * as NodeAssert from "node:assert/strict";
import {
  InMemoryCredentialStore,
  InMemoryModelsStore,
} from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { vi } from "vitest";
import type { SendError, SpawnTask } from "./src/domain.ts";
import { PiPromptLifecycle, type PromptSession } from "./src/session.ts";

export function receipt<T = void>() {
  let resolve: ((value: T) => void) | undefined;
  let reject: ((cause: unknown) => void) | undefined;
  const promise = new Promise<T>((done, failed) => {
    resolve = done;
    reject = failed;
  });
  NodeAssert.ok(resolve);
  NodeAssert.ok(reject);
  return { promise, resolve, reject };
}

export function fixture() {
  const messages: PromptSession["messages"] = [];
  const session = {
    prompt: vi.fn<PromptSession["prompt"]>(),
    abort: vi.fn(async () => {}),
    steer: vi.fn(async (_text: string) => {}),
    clearQueue: vi.fn(() => ({ steering: [], followUp: [] })),
    isStreaming: false,
    waitForIdle: vi.fn(async () => {
      session.isStreaming = false;
    }),
    messages,
    agent: { hasQueuedMessages: vi.fn(() => false) },
    sendCustomMessage: vi.fn<PromptSession["sendCustomMessage"]>(),
  };
  const finished = receipt();
  const hooks = {
    started: vi.fn(),
    settled: vi.fn((_error?: SendError) => finished.resolve()),
    interrupted: vi.fn(),
  };
  const lifecycle = new PiPromptLifecycle(session, hooks);
  return { session, hooks, lifecycle, finished };
}

/** An offline SDK session with controllable prompt admission and observable disposal. */
export async function factoryFixture() {
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsStore: new InMemoryModelsStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const model = modelRuntime.getModel("anthropic", "claude-sonnet-4-5");
  NodeAssert.ok(model);
  const task: SpawnTask = {
    prompt: "not dispatched by the factory",
    title: "factory fixture",
    cwd: process.cwd(),
    parent: {
      projectTrusted: false,
      modelRegistry: new ModelRegistry(modelRuntime),
      inheritedModel: model,
    },
  };
  const settingsManager = SettingsManager.inMemory();
  const loader = new DefaultResourceLoader({
    cwd: task.cwd,
    agentDir: task.cwd,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await loader.reload();
  const { session } = await createAgentSession({
    modelRuntime,
    resourceLoader: loader,
    settingsManager,
    sessionManager: SessionManager.inMemory(),
    noTools: "all",
  });
  session.prompt = vi.fn<AgentSession["prompt"]>();
  session.bindExtensions = vi.fn(session.bindExtensions.bind(session));
  session.dispose = vi.fn(session.dispose.bind(session));
  return { task, session };
}
