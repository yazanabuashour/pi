import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerTerminalCommand } from "./src/command.ts";
import { BackgroundTerminalSession } from "./src/extension-session.ts";
import { registerResultRenderer } from "./src/result-renderer.ts";
import { registerTerminalTools } from "./src/tools.ts";

export default function backgroundTerminals(pi: ExtensionAPI) {
  const session = new BackgroundTerminalSession(pi);
  registerTerminalTools(pi, session);
  registerResultRenderer(pi);
  registerTerminalCommand(pi, session);
}
