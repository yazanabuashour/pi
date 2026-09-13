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
function body with `agent`, `parallel`, `phase`, and JSON-decoded frozen `args`.
Static imports are not valid function-body syntax; dynamic imports are supported.
Compilation rejects stray wrapper-closing source before dispatch.

Each `agent()` inherits the calling session's complete model and effort captured
at workflow launch. The `effort` option overrides reasoning effort. Neither agent
options nor worker inter-process communication (IPC) exposes model selection.
Unsupported options are ignored. A missing parent model fails before session
creation rather than selecting a configured model.

`agent()` is lazy; repeated consumption dispatches once. `parallel()` preserves
input order and bounds fanout. A return with unconsumed or in-flight calls fails
accounting.

## Run ownership

`WorkflowRun.start()` owns script admission, the active-run registry entry, agent
execution, and final persistence. Callers observe snapshots through `details`,
await `completion`, or request cancellation with `abort()`. The tool adapter
formats results and delivers background completions; it does not mutate run state.

Normal completion and forced interruption use the same finalization path. The run
ignores late updates before writing terminal artifacts and lifecycle entries.
Persistence failures mark the run failed, and terminal progress reflects that
failure. Forced interruption records the terminal state without claiming that
uncooperative work has settled; `completion` still tracks execution cleanup.

`runAgent()` owns each child's fresh resource snapshot, session setup, prompt, and
teardown. Its caller supplies the task and inherited model and trust context, not
SDK loaders or settings managers. Swarm sessions remain separate because they
support steering and reuse rather than one-shot execution.

## Cancellation and settlement

Pre-abort rejects before spawn. Every terminal path stops dispatch, aborts active
invocations, terminates the worker, and waits for child `close`. The TERM-to-KILL
grace period clears after close. IPC sends observe errors. Late agent outcomes
cannot send replies into a stopped worker.

`RunController` owns agent tasks and their bounded settlement wait. The worker
does not wait indefinitely for agents that ignore abort. Neither a workflow nor
an agent request has an overall deadline. Trusted scripts own their host resources
and subprocesses. Worker exit neither reverses host effects nor proves that those
subprocesses have exited.
