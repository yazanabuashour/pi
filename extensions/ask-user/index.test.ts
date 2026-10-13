import * as NodeAssert from "node:assert/strict";
import NodeTest from "node:test";
import type {
  ExtensionAPI,
  ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import askUser, { showRpcQuestion } from "./index.ts";

await NodeTest(
  "RPC questions return the selected model-provided option",
  async () => {
    const result = await showRpcQuestion(
      {
        question: "Deploy where?",
        options: [
          { label: "Staging", description: "Internal verification" },
          { label: "Production" },
        ],
      },
      undefined,
      {
        async select(title, options) {
          NodeAssert.equal(title, "Deploy where?");
          NodeAssert.deepEqual(options, [
            "1. Staging — Internal verification",
            "2. Production",
            "3. Write my own answer…",
          ]);

          return options[0];
        },
        async input() {
          throw new Error("input should not open for a listed option");
        },
      },
    );

    NodeAssert.deepEqual(result, {
      answer: "Staging",
      wasCustom: false,
      index: 1,
    });
  },
);

await NodeTest(
  "selected duplicate labels retain their number in saved rendering",
  async () => {
    type Tool = Parameters<ExtensionAPI["registerTool"]>[0];

    let tool: Tool | undefined;

    const api: ExtensionAPI = Object.assign(Object.create(null), {
      registerFlag: () => {},
      getFlag: () => true,
      registerTool: (registered: Tool) => {
        tool = registered;
      },
    });

    askUser(api);
    NodeAssert.ok(tool);

    const context: ExtensionToolContext = Object.assign(Object.create(null), {
      mode: "rpc",
      hasUI: true,
      ui: { select: async (_title: string, options: string[]) => options[1] },
    });

    const result = await tool.execute(
      "selected",
      {
        question: "Which?",
        options: [{ label: "Same" }, { label: "Same" }],
      },
      undefined,
      undefined,
      context,
    );

    NodeAssert.equal(result.content[0]?.type, "text");
    NodeAssert.match(JSON.stringify(result.content), /option 2/);

    const theme = Object.assign(Object.create(null), {
      fg: (_color: string, text: string) => text,
    });

    const renderContext = Object.assign(Object.create(null), {});

    const render = (value: typeof result) =>
      tool
        ?.renderResult?.(
          value,
          { expanded: false, isPartial: false },
          theme,
          renderContext,
        )
        .render(80)
        .join("\n");

    NodeAssert.match(render(result) ?? "", /✓ 2\. Same/);
    NodeAssert.match(
      render({
        ...result,
        details: {
          question: "Legacy",
          options: ["Other", "Same"],
          answer: "Same",
          wasCustom: false,
          cancelled: false,
        },
      }) ?? "",
      /✓ 2\. Same/,
    );
    NodeAssert.match(
      render({
        ...result,
        details: {
          question: "Custom",
          options: [],
          answer: "Same",
          wasCustom: true,
          cancelled: false,
        },
      }) ?? "",
      /\(wrote\) Same/,
    );
    NodeAssert.match(
      render({
        ...result,
        details: {
          question: "Dismissed",
          options: [],
          answer: null,
          wasCustom: false,
          cancelled: true,
        },
      }) ?? "",
      /dismissed/,
    );
  },
);

await NodeTest(
  "RPC questions return to the options after an empty custom answer",
  async () => {
    const controller = new AbortController();
    let selections = 0;
    let inputs = 0;

    const result = await showRpcQuestion(
      {
        question: "Deploy where?",
        options: [{ label: "Staging" }, { label: "Production" }],
      },
      controller.signal,
      {
        async select(_title, options, opts) {
          NodeAssert.equal(opts?.signal, controller.signal);
          selections += 1;

          return options[2];
        },
        async input(_title, _placeholder, opts) {
          NodeAssert.equal(opts?.signal, controller.signal);
          inputs += 1;

          return inputs === 1 ? "  " : "  Canary  ";
        },
      },
    );

    NodeAssert.equal(selections, 2);
    NodeAssert.equal(inputs, 2);
    NodeAssert.deepEqual(result, { answer: "Canary", wasCustom: true });
  },
);
