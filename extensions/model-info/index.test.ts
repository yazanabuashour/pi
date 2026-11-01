import * as NodeAssert from "node:assert/strict";
import NodeTest from "node:test";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import modelInfo from "./index.ts";
import {
  MODEL_INFO_CHANNEL,
  REFRESH_CHANNEL,
} from "../shared/dashboard-state.ts";

await NodeTest(
  "navigation and compaction publish fresh branch metrics and refresh context",
  async () => {
    type Handler = (
      event: { reason: string },
      context: ExtensionContext,
    ) => void | Promise<void>;

    const handlers = new Map<string, Handler>();
    const publications: Array<{ cost: number; contextPercent: number }> = [];
    let refreshListener: (() => void) | undefined;

    const api: ExtensionAPI = Object.assign(Object.create(null), {
      on: (name: string, handler: Handler) => handlers.set(name, handler),
      events: {
        on: (name: string, handler: () => void) => {
          NodeAssert.equal(name, REFRESH_CHANNEL);
          refreshListener = handler;

          return () => {
            refreshListener = undefined;
          };
        },
        emit: (
          name: string,
          state: { cost: number; contextPercent: number },
        ) => {
          NodeAssert.equal(name, MODEL_INFO_CHANNEL);
          publications.push(state);
        },
      },
    });

    modelInfo(api);

    const context = (
      cost: number,
      percent: number,
      mode: ExtensionContext["mode"] = "tui",
    ): ExtensionContext =>
      Object.assign(Object.create(null), {
        mode,
        getContextUsage: () => ({ contextWindow: 1000, percent }),
        sessionManager: {
          getBranch: () => [
            {
              type: "message",
              message: { role: "assistant", usage: { cost: { total: cost } } },
            },
          ],
        },
      });

    await handlers.get("session_start")?.(
      { reason: "startup" },
      context(3, 60, "rpc"),
    );
    refreshListener?.();
    NodeAssert.equal(publications.length, 0);

    await handlers.get("session_start")?.(
      { reason: "startup" },
      context(3, 60),
    );

    for (const [event, cost, percent] of [
      ["session_tree", 1, 20],
      ["session_compact", 2, 10],
    ] as const) {
      NodeAssert.ok(handlers.has(event), `${event} refreshes producer state`);
      await handlers.get(event)?.({ reason: event }, context(cost, percent));
      NodeAssert.equal(publications.at(-1)?.cost, cost);
      NodeAssert.equal(publications.at(-1)?.contextPercent, percent);
      refreshListener?.();
      NodeAssert.equal(publications.at(-1)?.cost, cost);
      NodeAssert.equal(publications.at(-1)?.contextPercent, percent);
    }

    await handlers.get("session_shutdown")?.(
      { reason: "shutdown" },
      context(0, 0),
    );
    NodeAssert.equal(refreshListener, undefined);
  },
);
