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
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  renderSwarmToolCall,
  renderSwarmToolResult,
} from "./src/extension-renderers.ts";

await NodeTest(
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

await NodeTest(
  "swarm rows hide routine bodies but preserve expansion and errors",
  () => {
    const theme: Theme = Object.assign(Object.create(null), {
      fg: (_color: string, text: string) => text,
      bold: (text: string) => text,
    });

    const args = { name: "worker", prompt: "private-prompt" };

    const call = (expanded: boolean) =>
      renderSwarmToolCall("swarm_spawn", args.name, args, theme, expanded);

    NodeAssert.doesNotMatch(
      call(false).render(80).join("\n"),
      /private-prompt/,
    );
    NodeAssert.match(call(true).render(80).join("\n"), /private-prompt/);

    const context: Parameters<typeof renderSwarmToolResult>[3] = Object.assign(
      Object.create(null),
      {
        isError: false,
      },
    );

    const result = {
      content: [{ type: "text" as const, text: "worker-result" }],
      details: { id: "sa-1" },
    };

    const collapsed = renderSwarmToolResult(
      result,
      { expanded: false, isPartial: false },
      theme,
      context,
    );

    NodeAssert.match(collapsed.render(80).join("\n"), /sa-1.*\/swarm/);
    NodeAssert.doesNotMatch(collapsed.render(80).join("\n"), /worker-result/);

    for (const options of [
      { expanded: true, isPartial: false, isError: false },
      { expanded: false, isPartial: true, isError: false },
      { expanded: false, isPartial: false, isError: true },
    ]) {
      context.isError = options.isError;
      const rendered = renderSwarmToolResult(result, options, theme, context);
      NodeAssert.match(rendered.render(80).join("\n"), /worker-result/);
    }

    for (const component of [call(false), call(true), collapsed]) {
      for (const width of [20, 80]) {
        NodeAssert.ok(
          component.render(width).every((line) => visibleWidth(line) <= width),
        );
      }
    }
  },
);

await NodeTest("activity footer links to swarm navigation", () => {
  const theme: Theme = Object.assign(Object.create(null), {
    fg: (_color: string, text: string) => text,
  });

  NodeAssert.match(
    formatActivityStatus(theme, "swarm", { running: 1, done: 1, failed: 1 }),
    /\/swarm to view$/,
  );
});
