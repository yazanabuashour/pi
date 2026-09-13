import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import NodeTest from "node:test";
import { createChildResources } from "./child-session.ts";

NodeTest(
  "child settings preserve scopes without writing source files",
  async () => {
    const directory = await NodeFSP.mkdtemp(
      NodePath.join(NodeOS.tmpdir(), "pi-child-settings-"),
    );
    try {
      const cwd = NodePath.join(directory, "project");
      const agentDir = NodePath.join(directory, "agent");
      const globalPath = NodePath.join(agentDir, "settings.json");
      const projectPath = NodePath.join(cwd, ".pi", "settings.json");
      await NodeFSP.mkdir(NodePath.dirname(globalPath), { recursive: true });
      await NodeFSP.mkdir(NodePath.dirname(projectPath), { recursive: true });
      await NodeFSP.writeFile(
        globalPath,
        JSON.stringify({
          defaultThinkingLevel: "medium",
          retry: { enabled: true, maxRetries: 4 },
        }),
      );
      await NodeFSP.writeFile(
        projectPath,
        JSON.stringify({ retry: { enabled: false } }),
      );

      const { settingsManager } = await createChildResources({
        cwd,
        agentDir,
        projectTrusted: true,
      });
      NodeAssert.equal(settingsManager.getRetryEnabled(), false);
      NodeAssert.equal(settingsManager.getRetrySettings().maxRetries, 4);

      settingsManager.setDefaultThinkingLevel("xhigh");
      await settingsManager.flush();

      NodeAssert.equal(
        JSON.parse(await NodeFSP.readFile(globalPath, "utf8"))
          .defaultThinkingLevel,
        "medium",
      );
      NodeAssert.deepEqual(
        JSON.parse(await NodeFSP.readFile(projectPath, "utf8")),
        { retry: { enabled: false } },
      );
    } finally {
      await NodeFSP.rm(directory, { recursive: true, force: true });
    }
  },
);

NodeTest("invalid child settings fail visibly", async () => {
  const directory = await NodeFSP.mkdtemp(
    NodePath.join(NodeOS.tmpdir(), "pi-child-settings-invalid-"),
  );
  try {
    const agentDir = NodePath.join(directory, "agent");
    await NodeFSP.mkdir(agentDir, { recursive: true });
    await NodeFSP.writeFile(NodePath.join(agentDir, "settings.json"), "{");

    await NodeAssert.rejects(
      createChildResources({
        cwd: directory,
        agentDir,
        projectTrusted: false,
      }),
      /Could not load child settings: global:/,
    );
  } finally {
    await NodeFSP.rm(directory, { recursive: true, force: true });
  }
});
