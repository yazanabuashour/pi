import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import NodeTest from "node:test";
import {
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  ProjectTrustStore,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type SessionShutdownEvent,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  bindChildSessionExtensions,
  CHILD_EXCLUDED_TOOL_NAMES,
  childToolPolicy,
  createChildResources,
  resolveStandaloneChildProjectTrust,
  shutdownAndDisposeChildSession,
  type DisposableChildSession,
} from "./child-session.ts";

async function withTempDir(run: (directory: string) => Promise<void>) {
  const directory = await NodeFSP.mkdtemp(
    NodePath.join(NodeOS.tmpdir(), "pi-child-policy-"),
  );
  try {
    await run(directory);
  } finally {
    await NodeFSP.rm(directory, { recursive: true, force: true });
  }
}

function assertChildTools(session: AgentSession, starts: number) {
  NodeAssert.deepEqual(
    [...CHILD_EXCLUDED_TOOL_NAMES],
    [
      "swarm_spawn",
      "swarm_send",
      "swarm_wait",
      "swarm_cancel",
      "swarm_check",
      "swarm_list",
      "workflow",
      "ask_user",
    ],
  );
  const allTools = new Set(session.getAllTools().map((tool) => tool.name));
  const activeTools = new Set(session.getActiveToolNames());
  NodeAssert.equal(starts, 1);
  NodeAssert.equal(allTools.has("fixture_extension_tool"), true);
  NodeAssert.equal(activeTools.has("fixture_extension_tool"), true);
  NodeAssert.equal(allTools.has("structured_output"), true);
  NodeAssert.equal(activeTools.has("structured_output"), true);
  for (const denied of CHILD_EXCLUDED_TOOL_NAMES) {
    NodeAssert.equal(allTools.has(denied), false, `${denied} should be denied`);
    NodeAssert.equal(
      activeTools.has(denied),
      false,
      `${denied} should be inactive`,
    );
  }
  for (const builtin of ["read", "bash", "edit", "write"]) {
    NodeAssert.equal(
      activeTools.has(builtin),
      true,
      `${builtin} should stay active`,
    );
  }
}

NodeTest(
  "child denylist keeps extension and workflow structured tools available",
  async () => {
    await withTempDir(async (directory) => {
      let starts = 0;
      let shutdowns = 0;
      const settingsManager = SettingsManager.inMemory(undefined, {
        projectTrusted: false,
      });
      const inlineLoader = new DefaultResourceLoader({
        cwd: directory,
        agentDir: NodePath.join(directory, "inline-agent"),
        settingsManager,
        extensionFactories: [
          (pi) => {
            pi.on("session_start", () => {
              starts++;
            });
            pi.on("session_shutdown", () => {
              shutdowns++;
            });
            for (const name of [
              "fixture_extension_tool",
              ...CHILD_EXCLUDED_TOOL_NAMES,
            ]) {
              pi.registerTool({
                name,
                label: name,
                description: name,
                parameters: Type.Object({}),
                async execute() {
                  return {
                    content: [{ type: "text", text: "ok" }],
                    details: {},
                  };
                },
              });
            }
          },
        ],
      });
      await inlineLoader.reload();

      const structuredOutput = defineTool({
        name: "structured_output",
        label: "Structured Output",
        description: "fixture structured result",
        parameters: Type.Object({ value: Type.String() }),
        async execute(_id, params) {
          return {
            content: [{ type: "text", text: params.value }],
            details: {},
          };
        },
      });
      const { session } = await createAgentSession({
        cwd: directory,
        agentDir: NodePath.join(directory, "inline-agent"),
        resourceLoader: inlineLoader,
        settingsManager,
        sessionManager: SessionManager.inMemory(directory),
        customTools: [structuredOutput],
        ...childToolPolicy(),
      });
      await bindChildSessionExtensions(session);

      assertChildTools(session, starts);

      await Promise.all([
        shutdownAndDisposeChildSession(session),
        shutdownAndDisposeChildSession(session),
      ]);
      NodeAssert.equal(shutdowns, 1);
    });
  },
);

NodeTest(
  "resource loading gates project extensions but retains global extensions",
  async () => {
    await withTempDir(async (directory) => {
      const cwd = NodePath.join(directory, "project");
      const agentDir = NodePath.join(directory, "agent");
      await NodeFSP.mkdir(NodePath.join(cwd, ".pi", "extensions"), {
        recursive: true,
      });
      await NodeFSP.mkdir(NodePath.join(agentDir, "extensions"), {
        recursive: true,
      });
      const extensionSource = (name: string) => `
      export default function (pi) {
        pi.registerTool({
          name: ${JSON.stringify(name)}, label: ${JSON.stringify(name)},
          description: "fixture", parameters: { type: "object", properties: {} },
          async execute() { return { content: [{ type: "text", text: "ok" }] }; }
        });
      }
    `;
      await NodeFSP.writeFile(
        NodePath.join(agentDir, "extensions", "global.ts"),
        extensionSource("global_fixture"),
      );
      await NodeFSP.writeFile(
        NodePath.join(cwd, ".pi", "extensions", "project.ts"),
        extensionSource("project_fixture"),
      );

      const untrusted = await createChildResources({
        cwd,
        agentDir,
        projectTrusted: false,
      });
      const untrustedTools = new Set(
        untrusted.loader
          .getExtensions()
          .extensions.flatMap((extension) => [...extension.tools.keys()]),
      );
      NodeAssert.equal(untrustedTools.has("global_fixture"), true);
      NodeAssert.equal(untrustedTools.has("project_fixture"), false);

      const trusted = await createChildResources({
        cwd,
        agentDir,
        projectTrusted: true,
      });
      const trustedTools = new Set(
        trusted.loader
          .getExtensions()
          .extensions.flatMap((extension) => [...extension.tools.keys()]),
      );
      NodeAssert.equal(trustedTools.has("global_fixture"), true);
      NodeAssert.equal(trustedTools.has("project_fixture"), true);
    });
  },
);

NodeTest(
  "alternate standalone cwd only uses explicit saved trust",
  async () => {
    await withTempDir(async (directory) => {
      const parentCwd = NodePath.join(directory, "parent");
      const childCwd = NodePath.join(directory, "alternate");
      const agentDir = NodePath.join(directory, "agent");
      await NodeFSP.mkdir(parentCwd, { recursive: true });
      await NodeFSP.mkdir(childCwd, { recursive: true });

      NodeAssert.equal(
        resolveStandaloneChildProjectTrust({
          parentCwd,
          childCwd: parentCwd,
          parentTrusted: true,
          agentDir,
        }),
        true,
      );
      NodeAssert.equal(
        resolveStandaloneChildProjectTrust({
          parentCwd,
          childCwd,
          parentTrusted: true,
          agentDir,
        }),
        false,
      );

      new ProjectTrustStore(agentDir).set(childCwd, true);
      NodeAssert.equal(
        resolveStandaloneChildProjectTrust({
          parentCwd,
          childCwd,
          parentTrusted: false,
          agentDir,
        }),
        true,
      );
    });
  },
);

NodeTest(
  "shutdown helper balances hooks and disposal despite errors",
  async () => {
    let emits = 0;
    let disposals = 0;
    const session: DisposableChildSession = {
      extensionRunner: {
        hasHandlers: () => true,
        async emit(event: SessionShutdownEvent) {
          emits++;
          NodeAssert.deepEqual(event, {
            type: "session_shutdown",
            reason: "quit",
          });
          throw new Error("fixture shutdown failure");
        },
      },
      dispose() {
        disposals++;
      },
    };

    await Promise.all([
      shutdownAndDisposeChildSession(session),
      shutdownAndDisposeChildSession(session),
      shutdownAndDisposeChildSession(session),
    ]);
    NodeAssert.equal(emits, 1);
    NodeAssert.equal(disposals, 1);
  },
);

NodeTest("shutdown helper bounds a stuck hook before disposal", async () => {
  let disposals = 0;
  const session: DisposableChildSession = {
    extensionRunner: {
      hasHandlers: () => true,
      emit: () => new Promise(() => {}),
    },
    dispose() {
      disposals++;
    },
  };

  await shutdownAndDisposeChildSession(session, { timeoutMs: 10 });
  NodeAssert.equal(disposals, 1);
});
