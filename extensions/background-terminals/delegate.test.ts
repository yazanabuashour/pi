import * as NodeAssert from "node:assert/strict";
import NodeTest from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  buildDelegateLaunch,
  currentPiInvocation,
  type DelegateContext,
} from "./src/delegate.ts";
import { cwd } from "./manager.test-support.ts";

type Registry = ExtensionContext["modelRegistry"];

const models = [
  { provider: "github-copilot", id: "gpt-6.1-sol", auth: true },
  {
    provider: "amazon-bedrock",
    id: "us.anthropic.claude-fable-5-1",
    auth: true,
  },
  { provider: "openai-codex", id: "gpt-5.5", auth: false },
];

const modelRegistry: Registry = Object.assign(Object.create(null), {
  find: (provider: string, id: string) =>
    models.find((model) => model.provider === provider && model.id === id),
  hasConfiguredAuth: (model: { auth: boolean }) => model.auth,
  getAvailable: () => models.filter((model) => model.auth),
});

const context: DelegateContext = Object.assign(Object.create(null), {
  cwd,
  modelRegistry,
  isProjectTrusted: () => false,
  model: models[0],
  thinkingLevel: "high",
});

const fixed = {
  pi: { file: "/bin/pi-node", args: ["/pi/cli.js"] },
  sessionId: "session-1",
  env: {
    PATH: "/bin",
    PI_AUTOMATION_TELEMETRY_PATH: "/tmp/telemetry.jsonl",
    PI_AUTOMATION_NAME: "caller",
    PI_AUTOMATION_RUN_ID: "run",
    PI_AUTOMATION_FUTURE: "private",
  },
};

await NodeTest(
  "delegate uses exact configured models, direct arguments and an independent saved session",
  () => {
    const launch = buildDelegateLaunch(
      {
        prompt: "  @review -- this; rm -rf $HOME  ",
        title: "second\nopinion",
        model: "amazon-bedrock/us.anthropic.claude-fable-5-1",
        tools: ["read", "grep", "read"],
      },
      context,
      fixed,
    );

    NodeAssert.deepEqual(launch.argv, {
      file: "/bin/pi-node",
      args: [
        "/pi/cli.js",
        "--print",
        "--model",
        "amazon-bedrock/us.anthropic.claude-fable-5-1",
        "--thinking",
        "high",
        "--session-id",
        "session-1",
        "--name",
        "delegate: second opinion",
        "--no-approve",
        "--tools",
        "read,grep",
        "--exclude-tools",
        "delegate,ask_user,mcp__*",
        "Task: @review -- this; rm -rf $HOME",
      ],
    });
    NodeAssert.deepEqual(launch.env, { PATH: "/bin" });
    NodeAssert.deepEqual(launch.delegate, {
      model: "amazon-bedrock/us.anthropic.claude-fable-5-1",
      sessionId: "session-1",
      thinking: "high",
      tools: ["read", "grep"],
    });
    NodeAssert.ok(!launch.command.includes("rm -rf"));
    const { thinkingLevel: _thinking, ...withoutThinking } = context;

    const inherited = buildDelegateLaunch(
      { prompt: "task", title: "t", working_dir: ".." },
      withoutThinking,
      fixed,
    );

    NodeAssert.equal(inherited.delegate?.model, "github-copilot/gpt-6.1-sol");
    NodeAssert.ok(!inherited.argv?.args.includes("--thinking"));
    NodeAssert.ok(!inherited.argv?.args.includes("--no-approve"));

    const overridden = buildDelegateLaunch(
      {
        prompt: "task",
        title: "t",
        thinking: "off",
        tools: ["mcp__example__read"],
      },
      context,
      fixed,
    );

    NodeAssert.equal(overridden.delegate?.thinking, "off");
    NodeAssert.ok(overridden.argv?.args.includes("delegate,ask_user"));
    NodeAssert.equal(currentPiInvocation("/bin/pi", cwd).file, "/bin/pi");
    NodeAssert.deepEqual(
      currentPiInvocation("/bin/node", import.meta.filename),
      { file: "/bin/node", args: [import.meta.filename] },
    );
  },
);

await NodeTest("delegate rejects selections the child cannot honor", () => {
  const launch = (params: Parameters<typeof buildDelegateLaunch>[0]) => () =>
    buildDelegateLaunch(params, context, fixed);

  NodeAssert.throws(
    launch({ prompt: "x", title: "t", model: "openai-codex/gpt-5.5" }),
    /not available with configured credentials/,
  );
  NodeAssert.throws(
    launch({ prompt: "x", title: "t", model: "gpt-6.1-sol" }),
    /not available/,
  );

  for (const tool of ["delegate", "ask_user"]) {
    NodeAssert.throws(
      launch({ prompt: "x", title: "t", tools: [tool] }),
      /never available/,
    );
  }

  for (const tool of ["read,bash", "-read", "*"]) {
    NodeAssert.throws(
      launch({ prompt: "x", title: "t", tools: [tool] }),
      /Invalid tool name/,
    );
  }

  NodeAssert.throws(
    launch({ prompt: "x", title: "t", tools: [] }),
    /at least one tool/,
  );
  NodeAssert.throws(launch({ prompt: "", title: "t" }), /must not be empty/);
  NodeAssert.throws(
    launch({ prompt: "x", title: "t", working_dir: "missing-dir" }),
    /not a directory/,
  );
  NodeAssert.throws(
    () =>
      buildDelegateLaunch(
        { prompt: "x", title: "t" },
        { ...context, model: undefined },
        fixed,
      ),
    /no model/,
  );
});
