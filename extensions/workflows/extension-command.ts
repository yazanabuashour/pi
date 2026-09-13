import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import {
  getAgentDir,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import {
  normalizeWorkflowDetails,
  sessionWorkflowRunIds,
  showWorkflowDashboard,
} from "./dashboard.ts";
import type { WorkflowExtensionSession } from "./extension-session.ts";
import {
  countStates,
  displayInterruptedWorkflow,
  type WorkflowDetails,
} from "./model.ts";
import { buildWorkflowResultMessage } from "./prompt.ts";

interface RunSummary {
  runId: string;
  name?: string;
  status: string;
  done: number;
  total: number;
  startedAt: number;
  active: boolean;
}

function liveSummary(runId: string, details: WorkflowDetails): RunSummary {
  const { done, failed } = countStates(details);
  const summary: RunSummary = {
    runId,
    status: details.status,
    done: done + failed,
    total: details.agents.length,
    startedAt: details.startedAt,
    active: true,
  };
  if (details.name !== undefined) summary.name = details.name;
  return summary;
}

function savedSummary(runId: string, details: WorkflowDetails): RunSummary {
  const displayed = displayInterruptedWorkflow(details);
  const summary: RunSummary = {
    runId,
    status: displayed.status,
    done: displayed.agents.filter((agent) => agent.state !== "running").length,
    total: displayed.agents.length,
    startedAt: displayed.startedAt,
    active: false,
  };
  if (displayed.name !== undefined) summary.name = displayed.name;
  return summary;
}

function listRuns(
  activeRuns: Map<string, WorkflowDetails>,
  sessionId: string,
  referencedRunIds: ReadonlySet<string>,
) {
  const base = NodePath.join(getAgentDir(), "workflows");
  let names: string[] = [];
  try {
    names = NodeFS.readdirSync(base).filter((name) => name.startsWith("wf_"));
  } catch {
    // No runs exist yet.
  }
  const summaries: RunSummary[] = [];
  for (const runId of names) {
    const live = activeRuns.get(runId);
    if (live) {
      summaries.push(liveSummary(runId, live));
      continue;
    }
    try {
      const parsed = normalizeWorkflowDetails(
        runId,
        JSON.parse(
          NodeFS.readFileSync(
            NodePath.join(base, runId, "workflow.json"),
            "utf8",
          ),
        ),
      );
      if (
        parsed &&
        (parsed.sessionId === sessionId || referencedRunIds.has(runId))
      ) {
        summaries.push(savedSummary(runId, parsed));
      }
    } catch {
      // Ignore artifacts whose owning session cannot be verified.
    }
  }
  return summaries.sort((left, right) => right.startedAt - left.startedAt);
}

function runDetailText(
  run: RunSummary,
  activeRuns: Map<string, WorkflowDetails>,
) {
  const runDir = NodePath.join(getAgentDir(), "workflows", run.runId);
  const live = activeRuns.get(run.runId);
  if (live) return buildWorkflowResultMessage(live, runDir);
  try {
    const parsed = normalizeWorkflowDetails(
      run.runId,
      JSON.parse(
        NodeFS.readFileSync(NodePath.join(runDir, "workflow.json"), "utf8"),
      ),
    );
    return parsed
      ? buildWorkflowResultMessage(displayInterruptedWorkflow(parsed), runDir)
      : `Run ${run.runId} — unreadable artifact`;
  } catch {
    return `Run ${run.runId} — ${run.status}`;
  }
}

export function registerWorkflowCommand(
  pi: ExtensionAPI,
  session: WorkflowExtensionSession,
) {
  pi.registerCommand("workflows", {
    description:
      "List workflow runs (`/workflows <runId>` for one run's detail)",
    handler: async (rawArgs, context) => {
      const argument = rawArgs.trim();
      if (context.mode === "tui") {
        session.setUi(context);
        await showWorkflowDashboard(
          context,
          () => session.activeDetails(),
          argument || undefined,
        );
        session.acknowledgeFinished();
        return;
      }
      const active = session.activeDetails();
      const runs = listRuns(
        active,
        context.sessionManager.getSessionId(),
        sessionWorkflowRunIds(context),
      );
      if (runs.length === 0) {
        context.ui.notify("No workflow runs yet.", "info");
        return;
      }
      if (argument) {
        const run = runs.find(
          (candidate) =>
            candidate.runId === argument || candidate.runId.endsWith(argument),
        );
        context.ui.notify(
          run
            ? runDetailText(run, active)
            : `No workflow run matching "${argument}".`,
          run ? "info" : "warning",
        );
        return;
      }
      const labels = runs.map(
        (run) =>
          `${run.active ? "* " : "  "}${run.runId}  ${run.status}  ${run.name ?? ""}  ${run.done}/${run.total}`,
      );
      if (!context.hasUI) {
        context.ui.notify(labels.join("\n"), "info");
        return;
      }
      const choice = await context.ui.select("Workflow runs", labels);
      if (!choice) return;
      const run = runs[labels.indexOf(choice)];
      if (run) context.ui.notify(runDetailText(run, active), "info");
    },
  });
}
