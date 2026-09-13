import * as NodeAssert from "node:assert/strict";
import NodeTest from "node:test";
import { parseRecapResponse, reasoningOptions } from "./src/summarizer.ts";

NodeTest("omits reasoning when configured off", () => {
  NodeAssert.deepEqual(reasoningOptions("off"), {});
  NodeAssert.deepEqual(reasoningOptions("medium"), { reasoning: "medium" });
});

NodeTest("parses strict recap JSON", () => {
  NodeAssert.deepEqual(
    parseRecapResponse(
      '{"recap":"Updated config and ran focused tests.","next":"Review the diff.","title":"Configure page answers"}',
    ),
    {
      recap: "Updated config and ran focused tests.",
      next: "Review the diff.",
      title: "Configure page answers",
    },
  );
});

NodeTest(
  "defensively extracts fenced or surrounded JSON and normalizes Next",
  () => {
    NodeAssert.deepEqual(
      parseRecapResponse(
        'Result follows:\n```json\n{"recap":"- Added the extension\\n- Tests pass","next":"Next: Reload Pi."}\n```',
      ),
      {
        recap: "- Added the extension\n- Tests pass",
        next: "Reload Pi.",
      },
    );
  },
);

NodeTest("rejects malformed or incomplete output", () => {
  NodeAssert.throws(() => parseRecapResponse("not json"), /valid recap JSON/);
  NodeAssert.throws(
    () => parseRecapResponse('{"recap":"missing next"}'),
    /valid recap JSON/,
  );
  for (const field of ['"extra":"not allowed"', '"title":42']) {
    NodeAssert.throws(
      () => parseRecapResponse(`{"recap":"done","next":"nothing",${field}}`),
      /valid recap JSON/,
    );
  }
});

NodeTest("strips terminal control sequences from recap fields", () => {
  NodeAssert.deepEqual(
    parseRecapResponse(
      '{"recap":"Updated \\u001b[31mconfig\\u001b[0m.","next":"Review it.\\u0007","title":"  Fix\\n\\u001b[31mpage answers\\u001b[0m\\u0007  "}',
    ),
    { recap: "Updated config.", next: "Review it.", title: "Fix page answers" },
  );
  NodeAssert.deepEqual(
    parseRecapResponse(
      '{"recap":"Done.","next":"Nothing.","title":"\\u0007 "}',
    ),
    { recap: "Done.", next: "Nothing." },
  );
});
