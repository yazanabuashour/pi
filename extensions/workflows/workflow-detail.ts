import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
  agentContext,
  aggregateUsage,
  countStates,
  formatElapsed,
  formatUsage,
  stateSquare,
  statusColor,
  statusWord,
  SQUARE,
  type PhaseGroup,
  type Theme,
  type WorkflowDetails,
} from "./model.ts";

function groupSquare(group: PhaseGroup, theme: Theme) {
  if (group.agents.length === 0) return theme.fg("dim", SQUARE);
  if (group.agents.some((agent) => agent.state === "running")) {
    return theme.fg("warning", SQUARE);
  }
  if (group.agents.some((agent) => agent.state === "error")) {
    return theme.fg("error", SQUARE);
  }
  return theme.fg("success", SQUARE);
}

export interface WorkflowDetailSelection {
  phaseIndex: number;
  agentIndex: number;
  detailFocus: "phases" | "agents";
}

export class WorkflowDetailRenderer {
  private readonly theme: Theme;
  private readonly keybindings: KeybindingsManager;
  private readonly groups: () => PhaseGroup[];
  private readonly selection: WorkflowDetailSelection;

  constructor(
    theme: Theme,
    keybindings: KeybindingsManager,
    groups: () => PhaseGroup[],
    selection: WorkflowDetailSelection,
  ) {
    this.theme = theme;
    this.keybindings = keybindings;
    this.groups = groups;
    this.selection = selection;
  }

  private split(left: string, right: string, width: number) {
    const rightWidth = visibleWidth(right);
    let text = left;
    if (visibleWidth(text) + rightWidth + 1 > width) {
      text = truncateToWidth(text, Math.max(0, width - rightWidth - 2), "…");
    }
    return (
      text +
      " ".repeat(Math.max(1, width - visibleWidth(text) - rightWidth)) +
      right
    );
  }

  private panel(title: string, rows: string[], width: number, height: number) {
    const inner = Math.max(0, width - 2);
    const top = `╭ ${title} ${"─".repeat(Math.max(0, inner - visibleWidth(title) - 2))}╮`;
    const lines = [
      this.theme.fg("borderMuted", truncateToWidth(top, width, "")),
    ];
    for (let index = 0; index < height - 2; index++) {
      const row = truncateToWidth(rows[index] ?? "", inner, "…");
      lines.push(
        this.theme.fg("borderMuted", "│") +
          row +
          " ".repeat(Math.max(0, inner - visibleWidth(row))) +
          this.theme.fg("borderMuted", "│"),
      );
    }
    lines.push(this.theme.fg("borderMuted", `╰${"─".repeat(inner)}╯`));
    return lines;
  }

  private windowed<T>(items: T[], selected: number, size: number) {
    const offset = Math.max(
      0,
      Math.min(
        selected - Math.floor(size / 2),
        Math.max(0, items.length - size),
      ),
    );
    return { items: items.slice(offset, offset + size), offset };
  }

  private keys(binding: Parameters<KeybindingsManager["getKeys"]>[0]) {
    return this.keybindings.getKeys(binding).join("/") || "unbound";
  }

  private renderHeader(details: WorkflowDetails, width: number) {
    const { done, failed } = countStates(details);
    const right =
      this.theme.fg(
        "dim",
        `${done + failed}/${details.agents.length} agents · ${formatElapsed(details.startedAt, details.finishedAt)} · `,
      ) +
      this.theme.fg(statusColor(details.status), statusWord(details.status)) +
      " ";
    const totals = formatUsage(aggregateUsage(details.agents));
    return [
      this.split(
        " " +
          this.theme.bold(
            this.theme.fg("accent", details.name ?? details.runId),
          ),
        right,
        width,
      ),
      this.split(
        " " + this.theme.fg("muted", details.description ?? details.runId),
        totals ? this.theme.fg("dim", `${totals} `) : " ",
        width,
      ),
    ];
  }

  private phaseRows(
    groups: PhaseGroup[],
    innerWidth: number,
    bodyHeight: number,
  ) {
    const visible = this.windowed(
      groups,
      this.selection.phaseIndex,
      bodyHeight,
    );
    return visible.items.map((group, visibleIndex) => {
      const index = visible.offset + visibleIndex;
      const selected = index === this.selection.phaseIndex;
      const marker = selected
        ? this.theme.fg(
            this.selection.detailFocus === "phases" ? "accent" : "muted",
            "❯",
          )
        : " ";
      const done = group.agents.filter(
        (agent) => agent.state !== "running",
      ).length;
      const title = this.theme.fg(
        selected && this.selection.detailFocus === "phases" ? "accent" : "text",
        group.title,
      );
      const counts = this.theme.fg(
        "dim",
        group.agents.length > 0 ? `${done}/${group.agents.length} ` : "- ",
      );
      return this.split(
        ` ${marker} ${groupSquare(group, this.theme)} ${title}`,
        counts,
        innerWidth,
      );
    });
  }

  private agentRows(
    details: WorkflowDetails,
    group: PhaseGroup | undefined,
    innerWidth: number,
    bodyHeight: number,
  ) {
    const rows: string[] = [];
    if (group) {
      const maxLabel = Math.max(
        0,
        ...group.agents.map((agent) => agent.label.length),
      );
      const visible = this.windowed(
        group.agents,
        this.selection.agentIndex,
        bodyHeight,
      );
      for (const [visibleIndex, agent] of visible.items.entries()) {
        const selected =
          visible.offset + visibleIndex === this.selection.agentIndex;
        const marker =
          selected && this.selection.detailFocus === "agents"
            ? this.theme.fg("accent", "❯")
            : " ";
        const stats = [agent.model, agentContext(agent)]
          .filter(Boolean)
          .join(" · ");
        const label = this.theme.fg(
          selected && this.selection.detailFocus === "agents"
            ? "accent"
            : "text",
          agent.label.padEnd(Math.min(maxLabel, 40)),
        );
        const left = ` ${marker} ${stateSquare(agent.state, this.theme)} ${label}  ${this.theme.fg("dim", stats)}`;
        const right = this.theme.fg(
          "dim",
          `${formatElapsed(agent.startedAt, agent.finishedAt)} `,
        );
        rows.push(this.split(left, right, innerWidth));
        if (agent.error) {
          rows.push(
            truncateToWidth(
              `       ${this.theme.fg("error", agent.error)}`,
              innerWidth,
              "…",
            ),
          );
        }
      }
      if (group.agents.length === 0)
        rows.push(this.theme.fg("dim", " no agents in this phase yet"));
    }
    if (details.error) {
      rows.push(
        "",
        truncateToWidth(
          ` ${this.theme.fg("error", `workflow error: ${details.error}`)}`,
          innerWidth,
          "…",
        ),
      );
    }
    return rows;
  }

  private renderPanels(
    details: WorkflowDetails,
    width: number,
    height: number,
  ) {
    const groups = this.groups();
    this.selection.phaseIndex = Math.min(
      this.selection.phaseIndex,
      Math.max(0, groups.length - 1),
    );
    const selected = groups[this.selection.phaseIndex];
    const agents = selected?.agents ?? [];
    this.selection.agentIndex = Math.min(
      this.selection.agentIndex,
      Math.max(0, agents.length - 1),
    );
    const panelHeight = height - 3;
    const bodyHeight = Math.max(0, panelHeight - 2);
    const maxTitle = Math.max(8, ...groups.map((group) => group.title.length));
    const sidebarWidth = Math.min(
      Math.max(maxTitle + 12, 20),
      Math.floor(width / 3),
    );
    const agentsWidth = width - sidebarWidth - 1;
    const count = selected?.agents.length ?? 0;
    const title = selected
      ? `${selected.title} · ${count} agent${count === 1 ? "" : "s"}`
      : "Agents";
    const left = this.panel(
      "Phases",
      this.phaseRows(groups, sidebarWidth - 2, bodyHeight),
      sidebarWidth,
      panelHeight,
    );
    const right = this.panel(
      title,
      this.agentRows(details, selected, agentsWidth - 2, bodyHeight),
      agentsWidth,
      panelHeight,
    );
    return left.map((line, index) => `${line} ${right[index] ?? ""}`);
  }

  renderDetail(details: WorkflowDetails, width: number, height: number) {
    const hint =
      this.selection.detailFocus === "phases"
        ? `j/k select phase · l/${this.keys("tui.editor.cursorRight")}/${this.keys("tui.select.confirm")} agents · ${this.keys("tui.select.cancel")} back · s save report`
        : `j/k select agent · h/${this.keys("tui.editor.cursorLeft")}/${this.keys("tui.select.cancel")} phases · ${this.keys("tui.select.confirm")} transcript · s save report`;
    return [
      ...this.renderHeader(details, width),
      ...this.renderPanels(details, width, height),
      truncateToWidth(` ${this.theme.fg("dim", hint)}`, width, ""),
    ];
  }
}
