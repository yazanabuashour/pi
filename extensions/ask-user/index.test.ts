import * as NodeAssert from "node:assert/strict";
import NodeTest from "node:test";
import { showRpcQuestion } from "./index.ts";

NodeTest(
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

NodeTest(
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
