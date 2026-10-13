import { assert, it } from "@effect/vitest";
import { Effect, PlatformError } from "effect";
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
