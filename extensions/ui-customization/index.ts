import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import {
  getCapabilities,
  hyperlink,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import {
  emptyGitInfoState,
  emptyModelInfoState,
  GIT_INFO_CHANNEL,
  MODEL_INFO_CHANNEL,
  REFRESH_CHANNEL,
  isGitInfoState,
  isModelInfoState,
} from "../shared/dashboard-state.ts";

import {
  BOLD,
  gradientText,
  RESET,
  sanitizeTerminalLabel,
  TITLE_LINES,
} from "./src/theme-rendering.ts";

function formatTokens(tokens: number) {
  if (tokens < 1_000) return `${tokens}`;
  if (tokens < 1_000_000) return `${Math.round(tokens / 1_000)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}m`;
}

function formatDirectory(cwd: string) {
  const home = NodeOS.homedir();
  if (cwd === home) return "~";
  const display = cwd.startsWith(`${home}/`)
    ? `~/${NodePath.relative(home, cwd)}`
    : cwd;
  return sanitizeTerminalLabel(display);
}

function center(text: string, width: number) {
  const padding = Math.max(0, Math.floor((width - visibleWidth(text)) / 2));
  return truncateToWidth(`${" ".repeat(padding)}${text}`, width);
}

function columns(left: string, right: string, width: number) {
  if (!right) return truncateToWidth(left, width);

  const naturalGap = width - visibleWidth(left) - visibleWidth(right);
  if (naturalGap >= 1) return `${left}${" ".repeat(naturalGap)}${right}`;

  const leftWidth = Math.max(1, Math.floor(width * 0.45));
  const rightWidth = Math.max(1, width - leftWidth - 1);
  const fittedLeft = truncateToWidth(left, leftWidth);
  const fittedRight = truncateToWidth(right, rightWidth);
  const gap = Math.max(
    1,
    width - visibleWidth(fittedLeft) - visibleWidth(fittedRight),
  );
  return truncateToWidth(
    `${fittedLeft}${" ".repeat(gap)}${fittedRight}`,
    width,
  );
}

interface UiState {
  title: string;
  modelInfo: ReturnType<typeof emptyModelInfoState>;
  gitInfo: ReturnType<typeof emptyGitInfoState>;
  requestRender: (() => void) | undefined;
}

function renderGit(gitInfo: UiState["gitInfo"]) {
  if (gitInfo.unavailable !== null)
    return sanitizeTerminalLabel(gitInfo.unavailable);
  const fileLabel = gitInfo.changedFiles === 1 ? "file" : "files";
  let git = gitInfo.branch
    ? `${gitInfo.branch} · ${gitInfo.changedFiles} ${fileLabel} changed`
    : "";
  if (gitInfo.pullRequest) {
    const prLabel = `PR #${gitInfo.pullRequest.number}`;
    const linkedPr = getCapabilities().hyperlinks
      ? hyperlink(prLabel, gitInfo.pullRequest.url)
      : prLabel;
    git += ` · ${linkedPr}`;
  }
  return git;
}

function renderFooter(
  state: UiState,
  ctx: ExtensionContext,
  footerData: ReadonlyFooterDataProvider,
  theme: ExtensionContext["ui"]["theme"],
  width: number,
) {
  const directory = theme.fg("text", formatDirectory(ctx.cwd));
  const git = renderGit(state.gitInfo);
  const contextPercent =
    state.modelInfo.contextPercent === null
      ? "?"
      : `${Math.round(state.modelInfo.contextPercent)}`;
  const contextWindow =
    state.modelInfo.contextWindow > 0
      ? formatTokens(state.modelInfo.contextWindow)
      : "?";
  const tps =
    state.modelInfo.tokensPerSecond === null
      ? "— tok/s"
      : `~${Math.round(state.modelInfo.tokensPerSecond)} tok/s`;
  const usage = `${contextPercent}%/${contextWindow} · branch assistant est. $${state.modelInfo.cost.toFixed(2)} · ${tps}`;
  const model = state.modelInfo.provider
    ? `${state.modelInfo.provider}/${state.modelInfo.modelId} · ${state.modelInfo.thinking}`
    : state.modelInfo.modelId;
  const lines = [
    columns(directory, theme.fg("muted", model), width),
    ...(visibleWidth(usage) + visibleWidth(git) + 1 <= width
      ? [columns(theme.fg("muted", usage), theme.fg("muted", git), width)]
      : [
          ...wrapTextWithAnsi(theme.fg("muted", usage), width),
          ...(git ? [truncateToWidth(theme.fg("muted", git), width)] : []),
        ]),
  ];
  const statuses = footerData.getExtensionStatuses();
  for (const statusLine of Array.from(statuses.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([, text]) => text.split("\n"))) {
    lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
  }
  return lines;
}

function install(pi: ExtensionAPI, state: UiState, ctx: ExtensionContext) {
  if (ctx.mode !== "tui") return;
  ctx.ui.setHeader((tui) => {
    state.requestRender = () => tui.requestRender();
    return {
      render(width: number) {
        const art = TITLE_LINES.map((line, row) =>
          center(gradientText(line, row * 0.045), width),
        );
        const subtitle = center(
          `${BOLD}${gradientText(state.title, 0.18)}${RESET}`,
          width,
        );
        return ["", ...art, subtitle, ""];
      },
      invalidate() {},
    };
  });
  ctx.ui.setFooter((tui, theme, footerData) => {
    state.requestRender = () => tui.requestRender();
    return {
      invalidate() {},
      render: (width: number) =>
        renderFooter(state, ctx, footerData, theme, width),
    };
  });
  ctx.ui.setTitle(`pi · ${state.title}`);
  pi.events.emit(REFRESH_CHANNEL, undefined);
}

export default function uiCustomization(pi: ExtensionAPI) {
  const state: UiState = {
    title: "pi",
    modelInfo: emptyModelInfoState(),
    gitInfo: emptyGitInfoState(),
    requestRender: undefined,
  };

  const stopModelListener = pi.events.on(MODEL_INFO_CHANNEL, (value) => {
    if (!isModelInfoState(value)) return;
    state.modelInfo = value;
    state.requestRender?.();
  });

  const stopGitListener = pi.events.on(GIT_INFO_CHANNEL, (value) => {
    if (!isGitInfoState(value)) return;
    state.gitInfo = value;
    state.requestRender?.();
  });

  pi.on("session_start", (_event, ctx) => {
    state.title = formatDirectory(ctx.cwd);
    state.modelInfo = emptyModelInfoState();
    state.gitInfo = emptyGitInfoState();
    install(pi, state, ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    stopModelListener();
    stopGitListener();
    state.requestRender = undefined;
    if (ctx.mode === "tui") {
      ctx.ui.setHeader(undefined);
      ctx.ui.setFooter(undefined);
    }
  });
}
