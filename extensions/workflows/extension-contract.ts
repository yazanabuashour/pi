import { Type, type Static } from "typebox";
import { countStates, type WorkflowDetails } from "./model.ts";
import {
  WORKFLOW_PARAMETER_DESCRIPTIONS,
  WORKFLOW_TOOL_DESCRIPTION,
} from "./prompt.ts";

export const PREVIEW_LENGTH = 200;
export const EMIT_INTERVAL_MS = 120;
export const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export interface ScriptAgentResult {
  ok: boolean;
  output: string;
  structured?: unknown;
  error?: string;
}

export const WorkflowParams = Type.Object({
  script: Type.String({ description: WORKFLOW_PARAMETER_DESCRIPTIONS.script }),
  args: Type.Optional(
    Type.String({ description: WORKFLOW_PARAMETER_DESCRIPTIONS.args }),
  ),
  background: Type.Optional(
    Type.Boolean({ description: WORKFLOW_PARAMETER_DESCRIPTIONS.background }),
  ),
});

export type WorkflowInput = Static<typeof WorkflowParams>;

export const workflowToolMetadata = {
  name: "workflow",
  label: "Workflow",
  description: WORKFLOW_TOOL_DESCRIPTION,
  parameters: WorkflowParams,
} as const;

export function errorText<Input1>(error: Input1) {
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    16 * 1024,
  );
}

export function summaryLine(details: WorkflowDetails) {
  const { done, failed } = countStates(details);
  return `workflow ${details.name ?? details.runId}: ${done + failed}/${details.agents.length} agents${
    details.currentPhase ? ` · ${details.currentPhase}` : ""
  }`;
}

export interface ActiveWorkflowRun {
  readonly details: WorkflowDetails;
  readonly completion: Promise<void>;
  abort(reason: string): void;
  forceInterrupted(): void;
}
