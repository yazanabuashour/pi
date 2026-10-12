# pi

Own Pi extensions, Pi-specific skills, themes, and delivery. Instructions, skills,
and helpers usable from any harness belong in
[agents](https://github.com/yazanabuashour/agents), even if they call Pi.
Do not manage user settings, models, credentials, sessions, trust, browser
profiles, or upstream updates.

- Follow [development gates and installation](docs/development.md) for every change.
- Read installed Pi docs for changed APIs. Native Pi supplies runtime SDKs;
  development dependencies serve source checks only.
- Keep authored docs task-focused and concise. Preserve vendored material and
  third-party notices.

## Code contracts

- Decode external values once with the existing schema library; derive types.
  Trace contract changes through callers, storage, and wire formats. Keep
  protocol quirks in adapters.
- Own promises and resources until settlement on every exit. Owners create
  cancellation. Preserve its reason, prevent stale writes, and observe work that
  ignores abort. Use scoped Effect interruption; convert to `AbortSignal` at
  external boundaries.
- Use typed failures for expected outcomes and defects for broken invariants.
  Preserve cause and context; handle every variant. Distinguish acceptance from
  completion. Catch only to recover, translate, add context, retry, or clean up.
  Retry only known transient failures with abort-aware waits.
