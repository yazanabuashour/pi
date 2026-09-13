import * as NodeAssert from "node:assert/strict";
import NodeTest from "node:test";
import {
  reconcileDashboardSelection,
  type DashboardSelection,
} from "./src/ui/ps.ts";
import {
  buildOutputLines,
  createOutputLineCache,
  sanitizeText,
} from "./src/ui/output-view.ts";

NodeTest(
  "dashboard selection follows its terminal id and falls back by row",
  () => {
    const selection: DashboardSelection = { id: "bt-7", index: 6 };

    reconcileDashboardSelection(selection, [
      { id: "bt-new" },
      ...Array.from({ length: 8 }, (_, index) => ({ id: `bt-${index + 1}` })),
    ]);
    NodeAssert.deepEqual(selection, { id: "bt-7", index: 7 });

    reconcileDashboardSelection(selection, [
      ...Array.from({ length: 6 }, (_, index) => ({ id: `bt-${index + 1}` })),
      { id: "bt-8" },
      { id: "bt-9" },
    ]);
    NodeAssert.deepEqual(selection, { id: "bt-9", index: 7 });

    reconcileDashboardSelection(selection, [{ id: "bt-1" }, { id: "bt-2" }]);
    NodeAssert.deepEqual(selection, { id: "bt-2", index: 1 });

    reconcileDashboardSelection(selection, []);
    NodeAssert.deepEqual(selection, { id: undefined, index: 0 });
  },
);

NodeTest("sanitizeText strips ANSI, tabs, and control characters", () => {
  NodeAssert.equal(sanitizeText("\u001b[31mred\u001b[0m"), "red");
  NodeAssert.equal(sanitizeText("\u001b[12345Cshifted"), "shifted");
  NodeAssert.equal(sanitizeText("\u001b]0;window title\u0007output"), "output");
  NodeAssert.equal(
    sanitizeText("\u001b]8;;https://example.com\u001b\\link\u001b]8;;\u001b\\"),
    "link",
  );
  NodeAssert.equal(sanitizeText("\u001b]0;title\u009coutput"), "output");
  NodeAssert.equal(sanitizeText("\u009d0;title\u0007output"), "output");
  NodeAssert.equal(sanitizeText("a\u0085b"), "ab");
  NodeAssert.equal(sanitizeText("a\tb"), "a  b");
  NodeAssert.equal(sanitizeText("a\u0007b\u0000c"), "abc");
});

NodeTest(
  "output line cache reuses a version/width key and invalidates either dimension",
  () => {
    const cache = createOutputLineCache();
    const first = cache.get("first", 1, 80);
    const sameKey = cache.get("different text is intentionally ignored", 1, 80);
    NodeAssert.equal(sameKey, first);
    NodeAssert.deepEqual(sameKey, ["first"]);

    const newVersion = cache.get("second", 2, 80);
    NodeAssert.notEqual(newVersion, first);
    NodeAssert.deepEqual(newVersion, ["second"]);

    const newWidth = cache.get("x".repeat(25), 2, 10);
    NodeAssert.notEqual(newWidth, newVersion);
    NodeAssert.ok(newWidth.length > 1);
  },
);

NodeTest(
  "buildOutputLines wraps long lines and keeps only the final CR segment",
  () => {
    const lines = buildOutputLines("progress 1\rprogress 2\rdone\nnext", 80);
    NodeAssert.deepEqual(lines, ["done", "next"]);
    NodeAssert.deepEqual(buildOutputLines("progress 1\rprogress 2\r", 80), [
      "progress 2",
    ]);

    const wrapped = buildOutputLines("x".repeat(25), 10);
    NodeAssert.ok(wrapped.length > 1);
    NodeAssert.equal(wrapped.join(""), "x".repeat(25));
  },
);

NodeTest(
  "buildOutputLines drops one trailing empty line from a trailing newline",
  () => {
    NodeAssert.deepEqual(buildOutputLines("a\nb\n", 80), ["a", "b"]);
    NodeAssert.deepEqual(buildOutputLines("a\n\n", 80), ["a", ""]);
  },
);
