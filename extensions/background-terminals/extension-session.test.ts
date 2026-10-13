import * as NodeAssert from "node:assert/strict";
import NodeTest from "node:test";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { BackgroundTerminalSession } from "./src/extension-session.ts";
import { runTool } from "./src/runtime.ts";
import type { BackgroundTerminalDetailsV1 } from "./src/domain.ts";
import {
  cwd,
  nodeCmd,
  pollUntil,
  processGone,
} from "./manager.test-support.ts";
import { hostPlatform } from "../shared/host-runtime.ts";
import { registerTerminalTools } from "./src/tools.ts";
import { startSignalHandler } from "./extension-session.test-support.ts";

interface TestEvent {
  readonly reason: string;
}

type EventHandler = (
  event: TestEvent,
  context: ExtensionContext,
) => void | Promise<void>;

type SendMessage = ExtensionAPI["sendMessage"];

type SendOptions = Parameters<SendMessage>[1];

for (const policy of ["automatic", "host"] as const)
  await NodeTest(
    `${policy} delivery preserves active messages and controls idle wakes without a UI`,
    async (test) => {
      const previous = process.env["PI_BACKGROUND_WAKE_POLICY"];
      process.env["PI_BACKGROUND_WAKE_POLICY"] = policy;
      test.after(() => {
        if (previous === undefined)
          delete process.env["PI_BACKGROUND_WAKE_POLICY"];
        else process.env["PI_BACKGROUND_WAKE_POLICY"] = previous;
      });
      const events = new Map<string, EventHandler>();
      const sent: SendOptions[] = [];

      const api: ExtensionAPI = Object.assign(Object.create(null), {
        appendEntry: () => undefined,
        on: (event: string, handler: EventHandler) =>
          events.set(event, handler),
        sendMessage: (
          _message: Parameters<SendMessage>[0],
          options: SendOptions,
        ) => sent.push(options),
      });

      let idle = false;

      const context: ExtensionContext = Object.assign(Object.create(null), {
        hasUI: false,
        isIdle: () => idle,
        sessionManager: Object.assign(Object.create(null), {
          getSessionId: () => "delivery-test-session",
        }),
      });

      const session = new BackgroundTerminalSession(api);
      const startSession = events.get("session_start");
      const turnEnd = events.get("turn_end");
      const agentSettled = events.get("agent_settled");
      const shutdown = events.get("session_shutdown");
      NodeAssert.ok(startSession);
      NodeAssert.ok(turnEnd);
      NodeAssert.ok(agentSettled);
      NodeAssert.ok(shutdown);
      await startSession({ reason: "startup" }, context);

      const manager = await session.getManager();

      const startAndSettle = async (title: string) => {
        const snapshot = await runTool(
          session.getRuntime(),
          manager.start({ command: nodeCmd(""), title, cwd }),
        );

        NodeAssert.equal(session.recordStart(snapshot), true);
        NodeAssert.equal(
          await pollUntil(
            () => manager.view.get(snapshot.id)?.status !== "running",
          ),
          true,
        );
      };

      await startAndSettle("active result");
      NodeAssert.deepEqual(sent, []);
      await turnEnd({ reason: "turn-end" }, context);
      NodeAssert.deepEqual(sent, [{ deliverAs: "steer" }]);

      sent.length = 0;
      await startAndSettle("settlement-race result");
      await agentSettled({ reason: "agent-settled" }, context);
      NodeAssert.deepEqual(sent, [{ deliverAs: "steer" }]);

      sent.length = 0;
      idle = true;
      await startAndSettle("idle result");
      NodeAssert.deepEqual(sent, [
        policy === "automatic"
          ? { deliverAs: "followUp", triggerTurn: true }
          : { deliverAs: "followUp" },
      ]);

      await shutdown({ reason: "quit" }, context);
    },
  );

async function killDeliveryFixture(test: NodeTest.TestContext) {
  const events = new Map<string, EventHandler>();

  type Tool = Parameters<ExtensionAPI["registerTool"]>[0];

  const tools = new Map<string, Tool>();
  const sent: Array<Parameters<SendMessage>[0]> = [];
  let idle = false;

  const api: ExtensionAPI = Object.assign(Object.create(null), {
    appendEntry: () => {},
    on: (name: string, handler: EventHandler) => events.set(name, handler),
    registerTool: (tool: Tool) => tools.set(tool.name, tool),
    sendMessage: (message: Parameters<SendMessage>[0]) => sent.push(message),
  });

  const context = Object.assign(Object.create(null), {
    hasUI: false,
    isIdle: () => idle,
    sessionManager: { getSessionId: () => "kill-abort" },
  });

  const session = new BackgroundTerminalSession(api);
  registerTerminalTools(api, session);
  await events.get("session_start")?.({ reason: "startup" }, context);
  test.after(async () =>
    events.get("session_shutdown")?.({ reason: "quit" }, context),
  );

  return {
    events,
    tools,
    sent,
    context,
    session,
    setIdle: () => {
      idle = true;
    },
  };
}

for (const overlap of [false, true])
  await NodeTest(
    `aborted multi-kill ${overlap ? "preserves overlapping acknowledgement" : "recovers earlier completion"}`,
    { skip: hostPlatform === "win32" },
    async (test) => {
      const { events, tools, sent, context, session, setIdle } =
        await killDeliveryFixture(test);

      const first = await startSignalHandler(
        session,
        "first",
        "process.exit(0)",
      );

      const second = await startSignalHandler(
        session,
        "resistant",
        'process.stdout.write("term\\n")',
      );

      const kill = tools.get("bg_kill");
      NodeAssert.ok(kill);
      const ids = [first.id, second.id];
      const reason = new Error("fixture caller abort");
      const preAbort = new AbortController();
      preAbort.abort(reason);
      await NodeAssert.rejects(
        kill.execute("preabort", { ids }, preAbort.signal, undefined, context),
        { cause: reason },
      );
      NodeAssert.equal(first.stopRequested, undefined);
      const controller = new AbortController();

      const aborted = kill.execute(
        "abort",
        { ids },
        controller.signal,
        undefined,
        context,
      );

      const rejected = NodeAssert.rejects(aborted, { cause: reason });

      const surviving = overlap
        ? kill.execute("overlap", { ids }, undefined, undefined, context)
        : undefined;

      NodeAssert.ok(
        await pollUntil(
          () => first.status === "done" && second.stdout.text.includes("term"),
        ),
      );
      await events.get("turn_end")?.({ reason: "turn-end" }, context);
      NodeAssert.deepEqual(sent, [], "held results do not flush while waiting");
      setIdle();
      controller.abort(reason);
      await rejected;

      if (surviving) {
        NodeAssert.deepEqual(
          sent,
          [],
          "one aborted hold does not release a surviving wait",
        );
        const result = await surviving;
        NodeAssert.match(JSON.stringify(result), /first/);
        NodeAssert.match(JSON.stringify(result), /resistant/);
        NodeAssert.deepEqual(
          sent,
          [],
          "successful tool report consumes both results",
        );
      } else {
        NodeAssert.equal(
          sent.length,
          1,
          "the earlier completion is recovered on abort",
        );
        NodeAssert.match(JSON.stringify(sent[0]), /first/);
        NodeAssert.ok(await pollUntil(() => second.status === "killed"));
        NodeAssert.equal(
          sent.length,
          2,
          "the later settlement remains deliverable",
        );
        NodeAssert.match(JSON.stringify(sent[1]), /resistant/);
      }

      await events.get("agent_settled")?.({ reason: "settled" }, context);
      NodeAssert.equal(
        sent.length,
        overlap ? 0 : 2,
        "results are not delivered twice",
      );

      for (const snapshot of [first, second]) {
        NodeAssert.ok(snapshot.pid);
        NodeAssert.ok(await pollUntil(() => processGone(snapshot.pid ?? 0)));
      }
    },
  );

await NodeTest(
  "shutdown persists incomplete resource IDs when runtime disposal fails",
  async (test) => {
    const events = new Map<string, EventHandler>();
    const receipts: BackgroundTerminalDetailsV1[] = [];
    let rejectSettlement = true;

    const api: ExtensionAPI = Object.assign(Object.create(null), {
      appendEntry: (_type: string, details: BackgroundTerminalDetailsV1) => {
        if (details.event === "settled" && rejectSettlement) {
          rejectSettlement = false;
          throw new Error("fixture receipt failure");
        }

        receipts.push(details);
      },
      on: (event: string, handler: EventHandler) => events.set(event, handler),
      sendMessage: () => undefined,
    });

    const context: ExtensionContext = Object.assign(Object.create(null), {
      hasUI: false,
      isIdle: () => false,
      sessionManager: { getSessionId: () => "shutdown-failure" },
    });

    const session = new BackgroundTerminalSession(api);
    await events.get("session_start")?.({ reason: "startup" }, context);
    const manager = await session.getManager();
    const runtime = session.getRuntime();

    const snapshot = await runTool(
      runtime,
      manager.start({ command: nodeCmd(""), title: "disposal failure", cwd }),
    );

    NodeAssert.equal(session.recordStart(snapshot), true);
    NodeAssert.ok(await pollUntil(() => snapshot.status !== "running"));
    const dispose = runtime.dispose.bind(runtime);
    test.mock.method(runtime, "dispose", async () => {
      await dispose();
      throw new Error("fixture disposal failure");
    });
    const shutdown = events.get("session_shutdown");
    NodeAssert.ok(shutdown);
    await NodeAssert.rejects(
      async () => shutdown({ reason: "reload" }, context),
      /Cleanup incomplete for terminals: bt-1.*fixture disposal failure/,
    );
    NodeAssert.deepEqual(
      receipts.map((receipt) => receipt.event),
      ["started", "cleanup-incomplete", "settled"],
    );

    const receipt = receipts.find(
      (receipt) => receipt.event === "cleanup-incomplete",
    );

    NodeAssert.equal(receipt?.event, "cleanup-incomplete");
    NodeAssert.equal(receipt?.id, snapshot.id);
    NodeAssert.equal(receipt?.status, "done");
    NodeAssert.equal(receipt?.exitCode, 0);
    NodeAssert.equal(receipt?.outcome, "completed");
    NodeAssert.match(
      receipt?.cleanupIncomplete ?? "",
      /fixture disposal failure/,
    );
    // Shutdown stays idempotent after reporting and resetting the old owner.
    await shutdown({ reason: "reload" }, context);
  },
);
