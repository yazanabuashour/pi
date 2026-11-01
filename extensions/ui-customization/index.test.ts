import * as NodeAssert from "node:assert/strict";
import NodeTest from "node:test";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import customize from "./index.ts";
import modelInfo from "../model-info/index.ts";
import type {
  GitInfoState,
  ModelInfoState,
} from "../shared/dashboard-state.ts";

await NodeTest(
  "footer sanitizes producer metadata without stripping trusted styling",
  async () => {
    type Handler = (
      event: { type: "session_start" | "session_shutdown" },
      context: ExtensionContext,
    ) => void | Promise<void>;

    const hooks = new Map<string, Handler[]>();

    type DashboardState = ModelInfoState | GitInfoState | undefined;

    const listeners = new Map<string, (value: DashboardState) => void>();

    const api: ExtensionAPI = Object.assign(Object.create(null), {
      on: (name: string, handler: Handler) =>
        hooks.set(name, [...(hooks.get(name) ?? []), handler]),
      getThinkingLevel: () => "high",
      events: {
        on: (name: string, handler: (value: DashboardState) => void) => {
          listeners.set(name, handler);

          return () => listeners.delete(name);
        },
        emit: (name: string, value: DashboardState) =>
          listeners.get(name)?.(value),
      },
    });

    const injected = "\u001b]52;c;Y2xpcGJvYXJk\u0007\u001b[31m";

    const theme = Object.assign(Object.create(null), {
      fg: (_color: string, text: string) => {
        NodeAssert.equal(
          text.includes("\u001b"),
          false,
          "metadata must be safe before theme styling",
        );

        return text;
      },
    });

    let footer: Component | undefined;

    const context: ExtensionContext = Object.assign(Object.create(null), {
      mode: "tui",
      cwd: `/fixture${injected}`,
      model: {
        provider: `${injected}provider`,
        id: `${injected}model`,
        contextWindow: 1000,
      },
      getContextUsage: () => ({ contextWindow: 1000, percent: 20 }),
      sessionManager: { getBranch: () => [] },
      ui: {
        setHeader() {},
        setTitle() {},
        setFooter: (make: Parameters<ExtensionUIContext["setFooter"]>[0]) => {
          footer = make?.(
            Object.assign(Object.create(null), { requestRender() {} }),
            theme,
            Object.assign(Object.create(null), {
              getExtensionStatuses: () =>
                new Map([["fixture", "trusted \u001b[32mready\u001b[0m"]]),
            }),
          );
        },
      },
    });

    customize(api);
    modelInfo(api);

    try {
      for (const handler of hooks.get("session_start") ?? [])
        await handler({ type: "session_start" }, context);
      NodeAssert.ok(footer);
      const rendered = footer.render(180).join("\n");
      NodeAssert.match(rendered, /provider\/model/);
      NodeAssert.equal(rendered.includes("\u001b]52;"), false);
      NodeAssert.ok(rendered.includes("\u001b[32mready"));
      NodeAssert.equal(context.model?.provider, `${injected}provider`);
      NodeAssert.equal(context.cwd, `/fixture${injected}`);
    } finally {
      for (const handler of hooks.get("session_shutdown") ?? [])
        await handler({ type: "session_shutdown" }, context);
    }
  },
);
