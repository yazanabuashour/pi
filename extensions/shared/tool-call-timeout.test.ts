import * as NodeAssert from "node:assert/strict";
import NodeTest from "node:test";
import type {
  ToolDefinition,
  ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  createToolCallTimeoutGuard,
  runWithToolCallTimeout,
  ToolCallTimeoutError,
} from "./tool-call-timeout.ts";

await NodeTest(
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

await NodeTest(
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

await NodeTest(
  "reapplying the guard retains one raw execution after timeout and observes late rejection",
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

    const registry = {
      getAllTools: () => [{ name: definition.name }],
      getToolDefinition: () => definition,
    };

    guard.apply(registry);
    guard.apply(registry);
    // SAFETY: this fixture tool does not read its extension context.
    const context = {} as ExtensionToolContext;
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

await NodeTest(
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

await NodeTest(
  "the timeout is fresh for each tool call, not shared across calls",
  async (test) => {
    test.mock.timers.enable({ apis: ["setTimeout"] });

    const execute = () =>
      runWithToolCallTimeout("slow_fixture", 100, undefined, async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));

        return "done";
      });

    for (let call = 0; call < 2; call++) {
      const pending = execute();
      test.mock.timers.tick(60);
      NodeAssert.equal(await pending, "done");
    }
  },
);
