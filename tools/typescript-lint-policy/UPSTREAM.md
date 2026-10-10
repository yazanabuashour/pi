# anti-slop provenance and local differences

This policy uses selected files from
[dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop/tree/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b),
revision `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b`.
[UPSTREAM-SOURCE.json](UPSTREAM-SOURCE.json) records the SHA-256 digest of each
vendored file. [LICENSE.anti-slop](LICENSE.anti-slop) preserves the upstream MIT
notice verbatim. [LICENSE.eslint-stylistic](LICENSE.eslint-stylistic) preserves
the MIT notice for the vendored ESLint Stylistic padding-line implementation.
All license notices accompany compiled distributions.

## Exact upstream modules

`src/vendor/anti-slop/` contains byte-for-byte upstream implementations, their
required helpers, their regression tests, and the upstream license. It contains
no installer, skill, or operational assets. The upstream package distributes
TypeScript source and sets `private: true`; this policy does not depend on an
assumed registry release.

`src/plugin/upstream.ts` imports these rules directly:

- `no-array-filter-map`
- `no-chained-type-assertions`
- `no-conditional-empty-object-spread`
- `no-module-mocking`
- `no-reduce-accumulator-copy`
- `no-reflect-apply`
- `no-reflect-get`
- `no-shape-in-symbol-names`
- `require-readable-spacing`

The optional Effect plugin directly imports `no-service-constructor-imports`
and `no-manual-tagged-construction`. Local ports of `no-manual-effect-error-tag`
and `no-manual-tag-comparison` retain upstream metadata and tag-detection helpers
but treat every nested function, including declarations, as a handler boundary.
Upstream's handler helper skips function declarations and misattributes their
branches to an outer catch handler.

The plugin wraps `prefer-effect-match` locally to avoid competing Match advice
for tagged ternaries in broad Effect catch handlers, where the error-tag rule
prescribes `catchTag` or `catchReason`. All three rules use the corrected handler
boundary. Non-tag ternary checks remain active inside those handlers.

Local overrides also import upstream's parameter helpers. There are no local
copies of those algorithms. Oxfmt and Oxlint leave vendored source untouched. TypeScript checks those files, and the test command
runs their upstream regressions unchanged through Oxlint's `RuleTester`.
The upstream spacing CLI test assumes pnpm and the upstream source entry point;
project-owned integration coverage instead checks multi-file diagnostics,
attached comments, whitespace-only fixes, and repeated-fix stability against the
compiled plugin. The embedded Stylistic license, provenance notice, and input
declaration file are copied into `dist/` and included in build integrity hashes.

## Local overrides and additions

`src/plugin/overrides/` retains adapted implementations for object parameters,
unknown parameters, unknown returns, unknown aliases, unsafe dictionaries,
known-value widening, widen-then-assert flows, runtime `typeof`, and safety comments.

The alias-based rules share `src/plugin/shared/`. Those helpers derive in part
from anti-slop and remain covered by its notice. The local resolver preserves
lexical shadowing, declaration-site generic bindings, nested transparent aliases,
default arguments, and class-expression scope. Importing the pinned upstream
resolver would lose existing regression protection. Dictionary and widening
helpers remain split into focused modules under the measured local line limits.

`no-unknown-parameters` resolves local aliases in addition to checking direct
`unknown` syntax. Predicate exemptions apply only to the named predicate subject.
The safety-comment override rejects empty block comments whose only remaining
content is star prefixes. It reads validated options per file rather than caching
marker expressions across files. Existing rule IDs, options, and diagnostics
remain unchanged.

`src/plugin/rules/` contains the project-owned Node.js import, host-runtime,
Schema compilation, and Effect test-ownership rules. `src/config.ts` owns native
Oxlint settings and measured line limits. Consumers own their exemptions; this
package adds none. The namespaces remain `project` and `project-effect`, so
existing consumer waivers keep their names.

The small `no-runtime-typeof` port also stays local. Upstream accesses an
index-signature option with dot syntax, which fails this project's
`noPropertyAccessFromIndexSignature` compiler contract. The local port uses
Oxlint's schema-validated options. Keeping it avoids patching vendored bytes or
loosening compiler checks; detection, options, and diagnostics are unchanged.

## Ancestry limitation

The initial local policy was already an adaptation. Its original upstream base
is unknown, and it had no pristine upstream snapshot. The pin above identifies
the exact files now vendored and the comparison base for retained ports. It does
not establish pristine ancestry for the earlier adaptation. Project-owned work
uses [LICENSE](LICENSE); adapted upstream work also retains `LICENSE.anti-slop`.

Custom-rule analysis remains syntactic, not full TypeScript inference. The
native Oxlint rules separately enable type-aware analysis. Imported types and
cross-file signatures are unsupported. Dictionary interface analysis collects
only top-level interfaces. Known predicate calls use direct unknown-input syntax
and same-file signatures. Unknown array receivers and lazy iterators remain
outside the eager-array rule.
