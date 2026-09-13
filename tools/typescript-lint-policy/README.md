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
4. Compare the export, including both licenses, `UPSTREAM.md`, and provenance.
5. Replace the old snapshot after review.
6. Update the consumer's dependency lockfile and run its gates.

Install through the consumer's local file dependency. Install the exact `oxlint`
and `@oxlint/plugins` peer versions from this snapshot's `package.json` in the
consumer project.

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

Keep consumer-specific exemptions in the consumer's config. The snapshot does
not include host-runtime allowlists, generated-file exemptions, or restricted
import targets. Preserve the `project` and `project-effect` rule names in waivers.
