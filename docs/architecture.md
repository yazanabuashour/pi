# Package ownership and delivery

This package shares Pi resources, not providers, models, or private settings.
Users and employers own configuration; Pi and upstream packages own their updates.

## Installation isolation

Registering a checkout directly would expose unfinished edits to daily sessions.
The installer instead unpacks the package into a new installation directory,
copies the source lockfile, and installs production dependencies there.
Only success replaces `current` atomically. Existing directories remain available
to running sessions; installation neither reloads sessions nor changes settings.

Pi loads `current/node_modules/yazan-pi-setup`. Its production dependencies live
in that package root's `node_modules`.

## Dependencies and updates

Native Pi supplies its software development kits (SDKs) and TypeBox.
Development dependencies support source checks, not runtime SDK selection.
Effect package versions remain aligned.

npm omits `package-lock.json` from tarballs. The installer copies the checkout's
lock separately and uses `npm ci --omit=dev` to avoid resolving ranges again.
The lock does not pin the machine's Pi installation.

`npm run install:local` installs this source; `pi update --extensions` updates
upstream packages. See [installation](install.md) and [validation](development.md).
