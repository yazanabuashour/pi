import {
  agentContext,
  aggregateUsage,
  countStates,
  formatElapsed,
  formatUsage,
  phaseGroups,
  resultJson,
  statusWord,
  type WorkflowDetails,
} from "./model.ts";

export function buildReport(details: WorkflowDetails): string {
  const { done, failed } = countStates(details);
  const lines: string[] = [
    `# Workflow ${details.name ?? details.runId}`,
    "",
    `- Run: ${details.runId}`,
    `- Status: ${statusWord(details.status)}`,
    `- Agents: ${done}/${details.agents.length} ok${failed ? `, ${failed} failed` : ""}`,
    `- Elapsed: ${formatElapsed(details.startedAt, details.finishedAt)}`,
  ];
  const totals = formatUsage(aggregateUsage(details.agents));
  if (totals) lines.push(`- Usage: ${totals}`);
  if (details.description) lines.push("", details.description);
  if (details.error) lines.push("", `**Error:** ${details.error}`);

  for (const group of phaseGroups(details, true)) {
    lines.push("", `## ${group.title}`, "");
    if (group.agents.length === 0) {
      lines.push("_no agents_");
      continue;
    }
    for (const agent of group.agents) {
      const status =
        agent.state === "done"
          ? "ok"
          : agent.state === "error"
            ? "FAILED"
            : "running";
      const stats = [
        agent.model,
        agentContext(agent),
        formatElapsed(agent.startedAt, agent.finishedAt),
      ]
        .filter(Boolean)
        .join(" · ");
      lines.push(
        `- **${agent.label}** — ${status}${stats ? ` (${stats})` : ""}`,
      );
      if (agent.error) lines.push(`  - error: ${agent.error}`);
    }
  }

  if (details.result !== undefined) {
    lines.push(
      "",
      "## Result",
      "",
      "```json",
      resultJson(details.result),
      "```",
    );
  }
  lines.push("");
  return lines.join("\n");
}
