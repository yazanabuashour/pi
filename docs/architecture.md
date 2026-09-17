# Package ownership and delivery

The package shares reusable code without sharing providers, models, or private
settings. Settings stay outside the package so an update cannot replace a
machine's choices.

## Ownership

This repository owns extensions, skills, themes, development checks, and local
package installation. Personal preferences belong to the user; work configuration
belongs to the user or employer. Pi and upstream packages retain their own
installation and update commands.

The package does not select a provider. Pi's package format distributes resources
rather than merging user settings.

## Installation

A direct checkout registration would expose unfinished edits to daily sessions.
The installer instead unpacks packaged resources into a separate directory,
copies `package-lock.json` from the checkout, and runs `npm ci --omit=dev` there.
Only a successful install replaces the `current` link, atomically. Running sessions
keep access to their installation directories. The installer does not reload
sessions or write settings, credentials, or browser state.

Pi loads the package through `current/node_modules/yazan-pi-setup`.
Production dependencies live in that root's `node_modules`.

## Dependencies

Native Pi supplies its software development kit (SDK) and TypeBox at runtime.
`package-lock.json` fixes dependency versions for source checks and local
installation; it does not pin the machine's Pi installation. Effect prerelease
dependencies use aligned versions.

npm excludes `package-lock.json` from tarballs. The local installer supplies
the checkout's lock separately and uses `npm ci` so installation follows the
lock rather than resolving dependency ranges again.

`pi update --extensions` updates upstream packages. `npm run install:local`
installs this package from its source.
