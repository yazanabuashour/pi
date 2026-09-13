import { Effect, Result, Semaphore } from "effect";
import {
  emptyGitInfoState,
  type GitInfoState,
  type PullRequestInfo,
} from "../../shared/dashboard-state.ts";
import { loadRepository, lookupPullRequest } from "./repository.ts";

export class GitInfoRefresh {
  private state = emptyGitInfoState();
  private generation = 0;
  private queriedPr: { cwd: string; branch: string } | null = null;
  // Cache failures too; explicit refresh or a different cwd/branch re-queries gh.
  private pullRequest: Result.Result<PullRequestInfo | null, Error> =
    Result.succeed(null);
  private readonly semaphore = Semaphore.makeUnsafe(1);
  private readonly publish: (state: GitInfoState) => void;

  constructor(publish: (state: GitInfoState) => void) {
    this.publish = publish;
  }

  get snapshot(): GitInfoState {
    if (this.state.unavailable !== null) return { ...this.state };
    return {
      ...this.state,
      pullRequest: this.state.pullRequest
        ? { ...this.state.pullRequest }
        : null,
    };
  }

  /** Discard in-flight and queued results and forget the session's PR cache. */
  invalidate() {
    this.generation += 1;
    this.queriedPr = null;
    this.pullRequest = Result.succeed(null);
  }

  /** Explicit requests wait their turn and always query the pull request. */
  refresh(cwd: string) {
    return this.semaphore.withPermit(this.load(cwd, true, this.generation));
  }

  /** Background requests coalesce while another refresh owns the snapshot. */
  refreshIfIdle(cwd: string) {
    return this.semaphore
      .withPermitsIfAvailable(1)(this.load(cwd, false, this.generation))
      .pipe(Effect.asVoid);
  }

  private load(cwd: string, forcePullRequest: boolean, generation: number) {
    return Effect.suspend(() => {
      if (generation !== this.generation) return Effect.void;
      return this.loadRepositoryState(cwd, forcePullRequest, generation).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            if (generation !== this.generation) return;
            this.state = { unavailable: error.message };
            this.publish(this.snapshot);
          }),
        ),
      );
    });
  }

  private loadRepositoryState(
    cwd: string,
    forcePullRequest: boolean,
    generation: number,
  ) {
    return Effect.gen({ self: this }, function* () {
      const repo = yield* loadRepository(cwd);
      if (generation !== this.generation) return;
      if (!repo || !repo.branchName) {
        this.queriedPr = null;
        this.pullRequest = Result.succeed(null);
      } else if (
        forcePullRequest ||
        cwd !== this.queriedPr?.cwd ||
        repo.branchName !== this.queriedPr?.branch
      ) {
        const pullRequest = yield* lookupPullRequest(cwd, repo.branchName).pipe(
          Effect.result,
        );
        if (generation !== this.generation) return;
        this.queriedPr = { cwd, branch: repo.branchName };
        this.pullRequest = pullRequest;
      }
      if (Result.isFailure(this.pullRequest))
        return yield* Effect.fail(this.pullRequest.failure);
      this.state = {
        unavailable: null,
        isRepository: repo !== null,
        branch: repo?.branch ?? null,
        changedFiles: repo?.changedFiles ?? 0,
        pullRequest: this.pullRequest.success,
      };
      this.publish(this.snapshot);
    });
  }
}
