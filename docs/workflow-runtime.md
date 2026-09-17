# Workflow runtime

## Process and environment

`extensions/workflows/worker-session.ts` launches the adjacent `worker-child.cjs`
with `process.execPath`. The package includes that CommonJS file. There is no
interpreter search, system Node dependency, copied runtime, or fallback.

Native Pi uses embedded Bun with `BUN_BE_BUN=1` in the child environment.
`--no-env-file` and `--config=<platform null device>` disable dotenv and bunfig
loading. An isolated probe on Bun 1.3.14 confirmed these flags suppress local and
global preload fixtures.

Node-hosted Pi uses its existing executable. Node receives
`--max-old-space-size=128` and `--stack-size=2048`; neither flag bounds total process
memory. Bun receives neither flag and has no declared heap or total memory limit.

The worker inherits only `PATH` and fixed runtime controls. It does not inherit
Pi authentication or configuration environment variables. Trusted code still has
the account's host permissions, including access to its files, processes, and
network. The separate process is not a security sandbox.

## Execution and model selection

The parent prepares metadata. The worker compiles the prepared source as an async
function body with `agent`, `parallel`, `phase`, and frozen, JSON-decoded `args`.
Static imports are not valid function-body syntax; dynamic imports are supported.
Compilation rejects source that closes the function wrapper before execution.

Each `agent()` inherits the calling session's complete model and effort captured
at workflow launch. The `effort` option overrides reasoning effort. Neither agent
options nor worker inter-process communication (IPC) exposes model selection.
Unsupported options are ignored. A missing parent model fails before session
creation rather than selecting a configured model.

`agent()` starts when its result is awaited or used through `then()`, `catch()`,
or `finally()`. Reusing that result does not rerun the agent. `parallel()` limits
concurrency and returns results in input order. A script fails if it returns with
unused or unfinished agent calls.

## Run ownership

`WorkflowRun.start()` validates and records the script, registers the run,
executes agents, and persists the final state. Callers read snapshots through
`details`, await `completion`, or request cancellation with `abort()`. The tool
adapter formats results and delivers background completions; it does not change
run state.

Normal completion and forced interruption use the same finalization path. The run
ignores late updates before writing final artifacts and lifecycle entries.
Persistence failures mark the run failed and appear in final progress.
Forced interruption records the final state without claiming that work which
ignores cancellation has stopped;
`completion` still tracks execution cleanup.

`runAgent()` loads each child's resources, creates the session, sends the prompt,
and cleans up. Its caller supplies the task, inherited model, and trust context,
not SDK loaders or settings managers. Swarm sessions remain separate because they
support steering and reuse rather than a single task.

## Cancellation and settlement

An already-aborted signal rejects the run before worker creation. Every exit path
stops new agent calls, aborts active calls, terminates the worker, and waits for the
child's `close` event. The SIGTERM-to-SIGKILL timer clears after `close`. IPC send
errors fail the run. Late agent results cannot send replies to a stopped worker.

`RunController` owns agent tasks and their bounded settlement wait. The worker
does not wait indefinitely for agents that ignore abort. Neither a workflow nor
an agent request has an overall deadline. Trusted scripts own their host resources
and subprocesses. Worker exit neither reverses host effects nor proves that those
subprocesses have exited.
