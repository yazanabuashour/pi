# Workflow runtime

For script syntax, see [Write a workflow](../skills/workflow-authoring/SKILL.md).

## Process and environment

`extensions/workflows/worker-session.ts` launches the packaged `worker-child.cjs`
with `process.execPath`: no interpreter search, copied runtime, or fallback.

| Pi runtime | Worker controls |
| --- | --- |
| Native Pi (embedded Bun) | `BUN_BE_BUN=1`, `--no-env-file`, and `--config=<platform null device>` disable dotenv and bunfig loading. No declared heap or total memory limit. |
| Node-hosted Pi | `--max-old-space-size=128` and `--stack-size=2048`; neither bounds total process memory. |

An isolated Bun 1.3.14 probe confirmed suppression of local and global preload
fixtures. The worker inherits `PATH`, caller-provided `TMPDIR`, and fixed runtime
controls, not Pi authentication or configuration variables. The caller owns the
temporary directory; the worker neither allocates nor deletes it. It still has
the account's file, process, and network permissions; process separation is not a
security sandbox.

## Execution and model selection

The prepared script runs as an async function body with `agent`, `parallel`,
`phase`, and frozen, JSON-decoded `args`. Dynamic imports work; static imports
and source that closes the function wrapper fail compilation before execution.

Agents inherit the complete calling model and effort captured at launch. Only
`effort` can be overridden; unsupported options are ignored. Neither agent options
nor inter-process communication (IPC) exposes model selection. A missing parent
model fails before child session creation, with no configured-model fallback.
Child sessions use trust-aware resource loading, not a host-access restriction.

`agent()` starts on `await`, `then()`, `catch()`, or `finally()`. Reusing its result
does not rerun it. `parallel()` preserves input order. Returning with unused or
unfinished agent calls fails the script.

Existing limits come from [controller.ts](../extensions/workflows/controller.ts),
[runner.ts](../extensions/workflows/runner.ts), and
[tool-call-timeout.ts](../extensions/shared/tool-call-timeout.ts):

- At most 32 agent calls per workflow, with at most four concurrent.
- An agent's first assistant response event must arrive within 45 seconds.
- Each child tool call has a three-minute timeout; expiry produces an error tool result.
- Neither an agent nor a workflow has an overall deadline.

## Run ownership

`WorkflowRun.start()` admits and records a run. `details` returns snapshots,
`completion` tracks execution cleanup, and `abort()` requests cancellation.
`background: true` returns after admission in any UI mode. Completion delivery
follows the [background wake policy](reference.md#background-wake-policy).

Normal completion and forced interruption finalize artifacts and lifecycle state,
rejecting late updates. Persistence failures mark the run failed and appear in
final progress. Forced final state does not prove cancellation-ignoring work
stopped; `completion` still tracks cleanup.

## Cancellation and settlement

An already-aborted signal rejects before worker creation. Every exit stops new
calls, aborts active calls, terminates the worker, and waits for its `close` event.
The SIGTERM-to-SIGKILL timer clears on `close`. IPC send errors fail the run; late results cannot reply
to a stopped worker.

`RunController` bounds the wait for agent settlement, including ignored aborts.
A tool timeout is not proof the underlying work stopped. Trusted scripts own
their host resources and subprocesses: worker exit neither reverses host effects
nor proves those subprocesses exited.
