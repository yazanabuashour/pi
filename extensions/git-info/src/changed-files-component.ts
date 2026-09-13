import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  type TUI,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import type { ChangedFile } from "./changed-files-view.ts";

const DIFF_SCROLL_STEP = 5;

function padToWidth(text: string, width: number) {
  const truncated = truncateToWidth(text, width, "");
  return `${truncated}${" ".repeat(Math.max(0, width - visibleWidth(truncated)))}`;
}

export class ChangedFilesComponent {
  private focus: "files" | "diff" = "files";
  private selectedIndex = 0;
  private sidebarOffset = 0;
  private diffOffset = 0;
  private readonly tui: TUI;
  private readonly theme: Theme;
  private readonly files: ChangedFile[];
  private readonly done: () => void;

  constructor(tui: TUI, theme: Theme, files: ChangedFile[], done: () => void) {
    this.tui = tui;
    this.theme = theme;
    this.files = files;
    this.done = done;
  }

  private bodyHeight() {
    return Math.max(8, Math.floor(this.tui.terminal.rows * 0.8) - 2);
  }

  private ensureSelectedFileVisible() {
    const visibleFiles = Math.max(1, Math.floor(this.bodyHeight() / 2));
    if (this.selectedIndex < this.sidebarOffset)
      this.sidebarOffset = this.selectedIndex;
    if (this.selectedIndex >= this.sidebarOffset + visibleFiles) {
      this.sidebarOffset = this.selectedIndex - visibleFiles + 1;
    }
  }

  private moveFile(amount: number) {
    this.selectedIndex =
      (this.selectedIndex + amount + this.files.length) % this.files.length;
    this.diffOffset = 0;
    this.ensureSelectedFileVisible();
    this.tui.requestRender();
  }

  private moveDiff(amount: number) {
    const maxOffset = Math.max(
      0,
      this.selectedFile().diff.length - this.bodyHeight(),
    );
    this.diffOffset = Math.max(
      0,
      Math.min(maxOffset, this.diffOffset + amount),
    );
    this.tui.requestRender();
  }

  handleInput = (data: string) => {
    if (this.focus === "files") this.handleFileInput(data);
    else this.handleDiffInput(data);
  };

  private handleFileInput(data: string) {
    if (matchesKey(data, Key.escape)) return this.done();
    if (matchesKey(data, Key.down) || data === "j") return this.moveFile(1);
    if (matchesKey(data, Key.up) || data === "k") return this.moveFile(-1);
    if (matchesKey(data, Key.home) || data === "g") {
      this.selectedIndex = 0;
      this.diffOffset = 0;
      this.ensureSelectedFileVisible();
      return this.tui.requestRender();
    }
    if (matchesKey(data, Key.end) || data === "G") {
      this.selectedIndex = this.files.length - 1;
      this.diffOffset = 0;
      this.ensureSelectedFileVisible();
      return this.tui.requestRender();
    }
    if (
      matchesKey(data, Key.enter) ||
      matchesKey(data, Key.space) ||
      matchesKey(data, Key.right) ||
      data === "l"
    ) {
      this.focus = "diff";
      this.tui.requestRender();
    }
  }

  private handleDiffInput(data: string) {
    if (
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.left) ||
      data === "h"
    ) {
      this.focus = "files";
      return this.tui.requestRender();
    }
    if (matchesKey(data, Key.down) || data === "j")
      return this.moveDiff(DIFF_SCROLL_STEP);
    if (matchesKey(data, Key.up) || data === "k")
      return this.moveDiff(-DIFF_SCROLL_STEP);
    if (matchesKey(data, Key.ctrl("d"))) {
      return this.moveDiff(Math.max(1, Math.floor(this.bodyHeight() / 2)));
    }
    if (matchesKey(data, Key.ctrl("u"))) {
      return this.moveDiff(-Math.max(1, Math.floor(this.bodyHeight() / 2)));
    }
    if (matchesKey(data, Key.home) || data === "g") {
      this.diffOffset = 0;
      return this.tui.requestRender();
    }
    if (matchesKey(data, Key.end) || data === "G") {
      this.diffOffset = Math.max(
        0,
        this.selectedFile().diff.length - this.bodyHeight(),
      );
      this.tui.requestRender();
    }
  }

  private styleDiffLine(line: string) {
    const expanded = line.replaceAll("\t", "    ");
    if (expanded.startsWith("diff --git") || expanded.startsWith("index ")) {
      return this.theme.fg("accent", this.theme.bold(expanded));
    }
    if (expanded.startsWith("@@")) return this.theme.fg("mdHeading", expanded);
    if (expanded.startsWith("---") || expanded.startsWith("+++")) {
      return this.theme.fg("muted", expanded);
    }
    if (expanded.startsWith("+")) return this.theme.fg("success", expanded);
    if (expanded.startsWith("-")) return this.theme.fg("error", expanded);
    if (expanded.startsWith("…")) return this.theme.fg("warning", expanded);
    return this.theme.fg("text", expanded);
  }

  private border(width: number, label: string, top: boolean) {
    const text = `─ ${label} `;
    const remaining = Math.max(0, width - visibleWidth(text) - 2);
    const left = top ? "┌" : "└";
    const right = top ? "┐" : "┘";
    return this.theme.fg(
      "borderAccent",
      truncateToWidth(
        `${left}${text}${"─".repeat(remaining)}${right}`,
        width,
        "",
      ),
    );
  }

  render = (width: number) => {
    const height = this.bodyHeight();
    const sidebarWidth = Math.min(48, Math.max(24, Math.floor(width * 0.34)));
    const diffWidth = Math.max(1, width - sidebarWidth - 3);
    const title = `local changes · ${this.files.length} ${this.files.length === 1 ? "file" : "files"} · ${this.focus === "files" ? "FILES" : "DIFF"}`;
    const lines = [this.border(width, title, true)];
    for (let row = 0; row < height; row += 1) {
      lines.push(this.renderRow(row, sidebarWidth, diffWidth));
    }
    const help =
      this.focus === "files"
        ? "j/k or ↑/↓ select · enter/space/l open diff · esc close"
        : "j/k or ↑/↓ scroll · ctrl-d/u page · g/G top/bottom · esc/h files";
    lines.push(this.border(width, help, false));
    return lines;
  };

  private renderRow(row: number, sidebarWidth: number, diffWidth: number) {
    const fileIndex = this.sidebarOffset + Math.floor(row / 2);
    const sidebar = this.renderSidebar(fileIndex, row, sidebarWidth);
    const selectedFile = this.selectedFile();
    const diffLine = selectedFile.diff[this.diffOffset + row];
    const diff = padToWidth(
      diffLine === undefined ? "" : this.styleDiffLine(diffLine),
      diffWidth,
    );
    const separator = this.theme.fg(
      this.focus === "diff" ? "borderAccent" : "borderMuted",
      "│",
    );
    return `${this.theme.fg("borderMuted", "│")}${sidebar}${separator}${diff}${this.theme.fg("borderMuted", "│")}`;
  }

  private renderSidebar(fileIndex: number, row: number, width: number) {
    const file = this.files[fileIndex];
    if (!file) return " ".repeat(width);
    const selected = fileIndex === this.selectedIndex;
    let content =
      row % 2 === 0
        ? this.renderFileSummary(file, selected, width)
        : `  ${this.theme.fg("dim", truncateToWidth(file.path, Math.max(1, width - 2), "…"))}`;
    content = padToWidth(content, width);
    return selected
      ? this.theme.bg(
          this.focus === "files" ? "selectedBg" : "customMessageBg",
          content,
        )
      : content;
  }

  private selectedFile() {
    const file = this.files[this.selectedIndex];
    if (!file) throw new Error("Changed-files view requires at least one file");
    return file;
  }

  private renderFileSummary(
    file: ChangedFile,
    selected: boolean,
    width: number,
  ) {
    const marker = selected ? "› " : "  ";
    const binary = file.additions === null || file.deletions === null;
    const stats = binary ? "binary" : `+${file.additions} -${file.deletions}`;
    const styledStats = binary
      ? this.theme.fg("success", stats)
      : `${this.theme.fg("success", `+${file.additions}`)} ${this.theme.fg("error", `-${file.deletions}`)}`;
    const nameWidth = Math.max(
      1,
      width - visibleWidth(marker) - visibleWidth(stats) - 1,
    );
    const name = truncateToWidth(file.name, nameWidth, "…");
    const gap = " ".repeat(
      Math.max(
        1,
        width - visibleWidth(marker) - visibleWidth(name) - visibleWidth(stats),
      ),
    );
    return `${marker}${name}${gap}${styledStats}`;
  }

  invalidate() {}
}
