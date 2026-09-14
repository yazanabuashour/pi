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
complete model and reasoning effort. Agent tools permit an effort override, but
not a model or provider override.

Search is independent of the coding provider. Copilot authentication does not
provide Codex-backed OpenAI search. Search queries, hosted extraction, web
summaries, and page answers can send content to other services. Configuration
preferences are not security controls.

## Session tools

`/ps` displays background terminals. `/swarm` manages session-owned agents.
`/btw QUESTION` starts a private side question without the parent conversation;
model-visible swarm tools cannot see that private agent.

`swarm_spawn` accepts a self-contained prompt, name, working directory, and
reasoning effort. Only root can wait through `swarm_wait` or cancel agents.
Child delegation requires `allow_spawn`. The
[swarm skill](../skills/swarm/SKILL.md) contains the coordination procedure.

`/skill:workflow-authoring` enables the workflow tool. The
[authoring guide](../skills/workflow-authoring/SKILL.md) defines its interface.
Workers use Pi's runtime and have the account's host permissions. Swarm agents
share the account's files; neither mechanism is a security sandbox.

Workflows, swarm agents, and background terminals terminate owned work at session
shutdown. Completions during active work do not start another turn. Completions
while Pi is idle start a turn. Workflow execution cannot resume after its runtime
ends.

`ask_user` uses remote procedure call (RPC) dialogs only when Pi starts with
`--ask-user-rpc`. The flag declares that the client handles `extension_ui_request`.
Other non-interactive clients receive the fallback instead.

## Automation telemetry

`runtime-probes/automation-telemetry.ts` remains inactive unless
`PI_AUTOMATION_TELEMETRY_PATH` is set. `PI_AUTOMATION_NAME` and
`PI_AUTOMATION_RUN_ID` identify the caller and run.

Telemetry records tool durations, query counts, concurrency, provider status,
rate-limit indications, lifecycle events, and a shutdown summary. It excludes
tool arguments and results. Missing reasoning metadata stays unknown. Child
sessions exclude the parent's observer to avoid a shared output file.

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

Upstream changes require a commit-SHA bump plus
`npm install` and the project gates. Both policies support development checks
and are not included in the installed package.
