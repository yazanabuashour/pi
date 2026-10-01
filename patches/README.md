# Published declaration repairs

`npm run typecheck` applies these patches explicitly because installation uses
`--ignore-scripts`. The patches change only development declarations. They do not
ship in the installed package or modify native Pi, runtime JavaScript, shared
policies, or third-party notices.

| Package | Repair |
| --- | --- |
| `@earendil-works/pi-ai@0.99.2` | Add NodeNext JSON import attributes to generated model declarations. |
| `@google/genai@2.21.0` | Import `ErrorEvent`, `HeadersInit`, and `RequestInfo` from `undici-types`. |
| `@modelcontextprotocol/sdk@1.31.0` | Import `HeadersInit` in the transport declaration. |
| `effect@4.0.0` | Derive decoder options from the runtime's `TextDecoder` constructor. |

GenAI's declared optional MCP peer is an explicit development dependency because
its public declarations import that peer. `undici-types@7.24.6` also matches the
Node 24 type package. The GenAI patch uses its Node entry point and does not add
browser globals. Updating Pi's SDKs from 0.84.4 to 0.99.2 resolves the old
Anthropic SDK's invalid relative Undici imports without another patch.

`scripts/patch-declarations` requires the exact package versions and checks the
complete patch set before applying it. A second run accepts only the fully
applied set. Changed versions, incompatible source, and partial application
fail; use a clean install before retrying. Upstream files retain their original
line endings, including GenAI's CRLF.

When updating an affected dependency, inspect the published declarations, remove
repairs that upstream has fixed, and regenerate any remaining patches. Run the
clean-install and source gates in [the development guide](../docs/development.md).
The negative control in `scripts/test-declarations` verifies that the project
checks an invalid `.d.ts` file. Do not replace a failed declaration check with
`skipLibCheck`, browser globals, or diagnostic suppressions.
