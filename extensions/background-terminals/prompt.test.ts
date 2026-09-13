import * as NodeAssert from "node:assert/strict";
import NodeTest from "node:test";
import {
  backgroundTerminalDetails,
  type OutputView,
  type TerminalSnapshot,
} from "./src/domain.ts";
import {
  BG_START_PARAMETER_DESCRIPTIONS,
  BG_START_PROMPT_GUIDELINES,
  BG_START_TOOL_DESCRIPTION,
  buildKillReport,
  buildStatusResult,
  buildTerminalResultMessage,
} from "./src/prompt.ts";

NodeTest(
  "start guidance identifies the shell and scopes the final check to started work",
  () => {
    NodeAssert.match(BG_START_TOOL_DESCRIPTION, /sh -c on POSIX/);
    NodeAssert.match(
      BG_START_TOOL_DESCRIPTION,
      /cmd\.exe \/d \/s \/c on Windows/,
    );
    NodeAssert.match(BG_START_PARAMETER_DESCRIPTIONS.command, /sh -c on POSIX/);
    NodeAssert.match(
      BG_START_PARAMETER_DESCRIPTIONS.command,
      /cmd\.exe \/d \/s \/c on Windows/,
    );
    NodeAssert.match(
      BG_START_PROMPT_GUIDELINES.join("\n"),
      /If you started background work in this session, use bg_list before finalizing/,
    );
  },
);

function view(overrides: Partial<OutputView> = {}): OutputView {
  return { text: "", totalBytes: 0, truncatedBytes: 0, ...overrides };
}

function snap(overrides: Partial<TerminalSnapshot> = {}): TerminalSnapshot {
  return {
    id: "bt-1",
    command: "sleep 999",
    title: "test",
    cwd: "/tmp",
    pid: 123,
    status: "done",
    createdAt: Date.now() - 5_000,
    settledAt: Date.now(),
    stdout: view(),
    stderr: view(),
    ...overrides,
  };
}

NodeTest(
  "kill report distinguishes killed / raced natural exit / already settled",
  () => {
    const report = buildKillReport([
      {
        id: "bt-1",
        title: "a",
        status: "killed",
        wasRunning: true,
        killed: true,
        exit: "SIGTERM",
      },
      {
        id: "bt-2",
        title: "b",
        status: "done",
        wasRunning: true,
        killed: false,
        exit: "exit 0",
      },
      {
        id: "bt-3",
        title: "c",
        status: "failed",
        wasRunning: false,
        killed: false,
        exit: "exit 1",
      },
    ]);
    const [killedLine, racedLine, settledLine] = report.split("\n");
    NodeAssert.ok(killedLine);
    NodeAssert.ok(racedLine);
    NodeAssert.ok(settledLine);
    NodeAssert.equal(killedLine, 'Killed bt-1 "a" (SIGTERM).');
    NodeAssert.match(
      racedLine,
      /exited on its own before the kill landed \(exit 0\)/,
    );
    NodeAssert.match(settledLine, /was already failed \(exit 1\)/);
  },
);

NodeTest(
  "status result marks head-truncated output with a pointer at the full log",
  () => {
    const text = buildStatusResult(
      snap({
        stdout: view({
          text: "tail of the log\n",
          totalBytes: 5 * 1024 * 1024,
          truncatedBytes: 5 * 1024 * 1024 - 16,
          spillPath: "/tmp/bt-1.stdout.log",
        }),
      }),
    );
    NodeAssert.match(text, /stdout truncated: showing last /);
    NodeAssert.match(
      text,
      /Temporary full log \(available until session shutdown\): \/tmp\/bt-1\.stdout\.log/,
    );
  },
);

NodeTest(
  "terminal lifecycle details distinguish interruption from failure",
  () => {
    const details = backgroundTerminalDetails(
      snap({
        status: "killed",
        createdAt: 1,
        settledAt: 2,
        signal: "SIGTERM",
      }),
      "settled",
      "runtime-1",
      "reload",
    );
    NodeAssert.equal(details.outcome, "interrupted");
  },
);

NodeTest(
  "completion message reports kill vs exit and omits empty stderr",
  () => {
    const killed = buildTerminalResultMessage(
      snap({ status: "killed", signal: "SIGTERM" }),
    );
    NodeAssert.match(killed, /was killed after/);
    NodeAssert.ok(!killed.includes("stderr"), "empty stderr section omitted");

    const failed = buildTerminalResultMessage(
      snap({
        status: "failed",
        exitCode: 3,
        stderr: view({ text: "boom\n", totalBytes: 5 }),
      }),
    );
    NodeAssert.match(failed, /exited \(exit 3\)/);
    NodeAssert.match(failed, /stderr:\nboom/);
  },
);

NodeTest(
  "completion output is a shorter tail than the detailed status view",
  () => {
    const output = Array.from(
      { length: 100 },
      (_, index) => `line-${index + 1}`,
    ).join("\n");
    const terminal = snap({
      stdout: view({ text: output, totalBytes: Buffer.byteLength(output) }),
    });

    const completion = buildTerminalResultMessage(terminal);
    const status = buildStatusResult(terminal);

    NodeAssert.ok(!completion.includes("line-1\n"));
    NodeAssert.match(completion, /line-100/);
    NodeAssert.match(completion, /stdout truncated/);
    NodeAssert.match(status, /line-1\n/);
  },
);
