import * as NodeAssert from "node:assert/strict";
import NodeTest from "node:test";
import { OutputBuffer } from "./src/output.ts";

await NodeTest("push/view roundtrip preserves text and counts bytes", () => {
  const buf = new OutputBuffer(1024);
  buf.push("hello ");
  buf.push("world\n");
  const view = buf.view();
  NodeAssert.equal(view.text, "hello world\n");
  NodeAssert.equal(view.totalBytes, Buffer.byteLength("hello world\n"));
  NodeAssert.equal(view.truncatedBytes, 0);
});

await NodeTest(
  "head chunks are evicted past the cap and accounted as truncated",
  () => {
    const buf = new OutputBuffer(10);
    buf.push("aaaa"); // 4 bytes
    buf.push("bbbb"); // 8 bytes
    buf.push("cccc"); // 12 bytes -> evict "aaaa" (8 retained)
    const view = buf.view();
    NodeAssert.equal(view.text, "bbbbcccc");
    NodeAssert.equal(view.totalBytes, 12);
    NodeAssert.equal(view.truncatedBytes, 4);
  },
);

await NodeTest(
  "a single chunk larger than the cap is trimmed to its tail — retention stays bounded",
  () => {
    const buf = new OutputBuffer(4);
    buf.push("0123456789");
    // Only the newest cap-worth of bytes is retained; the head is truncated.
    NodeAssert.equal(buf.view().text, "6789");
    NodeAssert.equal(buf.view().totalBytes, 10);
    NodeAssert.equal(buf.view().truncatedBytes, 6);
    buf.push("x");
    // "6789" + "x" exceeds the cap; the older whole chunk is evicted.
    NodeAssert.equal(buf.view().text, "x");
    NodeAssert.equal(buf.view().totalBytes, 11);
    NodeAssert.equal(buf.view().truncatedBytes, 10);
  },
);

await NodeTest(
  "an oversized chunk evicts everything retained before it",
  () => {
    const buf = new OutputBuffer(8);
    buf.push("abcd");
    buf.push("0123456789"); // 10 bytes > cap: "abcd" evicted, chunk tail-trimmed
    const view = buf.view();
    NodeAssert.equal(view.text, "23456789");
    NodeAssert.equal(view.totalBytes, 14);
    NodeAssert.equal(view.truncatedBytes, 6);
  },
);

await NodeTest(
  "an oversized chunk cut lands on a UTF-8 code point boundary",
  () => {
    const buf = new OutputBuffer(5);
    buf.push("ééééé"); // 10 bytes; naive cut at byte 5 would split an é
    const view = buf.view();
    NodeAssert.equal(view.text, "éé"); // 4 bytes retained (5 would split)
    NodeAssert.equal(view.totalBytes, 10);
    NodeAssert.equal(view.truncatedBytes, 6);
    NodeAssert.ok(!view.text.includes("�"));
  },
);

await NodeTest(
  "spill receives the complete oversized chunk before trimming",
  () => {
    const spilled: string[] = [];
    const buf = new OutputBuffer(4, (chunk) => spilled.push(chunk));
    buf.push("0123456789");
    NodeAssert.deepEqual(spilled, ["0123456789"]);
    NodeAssert.equal(buf.view().text, "6789");
  },
);

await NodeTest(
  "push reports spill backpressure while retaining the chunk",
  () => {
    const buf = new OutputBuffer(1024, () => false);
    NodeAssert.equal(buf.push("queued"), false);
    NodeAssert.equal(buf.view().text, "queued");
  },
);

await NodeTest("multibyte chunks are never split by eviction", () => {
  const buf = new OutputBuffer(8);
  buf.push("ééé"); // 6 bytes
  buf.push("üüü"); // 6 bytes -> evicts the first chunk whole
  const view = buf.view();
  NodeAssert.equal(view.text, "üüü");
  NodeAssert.equal(view.truncatedBytes, 6);
});

await NodeTest(
  "spill callback receives every chunk in order, even after eviction",
  () => {
    const spilled: string[] = [];
    const buf = new OutputBuffer(4, (chunk) => spilled.push(chunk));
    buf.push("aaaa");
    buf.push("bbbb");
    buf.push("cccc");
    NodeAssert.deepEqual(spilled, ["aaaa", "bbbb", "cccc"]);
    NodeAssert.equal(buf.view().text, "cccc");
  },
);
