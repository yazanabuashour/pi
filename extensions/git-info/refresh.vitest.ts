import { assert, it } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";
import {
  emptyGitInfoState,
  type GitInfoState,
} from "../shared/dashboard-state.ts";
import { CommandRunner, type CommandResult } from "./src/process.ts";
import { GitInfoRefresh } from "./src/refresh.ts";

const repoCommand = "rev-parse --is-inside-work-tree";
const branchCommand = "branch --show-current";
const prCommand = "pr view main --json number,url,state,isDraft";
const openPr = {
  number: 7,
  url: "https://example.test/org/repo/pull/7",
  state: "OPEN",
  isDraft: false,
};
const result = (value: Partial<CommandResult>) =>
  Effect.succeed({ code: 0, stdout: "", stderr: "", ...value });

function fixture() {
  const requests: string[] = [];
  const published: GitInfoState[] = [];
  const responses = new Map([
    [repoCommand, result({ stdout: "true" })],
    [branchCommand, result({ stdout: "main" })],
    ["status --porcelain=v1 --untracked-files=all", result({ stdout: "" })],
    [prCommand, result({ stdout: JSON.stringify(openPr) })],
  ]);
  const runner = CommandRunner.of({
    run: (_command, args) =>
      Effect.suspend(() => {
        const command = args.join(" ");
        requests.push(command);
        const response = responses.get(command);
        assert.ok(response, `Unexpected command: ${command}`);
        return response;
      }),
  });
  const refresh = new GitInfoRefresh((state) => published.push(state));
  return { requests, published, responses, runner, refresh };
}

it.effect("forced refreshes queue while background refreshes coalesce", () => {
  const f = fixture();
  return Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    f.responses.set(
      prCommand,
      Effect.gen(function* () {
        yield* Deferred.succeed(started, undefined);
        yield* Deferred.await(release);
        return yield* result({ stdout: JSON.stringify(openPr) });
      }),
    );
    const background = yield* Effect.forkChild(
      f.refresh.refreshIfIdle("/fixture"),
    );
    yield* Deferred.await(started);
    const forced = yield* Effect.forkChild(f.refresh.refresh("/fixture"));
    const forcedAgain = yield* Effect.forkChild(f.refresh.refresh("/fixture"));
    yield* Effect.yieldNow;
    yield* f.refresh.refreshIfIdle("/fixture");
    assert.lengthOf(
      f.requests.filter((c) => c === repoCommand),
      1,
    );
    assert.deepEqual(f.refresh.snapshot, emptyGitInfoState());

    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(background);
    yield* Fiber.join(forced);
    yield* Fiber.join(forcedAgain);
    assert.lengthOf(
      f.requests.filter((c) => c === prCommand),
      3,
    );
    assert.lengthOf(f.published, 3);
    assert.deepEqual(f.refresh.snapshot, {
      unavailable: null,
      isRepository: true,
      branch: "main",
      changedFiles: 0,
      pullRequest: { number: openPr.number, url: openPr.url, isDraft: false },
    });
  }).pipe(Effect.provideService(CommandRunner, f.runner));
});

it.effect(
  "invalidation discards active PR results and queued refreshes without caching them",
  () => {
    const f = fixture();
    return Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      f.responses.set(
        prCommand,
        Effect.gen(function* () {
          yield* Deferred.succeed(started, undefined);
          yield* Deferred.await(release);
          return yield* result({
            code: 4,
            stderr: "private authentication error",
          });
        }),
      );
      const active = yield* Effect.forkChild(
        f.refresh.refreshIfIdle("/fixture"),
      );
      yield* Deferred.await(started);
      const queued = yield* Effect.forkChild(f.refresh.refresh("/fixture"));
      yield* Effect.yieldNow;
      f.refresh.invalidate();
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(active);
      yield* Fiber.join(queued);
      assert.deepEqual(f.refresh.snapshot, emptyGitInfoState());
      assert.isEmpty(f.published);
      assert.lengthOf(
        f.requests.filter((c) => c === repoCommand),
        1,
      );

      f.responses.set(prCommand, result({ stdout: JSON.stringify(openPr) }));
      yield* f.refresh.refreshIfIdle("/fixture");
      assert.lengthOf(
        f.requests.filter((c) => c === prCommand),
        2,
      );
      assert.equal(f.refresh.snapshot.unavailable, null);
      assert.lengthOf(f.published, 1);
    }).pipe(Effect.provideService(CommandRunner, f.runner));
  },
);

it.effect(
  "invalidation prevents stale repository success and failure from publishing",
  () => {
    const f = fixture();
    return Effect.gen(function* () {
      yield* f.refresh.refresh("/fixture");
      const snapshot = f.refresh.snapshot;
      for (const response of [{ stdout: "true" }, { code: 1 }]) {
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        f.responses.set(
          repoCommand,
          Effect.gen(function* () {
            yield* Deferred.succeed(started, undefined);
            yield* Deferred.await(release);
            return yield* result(response);
          }),
        );
        const active = yield* Effect.forkChild(f.refresh.refresh("/fixture"));
        yield* Deferred.await(started);
        f.refresh.invalidate();
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(active);
        assert.deepEqual(f.refresh.snapshot, snapshot);
        assert.lengthOf(f.published, 1);
        assert.lengthOf(
          f.requests.filter((c) => c === prCommand),
          1,
        );
      }
    }).pipe(Effect.provideService(CommandRunner, f.runner));
  },
);

it.effect(
  "PR cache is isolated from observers and refreshed on forced, cwd, branch or session changes",
  () => {
    const f = fixture();
    return Effect.gen(function* () {
      yield* f.refresh.refreshIfIdle("/fixture");
      const pristine = f.refresh.snapshot;
      const snapshot = f.refresh.snapshot;
      const published = f.published[0];
      assert.ok(snapshot.unavailable === null && snapshot.pullRequest);
      assert.ok(published?.unavailable === null && published.pullRequest);
      snapshot.pullRequest.number = 99;
      published.pullRequest.number = 100;
      assert.deepEqual(f.refresh.snapshot, pristine);
      f.responses.set(prCommand, result({ code: 4, stderr: "private error" }));
      yield* f.refresh.refreshIfIdle("/fixture");
      assert.deepEqual(f.refresh.snapshot, pristine);
      assert.lengthOf(
        f.requests.filter((c) => c === prCommand),
        1,
      );

      yield* f.refresh.refresh("/fixture");
      const unavailable = f.refresh.snapshot;
      assert.deepEqual(unavailable, {
        unavailable: "Git unavailable: gh pr view authentication required",
      });
      f.responses.set(prCommand, result({ stdout: JSON.stringify(openPr) }));
      yield* f.refresh.refreshIfIdle("/fixture");
      assert.deepEqual(f.refresh.snapshot, unavailable);
      assert.lengthOf(
        f.requests.filter((c) => c === prCommand),
        2,
      );

      f.refresh.invalidate();
      yield* f.refresh.refreshIfIdle("/fixture");
      assert.equal(f.refresh.snapshot.unavailable, null);
      assert.lengthOf(
        f.requests.filter((c) => c === prCommand),
        3,
      );

      f.responses.set(branchCommand, result({ stdout: "next" }));
      const nextPrCommand = "pr view next --json number,url,state,isDraft";
      f.responses.set(
        nextPrCommand,
        result({
          code: -1,
        }),
      );
      yield* f.refresh.refreshIfIdle("/fixture");
      assert.deepEqual(f.refresh.snapshot, {
        unavailable: "Git unavailable: gh pr view timed out",
      });

      f.responses.set(
        nextPrCommand,
        result({ stdout: JSON.stringify(openPr) }),
      );
      yield* f.refresh.refreshIfIdle("/other-repository");
      assert.equal(f.refresh.snapshot.unavailable, null);
      f.responses.set(nextPrCommand, result({ code: -1 }));
      yield* f.refresh.refreshIfIdle("/fixture");
      assert.deepEqual(f.refresh.snapshot, {
        unavailable: "Git unavailable: gh pr view timed out",
      });
      assert.lengthOf(
        f.requests.filter((c) => c === nextPrCommand),
        3,
      );
    }).pipe(Effect.provideService(CommandRunner, f.runner));
  },
);
