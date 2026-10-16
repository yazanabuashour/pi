# Configuration and capabilities

## User configuration

Installation leaves these settings and files unchanged:

| Owner | Configuration |
| --- | --- |
| Pi | `~/.pi/agent/settings.json`: provider, model, thinking level, interface, and package settings |
| pi-web-access | `~/.pi/web-search.json`: search routing, summary and page-answer models, and network policy |
| User or employer | `AGENTS.md`, approved tools, proxies, and browser profiles |
| Applications | Credentials, sessions, project trust, cookies, caches, and generated state |

`PI_CODING_AGENT_DIR` relocates Pi's agent files, not the installer's HOME-relative
package directory. The web extension owns its configuration paths.

## Models

`delegate` runs its child on the requested `provider/model-id`, or on the calling
session's model and thinking level when omitted. The requested model must be
available with configured credentials. Otherwise the call fails and lists the
available models. Workflow-script children use Pi's saved defaults unless the
script passes `model`.

Search is independent of the coding provider: Copilot authentication does not
provide Codex-backed OpenAI search. Search, hosted extraction, summaries, and page
answers can send content to other services. Preferences are not security controls.

## Session tools

| Entry point | Purpose |
| --- | --- |
| `bg_start` | Start a shell command without stdin; return a terminal ID before execution completes. |
| `bg_status` / `bg_list` | Inspect one terminal or list running and settled terminals. |
| `bg_kill` | Request termination and report observed settlement or incomplete cleanup. |
| `delegate` | Run a self-contained prompt in a saved Pi `--print` child process. Return immediately; deliver its final answer as a terminal completion. |
| `ask_user` | Ask one multiple-choice question with a free-form answer option. |
| `/skill:workflow-authoring` | Write a Node script that runs phased Pi children with schema-checked results. |

Delegated children save their session, and the completion names the session ID.
Reopen it from the child's working directory with `pi --session <id>`. Children
never receive `delegate` or `ask_user`, so delegation does not nest.
`PI_AUTOMATION_*` variables are removed from their environment.

See the [workflow authoring guide](../skills/workflow-authoring/SKILL.md).
Agents share the account's files and permissions; they are not a security sandbox.

### Background wake policy

`PI_BACKGROUND_WAKE_POLICY` controls extension-initiated turns:

| Value | Behavior |
| --- | --- |
| `automatic` (default) | Idle completions can start a turn. |
| `host` | Messages can steer or follow up active work, but cannot start an idle run. Idle results wait in history for the next host turn. |

A host that owns scheduling uses `PI_BACKGROUND_WAKE_POLICY=host pi --mode rpc`.
RPC alone does not select the policy. Each extension reads it at runtime creation;
invalid values fail initialization.

The policy covers terminal results, including delegated sessions. It does not
control third-party extensions or block explicit prompts. Terminal results
received during active work wait for delivery. Execution, submission, and
starting another turn are separate operations.

Host-controlled submissions append a `background-delivery` entry with
`event: "submission"`, `wakeRequested: false`, and `consumption: "unconfirmed"`.
This receipt records an attempt, not arrival in history, provider visibility, or
model consumption. The custom message carries the result. Pi's persistence
settings still apply; `--no-session` provides no disk durability.

Background terminals need no UI, but remain session-owned. One-shot clients can
exit and stop unfinished work. Keep the session alive until settlement. Wake
policy extends no resource lifetime.

`ask_user` uses RPC dialogs only with `--ask-user-rpc`, which declares client
support for `extension_ui_request`. Other non-interactive clients get a fallback.

### Cancellation and shutdown

Explicit cancellation requests a stop; it does not prove execution stopped.
Terminals retain observed exit codes or signals; process-group signalling does
not prove every descendant exited.

Shutdown and frontend restarts request cancellation and clean up owned resources.
Restoring history restores neither running work nor in-memory queues. Terminal
cleanup waits are bounded: incomplete cleanup reports affected IDs,
not successful cancellation. It does not erase observed outcomes. Lifecycle
entries distinguish `cleanup-incomplete` from `settled`; tool results expose stop
requests and incomplete cleanup separately. Abrupt termination can bypass hooks.

### Results and log retention

Execution, tracked results, and logs have separate lifetimes. Completed terminals
can leave the tracked list without deleting spill files. Shutdown removes the
session's temporary log directory. Background jobs have no age timeout.

`/ps` shows retained output tails. Reported log paths hold captured output while
available; capture limits or write failures can prevent complete logs. Delegated
sessions preserve conversations, not running agents.

Delegated reports use Pi's tool-output allowance (50 KB and 2,000 lines), not the
concise shell tail. Oversized reports retain both their beginning and end.
The photographed receipt, `IMG20261009212849.jpg`, measured 122 child reports on
2026-10-09; the largest report was 22 KB and 499 lines. Delegates retain an
original head and a current tail within the existing 2 MiB in-memory stream cap.
Spill files remain the source for complete output when available.

## Interface commands

| Entry point | Purpose |
| --- | --- |
| `/ps` | Inspect background terminals and their retained output; interactive sessions offer a picker. |
| `/lg` | Browse changed files and diffs in the interactive terminal interface. |
| `/pr` | Refresh Git and pull request information; pull request lookup uses `gh` and its authentication. |
| `/copy-all` | Copy the current branch's user and assistant messages to the clipboard, excluding tool output and reasoning. |

The interactive terminal's custom footer shows directory, Git status, model,
thinking level, context usage, and estimated cost. Automatic Git refresh and model
metrics run only in terminal sessions; `/pr` still refreshes on demand in other
modes. Cost comes from Pi's assistant-message estimates on the current branch,
not subscription billing; it excludes delegated work and summaries. The package
also supplies the `tokyo-night` theme.

## Automation telemetry

The package ships `runtime-probes/automation-telemetry.ts` without loading it.
Automation callers pass `--extension` with its installed path and set
`PI_AUTOMATION_TELEMETRY_PATH`. `PI_AUTOMATION_NAME` and `PI_AUTOMATION_RUN_ID`
identify the caller and run. Delegated children do not inherit these variables.

The `pi-automation-telemetry/v2` stream records lifecycle events, tool durations,
concurrency, errors, and a shutdown summary—not arguments, results, inferred query
counts, or rate limits. Counts include nested calls; `summedToolDurationMs` sums
completed call durations, including overlapping and nested calls, not wall time.
`settled` describes the latest agent run; each new session resets all counters.
Provider coverage is not measured. Missing reasoning metadata stays unknown.

Writes reach the operating-system cache without per-event disk synchronization;
a crash or power loss can leave incomplete diagnostics. File failures warn without
stopping valid work. Callers verify native process exit, lifecycle events, and
business results independently of telemetry.

See the [development guide](development.md) for source-check policies and
declaration repairs.
