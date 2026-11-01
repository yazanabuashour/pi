import * as NodeAssert from "node:assert/strict";
import NodeTest from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerResultRenderer } from "./src/result-renderer.ts";
import { TerminalDetailView } from "./src/ui/terminal-detail-view.ts";
import type { TerminalSnapshot } from "./src/domain.ts";
import {
  reconcileDashboardSelection,
  type DashboardSelection,
} from "./src/ui/ps.ts";
import {
  sanitizeTerminalLabel,
  sanitizeTerminalText,
} from "../shared/terminal-text.ts";
import {
  buildOutputLines,
  createOutputLineCache,
  sanitizeText,
} from "./src/ui/output-view.ts";

await NodeTest(
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

await NodeTest("sanitizeText strips ANSI, tabs, and control characters", () => {
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
  NodeAssert.equal(sanitizeText("a\tb\nc"), "a  b\nc");
  NodeAssert.equal(sanitizeTerminalText("a\tb\nc"), "a\tb\nc");
  NodeAssert.equal(sanitizeTerminalLabel("a\tb\nc"), "abc");
  NodeAssert.equal(sanitizeText("a\u0007b\u0000c"), "abc");
});

await NodeTest(
  "completion and detail render untrusted metadata before theme styling",
  () => {
    const hostile = "\u001b]0;hidden\u0007visible\nnext\tfield\u001b[31m";
    const safe = "visible next field";
    const styled: string[] = [];

    const theme = Object.assign(Object.create(null), {
      fg: (_color: string, text: string) => {
        styled.push(text);

        return text;
      },
      bold: (text: string) => text,
    });

    type Renderer = Parameters<ExtensionAPI["registerMessageRenderer"]>[1];

    let renderer: Renderer | undefined;

    const api: ExtensionAPI = Object.assign(Object.create(null), {
      registerMessageRenderer: (_name: string, value: Renderer) => {
        renderer = value;
      },
    });

    registerResultRenderer(api);
    NodeAssert.ok(renderer);

    const buffer = {
      text: "",
      totalBytes: 1,
      truncatedBytes: 1,
      spillPath: hostile,
    };

    const snapshot: TerminalSnapshot = {
      id: "bt-1",
      title: hostile,
      command: hostile,
      cwd: hostile,
      status: "failed",
      createdAt: 0,
      signal: "SIGTERM",
      stdout: buffer,
      stderr: buffer,
    };

    const component = renderer(
      {
        role: "custom",
        customType: "background-terminal-result",
        content: "header\nbody",
        display: true,
        timestamp: 0,
        details: { ...snapshot, id: hostile, signal: hostile },
      },
      { expanded: false, outputPad: 0 },
      theme,
    );

    NodeAssert.ok(component);
    const completion = component.render(500).join("\n");
    NodeAssert.match(completion, /visible next field/);
    NodeAssert.equal(completion.split("\n").length, 2);

    const view = Object.assign(Object.create(null), {
      get: () => snapshot,
      subscribeTo: () => () => {},
    });

    const tui = Object.assign(Object.create(null), {
      terminal: { rows: 30 },
      requestRender: () => {},
    });

    const keys = Object.assign(Object.create(null), {
      getKeys: () => ["escape"],
    });

    const detail = new TerminalDetailView(
      tui,
      theme,
      keys,
      snapshot.id,
      view,
      () => {},
    );

    try {
      const lines = detail.render(500);
      NodeAssert.ok(lines[1]?.endsWith(safe));
      NodeAssert.ok(lines.some((line) => line.includes(`full log: ${safe}`)));
      NodeAssert.ok(
        styled.every(
          (text) =>
            !["\u001b", "\u0007", "\t", "\n"].some((control) =>
              text.includes(control),
            ),
        ),
        "untrusted metadata is safe before styling",
      );
      NodeAssert.equal(
        snapshot.cwd,
        hostile,
        "captured originals remain unchanged",
      );
    } finally {
      detail.dispose();
    }
  },
);

await NodeTest(
  "output lines refresh after new output and rewrap after resizing",
  () => {
    const cache = createOutputLineCache();
    const first = cache.get("first", 1, 80);
    NodeAssert.deepEqual(first, ["first"]);

    const newVersion = cache.get("second", 2, 80);
    NodeAssert.deepEqual(newVersion, ["second"]);

    const text = "x".repeat(25);
    NodeAssert.deepEqual(cache.get(text, 3, 80), [text]);
    const newWidth = cache.get(text, 3, 10);
    NodeAssert.ok(newWidth.every((line) => line.length <= 10));
    NodeAssert.equal(newWidth.join(""), text);
    NodeAssert.deepEqual(cache.get(text, 3, 80), [text]);
  },
);

await NodeTest(
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

await NodeTest(
  "buildOutputLines drops one trailing empty line from a trailing newline",
  () => {
    NodeAssert.deepEqual(buildOutputLines("a\nb\n", 80), ["a", "b"]);
    NodeAssert.deepEqual(buildOutputLines("a\n\n", 80), ["a", ""]);
  },
);
