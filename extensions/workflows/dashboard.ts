import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { sessionWorkflowRunIds } from "./dashboard-artifacts.ts";
import { WorkflowDashboard } from "./workflow-dashboard.ts";
import type { WorkflowDetails } from "./model.ts";

export {
  loadRunEntries,
  normalizeWorkflowDetails,
  sessionWorkflowRunIds,
} from "./dashboard-artifacts.ts";

export async function showWorkflowDashboard(
  ctx: ExtensionContext,
  getActive: () => Map<string, WorkflowDetails>,
  initialRunId?: string,
): Promise<void> {
  await ctx.ui.custom<void>(
    (tui, theme, keybindings, done) => {
      const dashboard: WorkflowDashboard = new WorkflowDashboard(
        tui,
        theme,
        keybindings,
        getActive,
        ctx.sessionManager.getSessionId(),
        sessionWorkflowRunIds(ctx),
        () => {
          dashboard.dispose();
          done(undefined);
        },
        initialRunId,
      );
      return dashboard;
    },
    {
      overlay: true,
      overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%" },
    },
  );
}
