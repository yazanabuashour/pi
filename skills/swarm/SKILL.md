---
name: swarm
description: Delegate self-contained tasks to background Pi agents and coordinate them with addressed messages. Use for parallel work, peer coordination, progress reports, or managing a swarm with swarm_spawn, swarm_send, swarm_wait, swarm_cancel, swarm_check, and swarm_list.
---

# Coordinate a swarm

Address the root Pi session as `root`. Get stable child IDs such as `sa-1` from
tool results or `swarm_list`. Do not guess IDs or infer ancestry from them.

## Delegate a task

Call `swarm_spawn` with a self-contained `prompt` and a short `name`. Include
context, paths, file ownership, constraints, and the expected report. Children
do not receive the calling conversation.

Use these optional fields when needed:

- `working_dir`: trusted working directory; defaults to the caller's directory.
- `reasoning_effort`: overrides effort; omission inherits the caller's effort.
- `allow_spawn`: defaults to `false`. Set it explicitly to `true` only when the
  child needs to delegate. That child must explicitly permit spawning again
  for any of its own children that need to delegate.

Children inherit the caller's Pi model; you cannot select another model,
provider, or harness. They use normal host permissions and resources allowed
by project trust. They share the filesystem, with no sandbox or separate
worktree. Assign separate files to each agent, or coordinate edits before
changing shared files.

Keep working after spawning. Completion goes automatically to `root`, and is
forwarded to the direct parent unless that branch was canceled. If forwarding
fails (including capacity rejection), root receives the failure; it is not
retried. Ordinary commentary is not forwarded; use `swarm_send` for progress.

## Send an addressed message

Every swarm agent can call `swarm_send(to, message)`, `swarm_list`, and
`swarm_check`. Send to `root` or a model-visible peer. There is no broadcast.
Use explicit messages to report progress, share findings, request information,
or resolve shared-file ownership.

Use `swarm_send` to resume an agent that reported a blocker and finished.
Success confirms submission, not that the model read the message. Pi reports
later failures to deliver messages to root. Running recipients receive queued
steering between turns or tool calls. If no capacity is free, a send to an idle
child fails instead of waiting. Failed sends are not retried automatically.
Do not silently retry failures or assume the recipient acted on a submitted
message.

Only root can restart a canceled agent; peers cannot restart canceled agents
by messaging them.

## Handle results and blockers

Use the tools available to your session:

- Root has `swarm_wait(ids)` and `swarm_cancel(ids)`. Wait only when a result
  blocks useful progress. Canceling a parent stops its descendant branch.
- Children have no blocking wait or cancel tools. If another agent blocks your
  work as a child, report the blocker and finish instead of polling or waiting.
  Messages and descendant completion reports can wake you later.
- `swarm_check(id)` inspects status and recent activity without consuming a
  result. `swarm_list` discovers model-visible agents.
- Inspect errors and report incomplete work. Retained transcripts do not mean
  canceled work completed or can be restarted by a peer.

Swarm agents and `/btw` share capacity for four running children.
Do not spawn redundant work or rely on polling for capacity.

## Keep private questions and workflows separate

Use `/swarm` to open the management view. Keep `/btw` for private side questions:
it is invisible to model tools and receives no swarm tools.

Workflow agents receive no swarm tools. Swarm children cannot invoke workflows
or ask the user. Do not route workflow work through swarm APIs or treat a skill
as permission to bypass tool availability.
