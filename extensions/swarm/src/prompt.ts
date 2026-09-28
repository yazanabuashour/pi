/** Model-facing swarm strings. */

export const SWARM_SPAWN_TOOL_DESCRIPTION =
  "Spawn a background swarm agent with its own context and the calling session's model. Returns an opaque stable id immediately. Give a self-contained prompt: children cannot see this conversation. Completion is submitted automatically to root and the direct parent; a host-controlled wake policy leaves idle root results for the next host turn. Use swarm_send for actionable findings, blockers, questions, and ownership changes. Every child can send addressed messages and inspect model-visible peers. Children may spawn only when allow_spawn is explicitly true; they have no blocking wait/cancel tools and cannot run workflows or ask the user. Root owns the session's swarm manager. Children use normal host permissions and trust-gated resources: no sandbox, worktree, or file isolation. Use trusted working directories and coordinate file ownership. The cap is four running children, including private /btw sessions.";

export const SWARM_SPAWN_PROMPT_SNIPPET =
  "Spawn a background Pi swarm agent with the calling session's model and a self-contained task; allow_spawn explicitly permits delegation";

export const SWARM_SPAWN_PROMPT_GUIDELINES = [
  "Use swarm_spawn for self-contained background tasks; specify scope, file ownership, and what to report. Set allow_spawn only when the child needs to delegate.",
  "After swarm_spawn, continue independent work while children run. Results reach root and the direct parent automatically. Do not poll; wait only when results are the remaining dependency. Only root has swarm_wait and swarm_cancel. A child blocked on another agent should send its blocker and finish, identifying any unfinished delegated work.",
  "Before root's final handoff, join every outstanding worker needed for the current request, including descendants: use swarm_wait when their results are the remaining dependency. Integrate results, resolve conflicts, and finish validation before giving one consolidated answer to the user's request. Private /btw and explicitly detached work do not block handoff; state any work left running. A settled worker is not proof its assigned task succeeded.",
  "Keep routine swarm coordination under /swarm. Do not echo worker messages or acknowledge receipt without a next action. Surface meaningful milestones, actionable failures, blockers, or user decisions; worker completions do not replace your final answer.",
];

export function buildAgentSpawnResult(options: {
  id: string;
  title: string;
  modelLabel: string;
  cwd: string;
}) {
  return (
    `Spawned swarm agent ${options.id} "${options.title}" (pi: ${options.modelLabel}, ${options.cwd}).\n` +
    `Continue independent work. Results arrive automatically; root joins outstanding task-critical workers before final handoff.`
  );
}

export const SWARM_WAIT_TOOL_DESCRIPTION =
  "Root only: block until all listed swarm agents have settled, then return their final outputs. Continue independent work first; join outstanding task-critical workers before final handoff. Include required descendants, not private /btw or explicitly detached work. Aborting the wait leaves agents running. Children do not receive this tool.";

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
