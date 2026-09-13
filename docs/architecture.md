# Package ownership and delivery

Home and work share extensions but use different providers, models, and private
settings. One repository owns the reusable code. Settings stay outside the package
so an update cannot replace a machine's choices.

## Ownership

This repository owns extensions, skills, themes, development checks, and local
package installation. Dotfiles owns personal home preferences. Work configuration
belongs to the user or employer. Pi and upstream packages retain their own
installation and update commands.

The package does not require Dotfiles or select a provider. Pi's package format
distributes resources rather than merging user settings.

## Installation

A direct checkout registration would expose unfinished edits to daily sessions.
The installer instead packs resources, installs production dependencies in a
separate directory, and atomically replaces the `current` link. Running sessions
keep access to their installation directories. The installer does not reload
sessions or write settings, credentials, or browser state.

The full `current/node_modules/yazan-pi-setup` registration preserves the directory
structure Pi needs to resolve sibling production dependencies.

## Dependencies

Native Pi supplies its software development kit (SDK) and TypeBox at runtime.
Development copies and the package lock support reproducible source checks;
they do not pin the machine's Pi installation. Effect prerelease dependencies use
aligned versions because the development lock does not constrain tarball consumers.

`pi update --extensions` updates upstream packages. `npm run install:local`
installs this package from its source.
