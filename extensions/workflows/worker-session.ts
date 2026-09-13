import type { RuntimeRecord, RuntimeValue } from "../shared/runtime-values.ts";
import { isNumber, isObjectValue, isString } from "../shared/runtime-values.ts";
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeOS from "node:os";
import * as NodeURL from "node:url";
import type {
  RunWorkflowWorkerOptions,
  WorkerAgentOptions,
  WorkerAgentResult,
} from "./worker.ts";
import { toSerializable } from "./serialization.ts";

const MAX_RESULT_BYTES = 1024 * 1024;
const MAX_AGENT_MESSAGE_BYTES = 512 * 1024;
const MAX_AGENT_REQUESTS = 32;

type Outcome =
  | { ok: true; value: RuntimeValue }
  | { ok: false; error: unknown };

function byteLength(value: string) {
  return Buffer.byteLength(value, "utf8");
}

function isRecord<Input1>(value: Input1): value is Input1 & RuntimeRecord {
  return isObjectValue(value) && value !== null && !Array.isArray(value);
}

function errorText<Input1>(error: Input1) {
  return error instanceof Error ? error.message : String(error);
}

function sanitizeAgentOptions<Input1>(value: Input1): WorkerAgentOptions {
  if (!isRecord(value)) return {};
  const options: WorkerAgentOptions = {};
  if (value["label"] !== undefined) options.label = value["label"];
  if (value["phase"] !== undefined) options.phase = value["phase"];
  if (value["schema"] !== undefined) options.schema = value["schema"];
  if (value["effort"] !== undefined) options.effort = value["effort"];
  return options;
}

export class WorkerSession {
  private readonly child: NodeChildProcess.ChildProcess;
  private readonly token = NodeCrypto.randomBytes(24).toString("hex");
  private readonly requestIds = new Set<number>();
  private readonly activeAgentRequests = new Map<number, AbortController>();
  private requestCount = 0;
  private outcome: Outcome | undefined;
  private forceTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly options: RunWorkflowWorkerOptions;

  constructor(options: RunWorkflowWorkerOptions) {
    this.options = options;
    const workerPath = NodeURL.fileURLToPath(
      new URL("./worker-child.cjs", import.meta.url),
    );
    const bun = Boolean(process.versions["bun"]);
    const env: NodeJS.ProcessEnv = {
      PATH: process.env["PATH"] ?? "",
      NODE_NO_WARNINGS: "1",
    };
    if (bun) env["BUN_BE_BUN"] = "1";
    // Native Pi embeds Bun. BUN_BE_BUN selects its documented CLI entrypoint
    // only in this child. No runtime lookup or inherited config/auth environment.
    this.child = NodeChildProcess.spawn(
      process.execPath,
      [
        ...(bun
          ? ["--no-env-file", `--config=${NodeOS.devNull}`]
          : ["--max-old-space-size=128", "--stack-size=2048"]),
        workerPath,
      ],
      {
        cwd: options.cwd,
        env,
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      },
    );
  }

  run(source: string, argsJson: string) {
    return new Promise<RuntimeValue>((resolve, reject) => {
      const initialize = () => this.send({ kind: "init", source, argsJson });
      this.child.once("spawn", initialize);
      this.child.on("error", this.onError);
      this.child.on("message", this.handleMessage);
      // close follows exit (or spawn failure) and drained stdio/IPC. Keep error
      // observation installed until then, including pending send callbacks.
      this.child.once("close", (code, signal) => {
        this.finish({
          ok: false,
          error: new Error(
            `Workflow worker exited before completion (${signal ?? code ?? "unknown"})`,
          ),
        });
        if (this.forceTimer) clearTimeout(this.forceTimer);
        this.forceTimer = undefined;
        this.child.removeListener("spawn", initialize);
        this.child.removeListener("error", this.onError);
        this.child.removeListener("message", this.handleMessage);
        const outcome = this.outcome;
        if (outcome?.ok) resolve(outcome.value);
        else reject(outcome?.error);
      });
      this.options.signal.addEventListener("abort", this.onAbort, {
        once: true,
      });
      if (this.options.signal.aborted) this.onAbort();
    });
  }

  private readonly onAbort = () =>
    this.finish({ ok: false, error: this.options.signal.reason });

  private readonly onError = (error: Error) =>
    this.finish({ ok: false, error });

  private finish(outcome: Outcome) {
    if (this.outcome) return;
    this.outcome = outcome;
    this.options.signal.removeEventListener("abort", this.onAbort);
    for (const controller of this.activeAgentRequests.values()) {
      controller.abort(
        outcome.ok ? new Error("Workflow stopped") : outcome.error,
      );
    }
    this.activeAgentRequests.clear();
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    this.child.kill("SIGTERM");
    // Retain the existing TERM-to-KILL grace period, not a workflow deadline.
    this.forceTimer = setTimeout(() => {
      if (this.child.exitCode === null && this.child.signalCode === null)
        this.child.kill("SIGKILL");
    }, 1_000);
    this.forceTimer.unref?.();
  }

  private send(message: RuntimeRecord) {
    if (this.outcome) return;
    try {
      if (!this.child.connected)
        throw new Error("Workflow worker IPC disconnected");
      this.child.send({ token: this.token, ...message }, (error) => {
        if (error) this.onError(error);
      });
    } catch (error) {
      this.finish({ ok: false, error });
    }
  }

  private readonly handleMessage = <Input1>(raw: Input1) => {
    if (this.outcome) return;
    if (
      !isRecord(raw) ||
      raw["token"] !== this.token ||
      !isString(raw["kind"])
    ) {
      this.onError(new Error("Workflow worker sent an invalid IPC message"));
      return;
    }
    const kind = raw["kind"];
    if (kind === "phase") this.handlePhase(raw);
    else if (kind === "agent") this.handleAgent(raw);
    else if (kind === "result") this.handleResult(raw);
    else if (kind === "error" && isString(raw["error"])) {
      this.onError(new Error(raw["error"].slice(0, 16 * 1024)));
    } else
      this.onError(new Error("Workflow worker sent an unknown IPC message"));
  };

  private handlePhase(raw: RuntimeRecord) {
    const payloadJson = raw["payloadJson"];
    if (!isString(payloadJson) || byteLength(payloadJson) > 4096) {
      this.onError(new Error("Workflow worker sent an invalid phase update"));
      return;
    }
    try {
      const payload: unknown = JSON.parse(payloadJson);
      if (!isRecord(payload) || !isString(payload["title"])) {
        throw new Error("invalid title");
      }
      this.options.onPhase(payload["title"].slice(0, 160));
    } catch (error) {
      this.onError(new Error("Workflow phase update failed", { cause: error }));
    }
  }

  private handleAgent(raw: RuntimeRecord) {
    const payload = this.parseAgentPayload(raw["payloadJson"]);
    if (!payload) return;
    if (
      this.requestIds.has(payload.id) ||
      ++this.requestCount > MAX_AGENT_REQUESTS
    ) {
      this.onError(
        new Error("Workflow worker exceeded its agent request budget"),
      );
      return;
    }
    this.requestIds.add(payload.id);
    const controller = new AbortController();
    this.activeAgentRequests.set(payload.id, controller);
    // Observe even a callback that throws synchronously or ignores cancellation.
    // RunController owns the actual agent task and its settlement deadline.
    void Promise.resolve()
      .then(() => {
        if (this.outcome) return undefined;
        return this.options.onAgent(
          payload.prompt,
          sanitizeAgentOptions(payload.options),
          controller.signal,
        );
      })
      .then(
        (result) => {
          if (result) this.sendAgentResult(payload.id, result);
        },
        (error) =>
          this.sendAgentResult(payload.id, {
            ok: false,
            output: "",
            error: errorText(error),
          }),
      )
      .catch((error) => this.finish({ ok: false, error }));
  }

  private parseAgentPayload<Input1>(payloadJson: Input1) {
    if (
      !isString(payloadJson) ||
      byteLength(payloadJson) > MAX_AGENT_MESSAGE_BYTES
    ) {
      this.onError(
        new Error("Workflow worker sent an oversized agent request"),
      );
      return;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(payloadJson);
    } catch {
      this.onError(new Error("Workflow worker sent malformed agent JSON"));
      return;
    }
    if (!isRecord(payload)) {
      this.onError(new Error("Workflow worker sent an invalid agent request"));
      return;
    }
    const id = payload["id"];
    const prompt = payload["prompt"];
    const options = payload["options"];
    if (
      !isNumber(id) ||
      !Number.isSafeInteger(id) ||
      id < 1 ||
      !isString(prompt) ||
      prompt.length > 100_000 ||
      !isRecord(options)
    ) {
      this.onError(new Error("Workflow worker sent an invalid agent request"));
      return;
    }
    return { id, prompt, options };
  }

  private sendAgentResult(id: number, result: WorkerAgentResult) {
    if (!this.activeAgentRequests.delete(id) || this.outcome) return;
    try {
      const normalized = toSerializable(result, {
        maxDepth: 16,
        maxNodes: 10_000,
        maxStringBytes: 128 * 1024,
      });
      let resultJson = JSON.stringify(normalized);
      if (byteLength(resultJson) > MAX_AGENT_MESSAGE_BYTES) {
        resultJson = JSON.stringify({
          ok: false,
          output: "",
          error: "Agent result exceeded the workflow IPC output limit",
        });
      }
      this.send({ kind: "agentResult", id, resultJson });
    } catch (error) {
      this.finish({ ok: false, error });
    }
  }

  private handleResult(raw: RuntimeRecord) {
    const resultJson = raw["resultJson"];
    if (!isString(resultJson) || byteLength(resultJson) > MAX_RESULT_BYTES) {
      this.onError(new Error("Workflow result exceeded the IPC limit"));
      return;
    }
    try {
      const normalized = toSerializable(JSON.parse(resultJson));
      this.finish({ ok: true, value: JSON.parse(JSON.stringify(normalized)) });
    } catch (error) {
      this.onError(
        new Error(`Workflow returned invalid JSON: ${errorText(error)}`),
      );
    }
  }
}
