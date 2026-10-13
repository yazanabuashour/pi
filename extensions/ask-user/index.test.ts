import * as NodeAssert from "node:assert/strict";
import NodeTest from "node:test";
import * as NodeUtil from "node:util";
import type {
  ExtensionAPI,
  ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import askUser, { showRpcQuestion } from "./index.ts";
import { assertTuiSelection } from "./index.test-support.ts";

const injected = "\u001b]52;c;Y2xpcGJvYXJk\u0007\u001b[31m";

const theme = Object.assign(Object.create(null), {
  fg: (_color: string, text: string) => {
    NodeAssert.equal(text.includes("\u001b"), false, "sanitize before styling");

    return text;
  },
  bold: (text: string) => {
    NodeAssert.equal(text.includes("\u001b"), false, "sanitize before styling");

    return text;
  },
});

type Tool = Parameters<ExtensionAPI["registerTool"]>[0];

function renderSaved(
  tool: Tool,
  result: Parameters<NonNullable<Tool["renderResult"]>>[0],
) {
  NodeAssert.ok(tool.renderResult);

  return tool
    .renderResult(
      result,
      { expanded: false, isPartial: false },
      theme,
      Object.assign(Object.create(null), {}),
    )
    .render(80)
    .join("\n")
    .trimEnd();
}

function registeredAskUser() {
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

  return tool;
}

await NodeTest(
  "RPC questions return the selected model-provided option",
  async () => {
    const params = {
      question: `${injected}Deploy where?`,
      options: [
        {
          label: `${injected}Staging`,
          description: `${injected}Internal verification`,
        },
        { label: "Production" },
      ],
    };

    const result = await showRpcQuestion(params, undefined, {
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
    });

    NodeAssert.deepEqual(result, {
      answer: `${injected}Staging`,
      wasCustom: false,
      index: 1,
    });

    await assertTuiSelection(params, result, theme);
  },
);

await NodeTest(
  "selected duplicate labels retain their number in saved rendering",
  async () => {
    const tool = registeredAskUser();

    const context: ExtensionToolContext = Object.assign(Object.create(null), {
      mode: "rpc",
      hasUI: true,
      ui: { select: async (_title: string, options: string[]) => options[1] },
    });

    const result = await tool.execute(
      "selected",
      {
        question: `${injected}Which?`,
        options: [{ label: `${injected}Same` }, { label: `${injected}Same` }],
      },
      undefined,
      undefined,
      context,
    );

    NodeAssert.equal(result.content[0]?.type, "text");
    NodeAssert.match(JSON.stringify(result.content), /option 2/);

    const renderContext = Object.assign(Object.create(null), {});
    NodeAssert.ok(tool.renderCall);
    NodeAssert.match(
      tool
        .renderCall(
          {
            question: `${injected}Which?`,
            options: [null, { label: `${injected}Same` }],
          },
          theme,
          renderContext,
        )
        .render(100)
        .join("\n"),
      /2\. Same/,
    );
    NodeAssert.deepEqual(result.details, {
      question: `${injected}Which?`,
      options: [`${injected}Same`, `${injected}Same`],
      answer: `${injected}Same`,
      wasCustom: false,
      cancelled: false,
      index: 2,
    });
    NodeAssert.match(JSON.stringify(result.content), /\\u001b/);

    const render = (value: typeof result) => renderSaved(tool, value);

    NodeAssert.match(render(result), /✓ 2\. Same/);
    NodeAssert.match(
      render({
        content: [{ type: "text", text: `${injected}Fallback` }],
        details: null,
      }),
      /Fallback/,
    );
    assertHistoricalRendering(tool, result);
  },
);

function assertHistoricalRendering(
  tool: Tool,
  result: Parameters<NonNullable<Tool["renderResult"]>>[0],
) {
  const render = (
    details: Parameters<NonNullable<Tool["renderResult"]>>[0]["details"],
  ) => renderSaved(tool, { ...result, details });

  const selected = {
    question: "Legacy",
    options: ["Other", "Same"],
    answer: "Same",
    wasCustom: false,
    cancelled: false,
  };

  NodeAssert.match(render(selected), /✓ 2\. Same/);
  NodeAssert.equal(
    render({ ...selected, options: ["Same", "Same"] }),
    "✓ Same",
  );
  NodeAssert.match(
    render({
      ...selected,
      options: [],
      answer: `${injected}Same`,
      wasCustom: true,
    }),
    /\(wrote\) Same/,
  );
  NodeAssert.match(
    render({ ...selected, options: [], answer: null, cancelled: true }),
    /unanswered/,
  );
}

await NodeTest(
  "unanswered replies retain why no selection occurred",
  async () => {
    const tool = registeredAskUser();

    const params = {
      question: "Which?",
      options: [{ label: "One" }, { label: "Two" }],
    };

    const controller = new AbortController();
    controller.abort();

    for (const [mode, signal, expected] of [
      ["no-ui", undefined, "no UI available"],
      ["cancelled", controller.signal, "cancelled"],
      ["dismissed", undefined, "dismissed"],
    ] as const) {
      const context: ExtensionToolContext = Object.assign(Object.create(null), {
        mode: "rpc",
        hasUI: mode !== "no-ui",
        ui: { select: async () => undefined },
      });

      const result = await tool.execute(
        "unanswered",
        params,
        signal,
        undefined,
        context,
      );

      NodeAssert.equal(renderSaved(tool, result), `✗ ${expected}`);
      NodeAssert.deepEqual(result.details, {
        question: params.question,
        options: ["One", "Two"],
        answer: null,
        wasCustom: false,
        cancelled: true,
        reason: mode,
      });
    }
  },
);

await NodeTest("UI failures preserve their causal context", async () => {
  const tool = registeredAskUser();

  const context: ExtensionToolContext = Object.assign(Object.create(null), {
    mode: "rpc",
    hasUI: true,
    ui: {
      select: async () => {
        throw new Error("UI transport", { cause: new Error("root context") });
      },
    },
  });

  await NodeAssert.rejects(
    tool.execute(
      "failure",
      { question: "Which?", options: [{ label: "One" }, { label: "Two" }] },
      undefined,
      undefined,
      context,
    ),
    (error: Error) => {
      NodeAssert.ok(error.cause);
      NodeAssert.match(
        NodeUtil.inspect(error.cause, { depth: null }),
        /root context/,
      );

      return true;
    },
  );
});

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
