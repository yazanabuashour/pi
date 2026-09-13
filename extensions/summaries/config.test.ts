import * as NodeAssert from "node:assert/strict";
import NodeTest from "node:test";
// oxlint-disable-next-line project/namespace-node-imports -- Mock the mutable built-in export, not the immutable ESM namespace.
import NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import { Cause } from "effect";
import {
  getAgentDir,
  type ExtensionAPI,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import summariesExtension from "./index.ts";
import {
  loadSummaryConfig,
  parseSummaryConfig,
  PRIVATE_CONFIG_PATH,
} from "./src/config.ts";

NodeTest("only a missing private summary config inherits the session", (t) => {
  let failure: Error | undefined = Object.assign(new Error("missing"), {
    code: "ENOENT",
  });
  const read = t.mock.method(NodeFS, "readFileSync", () => {
    if (failure) throw failure;
    return "{broken";
  });
  NodeModule.syncBuiltinESMExports();
  t.after(() => {
    read.mock.restore();
    NodeModule.syncBuiltinESMExports();
  });
  NodeAssert.equal(loadSummaryConfig(), undefined);
  failure = Object.assign(new Error("unreadable"), { code: "EACCES" });
  NodeAssert.throws(loadSummaryConfig, /Could not load summary-model.json/);
  failure = undefined;
  NodeAssert.throws(loadSummaryConfig, /Could not load summary-model.json/);
});

NodeTest(
  "summary config save reports system causes and can restore session inheritance",
  async (t) => {
    const read = t.mock.method(NodeFS, "readFileSync", () => {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    });
    type CommandOptions = Parameters<ExtensionAPI["registerCommand"]>[1];
    const commands = new Map<string, CommandOptions>();
    const api: ExtensionAPI = Object.assign(Object.create(null), {
      on: () => {},
      registerEntryRenderer: () => {},
      registerCommand: (name: string, options: CommandOptions) =>
        commands.set(name, options),
    });
    const notices: string[] = [];
    let selection = "private-provider/private-model";
    const model = {
      provider: "private-provider",
      id: "private-model",
      reasoning: false,
    };
    const ctx: ExtensionCommandContext = Object.assign(Object.create(null), {
      mode: "tui",
      thinkingLevel: "off",
      modelRegistry: { getAvailable: () => [model] },
      ui: {
        select: async () => selection,
        custom: async () => "off",
        notify: (message: string) => notices.push(message),
      },
    });
    let failure: Error = Object.assign(
      new Error("private-provider/private-model secret contents"),
      { errno: -NodeOS.constants.errno.EACCES, code: "EACCES" },
    );
    const mkdir = t.mock.method(NodeFS.promises, "mkdir", async () => {
      throw failure;
    });
    const remove = t.mock.method(
      NodeFS.promises,
      "rm",
      async (path: NodeFS.PathLike) => {
        NodeAssert.equal(path, PRIVATE_CONFIG_PATH);
      },
    );
    NodeModule.syncBuiltinESMExports();
    t.after(() => {
      read.mock.restore();
      mkdir.mock.restore();
      remove.mock.restore();
      NodeModule.syncBuiltinESMExports();
    });
    summariesExtension(api);
    const command = commands.get("summary-model");
    NodeAssert.ok(command);
    await command.handler("", ctx);
    failure = new Cause.TimeoutError("private contents");
    await command.handler("", ctx);
    failure = new Error("private contents");
    await command.handler("", ctx);
    selection = "Current session model and effort (recommended)";
    await command.handler("", ctx);
    NodeAssert.equal(remove.mock.callCount(), 1);
    NodeAssert.deepEqual(notices, [
      "Could not save the private summary model config: EACCES.",
      "Could not save the private summary model config: save timed out.",
      "Could not save the private summary model config: save failed without a system error code.",
      "Run recaps now use the current session model and effort.",
    ]);
  },
);

NodeTest(
  "summary config accepts valid private overrides and rejects partial corruption",
  () => {
    NodeAssert.equal(
      PRIVATE_CONFIG_PATH,
      NodePath.join(getAgentDir(), "summary-model.json"),
    );
    NodeAssert.deepEqual(
      parseSummaryConfig({
        provider: " anthropic ",
        model: " claude-sonnet ",
        reasoning: "high",
      }),
      {
        provider: "anthropic",
        model: "claude-sonnet",
        reasoning: "high",
      },
    );

    for (const value of [
      undefined,
      { provider: "", model: 42, reasoning: "turbo" },
      { provider: "anthropic", model: 42, reasoning: "high" },
    ]) {
      NodeAssert.throws(
        () => parseSummaryConfig(value),
        /Invalid summary-model.json/,
      );
    }
  },
);
