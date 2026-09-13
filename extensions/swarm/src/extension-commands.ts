import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { deriveBtwTitle } from "./by-the-way.ts";
import type { AgentSnapshot } from "./domain.ts";
import type { SwarmExtensionSession } from "./extension-session.ts";
import { runTool } from "./runtime.ts";
import { openAgentPicker, openAgentTakeover } from "./ui/takeover.ts";

async function runBtw(
  pi: ExtensionAPI,
  session: SwarmExtensionSession,
  rawArgs: string,
  context: ExtensionCommandContext,
) {
  if (context.mode !== "tui") {
    if (context.hasUI)
      context.ui.notify("by the way is only available in the TUI", "error");
    return;
  }
  const prompt =
    rawArgs.trim() ||
    (await context.ui.input("by the way", "Ask a one-off question…"))?.trim() ||
    "";
  if (!prompt) return;
  const runtimeId = session.identity;
  const manager = await session.getManager();
  let snapshot: AgentSnapshot;
  try {
    snapshot = await runTool(
      session.getRuntime(),
      manager.spawn({
        origin: "btw",
        prompt,
        title: deriveBtwTitle(prompt),
        cwd: context.cwd,
        parent: {
          projectTrusted: context.isProjectTrusted(),
          inheritedModel: context.model,
          inheritedThinkingLevel: pi.getThinkingLevel(),
          modelRegistry: context.modelRegistry,
        },
      }),
    );
  } catch (error) {
    context.ui.notify(
      error instanceof Error ? error.message : String(error),
      "error",
    );
    return;
  }
  if (!session.isCurrent(runtimeId)) return;
  await openAgentTakeover(context, manager.view, snapshot.id, {
    badge: "by the way",
  });
}

export function registerSwarmCommands(
  pi: ExtensionAPI,
  session: SwarmExtensionSession,
) {
  pi.registerCommand("btw", {
    description:
      "Ask a one-off side question while the main agent keeps working",
    handler: (args, context) => runBtw(pi, session, args, context),
  });
  pi.registerCommand("swarm", {
    description:
      "List, inspect, and take over swarm agents and private side questions",
    handler: async (_args, context) => {
      if (context.mode !== "tui") {
        if (context.hasUI) {
          context.ui.notify(
            "Swarm takeover is only available in the TUI",
            "error",
          );
        }
        return;
      }
      const manager = await session.getManager();
      if (manager.view.size() === 0) {
        context.ui.notify(
          "No agents yet. Use swarm_spawn for model tasks or /btw for a private side question.",
          "info",
        );
        return;
      }
      await openAgentPicker(context, manager.view);
    },
  });
}
