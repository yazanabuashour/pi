import * as NodeAssert from "node:assert/strict";
import NodeTest from "node:test";
import {
  contextPercent,
  formatContextUtilization,
} from "./context-utilization.ts";

NodeTest("formats current context occupancy against model capacity", () => {
  NodeAssert.equal(
    formatContextUtilization({ tokens: 19_040, contextWindow: 272_000 }),
    "7%/272k",
  );
});

NodeTest(
  "formats the latest post-compaction usage rather than prior cumulative usage",
  () => {
    const latestUsage = { tokens: 18_000, contextWindow: 200_000 };
    NodeAssert.equal(formatContextUtilization(latestUsage), "9%/200k");
  },
);

NodeTest("clamps over-capacity and nonsensical token values", () => {
  NodeAssert.equal(
    contextPercent({ tokens: 500_000, contextWindow: 200_000 }),
    100,
  );
  NodeAssert.equal(
    formatContextUtilization({
      tokens: Number.POSITIVE_INFINITY,
      contextWindow: 200_000,
    }),
    "?%/200k",
  );
  NodeAssert.equal(
    formatContextUtilization({ tokens: -1, contextWindow: 200_000 }),
    "?%/200k",
  );
});

NodeTest("handles missing usage or capacity without NaN or Infinity", () => {
  NodeAssert.equal(
    formatContextUtilization({ tokens: null, contextWindow: 272_000 }),
    "?%/272k",
  );
  NodeAssert.equal(formatContextUtilization({ tokens: 12_000 }), "");
  NodeAssert.equal(
    formatContextUtilization({ tokens: 12_000, contextWindow: 0 }),
    "",
  );
});
