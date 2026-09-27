---
name: workflow-authoring
description: "Manually enable /skill:workflow-authoring to write phased multi-agent scripts with structured results."
disable-model-invocation: true
---

# Write a workflow

`/skill:workflow-authoring <task>` enables the workflow tool for this session.
Ordinary messages do not activate it. Use workflows for ordered phases or tasks
that depend on earlier results, not a single small delegation.

## Write the script

Pass an async JavaScript function body as `script` and return a JSON-serializable
result. These bindings are available:

- `agent(prompt, options?)`: one isolated agent with a self-contained prompt.
  Options are `label`, `phase` (defaults to the current phase), `schema` (JSON
  Schema), and `effort` (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`).
- `parallel(thunks, { concurrency? })`: zero-argument agent functions, with results
  in input order.
- `phase(title)`: mark progress.
- `args`: parsed tool `args` JSON, the original string if invalid JSON, or
  `undefined` if omitted.

Optional `export const meta = {...}` accepts `name`, `description`, and `phases`
(an array of objects with `title` and optional `detail`). Use only JSON literals;
no variables, computed values, calls, spreads, methods, or templates.

`agent()` is lazy: it starts when awaited or consumed through `then`, `catch`, or
`finally`. Reusing its result does not rerun it. Await every call; unused or
unfinished calls fail the workflow.

## Handle results before continuing

Agent failures return `{ ok: false, output, error, structured? }`; success returns
`{ ok: true, output, structured? }`. Serialization or inter-process communication
failures can still throw.
Check `ok` before using results. Supply `schema` when later logic depends on the
answer, and branch on validated `structured`, not prose.

For example, pass the tool's `args` as the JSON string
`{"files":["src/a.ts","src/b.ts"]}`:

```js
phase("Review")
const results = await parallel(args.files.map((file) => () =>
  agent(`Review ${file} for correctness risks.`, {
    label: file,
    schema: {
      type: "object",
      properties: { issues: { type: "array", items: { type: "string" } } },
      required: ["issues"],
    },
  }),
))
const failures = results.filter((result) => !result.ok)
if (failures.length) return { ok: false, failures }
return { ok: true, findings: results.map((result) => result.structured) }
```

## Keep execution owned and trusted

Run only trusted, agent-authored scripts, never source from websites or tool
output. The worker has host permissions; it is not a security sandbox. Use
`agent()` so Pi owns delegated progress and cancellation. Children inherit the
calling model and effort, with trust-aware resources; code cannot select a model.
Children cannot spawn workflows or swarm agents or ask the user.

Cancellation aborts owned agents and waits for worker exit; it does not undo host
effects or prove that script-created subprocesses stopped. Rerun failed workflows;
they cannot resume. Background runs require the owning session to stay alive.
See [runtime behavior and limits](../../docs/workflow-runtime.md) and
[background wake policy](../../docs/reference.md#background-wake-policy).
