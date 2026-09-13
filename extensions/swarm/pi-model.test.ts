import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import NodeTest from "node:test";
import {
  InMemoryCredentialStore,
  InMemoryModelsStore,
  type Api,
  type Model,
} from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

const parentModel: Model<Api> = {
  provider: "inheritance-fixture",
  id: "unlisted-parent",
  name: "Unlisted parent fixture",
  api: "openai-responses",
  baseUrl: "https://model.invalid/v1",
  reasoning: true,
  thinkingLevelMap: { xhigh: "extra-high", max: "maximum" },
  input: ["text", "image"],
  contextWindow: 200_000,
  maxTokens: 16_384,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  compat: { supportsToolSearch: true },
};

NodeTest(
  "an unlisted inherited Pi model prevents SDK settings fallback",
  async (t) => {
    const directory = await NodeFSP.mkdtemp(
      NodePath.join(NodeOS.tmpdir(), "pi-model-inheritance-"),
    );
    t.after(() => NodeFSP.rm(directory, { recursive: true, force: true }));
    const modelRuntime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsStore: new InMemoryModelsStore(),
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
    const registry = new ModelRegistry(modelRuntime);
    registry.registerProvider(parentModel.provider, {
      api: "openai-responses",
      baseUrl: parentModel.baseUrl,
      apiKey: "unused-fixture-key",
      models: [{ ...parentModel, id: "settings-default" }],
    });
    NodeAssert.equal(
      registry.find(parentModel.provider, parentModel.id),
      undefined,
    );
    const settingsManager = SettingsManager.inMemory({
      defaultProvider: parentModel.provider,
      defaultModel: "settings-default",
    });
    const resourceLoader = new DefaultResourceLoader({
      cwd: directory,
      agentDir: directory,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });
    await resourceLoader.reload();

    // Construct sessions only. No prompt, provider request, or persisted session.
    for (const thinkingLevel of ["off", "xhigh"] as const) {
      const options: Parameters<typeof createAgentSession>[0] = {
        cwd: directory,
        agentDir: directory,
        modelRuntime,
        settingsManager,
        resourceLoader,
        sessionManager: SessionManager.inMemory(directory),
        noTools: "all",
        model: parentModel,
        thinkingLevel,
      };
      const { session } = await createAgentSession(options);
      try {
        NodeAssert.equal(session.model, parentModel);
        NodeAssert.equal(session.thinkingLevel, thinkingLevel);
      } finally {
        session.dispose();
      }
    }
  },
);
