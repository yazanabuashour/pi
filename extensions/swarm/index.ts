import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerSwarmCommands } from "./src/extension-commands.ts";
import { registerSwarmRenderers } from "./src/extension-renderers.ts";
import { SwarmExtensionSession } from "./src/extension-session.ts";
import { registerSwarmTools } from "./src/extension-tools.ts";

export default function swarm(pi: ExtensionAPI) {
  const session = new SwarmExtensionSession(pi);
  registerSwarmTools(pi, session);
  registerSwarmRenderers(pi);
  registerSwarmCommands(pi, session);
}
