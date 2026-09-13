import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { WorkflowParams, workflowToolMetadata } from "./extension-contract.ts";
import {
  renderWorkflowCall,
  renderWorkflowResult,
} from "./extension-renderer.ts";
import type { WorkflowExtensionSession } from "./extension-session.ts";
import { executeWorkflow } from "./workflow-execute.ts";
import type { WorkflowDetails } from "./model.ts";

export function registerWorkflowTool(
  pi: ExtensionAPI,
  session: WorkflowExtensionSession,
) {
  pi.registerTool<typeof WorkflowParams, WorkflowDetails>({
    ...workflowToolMetadata,
    execute: (_toolCallId, params, signal, onUpdate, context) =>
      executeWorkflow(pi, session, params, signal, onUpdate, context),
    renderCall: (args, theme) => renderWorkflowCall(args, theme),
    renderResult: (result, { expanded }, theme) =>
      renderWorkflowResult(result, expanded, theme),
  });
}
