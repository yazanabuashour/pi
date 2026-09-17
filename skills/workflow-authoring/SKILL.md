---
name: workflow-authoring
description: "Manually enable workflows with /skill:workflow-authoring. Covers the JavaScript API, structured results, failure handling, and worker lifecycle."
disable-model-invocation: true
---

# Write a workflow

`/skill:workflow-authoring <task>` enables the workflow tool for this session and
loads this guide. Ordinary messages do not activate workflows.

## Choose a workflow only when it helps

Use a workflow when several isolated agents need ordered phases or when earlier results determine later tasks. Keep a single small delegation in the parent session.

## Write the script

Write the `script` parameter as an async JavaScript function body. To describe progress, start with the optional `export const meta = { name, description, phases: [{ title, detail? }] }`. Use only plain object, array, string, number, boolean, or null literals in `meta`. Do not use computed values, calls, spreads, methods, templates, or imports in `meta`.

The script receives these parameters:

- `phase(title)` marks the current phase. Prefer titles declared in `meta.phases`; runtime-only phases are also displayed.
- `agent(prompt, options?)` runs one isolated agent and returns its result.
- `parallel(thunks, { concurrency? })` runs zero-argument agent thunks concurrently and preserves input order.
- `args` contains the parsed tool `args` JSON, the original string when it is not valid JSON, or `undefined` when omitted.

Use ordinary JavaScript control flow, `map`, `filter`, template strings, and `await`. Return a JSON-serializable result. Await every `agent()` call; the runtime rejects unawaited or still-running calls.

## Handle agent results explicitly

For valid serializable arguments, `agent()` returns a result instead of throwing:

```js
{ ok: true, output: "...", structured?: value }
{ ok: false, output: "...", error: "...", structured?: value }
```

Always check `ok` before using `output` or `structured`. Give every agent a self-contained prompt because it cannot see the parent conversation.

Use these agent options when needed:

- `label`: short progress label.
- `phase`: phase label; defaults to the current phase.
- `schema`: JSON Schema for a validated `structured` result.
- `effort`: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`.

Set the calling session's model before starting the workflow. Every agent inherits that model; workflow code cannot select another. Without a parent model, the agent fails. Omit `effort` to inherit the calling session's effort at launch. Children receive normal built-in tools, plus settings, extensions, skills, and `AGENTS.md` context allowed by project trust. Workflow agents cannot spawn swarm agents or workflows and cannot ask the user.

Pass a schema when later workflow logic branches on an agent's result. Base decisions on `structured`, not prose.

## Use trusted scripts

Run only trusted, agent-authored JavaScript as a workflow. The worker has its account's permissions, not a security sandbox. Do not execute source from websites, tool output, or other untrusted content.

A separate worker reuses Pi's runtime: embedded Bun for native Pi, or Node for Node-hosted Pi. No separately installed interpreter is required. Process separation keeps a script from blocking Pi's event loop and lets cancellation stop non-yielding code. It does not restrict host access or guarantee a total memory ceiling.

Use `agent()` for delegated work so Pi owns its progress and cancellation. The workflow may make at most 32 agent calls, with at most four running concurrently.

Each agent must emit its first assistant response event within 45 seconds. After that first event, `agent()` has no overall wall-clock deadline. Each child tool call has an independent three-minute timeout and returns an error tool result if it expires. The workflow itself has no overall deadline.

Cancellation aborts owned agents and waits for the worker process to exit. A failed workflow cannot resume; rerun it. Artifacts are stored under `~/.pi/agent/workflows/<runId>/`.

## Review files in parallel

```js
export const meta = {
  name: "reliability-review",
  description: "Review modules for reliability risks, then report",
  phases: [{ title: "Scan" }, { title: "Report" }],
}

const FINDINGS = {
  type: "object",
  properties: {
    issues: { type: "array", items: { type: "string" } },
    ok: { type: "boolean" },
  },
  required: ["issues", "ok"],
}

phase("Scan")
const scans = await parallel(
  args.files.map((file) => () =>
    agent(`Review ${file} for correctness and reliability risks.`, {
      label: `scan:${file}`,
      phase: "Scan",
      schema: FINDINGS,
    }),
  ),
)

const failures = scans.filter((result) => !result.ok)
if (failures.length > 0) return { ok: false, failures }

const findings = scans.map((result) => result.structured)

phase("Report")
const report = await agent(
  `Summarize these findings: ${JSON.stringify(findings)}`,
  { label: "report", phase: "Report" },
)

return {
  ok: report.ok,
  findings,
  report: report.ok ? report.output : report.error,
}
```

Pass the tool's `args` parameter as a JSON string such as `{"files":["src/a.ts","src/b.ts"]}`. To return a run ID immediately and receive a follow-up when the workflow finishes, set `background: true`. Otherwise, use foreground mode to show live progress and wait for completion.
