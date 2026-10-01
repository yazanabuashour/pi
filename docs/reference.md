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

Swarm, `/btw`, and workflow agents inherit the calling session's model and effort.
Agent tools accept effort overrides, not model or provider overrides.

Search is independent of the coding provider: Copilot authentication does not
provide Codex-backed OpenAI search. Search, hosted extraction, summaries, and page
answers can send content to other services. Preferences are not security controls.

## Session tools

| Entry point | Purpose |
| --- | --- |
| `/ps` | Display background terminals. |
| `/swarm` | Manage session-owned agents. |
| `/btw QUESTION` | Ask privately without the parent conversation; model-visible swarm tools cannot see the agent. |
| `swarm_spawn` | Delegate a self-contained prompt with a name, working directory, and effort. Child delegation requires `allow_spawn`; only root can wait or cancel. |
| `/skill:workflow-authoring` | Enable the workflow tool. |

See the [swarm skill](../skills/swarm/SKILL.md) and
[workflow authoring guide](../skills/workflow-authoring/SKILL.md).
Agents share the account's files and permissions; workers use Pi's runtime.
Neither is a security sandbox.

### Swarm presentation and handoff

Swarm messages and automatic results enter model context and session history
without displaying their bodies in the main transcript. Swarm tool rows show
compact calls and expandable details; tool errors and wait progress remain
visible. Cancellation reports remain visible. The footer shows activity counts,
and `/swarm` opens agent status and transcripts. Private `/btw` presentation is
unchanged.

The model guidance requires root to join outstanding task-critical workers before
final handoff, including required descendants, then integrate their results and
finish validation. Private `/btw` and explicitly detached work do not block that
handoff. This guidance does not impose a runtime barrier or change background
execution, routing, or wake policy.

See [swarm orchestration design](swarm-orchestration.md) for the rationale and
Codex comparison.

### Background wake policy

`PI_BACKGROUND_WAKE_POLICY` controls extension-initiated turns:

| Value | Behavior |
| --- | --- |
| `automatic` (default) | Idle completions and addressed swarm messages can start a turn. |
| `host` | Messages can steer or follow up active work, but cannot start an idle run. Idle results wait in history for the next host turn. |

A host that owns scheduling uses `PI_BACKGROUND_WAKE_POLICY=host pi --mode rpc`.
RPC alone does not select the policy. Each extension reads it at runtime creation;
invalid values fail initialization.

The policy covers swarm results, root messages, terminal results (including child
sessions), and workflow completions. It does not change manager-directed sends
to swarm children, control third-party extensions, or block explicit prompts.
Swarm and terminal results received during active work wait for delivery;
background workflows submit custom completion messages as follow-ups.
Execution, submission, and starting another turn are separate operations.

Host-controlled submissions append a `background-delivery` entry with
`event: "submission"`, `wakeRequested: false`, and `consumption: "unconfirmed"`.
This receipt records an attempt, not arrival in history, provider visibility, or
model consumption. The custom message carries the result. Pi's persistence
settings still apply; `--no-session` provides no disk durability.

Background workflows need no UI, but remain session-owned. One-shot clients can
exit and cancel unfinished work. Keep the session alive until settlement or use
foreground execution. Wake policy extends no resource lifetime; workflows cannot
resume after their runtime ends.

`ask_user` uses RPC dialogs only with `--ask-user-rpc`, which declares client
support for `extension_ui_request`. Other non-interactive clients get a fallback.

### Cancellation and shutdown

Aborting `swarm_wait` stops only the wait. Explicit cancellation requests a stop;
it does not prove execution stopped. Swarm distinguishes requested cancellation
from observed interruption. Terminals retain observed exit codes or signals;
process-group signalling does not prove every descendant exited.

Shutdown and frontend restarts request cancellation and clean up owned resources.
Restoring history restores neither running work nor in-memory queues. Swarm and
terminal cleanup waits are bounded: incomplete cleanup reports affected IDs,
not successful cancellation. It does not erase observed outcomes. Lifecycle
entries distinguish `cleanup-incomplete` from `settled`; tool results expose stop
requests and incomplete cleanup separately. Abrupt termination can bypass hooks.

### Results and log retention

Execution, tracked results, and logs have separate lifetimes. Completed terminals
can leave the tracked list without deleting spill files. Shutdown removes the
session's temporary log directory. Background jobs have no age timeout.

`/ps` shows retained output tails. Reported log paths hold captured output while
available; capture limits or write failures can prevent complete logs. Swarm's
saved Pi sessions preserve conversations, not running agents or message queues.

## Automation telemetry

`runtime-probes/automation-telemetry.ts` activates only with
`PI_AUTOMATION_TELEMETRY_PATH`. `PI_AUTOMATION_NAME` and `PI_AUTOMATION_RUN_ID`
identify the caller and run. Child sessions exclude it to avoid sharing output.

Telemetry records tool durations, query counts, concurrency, provider status,
rate-limit indications, lifecycle events, and a shutdown summary—not tool
arguments or results. Missing reasoning metadata stays unknown. File failures
produce diagnostics without stopping valid work. Rate-limit indications do not
prove throttling; telemetry does not establish business-action completion.

## Development policies

`@effect/vitest@4.0.0` requires Vitest 5. Vite is an explicit development
dependency because Vitest 5 declares it as a peer and the required
`--legacy-peer-deps` install does not install peers.

Both development policies use commit-pinned Git dependencies locked in
`package-lock.json`; neither ships in the installed package:

- `tsconfig.json` extends `node-ts-source.json` from
  [typescript-config-policy](https://github.com/yazanabuashour/typescript-config-policy),
  adding local target, library, types, and source paths.
- `oxlint.config.ts` extends the default and `effectConfig` exports from
  `@yazanabuashour/oxlint-config`
  ([typescript-lint-policy](https://github.com/yazanabuashour/typescript-lint-policy)).
  It exempts `extensions/shared/host-runtime.ts` from
  `project/no-global-process-runtime`. The policy is not published to npm.

The temporary `skipLibCheck: true` override checks project source but skips
published declarations. With the locked dependencies, `npm run typecheck --
--skipLibCheck false` reproduces these upstream declaration failures:

- Pi's nested `@earendil-works/pi-ai@0.84.4` provider declarations import JSON
  without the attributes required by NodeNext.
- Its `@anthropic-ai/sdk@0.91.1` declarations reference nonexistent relative
  `node_modules/undici-types/index.d.ts` paths.
- Its `@google/genai@1.52.0` declarations reference an absent MCP SDK and browser
  `ErrorEvent` and `CloseEvent` globals in this Node-only project.
- `effect@4.0.0` references the browser `TextDecoderOptions` global.

Adding browser globals or changing module resolution would misrepresent the
runtime and would not repair the malformed imports. Remove this override when
the locked declarations pass the command above; dependency upgrades are separate
from the policy refresh.

`.npmrc` sets `allow-git=root` because npm disables Git fetches by default.
Updates require a new pinned commit, a lock regenerated by `npm install`, and
the project gates.
