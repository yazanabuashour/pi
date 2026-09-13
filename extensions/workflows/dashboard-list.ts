import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { RunEntry } from "./dashboard-artifacts.ts";
import {
  countStates,
  formatElapsed,
  statusColor,
  statusWord,
  SQUARE,
  type Theme,
} from "./model.ts";

export class WorkflowListRenderer {
  private readonly theme: Theme;
  private readonly keybindings: KeybindingsManager;

  constructor(theme: Theme, keybindings: KeybindingsManager) {
    this.theme = theme;
    this.keybindings = keybindings;
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
    const border = (text: string) => this.theme.fg("borderMuted", text);
    const titleText = truncateToWidth(` ${title} `, Math.max(0, inner - 2));
    const dashes = Math.max(0, inner - visibleWidth(titleText) - 1);
    const lines = [border("╭─") + titleText + border(`${"─".repeat(dashes)}╮`)];
    for (let index = 0; index < Math.max(0, height - 2); index++) {
      const row = truncateToWidth(rows[index] ?? "", inner, "…");
      lines.push(
        border("│") +
          row +
          " ".repeat(Math.max(0, inner - visibleWidth(row))) +
          border("│"),
      );
    }
    lines.push(border(`╰${"─".repeat(inner)}╯`));
    return lines;
  }

  private keys(binding: Parameters<KeybindingsManager["getKeys"]>[0]) {
    return this.keybindings.getKeys(binding).join("/") || "unbound";
  }

  private hintLine(hint: string, width: number) {
    return truncateToWidth(this.theme.fg("dim", ` ${hint}`), width);
  }

  private rows(
    entries: RunEntry[],
    selectedIndex: number,
    bodyHeight: number,
    width: number,
  ) {
    const offset = Math.max(
      0,
      Math.min(
        selectedIndex - Math.floor(bodyHeight / 2),
        Math.max(0, entries.length - bodyHeight),
      ),
    );
    return entries
      .slice(offset, offset + bodyHeight)
      .map((entry, visibleIndex) => {
        const selected = offset + visibleIndex === selectedIndex;
        const details = entry.details;
        const marker = selected ? this.theme.fg("accent", "❯") : " ";
        const name = details.name ?? details.runId;
        const label = this.theme.fg(selected ? "accent" : "text", name);
        const { done, failed } = countStates(details);
        const right =
          this.theme.fg(
            "dim",
            `${done + failed}/${details.agents.length} agents · ${formatElapsed(details.startedAt, details.finishedAt)} · `,
          ) +
          this.theme.fg(
            statusColor(details.status),
            statusWord(details.status),
          ) +
          " ";
        const square = this.theme.fg(statusColor(details.status), SQUARE);
        return this.split(
          ` ${marker} ${square} ${label} ${this.theme.fg("dim", details.runId)}`,
          right,
          width - 2,
        );
      });
  }

  render(
    entries: RunEntry[],
    selectedIndex: number,
    width: number,
    height: number,
  ) {
    const header = this.split(
      " " + this.theme.bold(this.theme.fg("accent", "Workflows")),
      this.theme.fg(
        "dim",
        `${entries.length} run${entries.length === 1 ? "" : "s"} `,
      ),
      width,
    );
    const panelHeight = height - 2;
    if (entries.length === 0) {
      return [
        header,
        ...this.panel(
          "Runs",
          [this.theme.fg("dim", " no workflow runs yet")],
          width,
          panelHeight,
        ),
        this.hintLine(`${this.keys("tui.select.cancel")} close`, width),
      ];
    }
    return [
      header,
      ...this.panel(
        "Runs",
        this.rows(entries, selectedIndex, Math.max(0, panelHeight - 2), width),
        width,
        panelHeight,
      ),
      this.hintLine(
        `${this.keys("tui.select.up")}/${this.keys("tui.select.down")} select · ${this.keys("tui.select.confirm")} open · ${this.keys("tui.select.cancel")} close`,
        width,
      ),
    ];
  }
}
