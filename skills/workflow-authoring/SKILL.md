---
name: workflow-authoring
description: "Manually use /skill:workflow-authoring to write phased native Pi child scripts with structured results."
disable-model-invocation: true
---

# Write a workflow

A workflow is a Node script whose code, not the model, decides the order of
agent runs: phases, fan-out then synthesis, or branching on validated results.
For one self-contained task, use the `delegate` tool instead.

## Write the script

Import the helpers from `pi-agents.mjs` in this skill's directory by absolute
path. Save the script outside the repository, for example
`$TMPDIR/workflow-<name>/run.mjs`. Write the complete result as JSON beside it,
and print only a short summary and the file's absolute path: the completion
message shows a short tail of stdout.

`agent(prompt, options?)` runs one `pi --mode json` child and resolves when
it exits. Options are `label`, `model` (`provider/model-id`), `thinking`,
`tools` (an allowlist array), `cwd`, and `schema` (JSON Schema). Without an
explicit model or thinking level, the child uses Pi's saved defaults.
`parallel(thunks, { concurrency? })` runs zero-argument agent functions and
returns results in input order. It has no default concurrency limit. If one
function throws, no more start, and it rethrows after the started ones settle.

Each result is `{ ok, label, model?, sessionId, cwd, output, structured?, error? }`.
With `schema`, Pi validates the child's `structured_output` call against it;
`ok` is false when the child never made a valid call. Check `ok` before using a
result, and branch on `structured`, not prose. Schema-file setup or cleanup
failures can throw.

```js
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { agent, parallel } from "/absolute/path/to/pi-agents.mjs";

const files = ["src/a.ts", "src/b.ts"];
const schema = {
  type: "object",
  properties: { issues: { type: "array", items: { type: "string" } } },
  required: ["issues"],
};
const reviews = await parallel(files.map((file) => () =>
  agent(`Review ${file} for correctness risks.`, { label: file, schema }),
));
const failures = reviews.filter((review) => !review.ok);
const output = fileURLToPath(new URL("result.json", import.meta.url));
writeFileSync(output, JSON.stringify(failures.length
  ? { ok: false, failures }
  : { ok: true, findings: reviews.map((review) => review.structured) }));
console.log(`${reviews.length - failures.length}/${reviews.length} ok: ${output}`);
```

## Run it

Start the script with `bg_start` (`node run.mjs`); its stdout tail arrives when
it exits. `bg_kill` requests termination of the script's process group; it does
not prove every child exited. See
[cancellation and shutdown](../../docs/reference.md#cancellation-and-shutdown).

Children are saved Pi sessions: reopen one from its `cwd` with
`pi --session <sessionId>`. They cannot delegate or ask the user. Run only
trusted, agent-authored scripts; they have the account's permissions and are
not a sandbox. Await every started helper call before the script exits.
