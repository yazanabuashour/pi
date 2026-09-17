# pi

This repository owns reusable Pi extensions, skills, themes, and their delivery.
It does not own user settings, provider or model choices, credentials, browser
profiles, sessions, project trust, or updates to Pi and upstream packages.

## Write documentation

- Read [the technical-writing skill](skills/technical-writing/SKILL.md) before
  writing or reviewing authored documentation. Apply its structure and prose rules.
- Keep each authored README below 25 lines. Put detailed guidance in linked pages.
  `npm run check` enforces the README limit.
- Preserve vendored documentation and third-party notices unchanged.

## Change and verify

- Keep the package installable without another checkout or personal configuration.
- Read the installed Pi documentation for the APIs you change. Native Pi supplies
  runtime SDKs; development dependencies support source checks only.
- Run `npm run format:check`, `npm run check`, and `npm test`. For loader,
  packaging, or process-lifecycle changes, also run the installed-package gate
  in [Develop and validate changes](docs/development.md) with an isolated HOME
  and native Pi.
- Keep `package.json`'s file allowlist explicit. Inspect `npm pack --dry-run`
  before delivery; never package private or generated state. Regenerate locks
  with npm rather than editing them.
- After checks and any required or approved review pass, run
  `npm run install:local`. Verify the installed resource. Report deferred or
  blocked installation. Never reload existing Pi sessions without asking.
  Keep installation directories while running processes use them.

## TypeScript

- Decode external values once using the existing schema library and derive types.
  Trace shared-contract changes through producers, consumers, storage, and wire
  formats. Keep protocol quirks in adapters.
- Keep each asynchronous operation responsible for its promises and resources
  until work settles, on every exit. Let the owner create cancellation.
  Preserve the cancellation reason, prevent stale writes, and observe work that
  ignores abort. Use scoped Effect interruption; convert to `AbortSignal` at
  external boundaries. For cancellation changes, verify pre-abort, mid-flight
  abort, ignored signals, and cleanup. Record evidence that work settled.
- Use typed failures for expected outcomes and defects for broken invariants.
  Preserve cause and context. Handle every variant. Distinguish whether work was
  accepted from how it finished. Catch only to recover, translate, add context,
  retry, or clean up. Retry known transient failures with abort-aware waits.
