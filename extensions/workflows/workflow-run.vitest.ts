import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { it, expect, onTestFinished, vi } from "vitest";
import { isRuntimeRecord, isString } from "../shared/runtime-values.ts";
import * as Agent from "./agent-run.ts";
import { WorkflowExtensionSession } from "./extension-session.ts";
import { emptyUsage, type WorkflowDetails } from "./model.ts";
import type { AgentOutcome, RunAgentOptions } from "./runner.ts";
import * as Serialization from "./serialization.ts";
import * as Worker from "./worker.ts";
import { WorkflowRun } from "./workflow-run.ts";

function receipt<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function readWorkflow(runDir: string): WorkflowDetails {
  // SAFETY: This fixture reads artifacts produced by the real workflow writer.
  return JSON.parse(
    NodeFS.readFileSync(NodePath.join(runDir, "workflow.json"), "utf8"),
  ) as WorkflowDetails;
}

async function fixture() {
  vi.useFakeTimers();
  const directory = NodeFS.mkdtempSync(
    NodePath.join(NodeOS.tmpdir(), "workflow-run-test-"),
  );
  vi.stubEnv("PI_CODING_AGENT_DIR", directory);
  vi.spyOn(Worker, "runWorkflowWorker");
  vi.spyOn(Agent, "runAgent");
  type Handler = (
    event: { reason: string },
    context: ExtensionContext,
  ) => void | Promise<void>;
  const handlers = new Map<string, Handler>();
  const appendEntry = vi.fn<ExtensionAPI["appendEntry"]>();
  const pi: ExtensionAPI = Object.assign(Object.create(null), {
    on: (name: string, handler: Handler) => handlers.set(name, handler),
    appendEntry,
    getThinkingLevel: () => "off",
  });
  const context: ExtensionContext = Object.assign(Object.create(null), {
    cwd: directory,
    hasUI: false,
    model: { id: "fixture-model", contextWindow: 100_000 },
    modelRegistry: {},
    isProjectTrusted: () => false,
    sessionManager: { getSessionId: () => "fixture-session" },
  });
  const session = new WorkflowExtensionSession(pi);
  await handlers.get("session_start")?.({ reason: "startup" }, context);
  onTestFinished(async () => {
    await handlers.get("session_shutdown")?.({ reason: "quit" }, context);
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    NodeFS.rmSync(directory, { recursive: true, force: true });
  });
  const lifecycle = () =>
    appendEntry.mock.calls.flatMap(([kind, data]) =>
      kind === "workflow-lifecycle" && isRuntimeRecord(data) ? [data] : [],
    );
  return { directory, pi, context, session, appendEntry, lifecycle };
}

it("persists admission before dispatch and exposes isolated settled snapshots", async () => {
  const f = await fixture();
  const params = {
    script: 'phase("Inspect"); return args;',
    args: '{"ok":true}',
  };
  vi.mocked(Worker.runWorkflowWorker).mockImplementation(async (options) => {
    const admitted = f.lifecycle();
    expect(admitted).toHaveLength(1);
    const runId = admitted[0]?.["runId"];
    NodeAssert.ok(isString(runId));
    const runDir = NodePath.join(f.directory, "workflows", String(runId));
    expect(readWorkflow(runDir).status).toBe("running");
    expect(
      NodeFS.readFileSync(NodePath.join(runDir, "script.js"), "utf8"),
    ).toBe(params.script);
    expect(
      NodeFS.readFileSync(NodePath.join(runDir, "args.json"), "utf8"),
    ).toBe(params.args);
    options.onPhase("Inspect");
    return { ok: true };
  });
  const run = WorkflowRun.start({ ...f, params });
  await run.completion;
  expect(run.details).toMatchObject({
    status: "completed",
    currentPhase: "Inspect",
    result: { ok: true },
  });
  expect(readWorkflow(run.runDir).status).toBe("completed");
  expect(f.lifecycle().map((entry) => entry["event"])).toEqual([
    "started",
    "settled",
  ]);
  const snapshot = run.details;
  snapshot.status = "failed";
  snapshot.phases.push({ title: "caller mutation" });
  expect(run.details.status).toBe("completed");
  expect(run.details.phases).not.toContainEqual({ title: "caller mutation" });
  expect(vi.getTimerCount()).toBe(0);
});

it("forces settlement once and rejects late worker and agent updates", async () => {
  const f = await fixture();
  const workerFinished = receipt<void>();
  const agentStarted = receipt<RunAgentOptions>();
  const agentFinished = receipt<AgentOutcome>();
  vi.mocked(Agent.runAgent).mockImplementation((options) => {
    agentStarted.resolve(options);
    return agentFinished.promise;
  });
  vi.mocked(Worker.runWorkflowWorker).mockImplementation(async (options) => {
    options.onPhase("Before shutdown");
    const agent = options.onAgent("inspect", {}, options.signal);
    await workerFinished.promise;
    options.onPhase("stale phase");
    await agent;
    return "stale result";
  });
  const run = WorkflowRun.start({
    ...f,
    params: { script: 'return agent("inspect");' },
  });
  const options = await agentStarted.promise;
  run.abort("Session is shutting down");
  run.forceInterrupted();
  run.forceInterrupted();
  const settled = run.details;
  const persisted = readWorkflow(run.runDir);
  expect(settled.status).toBe("aborted");
  expect(settled.agents[0]?.state).toBe("error");
  options.onProgress?.({
    preview: "stale preview",
    usage: emptyUsage(),
    transcript: [],
  });
  agentFinished.resolve({
    ok: true,
    output: "stale agent result",
    aborted: false,
    usage: emptyUsage(),
    transcript: [],
  });
  workerFinished.resolve();
  await run.completion;
  expect(run.details).toEqual(settled);
  expect(readWorkflow(run.runDir)).toEqual(persisted);
  expect(
    f.lifecycle().filter((entry) => entry["event"] === "settled"),
  ).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("reports failed final lifecycle persistence in both snapshot and artifact", async () => {
  const f = await fixture();
  vi.spyOn(console, "error").mockImplementation(() => {});
  f.appendEntry.mockImplementation((_kind, data) => {
    if (isRuntimeRecord(data) && data["event"] === "settled") {
      throw new Error("journal unavailable");
    }
  });
  vi.mocked(Worker.runWorkflowWorker).mockImplementation(async (options) => {
    options.onPhase("Finish");
    return undefined;
  });
  const updates: WorkflowDetails[] = [];
  const run = WorkflowRun.start({
    ...f,
    params: { script: "return undefined;" },
    onUpdate: (update) => updates.push(update.details),
  });
  await expect(run.completion).rejects.toThrow(/lifecycle/i);
  expect(updates.at(-1)?.status).toBe("failed");
  const persisted = readWorkflow(run.runDir);
  expect(run.details.status).toBe("failed");
  expect(persisted.status).toBe("failed");
  expect(persisted.error).toBe(run.details.error);
  expect(vi.getTimerCount()).toBe(0);
});

it("persists a failed final state after a transient artifact write failure", async () => {
  const f = await fixture();
  const finish = receipt<void>();
  vi.mocked(Worker.runWorkflowWorker).mockImplementation(async (options) => {
    options.onPhase("Finish");
    await finish.promise;
    return undefined;
  });
  const run = WorkflowRun.start({
    ...f,
    params: { script: "return undefined;" },
  });
  const write = Serialization.writeFileAtomic;
  let failed = false;
  vi.spyOn(Serialization, "writeFileAtomic").mockImplementation(
    (path, content) => {
      if (!failed && path === NodePath.join(run.runDir, "workflow.json")) {
        failed = true;
        throw new Error("transient write failure");
      }
      return write(path, content);
    },
  );
  finish.resolve();
  await expect(run.completion).rejects.toThrow(/persistence/i);
  const persisted = readWorkflow(run.runDir);
  expect(run.details.status).toBe("failed");
  expect(persisted.status).toBe("failed");
  expect(persisted.error).toBe(run.details.error);
  expect(f.lifecycle().at(-1)?.["status"]).toBe("failed");
  expect(vi.getTimerCount()).toBe(0);
});
