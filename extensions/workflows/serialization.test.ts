import type { RuntimeRecord } from "../shared/runtime-values.ts";
import { isObjectValue, isRuntimeRecord } from "../shared/runtime-values.ts";
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import NodeTest from "node:test";
import { runWorkflowWorker } from "./worker.ts";
import {
  safeStringify,
  toSerializable,
  writeFileAtomic,
} from "./serialization.ts";

NodeTest(
  "worker serializes cycles, repeated references, bigint and undefined",
  async () => {
    const run = (source: string) =>
      runWorkflowWorker({
        source,
        args: undefined,
        cwd: process.cwd(),
        signal: new AbortController().signal,
        onAgent: async () => ({ ok: true, output: "unused" }),
        onPhase: () => {},
      });
    NodeAssert.deepEqual(
      await run(`
    const value = { count: 7n };
    value.self = value;
    return [value, value];
  `),
      [{ count: "7n", self: "[circular]" }, "[circular]"],
    );
    NodeAssert.equal(await run("return undefined;"), null);
  },
);

NodeTest("safeStringify handles cycles, bigint, depth, and size", () => {
  const value: RuntimeRecord = {
    bigint: 42n,
    nested: { deeper: { deepest: true } },
    large: "x".repeat(20_000),
  };
  value["self"] = value;

  const text = safeStringify(value, {
    maxBytes: 2_048,
    maxDepth: 2,
    maxStringBytes: 512,
  });
  NodeAssert.ok(Buffer.byteLength(text, "utf8") <= 2_048);
  const parsed: unknown = JSON.parse(text);
  NodeAssert.ok(parsed && isObjectValue(parsed));
  NodeAssert.match(text, /42n/);
  NodeAssert.match(text, /circular/);
  NodeAssert.match(text, /truncated/);
});

NodeTest(
  "toSerializable preserves readable properties beside a throwing getter",
  () => {
    const value = {
      readable: "kept",
      get broken(): never {
        throw new Error("getter failed");
      },
    };

    const serialized = toSerializable(value);
    NodeAssert.ok(isRuntimeRecord(serialized));
    NodeAssert.equal(serialized["readable"], "kept");
    NodeAssert.equal(
      serialized["broken"],
      "[unreadable property: getter failed]",
    );
  },
);

NodeTest("atomic writes leave complete readable content", () => {
  const directory = NodeFS.mkdtempSync(
    NodePath.join(NodeOS.tmpdir(), "pi-workflow-test-"),
  );
  try {
    const file = NodePath.join(directory, "artifact.json");
    writeFileAtomic(file, '{"value":1}');
    writeFileAtomic(file, '{"value":2}');
    NodeAssert.deepEqual(JSON.parse(NodeFS.readFileSync(file, "utf8")), {
      value: 2,
    });
  } finally {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});
