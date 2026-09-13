import {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import {
  agentContext,
  formatElapsed,
  stateSquare,
  SQUARE,
  type AgentRecord,
  type Theme,
  type TranscriptEntry,
  type WorkflowDetails,
} from "./model.ts";

export class WorkflowTranscriptRenderer {
  transcriptScroll = 0;
  transcriptRowCount = 0;
  transcriptViewportSize = 1;
  private readonly theme: Theme;

  constructor(theme: Theme) {
    this.theme = theme;
  }

  private split(left: string, right: string, width: number) {
    const rightWidth = visibleWidth(right);
    let text = left;
    if (visibleWidth(text) + rightWidth + 1 > width) {
      text = truncateToWidth(text, Math.max(0, width - rightWidth - 2), "…");
    }
    const pad = Math.max(1, width - visibleWidth(text) - rightWidth);
    return text + " ".repeat(pad) + right;
  }

  private panel(title: string, rows: string[], width: number, height: number) {
    const inner = Math.max(0, width - 2);
    const top =
      "╭ " +
      title +
      " " +
      "─".repeat(Math.max(0, inner - visibleWidth(title) - 2)) +
      "╮";
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
    lines.push(this.theme.fg("borderMuted", "╰" + "─".repeat(inner) + "╯"));
    return lines;
  }

  private hintLine(hint: string, width: number) {
    return truncateToWidth(" " + this.theme.fg("dim", hint), width, "");
  }

  private transcriptRows(agent: AgentRecord, width: number): string[] {
    const theme = this.theme;
    const rows: string[] = [];
    if (agent.transcript.length === 0) {
      return [theme.fg("dim", " No transcript entries available.")];
    }

    for (const entry of agent.transcript) {
      const label = transcriptLabel(entry);
      const color = transcriptColor(entry);
      rows.push(
        ` ${theme.fg(color, SQUARE)} ${theme.bold(theme.fg(color, label))}`,
      );
      const contentWidth = Math.max(8, width - 4);
      const styled = theme.fg(
        entry.role === "thinking" ? "dim" : entry.isError ? "error" : "text",
        entry.text,
      );
      for (const line of wrapTextWithAnsi(styled, contentWidth)) {
        rows.push(`   ${line}`);
      }
      rows.push("");
    }
    return rows;
  }

  renderTranscript(
    details: WorkflowDetails,
    agent: AgentRecord,
    width: number,
    height: number,
  ): string[] {
    const theme = this.theme;
    const lines: string[] = [];
    const right = theme.fg(
      "dim",
      [
        agent.model,
        agentContext(agent),
        formatElapsed(agent.startedAt, agent.finishedAt),
      ]
        .filter(Boolean)
        .join(" · ") + " ",
    );
    lines.push(
      this.split(
        ` ${stateSquare(agent.state, theme)} ${theme.bold(theme.fg("accent", agent.label))}`,
        right,
        width,
      ),
    );
    lines.push(
      this.split(
        ` ${theme.fg("muted", `${details.name ?? details.runId} · ${agent.phase ?? "unphased"}`)}`,
        theme.fg("dim", `${agent.transcript.length} entries `),
        width,
      ),
    );

    const panelHeight = height - 3;
    const bodyHeight = Math.max(1, panelHeight - 2);
    const rows = this.transcriptRows(agent, width - 2);
    this.transcriptRowCount = rows.length;
    this.transcriptViewportSize = bodyHeight;
    const maxScroll = Math.max(0, rows.length - bodyHeight);
    this.transcriptScroll = Math.min(this.transcriptScroll, maxScroll);
    const visible = rows.slice(
      this.transcriptScroll,
      this.transcriptScroll + bodyHeight,
    );
    const position =
      rows.length > bodyHeight
        ? `Transcript · ${this.transcriptScroll + 1}-${Math.min(rows.length, this.transcriptScroll + bodyHeight)}/${rows.length}`
        : "Transcript";
    lines.push(...this.panel(position, visible, width, panelHeight));
    lines.push(
      this.hintLine(
        "j/k scroll · ctrl-u/d page · g/G top/bottom · h/left/esc back",
        width,
      ),
    );
    return lines;
  }
}

function transcriptLabel(entry: TranscriptEntry): string {
  if (entry.role === "user") return "USER";
  if (entry.role === "assistant") return "ASSISTANT";
  if (entry.role === "thinking") return "THINKING";
  if (entry.role === "tool") return `TOOL ${entry.name ?? "unknown"}`;
  return `RESULT ${entry.name ?? "unknown"}`;
}

function transcriptColor(
  entry: TranscriptEntry,
): "accent" | "success" | "dim" | "warning" | "error" | "muted" {
  if (entry.isError) return "error";
  if (entry.role === "user") return "accent";
  if (entry.role === "assistant") return "success";
  if (entry.role === "thinking") return "dim";
  if (entry.role === "tool") return "warning";
  return "muted";
}
