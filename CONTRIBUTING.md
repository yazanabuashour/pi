# Contributing to pi

Keep changes focused on reusable Pi extensions, skills, themes, and their delivery.
Provider choices, credentials, sessions, and personal settings belong outside this
repository.

## Develop and validate

Follow [Develop and validate changes](docs/development.md) for prerequisites,
source checks, and the isolated installed-package gate. The CI workflow runs
source checks on Linux and macOS; native Pi integration is a separate local gate.
Record any unavailable checks with your change.

Preserve third-party notices and the provenance records under `tools/`. Never
commit credentials, session transcripts, private prompts, or generated state.

## Submit a change

Describe the user-visible outcome, tests run, and any compatibility or lifecycle
impact. Keep unrelated work out of the change. Do not modify live environments or
publish releases as part of a contribution.

Report vulnerabilities through [the security policy](SECURITY.md), not a public
issue.
