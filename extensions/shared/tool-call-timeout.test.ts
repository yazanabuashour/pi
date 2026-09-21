import * as NodeAssert from "node:assert/strict";
import NodeTest from "node:test";
import type {
  ToolDefinition,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  createToolCallTimeoutGuard,
  runWithToolCallTimeout,
  CHILD_TOOL_CALL_TIMEOUT_MS,
  ToolCallTimeoutError,
} from "./tool-call-timeout.ts";

NodeTest(
  "the production timeout error names the tool and three-minute limit",
  () => {
    NodeAssert.equal(
      new ToolCallTimeoutError("fixture_tool", CHILD_TOOL_CALL_TIMEOUT_MS)
        .message,
      'Tool call "fixture_tool" timed out after 3 minutes.',
    );
  },
);

NodeTest(
  "a hung tool call fails clearly and receives an abort signal",
  async () => {
    let executionSignal: AbortSignal | undefined;

    await NodeAssert.rejects(
      runWithToolCallTimeout("hung_fixture", 10, undefined, (signal) => {
        executionSignal = signal;
        return new Promise(() => {});
      }),
      <Input1>(error: Input1) => {
        NodeAssert.equal(error instanceof ToolCallTimeoutError, true);
        NodeAssert.equal(
          error instanceof Error ? error.message : "",
          'Tool call "hung_fixture" timed out after 10 ms.',
        );
        return true;
      },
    );

    NodeAssert.equal(executionSignal?.aborted, true);
    NodeAssert.equal(
      executionSignal?.reason instanceof ToolCallTimeoutError,
      true,
    );
  },
);

NodeTest(
  "parent cancellation still stops the timeout wrapper immediately",
  async () => {
    let executed = false;
    await NodeAssert.rejects(
      runWithToolCallTimeout(
        "pre_aborted",
        60_000,
        AbortSignal.abort("pre-aborted"),
        async () => {
          executed = true;
        },
      ),
      <Input>(error: Input) => error === "pre-aborted",
    );
    NodeAssert.equal(executed, false);
    const controller = new AbortController();
    const reason = new Error("cancelled fixture");
    const pending = runWithToolCallTimeout(
      "hung_fixture",
      60_000,
      controller.signal,
      () => new Promise(() => {}),
    );

    controller.abort(reason);

    await NodeAssert.rejects(
      pending,
      <Input1>(error: Input1) => error === reason,
    );
  },
);

NodeTest(
  "the guard wraps each definition once and can discover later tools",
  () => {
    const definitions = new Map<string, ToolDefinition>();
    const createDefinition = (name: string): ToolDefinition => ({
      name,
      label: name,
      description: name,
      parameters: Type.Object({}),
      async execute() {
        return { content: [{ type: "text", text: "done" }], details: {} };
      },
    });
    const first = createDefinition("first");
    definitions.set(first.name, first);
    const registry = {
      getAllTools: () => [...definitions.keys()].map((name) => ({ name })),
      getToolDefinition: (name: string) => definitions.get(name),
    };
    const guard = createToolCallTimeoutGuard(10);

    const firstExecute = first.execute;
    guard.apply(registry);
    const firstWrappedExecute = first.execute;
    NodeAssert.notEqual(firstWrappedExecute, firstExecute);

    const second = createDefinition("second");
    const secondExecute = second.execute;
    definitions.set(second.name, second);
    guard.apply(registry);

    NodeAssert.equal(first.execute, firstWrappedExecute);
    NodeAssert.notEqual(second.execute, secondExecute);
  },
);

NodeTest(
  "guard retains raw execution after timeout and observes late rejection",
  async () => {
    let reject!: (error: Error) => void;
    const definition: ToolDefinition = {
      name: "ignored_abort",
      label: "fixture",
      description: "fixture",
      parameters: Type.Object({}),
      execute: () =>
        new Promise((_resolve, rejectPromise) => {
          reject = rejectPromise;
        }),
    };
    const guard = createToolCallTimeoutGuard(10);
    guard.apply({
      getAllTools: () => [{ name: definition.name }],
      getToolDefinition: () => definition,
    });
    // SAFETY: this fixture tool does not read its extension context.
    const context = {} as ExtensionContext;
    await NodeAssert.rejects(
      definition.execute("call-1", {}, undefined, undefined, context),
      ToolCallTimeoutError,
    );
    NodeAssert.deepEqual(guard.pendingResources(), ["ignored_abort:call-1"]);
    let settled = false;
    const settlement = guard.settled().then(() => {
      settled = true;
    });
    await Promise.resolve();
    NodeAssert.equal(settled, false);
    reject(new Error("late rejection"));
    await settlement;
    NodeAssert.deepEqual(guard.pendingResources(), []);
  },
);

NodeTest(
  "successful and terminating tool results pass through unchanged",
  async () => {
    const result = {
      content: [{ type: "text" as const, text: "recorded" }],
      details: { value: "fixture" },
      terminate: true,
    };

    NodeAssert.equal(
      await runWithToolCallTimeout(
        "structured_output",
        10,
        undefined,
        async () => result,
      ),
      result,
    );
  },
);

NodeTest(
  "the timeout is fresh for each tool call, not shared across calls",
  async () => {
    const execute = () =>
      runWithToolCallTimeout("slow_fixture", 100, undefined, async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        return "done";
      });

    NodeAssert.equal(await execute(), "done");
    NodeAssert.equal(await execute(), "done");
  },
);
