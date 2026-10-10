// Run saved native Pi child sessions from a Node workflow script.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";
import * as Schema from "effect/Schema";

const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));

const decodeEvent = Schema.decodeUnknownSync(
  Schema.Struct({ type: Schema.String }),
);

const decodeMessage = Schema.decodeUnknownSync(
  Schema.Struct({
    role: Schema.String,
  }),
);

const decodeAssistant = Schema.decodeUnknownSync(
  Schema.Struct({
    content: Schema.Array(
      Schema.Struct({
        type: Schema.String,
        text: Schema.optional(Schema.String),
      }),
    ),
    provider: Schema.String,
    model: Schema.String,
    stopReason: Schema.String,
    errorMessage: Schema.optional(Schema.String),
  }),
);

const decodeTool = Schema.decodeUnknownSync(
  Schema.Struct({
    toolName: Schema.String,
    isError: Schema.Boolean,
    result: Schema.Struct({ details: Schema.Unknown }),
  }),
);

const decodeSettled = Schema.decodeUnknownSync(
  // Pi 1.0.2 omits aborted; newer runtimes report it explicitly.
  Schema.Struct({ aborted: Schema.optional(Schema.Boolean) }),
);

function childArgs(prompt, options, sessionId, label) {
  const args = [
    "--mode",
    "json",
    "--session-id",
    sessionId,
    "--name",
    `workflow: ${label}`,
  ];

  if (options.model) args.push("--model", options.model);

  if (options.thinking) args.push("--thinking", options.thinking);

  // An allowlist also filters extension tools, so keep the schema's tool.
  const tools =
    options.tools && options.schema !== undefined
      ? [...options.tools, "structured_output"]
      : options.tools;

  if (tools) args.push("--tools", tools.join(","));

  // --tools alone leaves MCP tools callable; an explicit allowlist must not.
  const excluded =
    tools && !tools.some((name) => name.startsWith("mcp__"))
      ? "delegate,ask_user,mcp__*"
      : "delegate,ask_user";

  args.push("--exclude-tools", excluded);

  if (options.schema !== undefined)
    args.push("--extension", NodePath.join(here, "structured-output.ts"));

  // A leading "@" would make Pi read the prompt as a file path.
  args.push(`Task: ${prompt}`);

  return args;
}

function runChild(args, cwd, env, result) {
  const run = {
    stopReason: undefined,
    errorMessage: undefined,
    stderr: "",
    settled: false,
    aborted: false,
    protocolError: undefined,
  };

  const onLine = (line) => {
    if (!line.trim() || run.protocolError) return;

    try {
      const value = JSON.parse(line);
      const event = decodeEvent(value);

      if (
        event.type === "message_end" &&
        decodeMessage(value.message).role === "assistant"
      ) {
        const message = decodeAssistant(value.message);

        const text = message.content
          .filter((part) => part.type === "text")
          .map((part) => {
            if (part.text === undefined)
              throw new Error("assistant text block has no text");

            return part.text;
          })
          .join("\n")
          .trim();

        if (text) result.output = text;
        result.model = `${message.provider}/${message.model}`;
        run.stopReason = message.stopReason;
        run.errorMessage = message.errorMessage;
        run.settled = false;
      }

      if (
        event.type === "tool_execution_end" &&
        value.toolName === "structured_output" &&
        value.isError === false
      ) {
        const tool = decodeTool(value);
        result.structured = tool.result.details;
      }

      if (event.type === "agent_settled") {
        const settled = decodeSettled(value);
        run.settled = true;
        run.aborted = settled.aborted ?? false;
      }
    } catch (error) {
      run.protocolError = `Invalid Pi JSON event: ${error instanceof Error ? error.message : String(error)}`;
    }
  };

  return new Promise((settle) => {
    const child = NodeChildProcess.spawn(
      NodeProcess.env["PI_EXECUTABLE"] ?? "pi",
      args,
      {
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let buffered = "";
    let spawnError;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffered += chunk;
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";

      for (const line of lines) onLine(line);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      run.stderr += chunk;
    });
    // close, not error/exit, owns process and pipe settlement.
    child.on("error", (error) => {
      spawnError = error;
    });
    child.on("close", (code, signal) => {
      onLine(buffered);
      settle({
        ...run,
        exit: spawnError
          ? "spawn failed"
          : code === 0
            ? 0
            : String(signal ?? code),
        spawnError,
      });
    });
  });
}

/**
 * Run one child through process exit. Agent failures resolve with ok: false;
 * schema-file setup and cleanup failures throw. Defaults remain Pi's own.
 */
export async function agent(prompt, options = {}) {
  const label = options.label ?? "agent";
  const sessionId = NodeCrypto.randomUUID();
  const cwd = NodePath.resolve(options.cwd ?? NodeProcess.cwd());

  // Telemetry describes the caller's session; children must not append to it.
  const env = Object.fromEntries(
    Object.entries(NodeProcess.env).filter(
      ([name]) => !name.startsWith("PI_AUTOMATION_"),
    ),
  );

  delete env["PI_STRUCTURED_OUTPUT_SCHEMA"];
  const result = { ok: false, label, sessionId, cwd, output: "" };
  let schemaDir;

  try {
    if (options.schema !== undefined) {
      schemaDir = await NodeFSP.mkdtemp(
        NodePath.join(NodeOS.tmpdir(), "pi-agent-schema-"),
      );
      env["PI_STRUCTURED_OUTPUT_SCHEMA"] = NodePath.join(
        schemaDir,
        "schema.json",
      );
      await NodeFSP.writeFile(
        env["PI_STRUCTURED_OUTPUT_SCHEMA"],
        JSON.stringify(options.schema),
        { mode: 0o600 },
      );
    }

    const run = await runChild(
      childArgs(prompt, options, sessionId, label),
      cwd,
      env,
      result,
    );

    if (run.exit !== 0)
      result.error = `pi exited with ${run.exit}: ${run.spawnError?.message ?? run.stderr.trim()}`;
    else if (run.protocolError) result.error = run.protocolError;
    else if (
      run.stopReason === "error" ||
      run.stopReason === "aborted" ||
      run.aborted
    )
      result.error =
        `agent stopped (${run.aborted ? "aborted" : run.stopReason}): ${run.errorMessage ?? ""}`.trim();
    else if (
      !run.settled ||
      run.stopReason === undefined ||
      !["stop", "length", "toolUse"].includes(run.stopReason)
    )
      result.error =
        "pi exited without a completed assistant response and agent_settled event";
    else if (options.schema !== undefined && result.structured === undefined)
      result.error =
        "agent finished without a schema-valid structured_output call";
    else result.ok = true;
  } finally {
    if (schemaDir)
      await NodeFSP.rm(schemaDir, { recursive: true, force: true });
  }

  return result;
}

/** Stop admission on failure and drain all started work before rethrowing. */
export async function parallel(thunks, { concurrency = thunks.length } = {}) {
  if (thunks.length === 0) return [];

  if (!Number.isSafeInteger(concurrency) || concurrency < 1)
    throw new Error("parallel concurrency must be a positive safe integer");
  const results = Array.from({ length: thunks.length });
  let next = 0;
  let failed = false;

  const worker = async () => {
    while (!failed && next < thunks.length) {
      const index = next++;

      try {
        results[index] = await thunks[index]();
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };

  const settled = await Promise.allSettled(
    Array.from({ length: Math.min(concurrency, thunks.length) }, worker),
  );

  const rejection = settled.find((outcome) => outcome.status === "rejected");

  if (rejection) throw rejection.reason;

  return results;
}
