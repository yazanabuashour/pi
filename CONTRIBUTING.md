# Contributing to pi

Keep changes focused on reusable Pi extensions, skills, themes, and their delivery.
Provider choices, credentials, sessions, and personal settings belong outside this
repository.

## Develop and validate

Follow [Develop and validate changes](docs/development.md) for prerequisites,
source checks, and the isolated installed-package test. CI checks the source on
Linux and macOS and tests native swarm delivery on Linux. Run the full
installed-package test locally when required by the development guide. Record
any unavailable checks.

Preserve third-party notices. Never commit credentials, session transcripts,
private prompts, or generated state.

## Submit a change

Describe the user-visible outcome, tests run, and any changes to compatibility,
startup, or shutdown. Keep unrelated work out of the change. Do not modify live
environments or publish releases as part of a contribution.

Report vulnerabilities through [the security policy](SECURITY.md), not a public
issue.
