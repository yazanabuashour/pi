# Use the TypeScript lint policy

`@yazanabuashour/oxlint-config` is distributed as a compiled snapshot from
[typescript-lint-policy](https://github.com/yazanabuashour/typescript-lint-policy).
`private: true` prevents npm publication; the producer source is public on GitHub.
The snapshot's `SOURCE.json` identifies its source inputs and exported bytes. A
null `commit` means the source was not a clean committed tree.

## Install and configure

Obtain a reviewed snapshot from the producer-owned exporter. Add it to the
consumer's `package.json` as a local file dependency, using its actual path:

```json
{
  "devDependencies": {
    "@yazanabuashour/oxlint-config": "file:./tools/typescript-lint-policy"
  }
}
```

Install the exact `oxlint`, `@oxlint/plugins`, and `oxlint-tsgolint` peer versions
from the snapshot's `package.json` in the consumer project. Follow the consumer's
instructions for installing dependencies and updating its lockfile. Type-aware
linting is on by default; missing typed-lint tooling fails the lint run rather
than silently falling back to syntax checks. Keep the TypeScript compiler check
as a separate gate; Oxlint's experimental compiler diagnostics (`typeCheck`) are
disabled.

Create an `oxlint.config.ts` that extends the default export. The named
`strictestConfig` export is the same configuration:

```ts
import policy from "@yazanabuashour/oxlint-config"
import { defineConfig } from "oxlint"

export default defineConfig({ extends: [policy] })
```

Use the consumer's npm scripts or `npm exec -- oxlint` so local tool binaries are
available. Run Oxlint's `--fix` for structural spacing fixes, then Oxfmt for
formatting. Neither tool replaces the other.

Keep consumer-specific exemptions in the consumer's config. The portable default
supplies no generated-file exemptions, host-runtime adapter allowlists, or
restricted-import targets. Preserve the `project` and `project-effect` rule names
in local, justified waivers.

## Default contracts and options

- Unhandled promises (including `void promise`), promises used as booleans,
  awaiting non-thenables, and non-exhaustive union switches are errors. Await,
  return, or attach a rejection handler to owned async work.
- Unused lint-disable directives are errors, including runs without a special
  CLI flag.
- `project/require-readable-spacing` inserts structural blank lines with
  whitespace-only fixes. Consecutive imports, short local bindings, and overloads
  stay grouped.
- `project/no-runtime-typeof` bans runtime `typeof` narrowing. Comparisons with
  the string `"undefined"` are allowed as existence probes. Set
  `"project/no-runtime-typeof": ["error", { allowInTypeGuards: true }]` to permit
  checks directly inside predicate and assertion functions. The default is false.
- Conditional empty-object spreads are banned without an autofix. Omitting a
  property is not equivalent to assigning `undefined`.
- `project/no-multiline-comments` limits ordinary comments to one physical line,
  including adjacent `//` prose runs and `/* ... */` blocks. Longer `/** ... */`
  documentation is allowed on directly exported declarations and their
  non-private class, interface, type-literal, enum, and exported namespace members.
  Separate export lists do not turn internal comments into API documentation.
  Shebangs, recognized tool directives, and copyright/license notices are exempt.
  Tool directives also break adjacent prose runs. The rule does not judge whether
  prose is necessary or identify historical metadata; review owns those decisions.
  It offers no shortening autofix.
- `project/require-safety-comment-for-type-assertion` requires a non-empty
  justification. Its optional `markers` array replaces the default `["SAFETY"]`.
  Comments above exported declarations count. Keep ordinary safety comments on
  one line to satisfy the comment rule too.
- Adjacent eager array filter/map passes and reducer accumulator copies are
  rejected. Native `oxc/no-accumulating-spread` covers spreads. Review callback
  order, indexes, sparse arrays, ownership, and runtime support before switching
  APIs; these rules do not autofix.
- `max-lines` allows 300 effective lines; `max-lines-per-function` allows 100.
  Blank lines and comments are skipped; immediately invoked function expressions
  count as functions. These are readability preferences, not operational
  capacity limits or evidence that larger code is unhealthy.
  `receipts/size-limits.json` retains historical counts whose source roles and
  health were not classified.

Custom project and Effect rules use syntax and lexical scope, not full type
inference. Same-file aliases resolve where supported; imported types and
cross-file call signatures do not. Unknown array receivers and lazy iterator
pipelines are outside the array rule. The local host-runtime, Schema-compilation,
and Effect-test-runtime rules recognize dot names and string-literal keys, not
variable computed keys. Native type-aware rules use TypeScript project information
and inferred projects for standalone files.

## Opt in to Effect conventions

If the consumer depends directly on Effect, extend `effectConfig` too:

```ts
import policy, { effectConfig } from "@yazanabuashour/oxlint-config"
import { defineConfig } from "oxlint"

export default defineConfig({ extends: [policy, effectConfig] })
```

This enables all five `project-effect` rules:

- `no-service-constructor-imports`: reject named `make<CapabilityName>` imports
  from relative modules outside tests. Import the owning Layer and yield the
  contextual service instead. Package imports, path aliases, default imports,
  and static constructors such as `WorkspaceName.make` remain outside its scope.
- `no-manual-effect-error-tag`: use tagged Effect error handlers instead of
  manually branching on `_tag` inside broad catch handlers.
- `no-manual-tag-comparison`: use `Match` or `Predicate.isTagged` instead of
  manual `_tag` comparisons and switches.
- `no-manual-tagged-construction`: use constructors rather than object literals
  with a string `_tag`. Direct `Match.when` and `Match.not` patterns are allowed.
- `prefer-effect-match`: replace chained literal ternaries over the same value
  with `Match`. Tagged branches owned by the catch-handler rule receive only
  its more specific guidance.

These are repository-wide Effect conventions, not type-inferred checks. Tag
rules also cover plain tagged unions; they do not prove that a constructor
exists. Handler and pattern recognition uses the literal `Effect` and `Match`
names. Keep necessary protocol-boundary waivers local and justified. No dependency
or Effect-version discovery runs at configuration time. The project-owned Effect
test rule remains in the default.

## Update a snapshot

Do not run producer build or development commands in a snapshot directory. The
snapshot intentionally omits their inputs.

1. Obtain a complete producer checkout at the reviewed source revision.
2. Run `npm ci` and `npm run check` there.
3. Run `npm run vendor -- <new-destination>` there. Use a new directory next to
   the old snapshot, not the old directory itself. Its parent must exist, and the
   destination must be outside the producer tree.
4. Compare the export, including all license notices, `UPSTREAM.md`, and provenance.
5. Replace the old snapshot after review.
6. Update the consumer's dependency lockfile and run its gates.
