import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeTest from "node:test";
import { agent, parallel } from "./pi-agents.mjs";

function receipt() {
  let resolve;

  const promise = new Promise((accept) => {
    resolve = accept;
  });

  return { promise, resolve };
}

function fixture(test) {
  const directory = NodeFS.mkdtempSync(
    NodePath.join(NodeOS.tmpdir(), "pi-agents-test-"),
  );

  const executable = NodePath.join(directory, "pi-fixture.mjs");
  const receiptPath = NodePath.join(directory, "receipt.json");
  NodeFS.writeFileSync(
    executable,
    `#!/usr/bin/env node
import * as fs from "node:fs";
import * as process from "node:process";
const args = process.argv.slice(2);
const mode = args.at(-1).slice("Task: ".length);
const schemaPath = process.env.PI_STRUCTURED_OUTPUT_SCHEMA;
const receipt = { args, cwd: process.cwd(), env: process.env, schema: schemaPath ? JSON.parse(fs.readFileSync(schemaPath, "utf8")) : null, permissions: schemaPath ? fs.statSync(schemaPath).mode & 0o777 : null };
fs.writeFileSync(process.env.FIXTURE_RECEIPT, JSON.stringify(receipt));
const event = (value) => process.stdout.write(JSON.stringify(value) + "\\r\\n");
if (mode === "malformed") { process.stdout.write("not json\\n"); }
else if (mode !== "empty") {
  event({ type: "tool_execution_end", toolName: "read", isError: false, result: { content: [{ type: "text", text: "read receipt" }] } });
  event({ type: "tool_execution_end", toolName: "bash", isError: true, result: { content: [{ type: "text", text: "recoverable failure" }] } });
  event({ type: "message_end", message: { role: "assistant", provider: "fixture", model: "saved-default", stopReason: mode === "provider-error" ? "error" : "stop", errorMessage: mode === "provider-error" ? "provider failed" : undefined, content: [{ type: "thinking", thinking: "private" }, { type: "text", text: "done\\u2028not-a-record" }] } });
  if (schemaPath && mode !== "missing-schema") event({ type: "tool_execution_end", toolName: "structured_output", isError: false, result: { details: { answer: 42 } } });
  if (mode !== "unsettled") event({ type: "agent_settled", aborted: mode === "@prompt" ? undefined : false });
}
setImmediate(() => fs.writeFileSync(process.env.FIXTURE_CLOSED, "settled"));
`,
    { mode: 0o700 },
  );
  const previous = { ...NodeProcess.env };
  Object.assign(NodeProcess.env, {
    PI_EXECUTABLE: executable,
    FIXTURE_RECEIPT: receiptPath,
    FIXTURE_CLOSED: NodePath.join(directory, "closed"),
    PI_AUTOMATION_TELEMETRY_PATH: "parent-path",
    PI_AUTOMATION_NAME: "parent-name",
    PI_AUTOMATION_RUN_ID: "parent-run",
    PI_AUTOMATION_FUTURE: "parent-extra",
    PI_STRUCTURED_OUTPUT_SCHEMA: "stale-schema",
  });
  test.after(() => {
    for (const key of Object.keys(NodeProcess.env)) {
      if (!(key in previous)) delete NodeProcess.env[key];
    }

    Object.assign(NodeProcess.env, previous);
    NodeFS.rmSync(directory, { recursive: true, force: true });
  });

  return { directory, receiptPath };
}

await NodeTest.test(
  "native child arguments, schema lifetime, and JSON result folding",
  async (test) => {
    const { directory, receiptPath } = fixture(test);
    const defaults = await agent("@prompt");
    NodeAssert.equal(defaults.ok, true);
    NodeAssert.equal(defaults.output, "done\u2028not-a-record");
    NodeAssert.equal(defaults.model, "fixture/saved-default");
    NodeAssert.equal(
      NodeFS.readFileSync(NodeProcess.env["FIXTURE_CLOSED"], "utf8"),
      "settled",
    );
    const saved = JSON.parse(NodeFS.readFileSync(receiptPath, "utf8"));
    NodeAssert.deepEqual(saved.args, [
      "--mode",
      "json",
      "--session-id",
      defaults.sessionId,
      "--name",
      "workflow: agent",
      "--exclude-tools",
      "delegate,ask_user",
      "Task: @prompt",
    ]);
    NodeAssert.equal(saved.cwd, defaults.cwd);

    for (const name of [
      "PI_AUTOMATION_TELEMETRY_PATH",
      "PI_AUTOMATION_NAME",
      "PI_AUTOMATION_RUN_ID",
      "PI_AUTOMATION_FUTURE",
      "PI_STRUCTURED_OUTPUT_SCHEMA",
    ])
      NodeAssert.equal(saved.env[name], undefined);

    const schema = {
      type: "object",
      properties: { answer: { type: "number" } },
      required: ["answer"],
    };

    const structured = await agent("schema", {
      schema,
      label: "typed",
      model: "explicit/model",
      thinking: "high",
      tools: ["read"],
      cwd: directory,
    });

    NodeAssert.equal(structured.ok, true);
    NodeAssert.deepEqual(structured.structured, { answer: 42 });
    const typed = JSON.parse(NodeFS.readFileSync(receiptPath, "utf8"));
    NodeAssert.deepEqual(typed.schema, schema);
    NodeAssert.equal(typed.permissions, 0o600);
    NodeAssert.equal(
      NodeFS.existsSync(
        NodePath.dirname(typed.env.PI_STRUCTURED_OUTPUT_SCHEMA),
      ),
      false,
    );
    NodeAssert.ok(typed.args.includes("explicit/model"));
    NodeAssert.ok(typed.args.includes("high"));
    NodeAssert.ok(typed.args.includes("read,structured_output"));
    NodeAssert.ok(typed.args.includes("delegate,ask_user,mcp__*"));
    NodeAssert.ok(
      typed.args.includes(
        NodePath.resolve("skills/workflow-authoring/structured-output.ts"),
      ),
    );

    for (const [prompt, error] of [
      ["provider-error", /provider failed/],
      ["malformed", /Invalid Pi JSON event/],
      ["empty", /without a completed assistant/],
      ["unsettled", /agent_settled/],
      ["missing-schema", /without a schema-valid/],
    ]) {
      const result = await agent(prompt, { schema });
      NodeAssert.equal(result.ok, false, prompt);
      NodeAssert.match(result.error, error);
      const invocation = JSON.parse(NodeFS.readFileSync(receiptPath, "utf8"));
      NodeAssert.equal(
        NodeFS.existsSync(
          NodePath.dirname(invocation.env.PI_STRUCTURED_OUTPUT_SCHEMA),
        ),
        false,
      );
    }

    NodeProcess.env["PI_EXECUTABLE"] = NodePath.join(directory, "missing");
    const missing = await agent("spawn-failure", { schema });
    NodeAssert.equal(missing.ok, false);
    NodeAssert.match(missing.error, /spawn failed.*ENOENT/);
  },
);

await NodeTest.test(
  "an explicit MCP selector keeps only its named MCP tools",
  async (test) => {
    const { receiptPath } = fixture(test);
    const result = await agent("mcp", { tools: ["read", "mcp__fixture__*"] });
    NodeAssert.equal(result.ok, true);
    const saved = JSON.parse(NodeFS.readFileSync(receiptPath, "utf8"));
    NodeAssert.ok(saved.args.includes("read,mcp__fixture__*"));
    NodeAssert.ok(saved.args.includes("delegate,ask_user"));
    NodeAssert.equal(saved.args.includes("delegate,ask_user,mcp__*"), false);
  },
);

await NodeTest.test(
  "parallel preserves order and drains started work after failed admission",
  async () => {
    const release = receipt();
    const entered = receipt();
    const failure = new Error("phase failed");
    let completed = false;
    let admitted = 0;

    const running = parallel(
      [
        async () => {
          admitted++;
          entered.resolve();
          await release.promise;

          return "first";
        },
        async () => {
          admitted++;
          await entered.promise;
          throw failure;
        },
        async () => {
          admitted++;

          return "never";
        },
      ],
      { concurrency: 2 },
    ).finally(() => {
      completed = true;
    });

    const rejected = NodeAssert.rejects(running, (error) => error === failure);
    await entered.promise;
    await new Promise((resolve) => setImmediate(resolve));
    NodeAssert.equal(completed, false);
    NodeAssert.equal(admitted, 2);
    release.resolve();
    await rejected;

    const first = receipt();
    NodeAssert.deepEqual(
      await parallel([
        async () => {
          await first.promise;

          return "first";
        },
        async () => {
          first.resolve();

          return "second";
        },
      ]),
      ["first", "second"],
    );
    NodeAssert.deepEqual(await parallel([]), []);
    await NodeAssert.rejects(
      parallel([async () => undefined], { concurrency: 0 }),
      /positive safe integer/,
    );
  },
);
