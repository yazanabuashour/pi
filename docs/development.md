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
npm; never edit them by hand. The checks enforce README length and
[development policies](reference.md#development-policies).

For cancellation changes, verify pre-abort, mid-flight abort, ignored signals,
and cleanup. Record evidence that work settled.

## Test the installed candidate

For packaging, loader, or process-lifecycle changes, run this gate before updating
your working installation. Use native Pi and installed copies of `pi-web-access`
and `agent-browser`. If version-manager shims depend on HOME, put the actual
Node/npm executables first on PATH.

```bash
(
  set -e
  stage="$(mktemp -d)"
  trap 'rm -rf "$stage"' EXIT
  npm_cache="$(npm config get cache)"
  HOME="$stage" npm_config_cache="$npm_cache" npm run install:local
  npm run test:integration -- "$(command -v pi)" \
    "$stage/.local/share/dotfiles-pi-package/current/node_modules/yazan-pi-setup" \
    "$HOME/.pi/agent/npm/node_modules/pi-web-access" \
    "$HOME/.pi/agent/npm/node_modules/agent-browser"
)
```

Require a successful exit. The gate verifies locked production dependencies,
package discovery, native imports, delegated child delivery, workflow helper
execution and temporary-directory inheritance, saved child sessions, and telemetry.
It uses a temporary HOME and synthetic provider; obtain authorization before
using real provider or browser accounts.

Linux CI runs the full integration gate with pinned native Pi. The external
packages use `runtime-probes/integration-deps/package-lock.json`; source checks
also run on macOS. The gate records the tested runtime versions in its receipts.
Other installed versions must pass the same capability checks before deployment.

The web extension registers `web_search`, `fetch_content`, `get_search_content`,
and `source_check` directly. The gate requires them in parent and child provider
input. Its missing-tool negative control must fail before tool execution.
The probe reads native transcript state through `getCurrentSystemPrompt` and
`getCurrentTools`; it does not depend on a separate activation tool.

The gate prints a retained receipt directory with runtime versions, provider
and tool events, telemetry, and saved child transcripts. It requires the delegated
answer and session ID in provider input, not just history or display. The workflow
helper cases validate structured output and reject invalid output and provider
failure, including when native JSON mode exits successfully. Pass a new directory
as the optional fifth argument to select its location. No real web searches or
browser sessions run.

The RPC fixture keeps the parent alive until its provider sees the delegated
answer and Pi emits `agent_settled`. It then closes stdin and awaits process
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
