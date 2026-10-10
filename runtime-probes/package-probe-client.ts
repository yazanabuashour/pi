import * as NodeChildProcess from "node:child_process";
import * as NodeProcess from "node:process";
import { Type } from "typebox";
import { Parse } from "typebox/value";

const eventSchema = Type.Object({
  type: Type.String(),
  success: Type.Optional(Type.Boolean()),
  error: Type.Optional(Type.String()),
  message: Type.Optional(
    Type.Object({
      role: Type.String(),
      stopReason: Type.Optional(Type.String()),
      errorMessage: Type.Optional(Type.String()),
      content: Type.Optional(
        Type.Union([
          Type.String(),
          Type.Array(
            Type.Object({
              type: Type.String(),
              text: Type.Optional(Type.String()),
            }),
          ),
        ]),
      ),
    }),
  ),
});

const executable = NodeProcess.argv[2];

if (!executable) throw new Error("Expected a native Pi executable");

// The test-only shutdown tripwires and their measurement receipt are documented in docs/development.md.
const child = NodeChildProcess.spawn(
  executable,
  [
    "--mode",
    "rpc",
    "--no-session",
    "--no-context-files",
    "--no-approve",
    "--model",
    "dotfiles-package-probe/probe",
    "--thinking",
    "off",
  ],
  { stdio: ["pipe", "pipe", "pipe"] },
);

let finished = false;

let failure: Error | undefined;

let buffered = "";

let escalation: ReturnType<typeof setTimeout> | undefined;

function stop(cause?: Error) {
  failure ??= cause;
  child.stdin.end();

  if (!escalation)
    escalation = setTimeout(() => {
      failure ??= new Error("Native RPC did not close after orderly shutdown");
      child.kill("SIGKILL");
    }, 120_000);
}

function consume(line: string) {
  NodeProcess.stdout.write(`${line}\n`);
  const event = Parse(eventSchema, JSON.parse(line));

  if (event.type === "response" && event.success === false)
    stop(new Error(event.error ?? "Native RPC command failed"));

  if (event.type === "message_end" && event.message?.role === "assistant") {
    const message = event.message;

    if (message.stopReason === "error" || message.stopReason === "aborted") {
      if (
        NodeProcess.argv[3] !== "missing-tool" ||
        !message.errorMessage?.includes("missing required tool: web_search")
      )
        failure = new Error(message.errorMessage ?? "Native provider failed");
      finished = true;
    } else if (
      Array.isArray(message.content) &&
      message.content.some(
        (part) =>
          part.type === "text" && part.text === "dotfiles-package-probe-ok",
      )
    ) {
      finished = true;
    }
  }

  if (event.type === "agent_settled" && finished) stop();
}

const tripwire = setTimeout(() => {
  stop(
    new Error(
      "Native integration did not deliver and settle within the test tripwire",
    ),
  );
}, 120_000);

child.stdout.setEncoding("utf8");

child.stdout.on("data", (chunk: string) => {
  buffered += chunk;
  const lines = buffered.split("\n");
  buffered = lines.pop() ?? "";

  try {
    for (const line of lines) consume(line);
  } catch (cause) {
    stop(cause instanceof Error ? cause : new Error(String(cause)));
  }
});

child.stderr.on("data", (chunk: Buffer) => NodeProcess.stderr.write(chunk));

child.on("error", (cause) => {
  failure = cause;
});

const closed = new Promise<void>((resolve, reject) => {
  child.on("close", (code, signal) => {
    clearTimeout(tripwire);
    clearTimeout(escalation);

    if (buffered.trim())
      failure ??= new Error("Native RPC emitted an incomplete JSONL record");

    if (failure || code !== 0 || !finished)
      reject(
        failure ??
          new Error(`Native RPC exited before completion: ${signal ?? code}`),
      );
    else resolve();
  });
});

child.stdin.on("error", (cause) => {
  failure ??= cause;
});

child.stdin.write(
  `${JSON.stringify({
    type: "prompt",
    id: "integration",
    message:
      "/skill:workflow-authoring run the offline package integration probe.",
  })}\n`,
);

await closed;
