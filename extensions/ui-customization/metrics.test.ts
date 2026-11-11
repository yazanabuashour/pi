import * as NodeAssert from "node:assert/strict";
import NodeTest from "node:test";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import customize from "./index.ts";

await NodeTest(
  "navigation and compaction refresh footer branch metrics",
  async () => {
    type Handler = (
      event: { reason: string },
      context: ExtensionContext,
    ) => void;

    const handlers = new Map<string, Handler>();
    const listeners = new Map<string, () => void>();

    const api: ExtensionAPI = Object.assign(Object.create(null), {
      on: (name: string, handler: Handler) => handlers.set(name, handler),
      events: {
        on: (name: string, handler: () => void) => {
          listeners.set(name, handler);

          return () => listeners.delete(name);
        },
        emit: (name: string) => listeners.get(name)?.(),
      },
    });

    let footer: Component | undefined;

    function render() {
      NodeAssert.ok(footer);

      return footer.render(120).join("\n");
    }

    const context = (
      cost: number,
      percent: number,
      mode: ExtensionContext["mode"] = "tui",
    ): ExtensionContext =>
      Object.assign(Object.create(null), {
        mode,
        cwd: "/fixture",
        getContextUsage: () => ({ contextWindow: 1000, percent }),
        sessionManager: {
          getBranch: () => [
            {
              type: "message",
              message: { role: "assistant", usage: { cost: { total: cost } } },
            },
          ],
        },
        ui: {
          setHeader() {},
          setTitle() {},
          setFooter: (make: Parameters<ExtensionUIContext["setFooter"]>[0]) => {
            footer = make?.(
              Object.assign(Object.create(null), { requestRender() {} }),
              Object.assign(Object.create(null), {
                fg: (_color: string, text: string) => text,
              }),
              Object.assign(Object.create(null), {
                getExtensionStatuses: () => new Map(),
              }),
            );
          },
        },
      });

    customize(api);
    handlers.get("session_start")?.(
      { reason: "startup" },
      context(3, 60, "rpc"),
    );
    NodeAssert.equal(footer, undefined);
    handlers.get("session_start")?.({ reason: "startup" }, context(3, 60));

    for (const [event, cost, percent] of [
      ["session_tree", 1, 20],
      ["session_compact", 2, 10],
    ] as const) {
      NodeAssert.ok(handlers.has(event));
      handlers.get(event)?.({ reason: event }, context(cost, percent));
      NodeAssert.ok(render().includes(`${percent}%/1k · ~$${cost.toFixed(2)}`));
    }

    handlers.get("session_shutdown")?.({ reason: "shutdown" }, context(0, 0));
    NodeAssert.equal(footer, undefined);
    NodeAssert.equal(listeners.size, 0);
  },
);
