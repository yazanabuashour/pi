# Develop and validate changes

Use Node 24 or newer, npm, Git, tar, jq, ShellCheck, and shfmt. For documentation work,
read the [technical-writing skill](../skills/technical-writing/SKILL.md) first.
Keep the root README below 25 lines; `npm run check` enforces that limit.

## Check the source

From this checkout, run these commands in order:

```bash
npm ci --ignore-scripts --include=dev --legacy-peer-deps --no-audit --no-fund
npm run format:check
npm run check
npm test
npm pack --dry-run --ignore-scripts
```

Inspect the packed file list for private or generated state. Check that each
relative documentation link has a target in the package. Regenerate dependency
locks with npm; do not edit them by hand. Preserve third-party notices and
vendored policy files. See [Development policies](reference.md#development-policies)
for the compiler and lint configuration.

## Test the installed candidate

For package, loader, or process changes, test the candidate before activation.
Use native Pi and installed copies of `pi-web-access` and `agent-browser`:

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

Confirm that the command exits successfully and reports locked production
dependencies, installed package discovery, native imports, worker execution,
swarm completion, and telemetry. The dependency check compares the installed
lockfile, npm integrity records, and package versions with the source lock;
platform-specific optional dependencies may be absent.
This test uses a temporary HOME and a synthetic provider. For real provider or
browser changes, obtain authorization before testing the account integration.

## Replay the lost-message incident

Use [Run the lost-message trial](lost-message-trial.md) to compare historical
and corrected delivery options against provider-visible input on native Pi.
This focused trial complements the installed-package gate; it does not replace it.

## Install the checked changes

After checks and required or approved review, run `npm run install:local`.
Compare the changed resources with their installed copies under
`~/.local/share/dotfiles-pi-package/current/node_modules/yazan-pi-setup`.
Start a new session to use the changes. Reload an existing session only when asked.

If installation is blocked or deferred, report that the source changes remain
inactive. Keep installation directories while running processes use them.
