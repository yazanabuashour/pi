import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerWorkflowActivation } from "./activation.ts";
import { registerWorkflowCommand } from "./extension-command.ts";
import { WorkflowExtensionSession } from "./extension-session.ts";
import { registerWorkflowTool } from "./extension-tool.ts";

export default function workflows(pi: ExtensionAPI) {
  const session = new WorkflowExtensionSession(pi);
  registerWorkflowCommand(pi, session);
  registerWorkflowTool(pi, session);
  registerWorkflowActivation(pi);
}
