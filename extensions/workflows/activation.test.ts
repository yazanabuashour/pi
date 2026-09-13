import * as NodeAssert from "node:assert/strict";
import NodeTest from "node:test";
import type {
  ExtensionAPI,
  InputEvent,
  InputEventResult,
} from "@earendil-works/pi-coding-agent";
import { registerWorkflowActivation } from "./activation.ts";

type Handler = (
  event: Pick<InputEvent, "text" | "source">,
) => InputEventResult | void;

NodeTest(
  "only the manual skill command activates an admitted workflow tool",
  () => {
    const events = new Map<string, Handler>();
    let tools = ["read", "workflow"];
    const api: ExtensionAPI = Object.assign(Object.create(null), {
      on: (event: string, handler: Handler) => events.set(event, handler),
      getActiveTools: () => tools,
      setActiveTools: (names: string[]) => {
        tools = names;
      },
    });
    registerWorkflowActivation(api);
    const start = events.get("session_start");
    const input = events.get("input");
    NodeAssert.ok(start);
    NodeAssert.ok(input);
    const send = (
      text: string,
      source: InputEvent["source"] = "interactive",
    ) => {
      NodeAssert.equal(input({ text, source }), undefined);
    };

    start({ text: "", source: "interactive" });
    NodeAssert.deepEqual(tools, ["read"]);
    for (const prompt of [
      "ultracode: review these modules",
      "Run a workflow for this audit",
      "Should I use a workflow here?",
      "/skill:workflow-authoring-extra",
    ]) {
      send(prompt);
      NodeAssert.deepEqual(tools, ["read"], prompt);
    }
    send("/skill:workflow-authoring", "extension");
    NodeAssert.deepEqual(tools, ["read"]);

    send("/skill:workflow-authoring review these modules");
    NodeAssert.deepEqual(tools, ["read", "workflow"]);
    send("/skill:workflow-authoring", "rpc");
    NodeAssert.deepEqual(tools, ["read", "workflow"]);

    // An explicitly excluded tool must stay excluded even for a manual request.
    tools = ["read"];
    start({ text: "", source: "interactive" });
    send("/skill:workflow-authoring");
    NodeAssert.deepEqual(tools, ["read"]);
  },
);
