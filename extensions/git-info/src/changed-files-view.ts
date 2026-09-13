import * as NodePath from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Effect } from "effect";
import { ChangedFilesComponent } from "./changed-files-component.ts";
import { runCommand, type CommandResult } from "./process.ts";

const MAX_DIFF_LINES = 20_000;
// Strip terminal control sequences from repository-controlled paths and diff
// text before applying trusted theme styling.
const OSC_PATTERN = new RegExp(
  String.raw`(?:\u001b\]|\u009d)(?:[^\u0007\u001b\u009c]|\u001b(?!\\))*(?:\u0007|\u001b\\|\u009c)`,
  "g",
);
const CSI_PATTERN = new RegExp(
  String.raw`(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]`,
  "g",
);
const ESCAPE_PATTERN = new RegExp(
  String.raw`\u001b(?:[()][0-2A-Z]|[ -/]*[@-~])`,
  "g",
);
const CONTROL_PATTERN = new RegExp(
  String.raw`[\u0000-\u0008\u000b-\u001f\u007f-\u009f]`,
  "g",
);

export function sanitizeTerminalText(text: string) {
  return text
    .replace(OSC_PATTERN, "")
    .replace(CSI_PATTERN, "")
    .replace(ESCAPE_PATTERN, "")
    .replace(CONTROL_PATTERN, "");
}

interface ChangedPath {
  path: string;
  status: string;
}

export interface ChangedFile {
  additions: number | null;
  deletions: number | null;
  diff: string[];
  name: string;
  path: string;
}

function parseChangedPaths(output: string) {
  const records = output.split("\0");
  const paths: ChangedPath[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.length < 4) continue;

    const status = record.slice(0, 2);
    const path = record.slice(3);
    paths.push({ path, status });

    // In porcelain v1 -z output, rename/copy records are followed by the old path.
    if (status.includes("R") || status.includes("C")) index += 1;
  }

  return [...new Map(paths.map((entry) => [entry.path, entry])).values()];
}

function parseNumstat(output: string) {
  const line = output.split("\n").find(Boolean);
  if (!line) return { additions: 0, deletions: 0 };

  const [added, deleted] = line.split("\t");
  return {
    additions: added === "-" ? null : Number.parseInt(added ?? "0", 10),
    deletions: deleted === "-" ? null : Number.parseInt(deleted ?? "0", 10),
  };
}

function cleanDisplayPath(path: string) {
  return sanitizeTerminalText(path).replace(/[\r\n\t]/g, " ");
}

const run = (cwd: string, args: string[]) =>
  runCommand("git", args, cwd, 10_000);

function commandFailure(operation: string, result: CommandResult) {
  const detail = sanitizeTerminalText(result.stderr).trim();
  return new Error(
    `git ${operation} unavailable (exit ${result.code})${detail ? `: ${detail}` : ""}`,
  );
}

const loadFile = Effect.fn("git-info.loadFile")(function* (
  repoRoot: string,
  changedPath: ChangedPath,
  hasHead: boolean,
) {
  const useNoIndex = changedPath.status === "??" || !hasHead;
  const diffArguments = useNoIndex
    ? [
        "diff",
        "--no-index",
        "--no-ext-diff",
        "--no-color",
        "--unified=3",
        "--",
        "/dev/null",
        changedPath.path,
      ]
    : [
        "diff",
        "--no-ext-diff",
        "--no-color",
        "--unified=3",
        "HEAD",
        "--",
        changedPath.path,
      ];
  const statArguments = useNoIndex
    ? ["diff", "--no-index", "--numstat", "--", "/dev/null", changedPath.path]
    : ["diff", "--numstat", "HEAD", "--", changedPath.path];
  const [diffResult, statResult] = yield* Effect.all(
    [run(repoRoot, diffArguments), run(repoRoot, statArguments)],
    { concurrency: "unbounded" },
  );
  if (diffResult.code !== 0 && !(useNoIndex && diffResult.code === 1))
    return yield* Effect.fail(commandFailure("diff", diffResult));
  if (statResult.code !== 0 && !(useNoIndex && statResult.code === 1))
    return yield* Effect.fail(commandFailure("diff --numstat", statResult));
  const stats = parseNumstat(statResult.stdout);
  const allDiffLines = diffResult.stdout
    .trimEnd()
    .split("\n")
    .map(sanitizeTerminalText);
  const diff =
    allDiffLines.length > MAX_DIFF_LINES
      ? [
          ...allDiffLines.slice(0, MAX_DIFF_LINES),
          `… diff truncated after ${MAX_DIFF_LINES.toLocaleString()} lines …`,
        ]
      : allDiffLines;

  return {
    ...stats,
    diff:
      diff.length === 1 && diff[0] === ""
        ? ["No textual diff available."]
        : diff,
    name: cleanDisplayPath(NodePath.basename(changedPath.path)),
    path: cleanDisplayPath(changedPath.path),
  } satisfies ChangedFile;
});

export const loadChangedFiles = Effect.fn("git-info.loadChangedFiles")(
  function* (cwd: string) {
    const rootResult = yield* run(cwd, ["rev-parse", "--show-toplevel"]);
    if (rootResult.code !== 0) {
      if (
        rootResult.code === 128 &&
        /^fatal: not a git repository[ (:]/.test(rootResult.stderr)
      )
        return null;
      return yield* Effect.fail(
        commandFailure("rev-parse --show-toplevel", rootResult),
      );
    }

    const repoRoot = rootResult.stdout.trim();
    const [statusResult, headResult] = yield* Effect.all(
      [
        run(repoRoot, [
          "status",
          "--porcelain=v1",
          "-z",
          "--untracked-files=all",
        ]),
        run(repoRoot, ["rev-parse", "--verify", "--quiet", "HEAD"]),
      ],
      { concurrency: "unbounded" },
    );
    if (statusResult.code !== 0)
      return yield* Effect.fail(commandFailure("status", statusResult));
    if (
      headResult.code !== 0 &&
      !(headResult.code === 1 && !headResult.stderr.trim())
    )
      return yield* Effect.fail(
        commandFailure("rev-parse --verify HEAD", headResult),
      );

    const changedPaths = parseChangedPaths(statusResult.stdout);
    const files: ChangedFile[] = [];
    for (const changedPath of changedPaths) {
      files.push(yield* loadFile(repoRoot, changedPath, headResult.code === 0));
    }

    return files;
  },
);

export async function showChangedFiles(
  ctx: ExtensionContext,
  files: ChangedFile[],
) {
  if (ctx.mode !== "tui") return;

  await ctx.ui.custom<void>(
    (tui, theme, _keybindings, done) =>
      new ChangedFilesComponent(tui, theme, files, () => done(undefined)),
    {
      overlay: true,
      overlayOptions: {
        anchor: "center",
        margin: 1,
        maxHeight: "90%",
        minWidth: 60,
        width: "95%",
      },
    },
  );
}
