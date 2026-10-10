# Update this lint policy snapshot

This is a compiled snapshot of
[@yazanabuashour/oxlint-config](https://github.com/yazanabuashour/typescript-lint-policy).
`SOURCE.json` identifies its source inputs and exported bytes. A null `commit`
means the source was not a clean committed tree. `private: true` prevents npm
publication; the producer source is public on GitHub.

Do not run producer build or development commands in this directory. The
snapshot intentionally omits their inputs.

1. Obtain a complete producer checkout at the reviewed source revision.
2. Run `npm ci` and `npm run check` there.
3. Run `npm run vendor -- <new-destination>` there. Use a new directory next to
   this snapshot, not this directory itself.
4. Compare the export, including all license notices, `UPSTREAM.md`, and provenance.
5. Replace the old snapshot after review.
6. Update the consumer's dependency lockfile and run its gates.

Install through the consumer's local file dependency. Install the exact `oxlint`,
`@oxlint/plugins`, and `oxlint-tsgolint` peer versions from this snapshot's
`package.json` in the consumer project. Type-aware linting is on by default;
missing `oxlint-tsgolint` is a lint failure, not a syntax-only fallback.
Use the consumer's npm scripts or `npm exec -- oxlint` so local tool binaries are
available. Keep the consumer's TypeScript compiler check as a separate gate.

```ts
import policy from "@yazanabuashour/oxlint-config"
import { defineConfig } from "oxlint"

export default defineConfig({ extends: [policy] })
```

If the consumer depends directly on Effect, opt in to `effectConfig`:

```ts
import policy, { effectConfig } from "@yazanabuashour/oxlint-config"
import { defineConfig } from "oxlint"

export default defineConfig({ extends: [policy, effectConfig] })
```

The default rejects unhandled promises (including `void promise`), misused
promises, awaiting non-thenables, and non-exhaustive union switches. It also
enforces unused-disable directives, structural blank lines, and one-line ordinary
comments. Multiline API doc comments require a directly exported declaration or
its non-private members, not a separate export list. Shebangs, recognized tool
directives, and legal notices remain exempt. Keep the invariant behind a safety
assertion on one line; review decides whether other prose adds information.
Run Oxlint's `--fix` for spacing fixes and Oxfmt for formatting; neither tool
replaces the other. Effect consumers get tagged construction, branching, error-handler,
and service-ownership rules through `effectConfig`.

Keep consumer-specific exemptions in the consumer's config. The snapshot does
not include host-runtime allowlists, generated-file exemptions, or restricted
import targets. Preserve the `project` and `project-effect` rule names in waivers.
