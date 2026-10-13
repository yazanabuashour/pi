import { assert } from "@effect/vitest";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";
import { Effect } from "effect";
import { loadChangedFiles } from "./src/changed-files-view.ts";
import { CommandRunner } from "./src/process.ts";

export function loadFromGit(root: string, env: NodeJS.ProcessEnv) {
  return loadChangedFiles(root).pipe(
    Effect.provideService(CommandRunner, {
      run: (command, args, cwd) =>
        Effect.sync(() => {
          const result = NodeChildProcess.spawnSync(command, args, {
            cwd,
            env,
            encoding: "utf8",
          });

          if (result.error) throw result.error;

          if (result.status === null)
            throw new Error("Fixture did not observe process exit");

          return {
            code: result.status,
            stdout: result.stdout,
            stderr: result.stderr,
          };
        }),
    }),
  );
}

export function assertDirectoryTransitions(
  root: string,
  env: NodeJS.ProcessEnv,
  git: (...args: string[]) => string,
) {
  return Effect.gen(function* () {
    const load = () => loadFromGit(root, env);
    NodeFS.renameSync(
      NodePath.join(root, "config"),
      NodePath.join(root, "temporary"),
    );
    NodeFS.mkdirSync(NodePath.join(root, "config"));
    NodeFS.renameSync(
      NodePath.join(root, "temporary"),
      NodePath.join(root, "config/main"),
    );
    NodeFS.writeFileSync(NodePath.join(root, "config/extra"), "unrelated\n");
    git("add", "config");

    const directoryRename = (yield* load())?.find(
      ({ path }) => path === "config/main",
    );

    assert.equal(directoryRename?.additions, 0);
    assert.equal(directoryRename?.deletions, 0);
    assert.notInclude(directoryRename?.diff.join("\n") ?? "", "config/extra");
    NodeFS.writeFileSync(
      NodePath.join(root, "config/binary"),
      new Uint8Array([0, 1, 2]),
    );
    git("add", "config/binary");

    const withBinary = (yield* load())?.find(
      ({ path }) => path === "config/main",
    );

    assert.equal(withBinary?.additions, 0);
    assert.notInclude(withBinary?.diff.join("\n") ?? "", "config/binary");
    git("mv", "destination/old", "outside");
    NodeFS.rmdirSync(NodePath.join(root, "destination"));
    git("mv", "move", "destination");

    const replacedDirectory = (yield* load())?.find(
      ({ path }) => path === "destination",
    );

    assert.equal(replacedDirectory?.additions, 0);
    assert.equal(replacedDirectory?.deletions, 0);
    assert.notInclude(
      replacedDirectory?.diff.join("\n") ?? "",
      "destination/old",
    );
  });
}
