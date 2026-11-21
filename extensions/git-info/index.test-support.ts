import * as NodeEvents from "node:events";
import * as NodeUtil from "node:util";
import { assert } from "@effect/vitest";
import { onTestFinished, vi } from "vitest";
import { Effect, Layer, ManagedRuntime } from "effect";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import { type Component, visibleWidth } from "@earendil-works/pi-tui";
import { GIT_INFO_CHANNEL } from "../shared/dashboard-state.ts";
import {
  footerFixtureArgs,
  sessionWithCost,
} from "../shared/footer.test-support.ts";
import uiCustomization from "../ui-customization/index.ts";
import gitInfo from "./index.ts";
import {
  CommandError,
  CommandRunner,
  type CommandResult,
} from "./src/process.ts";
import * as Runtime from "./src/runtime.ts";

export const repoCommand = "rev-parse --is-inside-work-tree";

export const branchCommand = "branch --show-current";

export const statusCommand = "status --porcelain=v1 --untracked-files=all";

export const prCommand = "pr view main --json number,url,state,isDraft";

export const openPr = {
  number: 7,
  url: "https://example.test/org/repo/pull/7",
  state: "OPEN",
  isDraft: false,
};

interface CommandResults {
  [command: string]: Partial<CommandResult> | CommandError;
}

export async function fixture(mode: ExtensionContext["mode"] = "tui") {
  const bus = new NodeEvents.EventEmitter();

  type Handler = (
    event: { reason: string },
    ctx: ExtensionContext,
  ) => void | Promise<void>;

  type Command = Parameters<ExtensionAPI["registerCommand"]>[1];

  type Listener = Parameters<ExtensionAPI["events"]["on"]>[1];

  const handlers = new Map<string, Handler[]>();
  const commands = new Map<string, Command>();
  const requests: string[] = [];

  const results: CommandResults = {
    [repoCommand]: { stdout: "true\n" },
    [branchCommand]: { stdout: "main\n" },
    [statusCommand]: { stdout: "" },
    [prCommand]: { stdout: JSON.stringify(openPr) },
  };

  const runtime = ManagedRuntime.make(
    Layer.succeed(CommandRunner, {
      run: (_command, args) => {
        const command = args.join(" ");
        requests.push(command);
        const result = results[command];
        assert.ok(result, `Unexpected command: ${command}`);

        if (result instanceof CommandError) return Effect.fail(result);

        return Effect.succeed({ code: 0, stdout: "", stderr: "", ...result });
      },
    }),
  );

  const runtimeMock = vi.spyOn(Runtime, "createRuntime");
  runtimeMock.mockReturnValue(runtime);

  const apiStub: Pick<
    ExtensionAPI,
    "events" | "on" | "getThinkingLevel" | "registerCommand"
  > = {
    events: {
      on: (name: string, handler: Listener) => {
        bus.on(name, handler);

        return () => bus.off(name, handler);
      },
      emit: bus.emit.bind(bus),
    },
    on: (name, handler) => {
      // SAFETY: Dispatch supplies the lifecycle fields these handlers read; it ignores their results.
      const run = handler as Handler;
      handlers.set(name, [...(handlers.get(name) ?? []), run]);

      return () => {
        throw new Error("Fixture does not support removing lifecycle handlers");
      };
    },
    getThinkingLevel: () => "off",
    registerCommand: (name: string, command: Command) => {
      commands.set(name, command);
    },
  };

  // SAFETY: The fixture supplies only the events, commands, and thinking level these extensions use.
  const api = apiStub as ExtensionAPI;

  const ui = fixtureUi(mode);
  const { ctx } = ui;

  const dispatch = async (name: string) => {
    for (const handler of handlers.get(name) ?? [])
      await handler({ reason: "startup" }, ctx);
  };

  onTestFinished(async () => {
    await dispatch("session_shutdown");
    await runtime.dispose();
    runtimeMock.mockRestore();
  });
  uiCustomization(api);
  await dispatch("session_start");
  gitInfo(api);

  return {
    ...ui,
    bus,
    results,
    requests,
    runtime,
    dispatch,
    runtimeCreations: () => runtimeMock.mock.calls.length,
    refresh: async () => {
      const command = commands.get("pr");
      assert.ok(command);
      await command.handler("", ctx);
    },
    background: async () => {
      const published = NodeEvents.EventEmitter.once(bus, GIT_INFO_CHANNEL);
      await dispatch("input");
      await published;
    },
  };
}

function fixtureUi(mode: ExtensionContext["mode"]) {
  const notices: { text: string; level: string }[] = [];

  const footerArgs = footerFixtureArgs();

  let footer: Component | undefined;

  const ui: Pick<
    ExtensionUIContext,
    "setHeader" | "setTitle" | "setFooter" | "notify"
  > = {
    setHeader: () => {},
    setTitle: () => {},
    setFooter: (factory) => {
      footer = factory?.(...footerArgs);
    },
    notify: (text, level = "info") => {
      notices.push({ text, level });
    },
  };

  const cwd = "/fixture";

  const context: Pick<
    ExtensionContext,
    "cwd" | "mode" | "getContextUsage" | "sessionManager"
  > & { ui: typeof ui } = {
    cwd,
    mode,
    getContextUsage: () => ({
      tokens: 51_680,
      contextWindow: 272_000,
      percent: 19,
    }),
    sessionManager: sessionWithCost(cwd, 3.75),
    ui,
  };

  // SAFETY: Footer rendering, refresh handlers, and /pr only use the fields supplied here.
  const ctx = context as ExtensionCommandContext;

  return {
    ctx,
    notices,
    notice: () => notices.at(-1)?.text ?? "",
    render: (width = 120) => {
      assert.ok(footer);
      const lines = footer.render(width);

      for (const line of lines) assert.ok(visibleWidth(line) <= width);

      return lines
        .map(NodeUtil.stripVTControlCharacters)
        .join(" ")
        .replace(/\s+/g, " ");
    },
  };
}
