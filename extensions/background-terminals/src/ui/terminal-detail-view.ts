import { formatSize } from "@earendil-works/pi-coding-agent";
import type {
  KeybindingsManager,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { formatElapsed, formatExit, type TerminalSnapshot } from "../domain.ts";
import type { TerminalReadModel } from "../manager.ts";
import { createOutputLineCache, sanitizeText } from "./output-view.ts";

function oneLine(text: string) {
  return sanitizeText(text.replace(/\s+/g, " "));
}

function configuredKeys(
  keybindings: KeybindingsManager,
  binding: Parameters<KeybindingsManager["getKeys"]>[0],
) {
  return keybindings.getKeys(binding).join("/") || "unbound";
}

function statusGlyph(snap: TerminalSnapshot, theme: Theme) {
  if (snap.status === "running") return theme.fg("warning", "■");
  if (snap.status === "done") return theme.fg("success", "■");
  if (snap.status === "failed") return theme.fg("error", "■");
  return theme.fg("muted", "■");
}

const OUTPUT_SCROLL_STEP = 6;

export class TerminalDetailView implements Component {
  private tui: TUI;
  private theme: Theme;
  private keybindings: KeybindingsManager;
  private id: string;
  private view: TerminalReadModel;
  private done: (value: null) => void;

  /** Active output stream shown in the viewport; `t` toggles. */
  private stream: "stdout" | "stderr" = "stdout";
  /** Scroll offset in lines from the bottom. 0 = pinned to bottom (live tail). */
  private scrollOffset = 0;
  private lineCache = createOutputLineCache();
  private unsubscribe: () => void;
  private renderTimer: ReturnType<typeof setTimeout> | undefined;
  private ticker: ReturnType<typeof setInterval>;
  private closed = false;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    id: string,
    view: TerminalReadModel,
    done: (value: null) => void,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.id = id;
    this.view = view;
    this.done = done;
    this.unsubscribe = view.subscribeTo(id, () => this.scheduleRender());
    // Elapsed time in the header ticks along at 1Hz.
    this.ticker = setInterval(() => this.tui.requestRender(), 1000);
  }

  private snap(): TerminalSnapshot | undefined {
    return this.view.get(this.id);
  }

  private scheduleRender() {
    if (this.renderTimer) return;
    // A chatty process emits a chunk per write. Limit terminal repaints so
    // this view cannot starve input handling.
    this.renderTimer = setTimeout(() => {
      this.renderTimer = undefined;
      if (!this.closed) this.tui.requestRender();
    }, 50);
  }

  private cleanup() {
    if (this.closed) return false;
    this.closed = true;
    this.unsubscribe();
    clearInterval(this.ticker);
    if (this.renderTimer) clearTimeout(this.renderTimer);
    this.renderTimer = undefined;
    return true;
  }

  private close() {
    if (this.cleanup()) this.done(null);
  }

  dispose(): void {
    this.cleanup();
  }

  handleInput(data: string): void {
    if (
      this.keybindings.matches(data, "app.interrupt") ||
      this.keybindings.matches(data, "tui.select.cancel")
    ) {
      this.close();
      return;
    }
    if (data === "t") {
      this.stream = this.stream === "stdout" ? "stderr" : "stdout";
      this.lineCache = createOutputLineCache();
      this.scrollOffset = 0;
      this.tui.requestRender();
      return;
    }
    if (data === "x") {
      const snap = this.snap();
      if (snap?.status === "running") this.view.requestKill(this.id);
      return;
    }
    if (this.keybindings.matches(data, "tui.editor.cursorUp") || data === "k") {
      this.scrollOffset += OUTPUT_SCROLL_STEP;
      this.tui.requestRender();
      return;
    }
    if (
      this.keybindings.matches(data, "tui.editor.cursorDown") ||
      data === "j"
    ) {
      this.scrollOffset = Math.max(0, this.scrollOffset - OUTPUT_SCROLL_STEP);
      this.tui.requestRender();
      return;
    }
    if (this.keybindings.matches(data, "tui.editor.pageUp")) {
      this.scrollOffset += this.viewportHeight();
      this.tui.requestRender();
      return;
    }
    if (this.keybindings.matches(data, "tui.editor.pageDown")) {
      this.scrollOffset = Math.max(
        0,
        this.scrollOffset - this.viewportHeight(),
      );
      this.tui.requestRender();
      return;
    }
    if (data === "g") {
      this.scrollOffset = Number.MAX_SAFE_INTEGER; // clamped to top in render
      this.tui.requestRender();
      return;
    }
    if (data === "G") {
      this.scrollOffset = 0;
      this.tui.requestRender();
      return;
    }
  }

  private viewportHeight(): number {
    const rows = this.tui.terminal.rows || 30;
    // The complete view renders viewport + 8 chrome rows (borders, header,
    // command, tab, hints). rows - 9 makes the overlay ~terminal rows - 1.
    return Math.max(6, rows - 9);
  }

  private renderOutputBody(snap: TerminalSnapshot, width: number): string[] {
    const buffer = this.stream === "stdout" ? snap.stdout : snap.stderr;
    const output = this.lineCache.get(
      buffer.text,
      buffer.totalBytes,
      width - 2,
    );
    const viewport = this.viewportHeight();
    const body: string[] = [];
    if (snap.errorText) {
      body.push(
        truncateToWidth(
          this.theme.fg("error", `error: ${oneLine(snap.errorText)}`),
          width,
        ),
      );
    }
    if (buffer.truncatedBytes > 0) {
      body.push(
        truncateToWidth(
          this.theme.fg(
            "dim",
            `first ${formatSize(buffer.truncatedBytes)} dropped from view — full log: ${buffer.spillPath ?? "(unavailable)"}`,
          ),
          width,
        ),
      );
    }
    const scrollRows = this.scrollOffset > 0 ? 1 : 0;
    const capacity = Math.max(1, viewport - body.length - scrollRows);
    this.scrollOffset = Math.min(
      this.scrollOffset,
      Math.max(0, output.length - capacity),
    );
    const end = output.length - this.scrollOffset;
    const visible = output.slice(Math.max(0, end - capacity), end);
    if (visible.length === 0)
      body.push(this.theme.fg("dim", `(no ${this.stream} yet)`));
    else
      for (const line of visible)
        body.push(truncateToWidth(`  ${line}`, width));
    if (this.scrollOffset > 0) {
      body.push(
        truncateToWidth(
          this.theme.fg("dim", `... ${this.scrollOffset} lines below · ↓/pgdn`),
          width,
        ),
      );
    }
    while (body.length < viewport) body.push("");
    return body.slice(0, viewport);
  }

  render(width: number): string[] {
    const theme = this.theme;
    const border = theme.fg("borderAccent", "─".repeat(Math.max(1, width)));
    const lines: string[] = [];
    const snap = this.snap();

    if (!snap) {
      lines.push(border);
      lines.push(theme.fg("dim", `${this.id} is no longer tracked`));
      lines.push(border);
      return lines;
    }

    lines.push(border);
    const header =
      `${statusGlyph(snap, theme)} ` +
      theme.fg("accent", theme.bold(`${snap.id} · ${oneLine(snap.title)}`)) +
      theme.fg(
        "muted",
        ` · ${snap.status} · ${formatElapsed(snap)} · pid ${snap.pid ?? "?"}`,
      ) +
      (snap.status !== "running"
        ? theme.fg("muted", ` · ${formatExit(snap)}`)
        : "") +
      theme.fg("dim", ` · ${snap.cwd}`);
    lines.push(truncateToWidth(header, width));
    lines.push(
      truncateToWidth(
        theme.fg("dim", "$ ") + theme.fg("text", oneLine(snap.command)),
        width,
      ),
    );
    lines.push(border);

    // Stream tab line: which stream is active, both sizes.
    const active = this.stream;
    const tab = (name: "stdout" | "stderr", size: number) =>
      name === active
        ? theme.fg("accent", theme.bold(`${name} (${formatSize(size)})`))
        : theme.fg("dim", `${name} (${formatSize(size)})`);
    lines.push(
      truncateToWidth(
        `  ${tab("stdout", snap.stdout.totalBytes)}${theme.fg("dim", " | ")}${tab("stderr", snap.stderr.totalBytes)}${theme.fg("dim", "  — t to switch")}`,
        width,
      ),
    );

    lines.push(...this.renderOutputBody(snap, width));

    lines.push(border);
    lines.push(
      truncateToWidth(
        theme.fg(
          "dim",
          `${configuredKeys(this.keybindings, "tui.select.cancel")} back · t stdout/stderr · x kill · ${configuredKeys(this.keybindings, "tui.editor.cursorUp")}/${configuredKeys(this.keybindings, "tui.editor.cursorDown")}/jk scroll · ${configuredKeys(this.keybindings, "tui.editor.pageUp")}/${configuredKeys(this.keybindings, "tui.editor.pageDown")} page · g/G top/bottom`,
        ),
        width,
      ),
    );
    lines.push(border);
    return lines;
  }

  invalidate(): void {}
}
