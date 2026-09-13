import * as NodeAssert from "node:assert/strict";
import NodeTest from "node:test";
// oxlint-disable-next-line project/namespace-node-imports -- Mock the mutable built-in export, not the immutable ESM namespace.
import NodeFS from "node:fs";
import * as NodeModule from "node:module";
import {
  SessionManager,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  fauxAssistantMessage,
  fauxProvider,
  type FauxResponseStep,
} from "@earendil-works/pi-ai/providers/faux";
import summariesExtension from "./index.ts";
import type { RecapEntryData } from "./src/ui.ts";
import { PRIVATE_CONFIG_PATH } from "./src/config.ts";

function mockSummaryConfig(
  t: NodeTest.TestContext,
  read: () => string = () => {
    throw Object.assign(new Error("missing"), { code: "ENOENT" });
  },
) {
  const originalRead = NodeFS.readFileSync;
  const mocked = t.mock.method(
    NodeFS,
    "readFileSync",
    (...args: Parameters<typeof NodeFS.readFileSync>) =>
      args[0] === PRIVATE_CONFIG_PATH ? read() : originalRead(...args),
  );
  NodeModule.syncBuiltinESMExports();
  t.after(() => {
    mocked.mock.restore();
    NodeModule.syncBuiltinESMExports();
  });
}

NodeTest(
  "registers only the recap renderer, command, and bounded lifecycle hooks",
  () => {
    const events = new Set<string>();
    const renderers = new Set<string>();
    const commands = new Set<string>();
    const api: ExtensionAPI = Object.assign(Object.create(null), {
      on: (event: string) => events.add(event),
      registerEntryRenderer: (customType: string) => renderers.add(customType),
      registerCommand: (name: string) => commands.add(name),
    });

    summariesExtension(api);

    NodeAssert.deepEqual(
      events,
      new Set([
        "session_start",
        "before_agent_start",
        "agent_settled",
        "session_shutdown",
      ]),
    );
    NodeAssert.deepEqual(renderers, new Set(["summary-recap"]));
    NodeAssert.deepEqual(commands, new Set(["summary-model"]));
  },
);

function deferred<T>() {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  NodeAssert.ok(resolve);
  return { promise, resolve };
}

function summaryFixture(t: NodeTest.TestContext) {
  let configText: string | undefined;
  mockSummaryConfig(t, () => {
    if (configText !== undefined) return configText;
    throw Object.assign(new Error("missing"), { code: "ENOENT" });
  });
  const faux = fauxProvider({
    api: "summary-title-fixture",
    provider: "github-copilot",
    models: [{ id: "unlisted-work-model", reasoning: true }],
    tokenSize: { min: 1000, max: 1000 },
  });
  const model = { ...faux.getModel(), thinkingLevelMap: { max: "max" } };
  const session = SessionManager.inMemory();
  const handlers = new Map<
    string,
    (event: { type: string }, context: ExtensionContext) => void | Promise<void>
  >();
  let finished = deferred<void>();
  const names: string[] = [];
  const recaps: RecapEntryData[] = [];
  const notices: string[] = [];
  const context: ExtensionContext = Object.assign(Object.create(null), {
    mode: "tui",
    model,
    thinkingLevel: "max",
    sessionManager: session,
    modelRegistry: {
      find: (provider: string, id: string) =>
        provider === "override-provider" && id === "override-model"
          ? { ...model, provider, id }
          : undefined,
      getProvider: () => faux.provider,
      getApiKeyAndHeaders: async () => ({
        ok: true,
        apiKey: "unused-fixture-key",
      }),
    },
    ui: {
      theme: { fg: (_color: string, text: string) => text },
      setStatus: (_key: string, value: string | undefined) => {
        if (value === undefined) finished.resolve();
      },
      notify: (message: string) => notices.push(message),
    },
  });
  const api: ExtensionAPI = Object.assign(Object.create(null), {
    on: (
      name: string,
      handler: (event: { type: string }, ctx: ExtensionContext) => void,
    ) => handlers.set(name, handler),
    registerEntryRenderer: () => {},
    registerCommand: () => {},
    getSessionName: () => session.getSessionName(),
    setSessionName: (name: string) => {
      names.push(name);
      session.appendSessionInfo(name);
    },
    appendEntry: (_type: string, data: RecapEntryData) => recaps.push(data),
  });
  summariesExtension(api);
  const emit = (name: string) => handlers.get(name)?.({ type: name }, context);
  emit("session_start");
  const run = (response: FauxResponseStep) => {
    finished = deferred<void>();
    faux.setResponses([response]);
    emit("before_agent_start");
    session.appendMessage({
      role: "user",
      content: "Configure page answers",
      timestamp: Date.now(),
    });
    emit("agent_settled");
    return finished.promise;
  };
  return {
    faux,
    context,
    model,
    session,
    names,
    recaps,
    notices,
    emit,
    run,
    setConfig: (value: string) => {
      configText = value;
    },
  };
}

const titledRecap = fauxAssistantMessage(
  '{"recap":"Configured page answers.","next":"Nothing remains.","title":"Configure page answers"}',
);

NodeTest("the recap request names an unnamed session once", async (t) => {
  const fixture = summaryFixture(t);
  await fixture.run((context, options, _state, model) => {
    NodeAssert.equal(model, fixture.model);
    NodeAssert.equal(options?.reasoning, "max");
    NodeAssert.match(
      JSON.stringify(context.messages),
      /Include a title for this unnamed session/,
    );
    return titledRecap;
  });
  NodeAssert.equal(fixture.session.getSessionName(), "Configure page answers");
  Object.assign(fixture.context, {
    model: {
      ...fixture.model,
      provider: "openai-codex",
      id: "unlisted-home-model",
    },
    thinkingLevel: "low",
  });
  await fixture.run((context, options, _state, model) => {
    NodeAssert.equal(model, fixture.context.model);
    NodeAssert.equal(options?.reasoning, "low");
    NodeAssert.match(
      JSON.stringify(context.messages),
      /Do not include a title/,
    );
    return titledRecap;
  });
  NodeAssert.deepEqual(fixture.names, ["Configure page answers"]);
  NodeAssert.equal(fixture.recaps.length, 2);
  NodeAssert.equal(fixture.recaps[0]?.provider, "github-copilot");
  NodeAssert.equal(fixture.recaps[1]?.provider, "openai-codex");
  NodeAssert.equal(fixture.faux.state.callCount, 2);
  NodeAssert.deepEqual(fixture.notices, []);
});

NodeTest("a manual name wins while the recap is pending", async (t) => {
  const fixture = summaryFixture(t);
  const started = deferred<void>();
  const response = deferred<ReturnType<typeof fauxAssistantMessage>>();
  const pending = fixture.run(() => {
    started.resolve();
    return response.promise;
  });
  await started.promise;
  fixture.session.appendSessionInfo("My chosen name");
  response.resolve(titledRecap);
  await pending;
  NodeAssert.equal(fixture.session.getSessionName(), "My chosen name");
  NodeAssert.deepEqual(fixture.names, []);
  NodeAssert.equal(fixture.recaps.length, 1);
});

NodeTest(
  "shutdown prevents a late recap from naming the session",
  async (t) => {
    const fixture = summaryFixture(t);
    const started = deferred<void>();
    const response = deferred<ReturnType<typeof fauxAssistantMessage>>();
    const pending = fixture.run(() => {
      started.resolve();
      return response.promise;
    });
    await started.promise;
    const closing = fixture.emit("session_shutdown");
    response.resolve(titledRecap);
    await closing;
    await pending;
    NodeAssert.deepEqual(fixture.names, []);
    NodeAssert.deepEqual(fixture.recaps, []);
    NodeAssert.deepEqual(fixture.notices, []);
  },
);

NodeTest(
  "a failed recap keeps its local fallback without a title",
  async (t) => {
    const fixture = summaryFixture(t);
    await fixture.run(
      fauxAssistantMessage("", {
        stopReason: "error",
        errorMessage: "fixture failure",
      }),
    );
    NodeAssert.deepEqual(fixture.names, []);
    NodeAssert.equal(fixture.recaps.length, 1);
    NodeAssert.equal(fixture.notices.length, 1);
    NodeAssert.match(fixture.notices[0] ?? "", /local fallback/);
    NodeAssert.equal(fixture.faux.state.callCount, 1);

    for (const config of [
      "{broken",
      JSON.stringify({
        provider: "missing-provider",
        model: "missing-model",
        reasoning: "high",
      }),
    ]) {
      fixture.setConfig(config);
      await fixture.run(titledRecap);
      NodeAssert.equal(fixture.recaps.at(-1)?.fallback, true);
      NodeAssert.match(fixture.notices.at(-1) ?? "", /local fallback/);
      NodeAssert.equal(fixture.faux.state.callCount, 1);
    }
    NodeAssert.match(fixture.notices[1] ?? "", /summary-model.json/);
    NodeAssert.match(
      fixture.notices[2] ?? "",
      /missing-provider\/missing-model/,
    );
  },
);

NodeTest(
  "an explicit summary override keeps its provider, model, and effort",
  async (t) => {
    const fixture = summaryFixture(t);
    fixture.setConfig(
      JSON.stringify({
        provider: "override-provider",
        model: "override-model",
        reasoning: "medium",
      }),
    );
    await fixture.run((_context, options, _state, model) => {
      NodeAssert.equal(model.provider, "override-provider");
      NodeAssert.equal(model.id, "override-model");
      NodeAssert.equal(options?.reasoning, "medium");
      return titledRecap;
    });
    NodeAssert.deepEqual(fixture.notices, []);
    NodeAssert.equal(fixture.recaps[0]?.provider, "override-provider");
  },
);
