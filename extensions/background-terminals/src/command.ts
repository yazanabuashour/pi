import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { BackgroundTerminalSession } from "./extension-session.ts";
import { describeTerminal } from "./prompt.ts";
import { openTerminalPicker } from "./ui/ps.ts";

export function registerTerminalCommand(
  pi: ExtensionAPI,
  session: BackgroundTerminalSession,
) {
  pi.registerCommand("ps", {
    description: "List and inspect background terminals",
    handler: async (_args, context) => {
      const manager = await session.getManager();
      if (context.mode !== "tui") {
        if (context.hasUI) {
          const terminals = manager.view.list();
          context.ui.notify(
            terminals.length === 0
              ? "No background terminals."
              : terminals
                  .map((snapshot) => describeTerminal(snapshot))
                  .join("\n"),
            "info",
          );
        }
        return;
      }
      if (manager.view.size() === 0) {
        context.ui.notify(
          "No background terminals yet. The agent starts them with bg_start.",
          "info",
        );
        return;
      }
      await openTerminalPicker(context, manager.view);
    },
  });
}
