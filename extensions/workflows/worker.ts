import { WorkerSession } from "./worker-session.ts";
import { safeStringify } from "./serialization.ts";

const MAX_SOURCE_BYTES = 512 * 1024;
const MAX_ARGS_BYTES = 256 * 1024;

export interface WorkerAgentOptions {
  label?: unknown;
  phase?: unknown;
  schema?: unknown;
  effort?: unknown;
}

export interface WorkerAgentResult {
  ok: boolean;
  output: string;
  structured?: unknown;
  error?: string;
}

export interface RunWorkflowWorkerOptions {
  source: string;
  args: unknown;
  cwd: string;
  signal: AbortSignal;
  onAgent: (
    prompt: string,
    options: WorkerAgentOptions,
    signal: AbortSignal,
  ) => Promise<WorkerAgentResult>;
  onPhase: (title: string) => void;
}

function byteLength(value: string) {
  return Buffer.byteLength(value, "utf8");
}

/**
 * Run trusted agent-authored code with the account's host permissions in a
 * separate killable worker. This is a reliability boundary, not a security
 * sandbox. Settlement includes worker exit, but the parent RunController owns
 * agent task settlement. Neither workflows nor agent requests have a wall timer.
 */
export async function runWorkflowWorker(options: RunWorkflowWorkerOptions) {
  options.signal.throwIfAborted();
  if (byteLength(options.source) > MAX_SOURCE_BYTES) {
    return Promise.reject(
      new Error(`Workflow script exceeds the ${MAX_SOURCE_BYTES} byte limit`),
    );
  }

  const argsJson = safeStringify(
    { defined: options.args !== undefined, value: options.args },
    { maxBytes: MAX_ARGS_BYTES, maxDepth: 16, maxNodes: 10_000 },
  );
  if (byteLength(argsJson) > MAX_ARGS_BYTES) {
    return Promise.reject(new Error("Workflow args exceed the IPC limit"));
  }

  options.signal.throwIfAborted();
  return new WorkerSession(options).run(options.source, argsJson);
}
