# Develop and validate changes

Use Node 24 or newer, npm, Git, tar, jq, ShellCheck, and shfmt.
Keep the package installable without another checkout or personal configuration.

## Check the source

Run from this checkout:

```bash
npm ci --ignore-scripts --include=dev --legacy-peer-deps --no-audit --no-fund
npm run format:check
npm run check
npm test
npm pack --dry-run --ignore-scripts
```

Keep `package.json`'s file allowlist explicit. Inspect the packed files for private
or generated state and broken relative documentation links. Regenerate locks with
npm; never edit them by hand. The checks enforce README length and the dependency
and declaration policies below.

For cancellation changes, verify pre-abort, mid-flight abort, ignored signals,
and cleanup. Record evidence that work settled.

### Development policies

Both policies use producer-exported, content-addressed snapshots under `tools/`.
Neither ships in the installed package:

- `tsconfig.json` extends `tools/typescript-config-policy/node-ts-source.json` from
  [typescript-config-policy](https://github.com/yazanabuashour/typescript-config-policy),
  adding local target, library, types, and source paths.
- `oxlint.config.ts` extends the default and `effectConfig` exports from
  `@yazanabuashour/oxlint-config`
  ([typescript-lint-policy](https://github.com/yazanabuashour/typescript-lint-policy)),
  installed from its local snapshot through `package-lock.json`. It exempts
  `extensions/shared/host-runtime.ts` from `project/no-global-process-runtime`.

Update a policy through its producer's snapshot exporter, replace the local
snapshot, regenerate the lock with npm, and run the project gates. Do not edit
vendored policy content.

`@effect/vitest@4.0.0` requires Vitest 5, which declares Vite as a peer. GenAI's
public declarations import its optional MCP peer. Both peers are explicit
development dependencies because `--legacy-peer-deps` does not install peers.

### Maintain declaration repairs

`npm run typecheck` applies the version-checked patches under `patches/`, then
checks source and dependency declarations with NodeNext and Node globals.
Installation ignores lifecycle scripts; these repairs affect development
declarations only, not native Pi or runtime JavaScript. They do not ship in the
installed package or modify shared policies or third-party notices.

| Package | Repair |
| --- | --- |
| `@earendil-works/pi-ai` | Add NodeNext JSON import attributes to generated model declarations. |
| `@earendil-works/pi-coding-agent` | Derive the find tool's path module type from `path.posix`; Node 26 types no longer export `PlatformPath`. |
| `@google/genai` | Import `ErrorEvent`, `HeadersInit`, and `RequestInfo` from `undici-types` at the Node entry point. |
| `@modelcontextprotocol/sdk` | Import `HeadersInit` in the transport declaration. |
| `effect` | Derive decoder options from the runtime's `TextDecoder` constructor. |

`scripts/patch-declarations` requires exact package versions and checks the complete
patch set before applying it. A second run accepts only the fully applied set.
Changed versions, incompatible source, and partial application fail; use a clean
install before retrying. Preserve upstream line endings, including GenAI's CRLF.
The repairs use `undici-types` with the Node type package, not browser globals.

When updating an affected dependency, inspect the published declarations, remove
repairs that upstream has fixed, and regenerate any remaining patches. Run the
clean-install and source gates above. `npm run check` includes a negative control
that requires an invalid `.d.ts` file to fail compilation. Keep `skipLibCheck`
false; do not hide failures with browser globals or diagnostic suppressions.
Native Pi supplies runtime SDKs; development dependencies serve source checks only.

## Update upstream dependencies

```bash
npm run update:extensions
```

This runs `pi update --extensions`, then generates the CI dependency snapshot from
Pi's installed versions and npm lockfile. It uses `PI_CODING_AGENT_DIR` or
`~/.pi/agent`; no settings or credentials enter the snapshot. If the update,
snapshot, or audit fails, the command leaves the repository's snapshot unchanged.
Run the source and integration gates, then commit both files under
`runtime-probes/integration-deps`. Do not edit their versions by hand.

## Test the installed candidate

For packaging, loader, process-lifecycle, or dependency-snapshot changes, run this
gate before updating your working installation. Use native Pi and the locked CI
dependencies. To check other installed versions, substitute their package paths.
If version-manager shims depend on HOME, put the actual Node/npm executables first
on PATH.

```bash
(
  set -e
  stage="$(mktemp -d)"
  trap 'rm -rf "$stage"' EXIT
  npm_cache="$(npm config get cache)"
  npm ci --prefix runtime-probes/integration-deps \
    --ignore-scripts --omit=dev --legacy-peer-deps --no-audit --no-fund
  HOME="$stage" npm_config_cache="$npm_cache" npm run install:local
  npm run test:integration -- "$(command -v pi)" \
    "$stage/.local/share/dotfiles-pi-package/current/node_modules/yazan-pi-setup" \
    "$PWD/runtime-probes/integration-deps/node_modules/pi-web-access" \
    "$PWD/runtime-probes/integration-deps/node_modules/agent-browser"
)
```

Require a successful exit. The gate uses a temporary HOME and synthetic provider;
no real web searches or browser sessions run. Obtain authorization before using
real provider or browser accounts. Linux CI runs the full gate with pinned native
Pi and the external packages' lock under `runtime-probes/integration-deps`;
source checks also run on macOS. Other runtime versions must pass the same
capability checks before deployment.

The gate prints a retained receipt directory with runtime versions, provider and
tool events, lifecycle receipts, and telemetry. Pass a new directory as the
optional fifth argument to select its location. It verifies:

- Locked production dependencies, package discovery, and native SDK imports.
- `web_search`, `fetch_content`, `get_search_content`, and `source_check` in
  provider input; a missing-tool negative control must fail before
  execution. The probe reads native transcript state through
  `getCurrentSystemPrompt` and `getCurrentTools`, not a separate activation tool.
- Upstream `agent-browser` skill discovery and absence of package-owned delegate
  and workflow tools or skills.
- Background start acceptance before completion, final stdout reaching provider
  input, lifecycle receipts, and orderly process shutdown. A local Node
  fixture waits for the provider to observe start acceptance before it can finish.
- Opt-in telemetry and valid work continuing when telemetry fails.

The RPC fixture keeps Pi alive until its provider sees the background terminal's
final stdout and Pi emits `agent_settled`. It then closes stdin and awaits process
close. Test-only tripwires allow 120 seconds for delivery and another 120 seconds
for orderly shutdown before forced termination. The receipt is the complete
offline gate on 2026-10-10: native Pi 1.1.0, Node 24.18.1, `pi-web-access` 0.35.0,
and `agent-browser` 0.38.2 completed in 8 seconds. These tripwires do not limit
production background jobs.

## Install the checked changes

After checks and any required or approved review pass, run `npm run install:local`.
Compare changed resources with their installed copies under
`~/.local/share/dotfiles-pi-package/current/node_modules/yazan-pi-setup`.
Report unavailable checks or deferred installation.

Start a new session to load changes. Do not reload existing sessions without
asking or remove installation directories still used by running processes.
