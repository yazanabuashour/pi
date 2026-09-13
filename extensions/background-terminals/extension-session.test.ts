import * as NodeAssert from "node:assert/strict";
import NodeTest from "node:test";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { BackgroundTerminalSession } from "./src/extension-session.ts";
import { runTool } from "./src/runtime.ts";
import { cwd, nodeCmd, pollUntil } from "./manager.test-support.ts";

interface TestEvent {
  readonly reason: string;
}

type EventHandler = (
  event: TestEvent,
  context: ExtensionContext,
) => void | Promise<void>;
type SendMessage = ExtensionAPI["sendMessage"];
type SendOptions = Parameters<SendMessage>[1];

NodeTest(
  "active and settling results do not spawn turns while idle results wake the agent",
  async () => {
    const events = new Map<string, EventHandler>();
    const sent: SendOptions[] = [];
    const api: ExtensionAPI = Object.assign(Object.create(null), {
      appendEntry: () => undefined,
      on: (event: string, handler: EventHandler) => events.set(event, handler),
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
    NodeAssert.deepEqual(sent, [{ deliverAs: "followUp", triggerTurn: true }]);

    await shutdown({ reason: "quit" }, context);
  },
);
