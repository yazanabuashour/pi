import { truncateTail } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import {
  BackgroundTerminalDetailsSchema,
  TerminalStatusSchema,
  type BackgroundTerminalDetailsV1,
  type OutputView,
  type TerminalSnapshot,
} from "./domain.ts";
import { STATUS_STDERR_MAX, STATUS_STDOUT_MAX } from "./prompt.ts";

const StreamSummarySchema = Type.Object({
  totalBytes: Type.Number(),
  truncatedBytes: Type.Number(),
  fullOutputPath: Type.Optional(Type.String()),
});

export const TerminalSummarySchema = Type.Object({
  ...BackgroundTerminalDetailsSchema.properties,
  command: Type.String(),
  stdout: StreamSummarySchema,
  stderr: StreamSummarySchema,
});

const StreamOutputSchema = Type.Object({
  ...StreamSummarySchema.properties,
  text: Type.String(),
  truncated: Type.Boolean(),
});

export const TerminalStatusOutputSchema = Type.Object({
  ...TerminalSummarySchema.properties,
  stdout: StreamOutputSchema,
  stderr: StreamOutputSchema,
});

export const TerminalListOutputSchema = Type.Object({
  terminals: Type.Array(TerminalSummarySchema),
});

export const TerminalKillOutputSchema = Type.Object({
  results: Type.Array(
    Type.Object({
      id: Type.String(),
      title: Type.String(),
      status: TerminalStatusSchema,
      wasRunning: Type.Boolean(),
      killed: Type.Boolean(),
      stopRequested: Type.Optional(Type.Boolean()),
      cleanupIncomplete: Type.Optional(Type.String()),
      exit: Type.String(),
      terminal: Type.Optional(TerminalSummarySchema),
    }),
  ),
});

function streamSummary(view: OutputView): Static<typeof StreamSummarySchema> {
  const summary: Static<typeof StreamSummarySchema> = {
    totalBytes: view.totalBytes,
    truncatedBytes: view.truncatedBytes,
  };

  if (view.spillPath !== undefined) summary.fullOutputPath = view.spillPath;

  return summary;
}

export function terminalSummary(
  snapshot: TerminalSnapshot,
  details: BackgroundTerminalDetailsV1,
): Static<typeof TerminalSummarySchema> {
  return {
    ...details,
    command: snapshot.command,
    stdout: streamSummary(snapshot.stdout),
    stderr: streamSummary(snapshot.stderr),
  };
}

function streamOutput(view: OutputView, maxBytes: number) {
  const tail = truncateTail(view.text, { maxBytes });

  return {
    ...streamSummary(view),
    text: tail.content,
    truncated: tail.truncated || view.truncatedBytes > 0,
  };
}

export function terminalStatusOutput(
  snapshot: TerminalSnapshot,
  details: BackgroundTerminalDetailsV1,
): Static<typeof TerminalStatusOutputSchema> {
  return {
    ...terminalSummary(snapshot, details),
    stdout: streamOutput(snapshot.stdout, STATUS_STDOUT_MAX),
    stderr: streamOutput(snapshot.stderr, STATUS_STDERR_MAX),
  };
}
