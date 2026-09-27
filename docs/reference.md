# Configuration and capabilities

## User configuration

Package installation leaves these settings and files unchanged:

| Owner | Configuration |
| --- | --- |
| Pi | `~/.pi/agent/settings.json`: provider, model, thinking level, interface preferences, and package entries and filters |
| pi-web-access | `~/.pi/web-search.json`: search routing, summary models, page-answer models, and network policy |
| User or employer | Global and project `AGENTS.md`, approved tools, proxies, and browser profiles |
| Applications | Credentials, sessions, project trust, browser cookies, caches, and generated state |

Pi's agent files follow `PI_CODING_AGENT_DIR` when set. That variable does not
change the installer's HOME-relative package directory. The web extension owns
its configuration paths and settings.

## Models

Swarm agents, `/btw` agents, and workflow agents inherit the calling session's
model and reasoning effort. Agent tools accept an effort override, but not a
model or provider override.

Search is independent of the coding provider. Copilot authentication does not
provide Codex-backed OpenAI search. Search queries, hosted extraction, web
summaries, and page answers can send content to other services. Configuration
preferences are not security controls.

## Session tools

`/ps` displays background terminals. `/swarm` manages session-owned agents.
`/btw QUESTION` starts a private side question without the parent conversation;
model-visible swarm tools cannot see that private agent.

`swarm_spawn` accepts a self-contained prompt, name, working directory, and
reasoning effort. Only the root agent can use `swarm_wait` or cancel agents.
Child delegation requires `allow_spawn`.
The [swarm skill](../skills/swarm/SKILL.md) covers coordination.

`/skill:workflow-authoring` enables the workflow tool. The
[authoring guide](../skills/workflow-authoring/SKILL.md) defines its interface.
Workers use Pi's runtime and have the account's host permissions. Swarm agents
share the account's files; neither mechanism is a security sandbox.

Swarm and terminal results received during active work wait for delivery.
Background workflows submit custom completion messages as follow-ups.
Execution, message submission, and starting another model turn are separate
operations. Workflow execution cannot resume after its runtime ends.

### Background wake policy

`PI_BACKGROUND_WAKE_POLICY` controls extension-initiated turns:

| Value | Behavior |
| --- | --- |
| `automatic` (default) | Idle completion and addressed swarm messages can start a turn. |
| `host` | Messages can steer or follow up an active run, but never start an idle run. Idle messages enter Pi's history for the next host-initiated turn. |

For a host that owns turn scheduling, launch Pi with
`PI_BACKGROUND_WAKE_POLICY=host pi --mode rpc`. RPC alone does not select this
policy. Invalid values fail extension initialization rather than selecting a
fallback. Each extension reads the policy when its runtime is created.

The policy covers swarm results, messages to root, terminal results, and workflow
completion. It applies to package extensions loaded in the process, including
background terminals inside child sessions. Manager-directed sends to swarm
children keep their existing behavior. The policy does not control third-party
extensions or prevent explicit user or host prompts.

Host-controlled submissions append a `background-delivery` entry with
`event: "submission"`, `wakeRequested: false`, and `consumption: "unconfirmed"`.
This entry records an attempt, not successful processing. The custom message in
Pi's history contains the result; an idle result waits for the next host turn.
A submission receipt alone does not prove that the message reached history or a
provider request. Pi's session persistence settings still apply; `--no-session`
does not provide disk durability.

Background workflow execution does not require a UI. It remains session-owned:
a one-shot client can exit and cancel unfinished work. Keep the session alive
until settlement or use foreground execution. Wake policy does not extend the
lifetime of agents, terminals, or workers.

`ask_user` uses remote procedure call (RPC) dialogs only when Pi starts with
`--ask-user-rpc`. The flag declares that the client handles `extension_ui_request`.
Other non-interactive clients receive the fallback instead.

### Cancellation and shutdown

Aborting `swarm_wait` stops the wait, not the agents. Explicit cancellation
requests a stop; it does not by itself prove that execution stopped. Swarm
cancellation distinguishes a stop request from an observed interrupted run.
Background jobs retain their observed exit code or signal even when a stop was
requested. Process-group signalling does not prove that every descendant exited.

Session shutdown requests cancellation and cleans up owned resources. Resuming
conversation history does not restore running work or its in-memory queues.
Frontend-driven session restarts have the same ownership consequences as quitting
Pi. Swarm and
background-terminal cleanup waits remain bounded. If execution or cleanup has not
settled, the owner records the incomplete cleanup and reports the affected IDs
rather than inventing a successful cancellation. A cleanup failure does not erase
an already observed execution outcome. Lifecycle entries distinguish
`cleanup-incomplete` from `settled`; tool results expose the stop request and
incomplete cleanup separately. Abrupt process termination can bypass shutdown
hooks entirely.

### Results and log retention

Execution, tracked results, and log files have separate lifetimes. Completed
background jobs can leave the tracked list during a session; that pruning does
not delete their spill files. Session shutdown removes the session's temporary
log directory. Background jobs have no job-age timeout.

`/ps` shows the retained in-memory output tail, not the complete spill files.
Use the reported log paths for captured output while those files remain available.
Capture limits or write failures can prevent complete logs from being available.
Swarm conversations use Pi's saved session files; those files do not preserve
running agents or their in-memory message queues.

## Automation telemetry

`runtime-probes/automation-telemetry.ts` remains inactive unless
`PI_AUTOMATION_TELEMETRY_PATH` is set. `PI_AUTOMATION_NAME` and
`PI_AUTOMATION_RUN_ID` identify the caller and run.

Telemetry records tool durations, query counts, concurrency, provider status,
rate-limit indications, lifecycle events, and a shutdown summary. It excludes
tool arguments and results. Missing reasoning metadata stays unknown. Child
sessions exclude this extension to avoid sharing the parent's output file.

Open, write, and close failures produce diagnostics without stopping valid work.
Rate-limit indications do not prove throttling. Telemetry does not establish
whether a business action completed.

## Development policies

`tsconfig.json` extends `node-ts-source.json` from the commit-pinned Git source
[yazanabuashour/typescript-config-policy](https://github.com/yazanabuashour/typescript-config-policy),
locked in `package-lock.json`. The local configuration adds this package's
target, library, types, and source paths.

`oxlint.config.ts` extends both the default policy and `effectConfig` from
`@yazanabuashour/oxlint-config`. The development dependency is a commit-pinned
Git source from
[yazanabuashour/typescript-lint-policy](https://github.com/yazanabuashour/typescript-lint-policy),
locked in `package-lock.json`; it is not published to the npm registry. The
repository `.npmrc` sets `allow-git=root` because npm disables Git fetches by
default. The local configuration exempts `extensions/shared/host-runtime.ts` from the
`project/no-global-process-runtime` rule.

Policy updates require a new pinned commit, a lock regenerated by `npm install`,
and the project gates. Neither policy is included in the installed package.
