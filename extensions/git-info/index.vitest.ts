import * as NodeEvents from "node:events";
import * as NodeUtil from "node:util";
import { assert, it } from "@effect/vitest";
import { onTestFinished, vi } from "vitest";
import { Effect, Layer, ManagedRuntime } from "effect";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { type Component, visibleWidth } from "@earendil-works/pi-tui";
import {
  emptyModelInfoState,
  GIT_INFO_CHANNEL,
  MODEL_INFO_CHANNEL,
  isGitInfoState,
} from "../shared/dashboard-state.ts";
import uiCustomization from "../ui-customization/index.ts";
import gitInfo from "./index.ts";
import { CommandRunner, type CommandResult } from "./src/process.ts";
import { lookupPullRequest } from "./src/repository.ts";
import * as Runtime from "./src/runtime.ts";

const repoCommand = "rev-parse --is-inside-work-tree";
const branchCommand = "branch --show-current";
const statusCommand = "status --porcelain=v1 --untracked-files=all";
const prCommand = "pr view main --json number,url,state,isDraft";
const openPr = {
  number: 7,
  url: "https://example.test/org/repo/pull/7",
  state: "OPEN",
  isDraft: false,
};

interface CommandResults {
  [command: string]: Partial<CommandResult>;
}

async function fixture() {
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
        return Effect.succeed({ code: 0, stdout: "", stderr: "", ...result });
      },
    }),
  );
  const runtimeMock = vi.spyOn(Runtime, "createRuntime");
  runtimeMock.mockReturnValue(runtime);
  const api: ExtensionAPI = Object.assign(Object.create(null), {
    events: {
      on: (name: string, handler: Listener) => {
        bus.on(name, handler);
        return () => bus.off(name, handler);
      },
      emit: bus.emit.bind(bus),
    },
    on: (name: string, handler: Handler) =>
      handlers.set(name, [...(handlers.get(name) ?? []), handler]),
    registerCommand: (name: string, command: Command) =>
      commands.set(name, command),
  });
  const ui = fixtureUi();
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

function fixtureUi() {
  const notices: { text: string; level: string }[] = [];
  const tui = Object.assign(Object.create(null), { requestRender: () => {} });
  const theme = Object.assign(Object.create(null), {
    fg: (_color: string, text: string) => text,
  });
  const footerData = Object.assign(Object.create(null), {
    getExtensionStatuses: () => new Map(),
  });
  type FooterFactory = Parameters<ExtensionContext["ui"]["setFooter"]>[0];
  let footer: Component | undefined;
  const ctx: ExtensionCommandContext = Object.assign(Object.create(null), {
    cwd: "/fixture",
    mode: "tui",
    ui: {
      theme,
      setHeader: () => {},
      setTitle: () => {},
      setFooter: (factory: FooterFactory) => {
        footer = factory?.(tui, theme, footerData);
      },
      notify: (text: string, level: string) => notices.push({ text, level }),
    },
  });
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

it("command failures reach the guard, footer and /pr without clean or absent claims", async () => {
  const f = await fixture();
  const secret =
    "https://secret:private-token@private-host/private-repo Authorization: Bearer private-token\nprivate content";
  const systemFailure = (reason: string, method = "spawn") =>
    `Failed to run gh: ${reason}: ChildProcess.${method}`;
  for (const [command, code, stderr, diagnostic] of [
    ...Object.keys(f.results).map(
      (command) => [command, 1, "", "failed (exit 1)"] as const,
    ),
    [prCommand, 1, systemFailure("NotFound"), "not found (NotFound)"],
    [prCommand, 1, systemFailure("PermissionDenied"), "system error"],
    [prCommand, 1, systemFailure("Unknown", "exitCode"), "terminated"],
    [prCommand, 1, "dial tcp: lookup private-host", "transport failure"],
    [prCommand, 1, "HTTP 401: Bad credentials", "required (HTTP 401)"],
  ] satisfies (readonly [string, number, string, string])[]) {
    const success = f.results[command];
    const failure = { code, stdout: secret, stderr: `${stderr}\n${secret}` };
    f.results[command] = failure;
    await f.refresh();
    assert.equal(f.notices.at(-1)?.level, "warning");
    assert.include(f.notice(), diagnostic);
    for (const text of [f.notice(), f.render()]) {
      assert.include(text, "Git unavailable:");
      assert.notMatch(
        text,
        /files? changed|PR #|private|secret|Authorization|https:|No open PR|Not a git repository/,
      );
    }
    assert.ok(success);
    f.results[command] = success;
    await f.refresh();
    assert.include(f.render(), "PR #7");
  }
});

it("successful absence, clean, unborn, closed PR and detached HEAD remain distinct", async () => {
  const f = await fixture();
  f.results[repoCommand] = {
    code: 128,
    stderr:
      "fatal: not a git repository (or any of the parent directories): .git",
  };
  await f.refresh();
  assert.equal(f.notices.at(-1)?.text, "Not a git repository");
  assert.notInclude(f.render(), "Git unavailable");
  f.results[repoCommand] = { stdout: "true" };
  f.results[prCommand] = {
    code: 1,
    stderr: 'no pull requests found for branch "main"\n',
  };
  await f.refresh();
  assert.equal(f.notices.at(-1)?.text, "No open PR found for main");
  assert.include(f.render(), "0 files changed");
  assert.notInclude(f.requests.join(";"), "--short HEAD");
  for (const state of ["CLOSED", "MERGED"]) {
    f.results[prCommand] = { stdout: JSON.stringify({ ...openPr, state }) };
    await f.refresh();
    assert.equal(f.notices.at(-1)?.text, "No open PR found for main");
  }
  f.results[branchCommand] = { stdout: "" };
  f.results["rev-parse --short HEAD"] = { stdout: "abc123\n" };
  f.results[statusCommand] = { stdout: " M file.txt\n?? other.txt\n" };
  await f.refresh();
  assert.include(f.render(), "detached@abc123 · 2 files changed");
  f.results["rev-parse --short HEAD"] = { code: 128 };
  await f.refresh();
  assert.include(f.render(), "Git unavailable");
});

it("malformed successful responses and unrecognized absence diagnostics are unavailable", async () => {
  const f = await fixture();
  for (const [command, responses] of [
    [repoCommand, ["", "unexpected"]],
    [branchCommand, ["main\nother"]],
    [statusCommand, ["invalid", "\n", " M file\n[command output truncated]\n"]],
    [
      prCommand,
      [
        "",
        "private malformed json",
        "null",
        "{}",
        JSON.stringify({ ...openPr, state: "UNKNOWN" }),
        JSON.stringify({ ...openPr, isDraft: "false" }),
        JSON.stringify({ ...openPr, url: "https://token:secret@example.test" }),
      ],
    ],
  ] satisfies [string, string[]][]) {
    const success = f.results[command];
    for (const stdout of responses) {
      f.results[command] = { stdout };
      await f.refresh();
      assert.match(f.notice(), /unavailable:.*malformed response/);
    }
    assert.ok(success);
    f.results[command] = success;
  }
  f.results[repoCommand] = {
    code: 128,
    stderr: "unknown localized diagnostic",
  };
  await f.refresh();
  assert.include(f.notices.at(-1)?.text ?? "", "Git unavailable");
});

it("background refresh retains failed PR lookup until existing explicit or branch refresh", async () => {
  const f = await fixture();
  const failure = { code: 4, stderr: "dial tcp: secret", stdout: "secret" };
  f.results[prCommand] = failure;
  await f.refresh();
  const error = await f.runtime.runPromise(
    lookupPullRequest(f.ctx.cwd, "main").pipe(Effect.flip),
  );
  assert.deepEqual(error.cause, failure);
  assert.equal(error.message, f.notice());
  const prRequests = () => f.requests.filter((c) => c === prCommand).length;
  const count = prRequests();
  await f.background();
  assert.equal(prRequests(), count);
  assert.include(f.render(), "authentication required");
  f.results[prCommand] = { stdout: JSON.stringify(openPr) };
  await f.refresh();
  assert.include(f.render(), "PR #7");
  f.results[branchCommand] = { stdout: "next" };
  f.results["pr view next --json number,url,state,isDraft"] = { code: -1 };
  await f.background();
  assert.include(f.render(), "timed out");
  assert.notInclude(f.render(), "PR #7");
});

it("unavailable state takes precedence and preserves qualified usage at narrow widths", async () => {
  const f = await fixture();
  assert.equal(isGitInfoState({ unavailable: "" }), false);
  assert.equal(isGitInfoState({}), false);
  assert.equal(isGitInfoState({ unavailable: null }), false);
  f.bus.emit(MODEL_INFO_CHANNEL, {
    ...emptyModelInfoState(),
    cost: 3.75,
    tokensPerSecond: 42,
  });
  f.bus.emit(GIT_INFO_CHANNEL, {
    unavailable: "Git unavailable: gh pr view failed (exit 4)",
    branch: "stale",
    changedFiles: 0,
    pullRequest: openPr,
  });
  for (const width of [20, 32, 40, 60, 80, 120]) {
    const text = f.render(width);
    assert.include(text, "Git unavailable");
    assert.include(text, "branch assistant est. $3.75");
    assert.include(text, "~42 tok/s");
    assert.notMatch(text, /stale|files changed|PR #/);
  }
});
