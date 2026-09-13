/** Model-facing swarm strings. */

export const SWARM_SPAWN_TOOL_DESCRIPTION =
  "Spawn a background swarm agent with its own context and the calling session's model. Returns an opaque stable id immediately. Give a self-contained prompt: children cannot see this conversation. Completion is delivered automatically to root and the direct parent; send progress explicitly with swarm_send. Every child can send addressed messages and inspect model-visible peers. Children may spawn only when allow_spawn is explicitly true; they have no blocking wait/cancel tools and cannot run workflows or ask the user. Root owns the session's swarm manager. Children use normal host permissions and trust-gated resources: no sandbox, worktree, or file isolation. Use trusted working directories and coordinate file ownership. The cap is four running children, including private /btw sessions.";

export const SWARM_SPAWN_PROMPT_SNIPPET =
  "Spawn a background Pi swarm agent with the calling session's model and a self-contained task; allow_spawn explicitly permits delegation";

export const SWARM_SPAWN_PROMPT_GUIDELINES = [
  "Use swarm_spawn for self-contained background tasks; specify scope, file ownership, and what to report. Set allow_spawn only when the child needs to delegate.",
  "After swarm_spawn, keep working; completion reaches root and the direct parent automatically. Only root has swarm_wait and swarm_cancel; use swarm_wait only when a result blocks progress. A child blocked on another agent should send its blocker with swarm_send and finish rather than poll or wait.",
];

export function buildAgentSpawnResult(options: {
  id: string;
  title: string;
  modelLabel: string;
  cwd: string;
}) {
  return (
    `Spawned swarm agent ${options.id} "${options.title}" (pi: ${options.modelLabel}, ${options.cwd}).\n` +
    `It runs in the background. Completion goes to root and its direct parent automatically. ` +
    `Use swarm_send(to: "${options.id}", message: "...") for addressed messages, swarm_check to peek, or swarm_list to find peers. ` +
    `Only root can block with swarm_wait(ids: ["${options.id}"]) or stop the descendant branch with swarm_cancel.`
  );
}

export const SWARM_WAIT_TOOL_DESCRIPTION =
  "Root only: block until all listed swarm agents have settled, then return their final outputs. Prefer automatic completion messages; use this only when you need a result before continuing. Children do not receive this tool.";

export const SWARM_CANCEL_TOOL_DESCRIPTION =
  "Root only: cancel swarm agents and their descendant branches. Aborts active work while preserving partial session transcripts on disk. Canceled agents require root to restart; peers cannot restart them.";

export const SWARM_CHECK_TOOL_DESCRIPTION =
  "Peek at a model-visible swarm agent's status and recent activity without blocking or consuming its result. Private /btw sessions are not visible.";

export const SWARM_LIST_TOOL_DESCRIPTION =
  "List model-visible swarm agents and their stable opaque ids, models, and statuses. Address the owning root session as root. Private /btw sessions are not visible.";

export function buildAgentResultMessage(options: {
  id: string;
  title: string;
  status: "running" | "done" | "error";
  errorText?: string;
  output: string;
}) {
  const verb = options.status === "error" ? "failed" : "finished";
  let text = `Swarm agent ${options.id} "${options.title}" ${verb}.`;
  if (options.errorText) text += `\nError: ${options.errorText}`;
  text += `\n\n${options.output}`;
  return text;
}
