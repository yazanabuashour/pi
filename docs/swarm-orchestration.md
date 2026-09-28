# Quiet swarm orchestration

Background execution and final handoff are separate decisions. Workers run
concurrently while root continues independent work. Root joins outstanding work
needed for the current request when those results become the remaining dependency,
then integrates the results and answers the user.

## Separate presentation from delivery

Routine worker messages and automatic results use `display: false`. Their content,
attribution, and delivery options remain intact. The model still receives them;
the transcript UI does not display their bodies. The existing footer and `/swarm`
provide status and inspection without repeating each result in the conversation.
Tool rows hide routine bodies unless expanded. Errors, wait progress, and
cancellation reports remain visible. Private `/btw` behavior stays separate.

This change does not filter model context, suppress wakes, or add another queue.
The delivery policy still controls whether idle results can start a turn. Hiding
messages alone cannot prevent the model from echoing them, so the instructions
also discourage routine acknowledgments and repeated summaries.

## Join dependencies, not every session

The root instructions require one consolidated answer after task-critical workers
settle and their findings are integrated. Required descendants count; private
`/btw` and explicitly detached work do not. A worker can settle with an error or
blocker, so root must evaluate the outcome rather than equate settlement with
success. Children identify unfinished delegated work in their reports.

The existing `swarm_wait` joins all listed agents without polling and consumes the
returned results. Root need not wait again for results already received. Aborting
a wait leaves agents running.

This is model guidance, not a runtime guarantee. A future enforced barrier would
need explicit request ownership and detachment semantics. Waiting for every
session-owned agent would incorrectly couple unrelated work to the current answer.

## Compare with Codex CLI

The comparison uses open-source `openai/codex` commit
[`1cc7e2361237ce7244430ee1d581c77f95c57ac8`](https://github.com/openai/codex/commit/1cc7e2361237ce7244430ee1d581c77f95c57ac8).
At that revision, multi-agent v1 is enabled by default and v2 is not; see the
[feature definitions](https://github.com/openai/codex/blob/1cc7e2361237ce7244430ee1d581c77f95c57ac8/codex-rs/features/src/lib.rs#L1326-L1337).

- **Presentation:** Codex separates result delivery from compact activity rows.
  Its [v2 UI](https://github.com/openai/codex/blob/1cc7e2361237ce7244430ee1d581c77f95c57ac8/codex-rs/tui/src/multi_agents.rs#L225-L334)
  shows one-line started and completed activity. Pi uses its existing footer and
  `/swarm` instead of adding a second activity stream.
- **Waiting:** Codex [v1 waits for any terminal target](https://github.com/openai/codex/blob/1cc7e2361237ce7244430ee1d581c77f95c57ac8/codex-rs/core/src/tools/handlers/multi_agents/wait.rs#L172-L216).
  Its [v2 wait handles mailbox activity](https://github.com/openai/codex/blob/1cc7e2361237ce7244430ee1d581c77f95c57ac8/codex-rs/core/src/tools/handlers/multi_agents_v2/wait.rs#L126-L208).
  Pi retains wait-all for an explicit dependency list; changing that contract is
  unnecessary for a quieter handoff.
- **Waking:** Codex [v2 completion routing](https://github.com/openai/codex/blob/1cc7e2361237ce7244430ee1d581c77f95c57ac8/codex-rs/core/src/agent/control/completion.rs#L88-L119)
  does not trigger a parent turn. Pi retains its configurable wake policy rather
  than leave an interactive parent idle with unread results.
- **Finalization:** No built-in all-children-finished barrier was found in the
  inspected [turn continuation logic](https://github.com/openai/codex/blob/1cc7e2361237ce7244430ee1d581c77f95c57ac8/codex-rs/core/src/session/turn.rs#L538-L564)
  or [stop path](https://github.com/openai/codex/blob/1cc7e2361237ce7244430ee1d581c77f95c57ac8/codex-rs/core/src/session/turn.rs#L647-L739).
  The checked-in [tool guidance](https://github.com/openai/codex/blob/1cc7e2361237ce7244430ee1d581c77f95c57ac8/codex-rs/core/src/tools/handlers/multi_agents_spec.rs#L700-L738)
  recommends critical-path waiting and integration, not an explicit join before
  final response. Pi makes that instruction explicit without adding enforcement.
