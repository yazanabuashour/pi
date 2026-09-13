import * as NodeAssert from "node:assert/strict";
import NodeTest from "node:test";
import type {
  ExtensionAPI,
  ExtensionUIContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { AgentSnapshot } from "./src/domain.ts";
import {
  type BtwResultData,
  deliverBtwResult,
} from "./src/extension-status.ts";
import { formatActivityStatus } from "../shared/activity-status.ts";

NodeTest(
  "private results stay out of model messages and link to swarm navigation",
  () => {
    let result: BtwResultData | undefined;
    let entryType = "";
    let notification = "";
    const pi: ExtensionAPI = Object.assign(Object.create(null), {
      appendEntry: (type: string, data: BtwResultData) => {
        entryType = type;
        result = data;
      },
    });
    const ui: ExtensionUIContext = Object.assign(Object.create(null), {
      notify: (message: string) => {
        notification = message;
      },
    });
    const snapshot: AgentSnapshot = {
      id: "btw-1",
      parentId: "root",
      canSpawn: false,
      origin: "btw",
      title: "commit the intended changes",
      prompt: "commit the intended changes",
      cwd: "/repo/project",
      generation: 1,
      status: "done",
      createdAt: Date.now(),
      settledAt: Date.now(),
      outcome: "completed",
      meta: { sessionFilePath: "/tmp/btw.jsonl" },
      usage: {},
      transcript: [],
      liveTools: [],
      queued: [],
      finalText: "Committed abc1234",
      turns: 1,
    };

    deliverBtwResult(pi, ui, snapshot);

    NodeAssert.equal(entryType, "btw-result");
    NodeAssert.equal(result?.answer, snapshot.finalText);
    NodeAssert.match(
      notification,
      /^by the way .* answered — reopen it with \/swarm$/,
    );

    deliverBtwResult(pi, ui, { ...snapshot, status: "error" });
    NodeAssert.match(
      notification,
      /^by the way .* failed — reopen it with \/swarm$/,
    );
  },
);

NodeTest("activity footer links to swarm navigation", () => {
  const theme: Theme = Object.assign(Object.create(null), {
    fg: (_color: string, text: string) => text,
  });
  NodeAssert.match(
    formatActivityStatus(theme, "swarm", { running: 1, done: 1, failed: 1 }),
    /\/swarm to view$/,
  );
});
