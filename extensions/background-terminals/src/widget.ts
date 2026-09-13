import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";

const WIDGET_KEY = "background-terminals";

export function setRunningWidget(ui: ExtensionUIContext, running: number) {
  if (running === 0) {
    ui.setWidget(WIDGET_KEY, undefined);
    return;
  }
  ui.setWidget(WIDGET_KEY, (_tui, theme) => ({
    render: () => [
      theme.fg("warning", "■ ") +
        theme.fg(
          "text",
          `${running} background terminal${running === 1 ? "" : "s"} running`,
        ) +
        theme.fg("dim", " • ") +
        theme.fg("accent", "/ps") +
        theme.fg("dim", " to view"),
    ],
    invalidate: () => {},
  }));
}

export function clearRunningWidget(ui: ExtensionUIContext | undefined) {
  ui?.setWidget(WIDGET_KEY, undefined);
}
