import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  loadChangedFiles,
  sanitizeTerminalText,
} from "./src/changed-files-view.ts";
import { CommandRunner, type CommandResult } from "./src/process.ts";

it("repository text cannot inject terminal control sequences", () => {
  const input =
    "before\u001b]52;c;Y2xpcGJvYXJk\u0007after\u001b[31mred\u001b[0m\u0001";
  assert.equal(sanitizeTerminalText(input), "beforeafterred");
});

function loadWithResults(results: Record<string, Partial<CommandResult>>) {
  return loadChangedFiles("/fixture").pipe(
    Effect.provideService(CommandRunner, {
      run: (_command, args) =>
        Effect.succeed({
          code: 0,
          stdout: args.includes("--show-toplevel") ? "/fixture" : "",
          stderr: "",
          ...results[args.join(" ")],
        }),
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
          [command]: { code: -1, stderr: "permission denied" },
        }),
      );
      assert.equal(
        failure.message,
        `git ${operation} unavailable (exit -1): permission denied`,
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
      for (const command of Object.keys(results).filter((key) =>
        key.startsWith("diff "),
      )) {
        const failure = yield* Effect.flip(
          loadWithResults({
            ...results,
            [command]: { code: 128, stderr: "cannot read file" },
          }),
        );
        assert.match(
          failure.message,
          /git diff.*unavailable.*cannot read file/,
        );
      }
    }),
);
