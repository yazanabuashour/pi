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

For packaging, loader, or process-lifecycle changes, test the installed package
before updating your working installation.
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

Confirm that the command exits successfully and reports matching production
dependencies, package discovery, native imports, worker execution, swarm
completion, and telemetry. The test compares the installed lockfile, npm integrity
records, and package versions with the source lockfile. Platform-specific optional
dependencies may be absent.

The test uses a temporary HOME and a synthetic provider. Before testing real
provider or browser accounts, obtain authorization.

## Check native swarm delivery

Follow [Run the native delivery regression gate](lost-message-trial.md) to verify
that the installed swarm adapter delivers messages to the provider. The test also
reintroduces the earlier bug in a disposable copy and confirms that a message is
lost. Linux CI runs this test with pinned native Pi. `test:integration` runs it
after the other package checks.

## Install the checked changes

After checks and required or approved review, run `npm run install:local`.
Compare the changed resources with their installed copies under
`~/.local/share/dotfiles-pi-package/current/node_modules/yazan-pi-setup`.
Start a new session to use the changes. Reload an existing session only when asked.

If installation is blocked or deferred, report that the changes are not installed.
Keep installation directories while running processes use them.
