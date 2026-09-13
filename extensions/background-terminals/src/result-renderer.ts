import {
  getMarkdownTheme,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Markdown, Text } from "@earendil-works/pi-tui";
import {
  isNumber,
  isRuntimeRecord,
  isString,
} from "../../shared/runtime-values.ts";
import { sanitizeText } from "./ui/output-view.ts";

function detailString<Value>(details: Value, key: string) {
  return isRuntimeRecord(details) && isString(details[key])
    ? details[key]
    : undefined;
}

function detailNumber<Value>(details: Value, key: string) {
  return isRuntimeRecord(details) && isNumber(details[key])
    ? details[key]
    : undefined;
}

export function registerResultRenderer(pi: ExtensionAPI) {
  pi.registerMessageRenderer(
    "background-terminal-result",
    (message, { expanded }, theme) => {
      const status = detailString(message.details, "status");
      const failed = status === "failed";
      const killed = status === "killed";
      const icon = failed
        ? theme.fg("error", "x")
        : killed
          ? theme.fg("muted", "■")
          : theme.fg("success", "■");
      const signal = detailString(message.details, "signal");
      const exitCode = detailNumber(message.details, "exitCode");
      const how = killed ? "killed" : (signal ?? `exit ${exitCode ?? "?"}`);
      const id = detailString(message.details, "id") ?? "?";
      const title = detailString(message.details, "title") ?? "";
      const header =
        `${icon} ` +
        theme.fg("accent", theme.bold(`terminal ${id}`)) +
        theme.fg("muted", ` · ${title} · ${how}`);
      const content = isString(message.content) ? message.content : "";
      const body = sanitizeText(content.split("\n").slice(1).join("\n").trim());
      if (expanded) {
        const markdown = new Markdown(body, 0, 0, getMarkdownTheme());
        const container = new Text(header, 0, 0);
        return {
          render: (width: number) => [
            ...container.render(width),
            ...markdown.render(width),
          ],
          invalidate: () => {
            container.invalidate();
            markdown.invalidate();
          },
        };
      }
      const lines = body.split("\n");
      let text = header;
      for (const line of lines.slice(0, 8)) {
        text += `\n${theme.fg("toolOutput", line)}`;
      }
      if (lines.length > 8) {
        text += `\n${theme.fg("dim", "... (ctrl+o to expand)")}`;
      }
      return new Text(text, 0, 0);
    },
  );
}
