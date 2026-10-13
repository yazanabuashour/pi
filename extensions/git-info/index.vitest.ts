import { assert, it } from "@effect/vitest";
import { Cause, Effect, PlatformError } from "effect";
import {
  emptyModelInfoState,
  GIT_INFO_CHANNEL,
  MODEL_INFO_CHANNEL,
  isGitInfoState,
} from "../shared/dashboard-state.ts";
import {
  branchCommand,
  fixture,
  openPr,
  prCommand,
  repoCommand,
  statusCommand,
} from "./index.test-support.ts";
import { CommandError, type CommandResult } from "./src/process.ts";
import { lookupPullRequest } from "./src/repository.ts";

it("command failures reach the guard, footer and /pr without clean or absent claims", async () => {
  const f = await fixture();

  const secret =
    "https://secret:private-token@private-host/private-repo Authorization: Bearer private-token\nprivate content";

  const systemFailure = (
    reason: PlatformError.SystemErrorTag,
    method = "spawn",
  ) =>
    new CommandError({
      command: "gh",
      args: ["pr", "view", "main"],
      cwd: f.ctx.cwd,
      stdout: secret,
      stderr: secret,
      cause: PlatformError.systemError({
        _tag: reason,
        module: "ChildProcess",
        method,
        description: secret,
        cause: new Error(secret),
      }),
    });

  for (const [command, failure, diagnostic] of [
    ...Object.keys(f.results).map(
      (command) =>
        [
          command,
          { code: 1, stdout: secret, stderr: secret },
          "failed (exit 1)",
        ] as const,
    ),
    [prCommand, systemFailure("NotFound"), "not found (NotFound)"],
    [prCommand, systemFailure("PermissionDenied"), "system error"],
    [prCommand, systemFailure("Unknown", "exitCode"), "terminated"],
    [
      prCommand,
      { code: 1, stderr: "dial tcp: lookup private-host" },
      "transport failure",
    ],
    [
      prCommand,
      { code: 1, stderr: "HTTP 401: Bad credentials" },
      "required (HTTP 401)",
    ],
    [
      prCommand,
      { code: 1, stderr: "Failed to run gh: NotFound: ChildProcess.spawn" },
      "failed (exit 1)",
    ],
  ] satisfies (readonly [
    string,
    Partial<CommandResult> | CommandError,
    string,
  ])[]) {
    const success = f.results[command];
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
  assert.include(f.render(), `${f.ctx.cwd} · main · clean`);
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
  f.results["pr view next --json number,url,state,isDraft"] = new CommandError({
    command: "gh",
    args: ["pr", "view", "next"],
    cwd: f.ctx.cwd,
    stdout: "",
    stderr: "",
    cause: new Cause.TimeoutError(),
  });
  await f.background();
  assert.include(f.render(), "timed out");
  assert.notInclude(f.render(), "PR #7");
});

it("unavailable state takes precedence and preserves minimal usage at narrow widths", async () => {
  const f = await fixture();
  assert.equal(isGitInfoState({ unavailable: "" }), false);
  assert.equal(isGitInfoState({}), false);
  assert.equal(isGitInfoState({ unavailable: null }), false);
  f.bus.emit(MODEL_INFO_CHANNEL, {
    ...emptyModelInfoState(),
    cost: 3.75,
    contextPercent: 19,
    contextWindow: 272_000,
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
    assert.include(text, "19%/272k · ~$3.75");
    assert.notMatch(text, /stale|files changed|PR #|tok\/s/);
  }
});
