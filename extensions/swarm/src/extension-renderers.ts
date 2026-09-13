import {
  getMarkdownTheme,
  type ExtensionAPI,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Markdown, Text } from "@earendil-works/pi-tui";
import { isRuntimeRecord, isString } from "../../shared/runtime-values.ts";
import type { BtwResultData } from "./extension-status.ts";

function detailString<Value>(details: Value, key: string) {
  return isRuntimeRecord(details) && isString(details[key])
    ? details[key]
    : undefined;
}

function renderResultBody(
  header: string,
  body: string,
  expanded: boolean,
  theme: Theme,
) {
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
  for (const line of lines.slice(0, 8))
    text += `\n${theme.fg("toolOutput", line)}`;
  if (lines.length > 8)
    text += `\n${theme.fg("dim", "... (ctrl+o to expand)")}`;
  return new Text(text, 0, 0);
}

export function registerSwarmRenderers(pi: ExtensionAPI) {
  pi.registerMessageRenderer("swarm-result", (message, { expanded }, theme) => {
    const status = detailString(message.details, "status");
    const id = detailString(message.details, "id") ?? "?";
    const title = detailString(message.details, "title") ?? "";
    const failed = status === "error";
    const icon = failed ? theme.fg("error", "x") : theme.fg("success", "■");
    const header =
      `${icon} ` +
      theme.fg("accent", theme.bold(`agent ${id}`)) +
      theme.fg("muted", ` · ${title} · ${failed ? "failed" : "finished"}`);
    const content = isString(message.content) ? message.content : "";
    const body = content.split("\n").slice(1).join("\n").trim();
    return renderResultBody(header, body, expanded, theme);
  });

  pi.registerEntryRenderer<BtwResultData>(
    "btw-result",
    (entry, { expanded }, theme) => {
      const data = entry.data;
      const failed = data?.status === "error";
      const icon = failed ? theme.fg("error", "x") : theme.fg("success", "■");
      const header =
        `${icon} ` +
        theme.fg("accent", theme.bold(`by the way · ${data?.title ?? "?"}`)) +
        theme.fg(
          "muted",
          ` · ${failed ? "failed" : "answered"} · ${data?.id ?? "?"}`,
        );
      const body = [
        data?.errorText ? `Error: ${data.errorText}` : "",
        data?.answer ?? "(no answer)",
      ]
        .filter(Boolean)
        .join("\n\n");
      return renderResultBody(header, body, expanded, theme);
    },
  );
}
