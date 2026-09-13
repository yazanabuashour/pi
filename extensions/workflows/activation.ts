import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const WORKFLOW_TOOL_NAME = "workflow";
const WORKFLOW_SKILL_INVOCATION = /^\/skill:workflow-authoring(?:\s|$)/;

/** Activate only for the manual skill command; Pi owns skill expansion. */
export function registerWorkflowActivation(pi: ExtensionAPI) {
  let activationAllowed = false;
  pi.on("session_start", () => {
    const activeTools = pi.getActiveTools();
    activationAllowed = activeTools.includes(WORKFLOW_TOOL_NAME);
    pi.setActiveTools(
      activeTools.filter((name) => name !== WORKFLOW_TOOL_NAME),
    );
  });
  pi.on("input", (event) => {
    if (
      !activationAllowed ||
      event.source === "extension" ||
      !WORKFLOW_SKILL_INVOCATION.test(event.text.trimStart())
    ) {
      return;
    }
    const activeTools = pi.getActiveTools();
    if (!activeTools.includes(WORKFLOW_TOOL_NAME)) {
      pi.setActiveTools([...activeTools, WORKFLOW_TOOL_NAME]);
    }
  });
}
