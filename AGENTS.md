# pi

Own reusable Pi extensions, skills, themes, and delivery—not user settings,
models, credentials, sessions, trust, browser profiles, or upstream updates.

- Follow [development gates and installation](docs/development.md) for every change.
- Read installed Pi docs for changed APIs. Native Pi supplies runtime SDKs;
  development dependencies serve source checks only.
- For authored docs, use [technical-writing](skills/technical-writing/SKILL.md).
  Preserve vendored material and third-party notices.

## Code contracts

- Decode external values once with the existing schema library; derive types.
  Trace contract changes through callers, storage, and wire formats. Keep
  protocol quirks in adapters.
- Own promises and resources until settlement on every exit. Owners create
  cancellation. Preserve its reason, prevent stale writes, and observe work that
  ignores abort. Use scoped
  Effect interruption; convert to `AbortSignal` at external boundaries.
- Use typed failures for expected outcomes and defects for broken invariants.
  Preserve cause and context; handle every variant. Distinguish acceptance from
  completion. Catch only to recover, translate, add context, retry, or clean up.
  Retry only known transient failures with abort-aware waits.
