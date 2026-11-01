import { assert, it } from "@effect/vitest";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";
import { Effect, PlatformError } from "effect";
import {
  assertDirectoryTransitions,
  loadFromGit,
} from "./changed-files-view.test-support.ts";
import {
  loadChangedFiles,
  sanitizeTerminalText,
} from "./src/changed-files-view.ts";
import {
  CommandError,
  CommandRunner,
  type CommandResult,
} from "./src/process.ts";

it("repository text cannot inject terminal control sequences", () => {
  const input =
    "before\u001b]52;c;Y2xpcGJvYXJk\u0007after\u001b[31mred\u001b[0m\u0001";

  assert.equal(sanitizeTerminalText(input), "beforeafterred");
});

it.effect(
  "real Git preserves root whitespace, rename sides, and literal filenames",
  () =>
    Effect.acquireUseRelease(
      Effect.sync(() =>
        NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "git-changes-")),
      ),
      (base) =>
        Effect.gen(function* () {
          const root = NodePath.join(base, "repo ");
          NodeFS.mkdirSync(root);

          const env = {
            ...process.env,
            HOME: base,
            GIT_CONFIG_GLOBAL: "/dev/null",
            GIT_CONFIG_NOSYSTEM: "1",
          };

          const git = (...args: string[]) =>
            NodeChildProcess.execFileSync("git", args, {
              cwd: root,
              env,
              encoding: "utf8",
            });

          git("init", "-q");

          const original = Array.from(
            { length: 10 },
            (_, index) => `line ${index}\n`,
          ).join("");

          NodeFS.writeFileSync(NodePath.join(root, "config"), "setting\n");
          NodeFS.mkdirSync(NodePath.join(root, "destination"));
          NodeFS.writeFileSync(
            NodePath.join(root, "destination/old"),
            "old-child\n",
          );
          NodeFS.writeFileSync(NodePath.join(root, "move"), "moved-root\n");
          NodeFS.writeFileSync(NodePath.join(root, "old.txt"), original);
          NodeFS.writeFileSync(NodePath.join(root, "[c].txt"), "old\n");
          NodeFS.writeFileSync(NodePath.join(root, "c.txt"), "unrelated\n");
          git("add", ".");
          git(
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "commit",
            "-qm",
            "initial",
          );
          git("mv", "old.txt", "new.txt");

          const load = () => loadFromGit(root, env);

          const renamed = yield* load();
          assert.equal(renamed?.[0]?.path, "new.txt");
          assert.equal(renamed?.[0]?.additions, 0);
          assert.equal(renamed?.[0]?.deletions, 0);
          assert.include(
            renamed?.[0]?.diff.join("\n") ?? "",
            "rename from old.txt",
          );
          NodeFS.appendFileSync(NodePath.join(root, "new.txt"), "added\n");
          const modified = yield* load();
          assert.equal(modified?.[0]?.additions, 1);
          assert.equal(modified?.[0]?.deletions, 0);
          assert.include(modified?.[0]?.diff.join("\n") ?? "", "+added");
          NodeFS.writeFileSync(NodePath.join(root, "new.txt"), "replacement\n");
          NodeFS.writeFileSync(NodePath.join(root, "[c].txt"), "new\n");
          const rewritten = yield* load();
          const rename = rewritten?.find((file) => file.path === "new.txt");
          assert.equal(rename?.additions, 1);
          assert.equal(rename?.deletions, 10);
          const literal = rewritten?.find((file) => file.path === "[c].txt");
          assert.equal(literal?.additions, 1);
          assert.equal(literal?.deletions, 1);
          assert.include(literal?.diff.join("\n") ?? "", "+new");
          yield* assertDirectoryTransitions(root, env, git);
        }),
      (base) =>
        Effect.sync(() =>
          NodeFS.rmSync(base, { recursive: true, force: true }),
        ),
    ),
);

function loadWithResults(
  results: Record<string, Partial<CommandResult> | CommandError>,
) {
  return loadChangedFiles("/fixture").pipe(
    Effect.provideService(CommandRunner, {
      run: (_command, args) => {
        const result = results[args.join(" ")];

        return result instanceof CommandError
          ? Effect.fail(result)
          : Effect.succeed({
              code: 0,
              stdout: args.includes("--show-toplevel") ? "/fixture" : "",
              stderr: "",
              ...result,
            });
      },
    }),
  );
}

it.effect("copies do not include independently modified source stats", () =>
  Effect.gen(function* () {
    const files = yield* loadWithResults({
      "status --porcelain=v1 -z --untracked-files=all": {
        stdout: "C  copy.txt\u0000old.txt\u0000M  old.txt\u0000",
      },
      "diff --no-ext-diff --no-color --unified=3 --find-renames HEAD -- :(literal)copy.txt":
        { stdout: "+copied" },
      "diff --numstat --find-renames HEAD -- :(literal)copy.txt": {
        stdout: "10\t0\tcopy.txt\n",
      },
      "diff --no-ext-diff --no-color --unified=3 --find-renames HEAD -- :(literal)old.txt":
        { stdout: "-old\n+changed" },
      "diff --numstat --find-renames HEAD -- :(literal)old.txt": {
        stdout: "1\t1\told.txt\n",
      },
    });

    assert.deepEqual(
      files?.map(({ path, additions, deletions }) => ({
        path,
        additions,
        deletions,
      })),
      [
        { path: "copy.txt", additions: 10, deletions: 0 },
        { path: "old.txt", additions: 1, deletions: 1 },
      ],
    );
  }),
);

it.effect("changed-files failures do not look clean or non-repository", () =>
  Effect.gen(function* () {
    for (const [command, operation] of [
      ["rev-parse --show-toplevel", "rev-parse --show-toplevel"],
      ["status --porcelain=v1 -z --untracked-files=all", "status"],
      ["rev-parse --verify --quiet HEAD", "rev-parse --verify HEAD"],
    ]) {
      assert.ok(command);

      const failure = yield* Effect.flip(
        loadWithResults({
          [command]: { code: 128, stderr: "permission denied" },
        }),
      );

      assert.equal(
        failure.message,
        `git ${operation} unavailable (exit 128): permission denied`,
      );
    }

    assert.equal(
      yield* loadWithResults({
        "rev-parse --show-toplevel": {
          code: 128,
          stderr:
            "fatal: not a git repository (or any of the parent directories): .git",
        },
      }),
      null,
    );
    assert.deepEqual(yield* loadWithResults({}), []);
  }),
);

it.effect(
  "unborn and untracked diffs accept no-index exit 1 but reject failed diffs",
  () =>
    Effect.gen(function* () {
      const results = {
        "status --porcelain=v1 -z --untracked-files=all": {
          stdout: "?? file.txt\u0000",
        },
        "rev-parse --verify --quiet HEAD": { code: 1 },
        "diff --no-index --no-ext-diff --no-color --unified=3 -- /dev/null file.txt":
          { code: 1, stdout: "+hello" },
        "diff --no-index --numstat -- /dev/null file.txt": {
          code: 1,
          stdout: "1\t0\tfile.txt",
        },
      };

      const files = yield* loadWithResults(results);
      assert.equal(files?.[0]?.additions, 1);
      assert.deepEqual(files?.[0]?.diff, ["+hello"]);

      results[
        "diff --no-index --no-ext-diff --no-color --unified=3 -- /dev/null file.txt"
      ].stdout = "new file mode 100644";
      results["diff --no-index --numstat -- /dev/null file.txt"].stdout =
        "0\t0\tfile.txt";
      const empty = yield* loadWithResults(results);
      assert.equal(empty?.[0]?.additions, 0);
      assert.deepEqual(empty?.[0]?.diff, ["new file mode 100644"]);

      for (const command of Object.keys(results).filter((key) =>
        key.startsWith("diff "),
      )) {
        for (const code of [1, 128]) {
          const failure = yield* Effect.flip(
            loadWithResults({
              ...results,
              [command]: { code, stderr: "cannot read file" },
            }),
          );

          assert.match(
            failure.message,
            /git diff.*unavailable.*cannot read file/,
          );
        }

        const launchFailure = new CommandError({
          command: "git",
          args: command.split(" "),
          cwd: "/fixture",
          stdout: "",
          stderr: "",
          cause: PlatformError.systemError({
            // oxlint-disable-next-line project-effect/no-manual-tagged-construction -- The platform factory requires its normalized reason tag.
            _tag: "NotFound",
            module: "ChildProcess",
            method: "spawn",
          }),
        });

        const unavailable = yield* Effect.flip(
          loadWithResults({ ...results, [command]: launchFailure }),
        );

        assert.equal(unavailable.cause, launchFailure);
        assert.include(unavailable.message, "not found (NotFound)");
      }
    }),
);
