import * as NodeAssert from "node:assert/strict";
import NodeTest from "node:test";
import { Check } from "typebox/value";
import {
  backgroundTerminalDetails,
  type TerminalSnapshot,
} from "./src/domain.ts";
import {
  TerminalListOutputSchema,
  TerminalStatusOutputSchema,
  TerminalSummarySchema,
  terminalStatusOutput,
  terminalSummary,
} from "./src/tool-output.ts";
import { STATUS_STDOUT_MAX } from "./src/prompt.ts";

await NodeTest(
  "structured terminal results preserve acceptance, observed exit and bounded output",
  () => {
    const text = `${"x".repeat(STATUS_STDOUT_MAX)}\nlast line`;

    const snapshot: TerminalSnapshot = {
      id: "bt-1",
      title: "build",
      command: "npm run build",
      cwd: "/work",
      pid: 123,
      status: "failed",
      createdAt: 1,
      settledAt: 2,
      exitCode: 3,
      stdout: {
        text,
        totalBytes: Buffer.byteLength(text),
        truncatedBytes: 0,
        spillPath: "/tmp/build.stdout.log",
      },
      stderr: { text: "failure", totalBytes: 7, truncatedBytes: 0 },
    };

    const accepted = terminalSummary(
      snapshot,
      backgroundTerminalDetails(snapshot, "started", "runtime-1"),
    );

    NodeAssert.ok(Check(TerminalSummarySchema, accepted));
    NodeAssert.equal(accepted.status, "running");
    NodeAssert.equal(accepted.outcome, undefined);
    NodeAssert.equal(accepted.exitCode, undefined);
    NodeAssert.equal(accepted.command, snapshot.command);
    NodeAssert.equal("text" in accepted.stdout, false);
    NodeAssert.ok(Check(TerminalListOutputSchema, { terminals: [accepted] }));

    const observed = terminalStatusOutput(
      snapshot,
      backgroundTerminalDetails(snapshot, "snapshot", "runtime-1"),
    );

    NodeAssert.ok(Check(TerminalStatusOutputSchema, observed));
    NodeAssert.equal(observed.status, "failed");
    NodeAssert.equal(observed.exitCode, 3);
    NodeAssert.equal(observed.outcome, "failed");
    NodeAssert.ok(Buffer.byteLength(observed.stdout.text) <= STATUS_STDOUT_MAX);
    NodeAssert.match(observed.stdout.text, /last line$/);
    NodeAssert.equal(observed.stdout.truncated, true);
    NodeAssert.equal(observed.stdout.totalBytes, Buffer.byteLength(text));
    NodeAssert.equal(observed.stdout.fullOutputPath, snapshot.stdout.spillPath);
    NodeAssert.equal(observed.stderr.text, "failure");
    NodeAssert.equal(observed.stderr.truncated, false);
  },
);
