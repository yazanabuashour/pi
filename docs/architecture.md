# Package ownership and delivery

This package owns resources that depend on Pi's runtime or interfaces.
[agents](https://github.com/yazanabuashour/agents) owns instructions, skills, and
helpers usable from any harness. Calling Pi does not decide ownership:
checkpoint review belongs in agents; `workflow-authoring` belongs here because
it uses this package's Pi tools. Neither repository requires the other.

Browser policy and technical writing belong in agents, not this package.
Upstream tools own their CLI guides and updates. Users and employers own settings,
models, credentials, sessions, trust, and browser profiles.

## Installation isolation

Loading the checkout would expose unfinished edits to daily sessions. The
installer creates a separate copy and replaces `current` atomically only after
installation succeeds. It leaves settings and existing installation directories
unchanged and does not reload sessions.

## Dependencies and updates

Native Pi supplies its software development kits (SDKs) and TypeBox; development
dependencies do not select the runtime SDKs.

npm omits `package-lock.json` from tarballs, so the installer copies it separately
to preserve locked dependencies. The lock does not pin the machine's Pi version.

`npm run install:local` installs this source; `pi update --extensions` updates
upstream packages. See [installation](install.md) and [validation](development.md).
