import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import {
  Editor,
  type EditorTheme,
  Key,
  matchesKey,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import type { AskUserInput } from "../index.ts";

type Theme = ExtensionUIContext["theme"];

export type SelectionResult =
  | { answer: string; wasCustom: true }
  | { answer: string; wasCustom: false; index: number }
  | null;

interface DisplayOption {
  label: string;
  description?: string;
  isOther?: boolean;
}

export const CUSTOM_OPTION_LABEL = "Write my own answer…";

function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length > width && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

class QuestionView {
  private optionIndex = 0;
  private editMode = false;
  private cachedLines: string[] | undefined;
  private settled = false;
  private readonly editor: Editor;
  private readonly params: AskUserInput;
  private readonly options: DisplayOption[];
  private readonly signal: AbortSignal;
  private readonly tui: ConstructorParameters<typeof Editor>[0];
  private readonly theme: Theme;
  private readonly done: (result: SelectionResult) => void;

  constructor(
    params: AskUserInput,
    options: DisplayOption[],
    signal: AbortSignal,
    tui: ConstructorParameters<typeof Editor>[0],
    theme: Theme,
    done: (result: SelectionResult) => void,
  ) {
    this.params = params;
    this.options = options;
    this.signal = signal;
    this.tui = tui;
    this.theme = theme;
    this.done = done;
    const editorTheme: EditorTheme = {
      borderColor: (text) => theme.fg("accent", text),
      selectList: {
        selectedPrefix: (text) => theme.fg("accent", text),
        selectedText: (text) => theme.fg("accent", text),
        description: (text) => theme.fg("muted", text),
        scrollInfo: (text) => theme.fg("dim", text),
        noMatch: (text) => theme.fg("warning", text),
      },
    };
    this.editor = new Editor(tui, editorTheme);
    this.editor.onSubmit = (value) => this.submitCustomAnswer(value);
    signal.addEventListener("abort", this.cancel, { once: true });
    if (signal.aborted) queueMicrotask(this.cancel);
  }

  private readonly cancel = () => this.finish(null);

  private finish(result: SelectionResult) {
    if (this.settled) return;
    this.settled = true;
    this.signal.removeEventListener("abort", this.cancel);
    this.done(result);
  }

  private submitCustomAnswer(value: string) {
    const answer = value.trim();
    if (answer) {
      this.finish({ answer, wasCustom: true });
      return;
    }
    this.editMode = false;
    this.editor.setText("");
    this.refresh();
  }

  private refresh() {
    this.cachedLines = undefined;
    this.tui.requestRender();
  }

  private selectOption(index: number) {
    const selected = this.options[index];
    if (!selected) return;
    if (selected.isOther) {
      this.optionIndex = index;
      this.editMode = true;
      this.refresh();
      return;
    }
    this.finish({ answer: selected.label, wasCustom: false, index: index + 1 });
  }

  handleInput = (data: string) => {
    if (this.editMode) {
      if (matchesKey(data, Key.escape)) {
        this.editMode = false;
        this.editor.setText("");
        this.refresh();
        return;
      }
      this.editor.handleInput(data);
      this.refresh();
      return;
    }
    if (matchesKey(data, Key.up)) {
      this.optionIndex =
        (this.optionIndex - 1 + this.options.length) % this.options.length;
      this.refresh();
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.optionIndex = (this.optionIndex + 1) % this.options.length;
      this.refresh();
      return;
    }
    if (
      data.length === 1 &&
      data >= "1" &&
      data <= String(this.options.length)
    ) {
      this.selectOption(Number(data) - 1);
      return;
    }
    if (matchesKey(data, Key.enter)) {
      this.selectOption(this.optionIndex);
      return;
    }
    if (matchesKey(data, Key.escape)) this.finish(null);
  };

  render = (width: number): string[] => {
    if (this.cachedLines) return this.cachedLines;
    const lines: string[] = [];
    const add = (text: string) => lines.push(truncateToWidth(text, width));
    const title = " Question ";
    add(
      this.theme.fg(
        "accent",
        `─${title}${"─".repeat(Math.max(0, width - title.length - 1))}`,
      ),
    );
    for (const line of wrapText(
      this.params.question,
      Math.max(10, width - 2),
    )) {
      add(` ${this.theme.fg("text", this.theme.bold(line))}`);
    }
    lines.push("");
    this.renderOptions(add);
    this.renderEditor(lines, add, width);
    this.renderHelp(lines, add, width);
    this.cachedLines = lines;
    return lines;
  };

  private renderOptions(add: (text: string) => void) {
    for (const [index, option] of this.options.entries()) {
      const selected = index === this.optionIndex;
      const prefix = selected ? this.theme.fg("accent", " ❯ ") : "   ";
      const marker = option.isOther ? "✎" : `${index + 1}.`;
      const label = `${marker} ${option.label}`;
      const color =
        selected || (option.isOther && this.editMode)
          ? "accent"
          : option.isOther
            ? "muted"
            : "text";
      add(prefix + this.theme.fg(color, label));
      if (option.description)
        add(`      ${this.theme.fg("muted", option.description)}`);
    }
  }

  private renderEditor(
    lines: string[],
    add: (text: string) => void,
    width: number,
  ) {
    if (!this.editMode) return;
    lines.push("");
    add(this.theme.fg("muted", " Your answer:"));
    for (const line of this.editor.render(width - 2)) add(` ${line}`);
  }

  private renderHelp(
    lines: string[],
    add: (text: string) => void,
    width: number,
  ) {
    lines.push("");
    const help = this.editMode
      ? " Enter submit • Esc back to options"
      : ` ↑↓ or 1-${this.options.length} select • Enter confirm • Esc dismiss`;
    add(this.theme.fg("dim", help));
    add(this.theme.fg("accent", "─".repeat(width)));
  }

  invalidate = () => {
    this.cachedLines = undefined;
  };

  dispose = () => this.signal.removeEventListener("abort", this.cancel);
}

export function showTuiQuestion(
  params: AskUserInput,
  signal: AbortSignal,
  ui: ExtensionUIContext,
): Promise<SelectionResult> {
  const options: DisplayOption[] = [
    ...params.options,
    { label: CUSTOM_OPTION_LABEL, isOther: true },
  ];
  return ui.custom((tui, theme, _keyboard, done) => {
    const view = new QuestionView(params, options, signal, tui, theme, done);
    return view;
  });
}
