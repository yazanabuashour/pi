import { Effect } from "effect";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { pullRequestInfoSchema } from "../../shared/dashboard-state.ts";
import { runCommand, type CommandResult } from "./process.ts";

const GIT_TIMEOUT_MS = 3_000;
const GH_TIMEOUT_MS = 10_000;
const INVALID_BRANCH_TEXT = new RegExp(
  String.raw`[\s\u0000-\u001f\u007f]`,
  "u",
);
const pullRequestResponseSchema = Type.Object({
  ...pullRequestInfoSchema.properties,
  state: Type.Union([
    Type.Literal("OPEN"),
    Type.Literal("CLOSED"),
    Type.Literal("MERGED"),
  ]),
});

function commandDiagnostic(operation: string, result: CommandResult) {
  if (result.code === -1) return "timed out";
  if (operation === "gh pr view" && result.code === 4)
    return "authentication required";

  // The runner flattens Effect platform errors into stderr, without their cause.
  const system =
    /(?:^|\n)Failed to run (?:git|gh): (NotFound|PermissionDenied|BadResource|Busy|Unknown): ChildProcess\.(spawn|exitCode)\b/.exec(
      result.stderr,
    );
  if (system?.[2] === "exitCode") return "terminated";
  if (system?.[1] === "NotFound")
    return "command or working directory not found (NotFound)";
  if (system) return `system error (${system[1]})`;

  // gh has no transport exit status. Never copy its host, URL or response text.
  if (operation === "gh pr view" && result.code === 1) {
    if (/^HTTP 401:|\(HTTP 401\)/m.test(result.stderr))
      return "authentication required (HTTP 401)";
    if (
      /error connecting to |\bdial tcp\b|\bTLS handshake timeout\b|\bconnection reset by peer\b/.test(
        result.stderr,
      )
    )
      return "transport failure";
  }
  return `failed (exit ${result.code})`;
}

function commandFailure(operation: string, result: CommandResult) {
  return new Error(
    `Git unavailable: ${operation} ${commandDiagnostic(operation, result)}`,
    { cause: result },
  );
}

function malformedResponse(operation: string) {
  return new Error(
    `Git unavailable: ${operation} returned a malformed response`,
  );
}

const runGit = (cwd: string, args: string[]) =>
  runCommand("git", args, cwd, GIT_TIMEOUT_MS);

const gitOutput = Effect.fn("git-info.gitOutput")(function* (
  cwd: string,
  args: string[],
) {
  const result = yield* runGit(cwd, args);
  if (result.code !== 0)
    return yield* Effect.fail(commandFailure(`git ${args[0]}`, result));
  return result.stdout;
});

export const loadRepository = Effect.fn("git-info.loadRepository")(function* (
  cwd: string,
) {
  const repo = yield* runGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (repo.code !== 0) {
    // Git has no distinct exit code for absence. Unknown diagnostics fail closed.
    if (
      repo.code === 128 &&
      /^fatal: not a git repository[ (:]/.test(repo.stderr)
    )
      return null;
    return yield* Effect.fail(commandFailure("git rev-parse", repo));
  }
  if (repo.stdout.trim() === "false") return null;
  if (repo.stdout.trim() !== "true")
    return yield* Effect.fail(malformedResponse("git rev-parse"));
  const [branchOutput, status] = yield* Effect.all(
    [
      gitOutput(cwd, ["branch", "--show-current"]),
      gitOutput(cwd, ["status", "--porcelain=v1", "--untracked-files=all"]),
    ],
    { concurrency: "unbounded" },
  );
  const branchName = branchOutput.trim();
  if (branchName && INVALID_BRANCH_TEXT.test(branchName))
    return yield* Effect.fail(malformedResponse("git branch"));
  const lines = status === "" ? [] : status.replace(/\n$/, "").split("\n");
  if (lines.some((line) => !/^[ MTADRCU?!]{2} .+$/.test(line)))
    return yield* Effect.fail(malformedResponse("git status"));
  let branch = branchName;
  if (!branch) {
    const head = (yield* gitOutput(cwd, [
      "rev-parse",
      "--short",
      "HEAD",
    ])).trim();
    if (!/^[0-9a-f]+$/.test(head))
      return yield* Effect.fail(malformedResponse("git rev-parse HEAD"));
    branch = `detached@${head}`;
  }
  return { branchName, branch, changedFiles: lines.length };
});

export const lookupPullRequest = Effect.fn("git-info.lookupPullRequest")(
  function* (cwd: string, branch: string) {
    const result = yield* runCommand(
      "gh",
      ["pr", "view", branch, "--json", "number,url,state,isDraft"],
      cwd,
      GH_TIMEOUT_MS,
    );
    if (result.code !== 0) {
      // gh pr view uses exit 1 for both absence and operational failures.
      if (
        result.code === 1 &&
        result.stderr.trim() === `no pull requests found for branch "${branch}"`
      )
        return null;
      return yield* Effect.fail(commandFailure("gh pr view", result));
    }
    const value: unknown = yield* Effect.try({
      try: () => JSON.parse(result.stdout),
      catch: () => malformedResponse("gh pr view"),
    });
    if (
      !Value.Check(pullRequestResponseSchema, value) ||
      !URL.canParse(value.url)
    )
      return yield* Effect.fail(malformedResponse("gh pr view"));
    const url = new URL(value.url);
    if (url.protocol !== "https:" || url.username || url.password)
      return yield* Effect.fail(malformedResponse("gh pr view"));
    return value.state === "OPEN"
      ? { number: value.number, url: value.url, isDraft: value.isDraft }
      : null;
  },
);
