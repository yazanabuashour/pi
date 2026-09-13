import * as NodeAssert from "node:assert/strict";
import * as NodeProcess from "node:process";
import * as NodeTimersPromises from "node:timers/promises";
import {
  fauxAssistantMessage,
  InMemoryCredentialStore,
  InMemoryModelsStore,
} from "@earendil-works/pi-ai";
import * as Pi from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, it, vi } from "vitest";
import { CHILD_EXCLUDED_TOOL_NAMES } from "../shared/child-session.ts";
import { runAgent } from "./agent-run.ts";
import type { RunAgentOptions } from "./runner.ts";

const bindSdkExtensions = Pi.AgentSession.prototype.bindExtensions;
const disposeSdkSession = Pi.AgentSession.prototype.dispose;
const sessions = new Set<Pi.AgentSession>();

function receipt() {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.spyOn(Pi.SettingsManager, "create").mockImplementation(() =>
    Pi.SettingsManager.inMemory(),
  );
  vi.spyOn(Pi.DefaultResourceLoader.prototype, "reload").mockResolvedValue();
});

afterEach(() => {
  for (const session of sessions) disposeSdkSession.call(session);
  sessions.clear();
  vi.restoreAllMocks();
});

async function fixture() {
  const modelRuntime = await Pi.ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsStore: new InMemoryModelsStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const model = modelRuntime.getModel("anthropic", "claude-sonnet-4-5");
  NodeAssert.ok(model);
  const options: RunAgentOptions = {
    prompt: "fixture task",
    cwd: NodeProcess.cwd(),
    projectTrusted: false,
    model,
    modelRegistry: new Pi.ModelRegistry(modelRuntime),
  };
  const runtime = vi
    .spyOn(Pi.ModelRuntime, "create")
    .mockResolvedValue(modelRuntime);
  const prompt = vi
    .spyOn(Pi.AgentSession.prototype, "prompt")
    .mockResolvedValue();
  const bind = vi
    .spyOn(Pi.AgentSession.prototype, "bindExtensions")
    .mockImplementation(async function (this: Pi.AgentSession, handlers) {
      sessions.add(this);
      await bindSdkExtensions.call(this, handlers);
    });
  const dispose = vi
    .spyOn(Pi.AgentSession.prototype, "dispose")
    .mockImplementation(function (this: Pi.AgentSession) {
      sessions.add(this);
      disposeSdkSession.call(this);
    });
  return { options, model, modelRuntime, runtime, prompt, bind, dispose };
}

it("settles resource, factory, and extension setup failures and cleans acquired sessions", async () => {
  const f = await fixture();
  vi.mocked(Pi.DefaultResourceLoader.prototype.reload).mockRejectedValueOnce(
    new Error("resource loading failed"),
  );
  const resources = await runAgent(f.options);
  NodeAssert.equal(resources.ok, false);
  NodeAssert.equal(resources.aborted, false);
  NodeAssert.match(resources.error ?? "", /resource loading failed/);
  NodeAssert.equal(f.runtime.mock.calls.length, 0);

  f.runtime.mockRejectedValueOnce(new Error("SDK runtime creation failed"));
  const factory = await runAgent(f.options);
  NodeAssert.equal(factory.ok, false);
  NodeAssert.match(factory.error ?? "", /SDK runtime creation failed/);

  f.bind.mockRejectedValueOnce(new Error("extension setup failed"));
  const setup = await runAgent(f.options);
  NodeAssert.equal(setup.ok, false);
  NodeAssert.match(setup.error ?? "", /extension setup failed/);
  NodeAssert.equal(f.prompt.mock.calls.length, 0);
  NodeAssert.equal(f.dispose.mock.calls.length, 1);
});

it("pre-aborted runs acquire nothing and retain the cancellation reason", async () => {
  const f = await fixture();
  const outcome = await runAgent({
    ...f.options,
    signal: AbortSignal.abort(new Error("cancel before acquisition")),
  });
  NodeAssert.equal(outcome.aborted, true);
  NodeAssert.match(outcome.error ?? "", /cancel before acquisition/);
  NodeAssert.equal(vi.mocked(Pi.SettingsManager.create).mock.calls.length, 0);
  NodeAssert.equal(f.runtime.mock.calls.length, 0);
});

it("owns ignored acquisition through late creation or binding before disposing once", async () => {
  const f = await fixture();
  for (const stage of ["resources", "creation", "binding"]) {
    const entered = receipt();
    const released = receipt();
    const shutdown = vi.fn(async () => undefined);
    if (stage === "resources") {
      vi.mocked(
        Pi.DefaultResourceLoader.prototype.reload,
      ).mockImplementationOnce(async () => {
        entered.resolve();
        await released.promise;
      });
    } else if (stage === "creation") {
      f.runtime.mockImplementationOnce(async () => {
        entered.resolve();
        await released.promise;
        return f.modelRuntime;
      });
    } else {
      f.bind.mockImplementationOnce(
        async function (this: Pi.AgentSession, handlers) {
          sessions.add(this);
          entered.resolve();
          await released.promise;
          await bindSdkExtensions.call(this, handlers);
          vi.spyOn(this.extensionRunner, "hasHandlers").mockReturnValue(true);
          vi.spyOn(this.extensionRunner, "emit").mockImplementation(shutdown);
        },
      );
    }
    const beforeDispose = f.dispose.mock.calls.length;
    const beforeRuntime = f.runtime.mock.calls.length;
    const beforeBind = f.bind.mock.calls.length;
    const controller = new AbortController();
    let completed = false;
    const running = runAgent({ ...f.options, signal: controller.signal }).then(
      (result) => {
        completed = true;
        return result;
      },
    );
    await entered.promise;
    controller.abort(new Error(`cancel ${stage}`));
    await NodeTimersPromises.setImmediate();
    NodeAssert.equal(completed, false, stage);
    NodeAssert.equal(f.dispose.mock.calls.length, beforeDispose);
    released.resolve();
    const outcome = await running;
    NodeAssert.equal(outcome.aborted, true);
    NodeAssert.equal(outcome.error, `cancel ${stage}`);
    NodeAssert.equal(f.prompt.mock.calls.length, 0);
    NodeAssert.equal(
      f.dispose.mock.calls.length - beforeDispose,
      stage === "resources" ? 0 : 1,
    );
    if (stage === "resources")
      NodeAssert.equal(f.runtime.mock.calls.length, beforeRuntime);
    if (stage === "creation")
      NodeAssert.equal(f.bind.mock.calls.length, beforeBind);
    if (stage === "binding") NodeAssert.equal(shutdown.mock.calls.length, 1);
  }
});

it("preserves inherited model, tools, transcript, and the terminating structured result", async () => {
  const f = await fixture();
  f.prompt.mockImplementationOnce(async function (this: Pi.AgentSession) {
    NodeAssert.equal(this.model, f.model);
    NodeAssert.equal(this.thinkingLevel, "high");
    for (const excluded of CHILD_EXCLUDED_TOOL_NAMES)
      NodeAssert.equal(this.getActiveToolNames().includes(excluded), false);
    NodeAssert.ok(this.getActiveToolNames().includes("read"));
    const tool = this.agent.state.tools.find(
      (candidate) => candidate.name === "structured_output",
    );
    NodeAssert.ok(tool);
    const recorded = await tool.execute("structured-call", { answer: 42 });
    NodeAssert.equal(recorded.terminate, true);
    this.agent.state.messages = [
      {
        ...fauxAssistantMessage("completed"),
        model: f.model.id,
        provider: f.model.provider,
      },
    ];
  });
  const result = await runAgent({
    ...f.options,
    thinkingLevel: "high",
    schema: { type: "object", properties: { answer: { type: "number" } } },
  });
  NodeAssert.equal(result.ok, true);
  NodeAssert.equal(JSON.stringify(result.structured), '{"answer":42}');
  NodeAssert.equal(result.output, "completed");
  NodeAssert.equal(result.transcript.length, 1);
  NodeAssert.equal(f.dispose.mock.calls.length, 1);
});
