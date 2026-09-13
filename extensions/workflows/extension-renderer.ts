import {
  getMarkdownTheme,
  keyHint,
  type AgentToolResult,
} from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { extractMeta, type WorkflowMeta } from "./meta.ts";
import {
  agentContext,
  aggregateUsage,
  countStates,
  formatElapsed,
  formatUsage,
  phaseGroups,
  resultJson,
  stateSquare,
  statusColor,
  statusWord,
  SQUARE,
  type Theme,
  type WorkflowDetails,
} from "./model.ts";
import type { WorkflowInput } from "./extension-contract.ts";

function header(details: WorkflowDetails, theme: Theme) {
  const { done, failed } = countStates(details);
  let text =
    `${theme.fg(statusColor(details.status), SQUARE)} ${theme.fg("toolTitle", theme.bold("workflow "))}` +
    `${theme.fg("accent", details.name ?? details.runId)} ` +
    theme.fg(
      "dim",
      `${done + failed}/${details.agents.length} agents · ${formatElapsed(details.startedAt, details.finishedAt)} · `,
    ) +
    theme.fg(statusColor(details.status), statusWord(details.status));
  if (failed) text += theme.fg("error", ` · ${failed} failed`);
  if (details.background) text += theme.fg("dim", " (background)");
  if (details.status === "running" && details.currentPhase) {
    text += theme.fg("muted", ` · ${details.currentPhase}`);
  }
  return text;
}

function collapsed(details: WorkflowDetails, theme: Theme) {
  let text = header(details, theme);
  for (const agent of details.agents) {
    const context = agentContext(agent);
    text += `\n  ${stateSquare(agent.state, theme)} ${theme.fg("accent", agent.label)}${
      agent.phase ? theme.fg("dim", ` (${agent.phase})`) : ""
    }${theme.fg(
      "dim",
      `${context ? ` · ${context}` : ""} · ${formatElapsed(agent.startedAt, agent.finishedAt)}`,
    )}`;
  }
  const totals = formatUsage(aggregateUsage(details.agents));
  if (totals) text += `\n  ${theme.fg("dim", `Total: ${totals}`)}`;
  if (details.error)
    text += `\n  ${theme.fg("error", `Error: ${details.error}`)}`;
  text += `\n${theme.fg("muted", `(${keyHint("app.tools.expand", "to expand")})`)}`;
  return new Text(text, 0, 0);
}

function addAgents(
  container: Container,
  details: WorkflowDetails,
  theme: Theme,
) {
  for (const group of phaseGroups(details)) {
    container.addChild(new Spacer(1));
    container.addChild(
      new Text(theme.fg("muted", `─── ${group.title} ───`), 0, 0),
    );
    for (const agent of group.agents) {
      const usage = formatUsage(agent.usage, agent.model);
      const context = agentContext(agent);
      let line = `${stateSquare(agent.state, theme)} ${theme.fg("accent", agent.label)} ${theme.fg(
        "dim",
        [context, formatElapsed(agent.startedAt, agent.finishedAt)]
          .filter(Boolean)
          .join(" · "),
      )}`;
      if (usage) line += ` ${theme.fg("dim", usage)}`;
      container.addChild(new Text(line, 0, 0));
      if (agent.error) {
        container.addChild(
          new Text(`  ${theme.fg("error", agent.error)}`, 0, 0),
        );
      } else if (agent.preview) {
        const preview = agent.preview.split("\n").slice(0, 2).join(" ");
        container.addChild(new Text(`  ${theme.fg("dim", preview)}`, 0, 0));
      }
    }
  }
}

function expanded(details: WorkflowDetails, theme: Theme) {
  const container = new Container();
  container.addChild(new Text(header(details, theme), 0, 0));
  if (details.description) {
    container.addChild(new Text(theme.fg("dim", details.description), 0, 0));
  }
  addAgents(container, details, theme);
  if (details.error) {
    container.addChild(new Spacer(1));
    container.addChild(
      new Text(theme.fg("error", `Error: ${details.error}`), 0, 0),
    );
  }
  if (details.result !== undefined) {
    container.addChild(new Spacer(1));
    container.addChild(new Text(theme.fg("muted", "─── result ───"), 0, 0));
    container.addChild(
      new Markdown(
        `\`\`\`json\n${resultJson(details.result)}\n\`\`\``,
        0,
        0,
        getMarkdownTheme(),
      ),
    );
  }
  const totals = formatUsage(aggregateUsage(details.agents));
  if (totals) {
    container.addChild(new Spacer(1));
    container.addChild(new Text(theme.fg("dim", `Total: ${totals}`), 0, 0));
  }
  return container;
}

export function renderWorkflowCall(args: Partial<WorkflowInput>, theme: Theme) {
  const meta: WorkflowMeta = args.script
    ? extractMeta(args.script)
    : { phases: [] };
  let text =
    theme.fg("toolTitle", theme.bold("workflow ")) +
    theme.fg("accent", meta.name ?? "(script)");
  if (args.background) text += theme.fg("dim", " (background)");
  if (meta.description) text += `\n  ${theme.fg("dim", meta.description)}`;
  for (const phase of meta.phases.slice(0, 8)) {
    text += `\n  ${theme.fg("dim", SQUARE)} ${theme.fg("accent", phase.title)}${
      phase.detail ? theme.fg("dim", ` — ${phase.detail}`) : ""
    }`;
  }
  return new Text(text, 0, 0);
}

export function renderWorkflowResult(
  result: AgentToolResult<WorkflowDetails>,
  expandedView: boolean,
  theme: Theme,
) {
  const details = result.details;
  if (!details) {
    const first = result.content[0];
    return new Text(first?.type === "text" ? first.text : "(no output)", 0, 0);
  }
  return expandedView ? expanded(details, theme) : collapsed(details, theme);
}
