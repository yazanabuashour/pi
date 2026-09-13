import type {
  AgentToolUpdateCallback,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { WorkflowInput } from "./extension-contract.ts";
import type { WorkflowExtensionSession } from "./extension-session.ts";
import type { WorkflowDetails } from "./model.ts";
import {
  buildBackgroundWorkflowFollowUp,
  buildBackgroundWorkflowLaunchResult,
  buildWorkflowResultMessage,
} from "./prompt.ts";
import { compactToolDetails } from "./workflow-progress.ts";
import { WorkflowRun } from "./workflow-run.ts";

function startBackground(
  pi: ExtensionAPI,
  session: WorkflowExtensionSession,
  run: WorkflowRun,
) {
  void run.completion
    .catch((error) => {
      console.error("workflows: background run failed", error);
    })
    .then(() => {
      const details = run.details;
      if (!session.ownsCurrentSession(details)) return;
      try {
        pi.sendUserMessage(
          buildBackgroundWorkflowFollowUp({
            runId: details.runId,
            status: details.status,
            result: buildWorkflowResultMessage(details, run.runDir),
          }),
          { deliverAs: "followUp" },
        );
      } catch (error) {
        console.error("workflows: failed to deliver completion", error);
      }
    });
  const details = run.details;
  const launch: Parameters<typeof buildBackgroundWorkflowLaunchResult>[0] = {
    runId: details.runId,
    runDir: run.runDir,
  };
  if (details.name !== undefined) launch.name = details.name;
  const launchResult = buildBackgroundWorkflowLaunchResult(launch);
  return {
    content: [{ type: "text" as const, text: launchResult }],
    details: compactToolDetails(details),
  };
}

export async function executeWorkflow(
  pi: ExtensionAPI,
  session: WorkflowExtensionSession,
  params: WorkflowInput,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<WorkflowDetails> | undefined,
  context: ExtensionContext,
) {
  const run = WorkflowRun.start({
    pi,
    session,
    params,
    signal,
    onUpdate,
    context,
  });
  if (run.details.background) return startBackground(pi, session, run);
  await run.completion;
  const details = run.details;
  const message = buildWorkflowResultMessage(details, run.runDir);
  if (details.status !== "completed") throw new Error(message);
  return {
    content: [{ type: "text" as const, text: message }],
    details: compactToolDetails(details),
  };
}
