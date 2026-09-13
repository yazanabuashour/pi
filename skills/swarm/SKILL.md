---
name: swarm
description: Delegate self-contained tasks to background Pi agents and coordinate them with addressed messages. Use for parallel work, peer coordination, progress reports, or managing a swarm with swarm_spawn, swarm_send, swarm_wait, swarm_cancel, swarm_check, and swarm_list.
---

# Coordinate a swarm

A swarm has one manager owned by the root Pi session. Address that session as
`root`. Child IDs such as `sa-1` are opaque and stable; obtain them from tool
results or `swarm_list`, rather than guessing or deriving ancestry from them.

## Delegate a task

Call `swarm_spawn` with a self-contained `prompt` and a short `name`. Include
needed context, paths, ownership boundaries, constraints, and the expected
report. Children do not receive the calling conversation.

Optional fields:

- `working_dir`: trusted working directory; defaults to the caller's directory.
- `reasoning_effort`: overrides effort; omission inherits the caller's effort.
- `allow_spawn`: defaults to `false`. Set it explicitly to `true` only when the
  child needs to delegate. That child must explicitly permit spawning again
  for any of its own children that need to delegate.

Children inherit the caller's complete Pi model; there is no model, provider,
or harness selector. They use normal host permissions and trust-gated resources.
This is not a sandbox and creates no worktree or file isolation. Assign disjoint
file ownership or coordinate edits explicitly before working in shared files.

Keep working after spawning. Completion goes automatically to `root`, and is
forwarded to the direct parent unless that branch was canceled. If forwarding
fails (including capacity rejection), root receives the failure; it is not
retried. Ordinary commentary is not forwarded; use `swarm_send` for progress.

## Send an addressed message

Every swarm agent can call `swarm_send(to, message)`, `swarm_list`, and
`swarm_check`. Send to `root` or a model-visible peer. There is no broadcast.
Use explicit messages to report progress, share findings, request information,
or resolve shared-file ownership.

`swarm_send` requests attention rather than passive mailbox storage: a reply
can resume an agent that reported a blocker and finished. Success confirms
submission, not model consumption. Root delivery uses Pi's asynchronous message
API; Pi reports later delivery failures. Running recipients receive steering at Pi
turn/tool boundaries. Waking an idle child requires free capacity; otherwise
the send fails rather than waiting for a slot. This uses Pi message queues, not
native `response.steer`. Errors surface; there are no
implicit retries. Do not silently retry failures or assume a submitted message
has been acted on.

Only root can restart a canceled agent; peers cannot restart canceled agents
by messaging them.

## Handle results and blockers

- Root has `swarm_wait(ids)` and `swarm_cancel(ids)`. Wait only when a result
  blocks useful progress. Canceling a parent stops its descendant branch.
- Children have no blocking wait or cancel tools. A child blocked on another
  agent should send its blocker and finish rather than poll or wait indefinitely.
  Explicit messages and automatic descendant completion can wake it later.
- `swarm_check(id)` inspects status and recent activity without consuming a
  result. `swarm_list` discovers model-visible agents.
- Inspect errors and report incomplete work. Retained transcripts do not mean
  canceled work completed or can be restarted by a peer.

The existing shared capacity remains four running children, including `/btw`.
Do not spawn redundant work or rely on polling for capacity.

## Keep private questions and workflows separate

`/swarm` opens the human management view. `/btw` remains a private side question:
it is invisible to model tools and receives no swarm tools.

Workflows are unchanged. Workflow leaf agents receive no swarm tools; swarm
children cannot invoke workflows or ask the user. Do not route workflow work
through swarm APIs or treat a skill as permission to bypass tool availability.
