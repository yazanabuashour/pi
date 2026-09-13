import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Effect, Fiber, Schedule } from "effect";
import {
  GIT_INFO_CHANNEL,
  REFRESH_CHANNEL,
} from "../shared/dashboard-state.ts";
import {
  loadChangedFiles,
  showChangedFiles,
} from "./src/changed-files-view.ts";
import type { CommandRunner } from "./src/process.ts";
import { GitInfoRefresh } from "./src/refresh.ts";
import {
  createRuntime,
  runEffect,
  type GitInfoRuntime,
} from "./src/runtime.ts";

const POLL_INTERVAL_MS = 3_000;

class GitInfoController {
  private runtime: GitInfoRuntime | undefined;
  private pollingFiber: Fiber.Fiber<void> | undefined;
  private currentContext: ExtensionContext | undefined;
  private readonly refresh: GitInfoRefresh;
  private stopRefreshListener: (() => void) | undefined;
  private readonly pi: ExtensionAPI;

  constructor(pi: ExtensionAPI) {
    this.pi = pi;
    this.refresh = new GitInfoRefresh((state) =>
      pi.events.emit(GIT_INFO_CHANNEL, state),
    );
  }

  install() {
    this.stopRefreshListener = this.pi.events.on(REFRESH_CHANNEL, () => {
      if (this.currentContext) this.refreshInBackground(this.currentContext);
    });
    this.installLifecycle();
    this.installCommands();
  }

  private getRuntime() {
    return (this.runtime ??= createRuntime());
  }

  private reportBackgroundDefect<Input1>(defect: Input1) {
    return Effect.logError("git-info background task defect", defect);
  }

  private poll() {
    return Effect.suspend(() =>
      this.currentContext
        ? this.refresh.refreshIfIdle(this.currentContext.cwd)
        : Effect.void,
    ).pipe(
      Effect.catchDefect((defect) => this.reportBackgroundDefect(defect)),
      Effect.repeat(Schedule.fixed(POLL_INTERVAL_MS)),
      Effect.delay(POLL_INTERVAL_MS),
      Effect.asVoid,
    );
  }

  private forkBackground(effect: Effect.Effect<void, never, CommandRunner>) {
    return this.getRuntime().runFork(
      effect.pipe(
        Effect.catchDefect((defect) => this.reportBackgroundDefect(defect)),
      ),
    );
  }

  private refreshInBackground(ctx: ExtensionContext) {
    this.currentContext = ctx;
    this.forkBackground(this.refresh.refreshIfIdle(ctx.cwd));
  }

  private installLifecycle() {
    this.pi.on("session_start", async (_event, ctx) => {
      this.refresh.invalidate();
      const previous = this.pollingFiber;
      this.pollingFiber = undefined;
      if (previous)
        await this.getRuntime().runPromise(Fiber.interrupt(previous));
      this.refreshInBackground(ctx);
      this.pollingFiber = this.forkBackground(this.poll());
    });
    this.pi.on("input", (_event, ctx) => {
      this.refreshInBackground(ctx);
      return { action: "continue" };
    });
    this.pi.on("tool_execution_end", (_event, ctx) =>
      this.refreshInBackground(ctx),
    );
    this.pi.on("session_shutdown", async () => {
      this.stopRefreshListener?.();
      this.refresh.invalidate();
      this.currentContext = undefined;
      this.pollingFiber = undefined;
      const closing = this.runtime;
      this.runtime = undefined;
      await closing?.dispose();
    });
  }

  private installCommands() {
    this.pi.registerCommand("lg", {
      description: "Browse changed files and their diffs",
      handler: async (_args, ctx) => this.showLocalChanges(ctx),
    });
    this.pi.registerCommand("pr", {
      description: "Refresh git and pull request information",
      handler: async (_args, ctx) => this.showPullRequest(ctx),
    });
  }

  private async showLocalChanges(ctx: ExtensionContext) {
    if (ctx.mode !== "tui") {
      ctx.ui.notify(
        "The local changes viewer requires the interactive TUI",
        "warning",
      );
      return;
    }
    const files = await runEffect(
      this.getRuntime(),
      loadChangedFiles(ctx.cwd),
      {
        signal: ctx.signal,
        interruptMessage: "Loading changed files was cancelled.",
      },
    );
    if (files === null) return ctx.ui.notify("Not a git repository", "warning");
    if (files.length === 0)
      return ctx.ui.notify("Working tree is clean", "info");
    await showChangedFiles(ctx, files);
  }

  private async showPullRequest(ctx: ExtensionContext) {
    this.currentContext = ctx;
    await runEffect(this.getRuntime(), this.refresh.refresh(ctx.cwd), {
      signal: ctx.signal,
      interruptMessage: "Git and pull request refresh was cancelled.",
    });
    const state = this.refresh.snapshot;
    if (state.unavailable !== null) ctx.ui.notify(state.unavailable, "warning");
    else if (!state.isRepository)
      ctx.ui.notify("Not a git repository", "warning");
    else if (state.pullRequest) {
      ctx.ui.notify(
        `PR #${state.pullRequest.number}: ${state.pullRequest.url}`,
        "info",
      );
    } else ctx.ui.notify(`No open PR found for ${state.branch}`, "info");
  }
}

export default function gitInfo(pi: ExtensionAPI) {
  new GitInfoController(pi).install();
}
