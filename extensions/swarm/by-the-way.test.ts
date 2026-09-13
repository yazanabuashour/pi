import * as NodeAssert from "node:assert/strict";
import NodeTest from "node:test";
import { BTW_TITLE_MAX_LENGTH, deriveBtwTitle } from "./src/by-the-way.ts";

NodeTest(
  "deriveBtwTitle uses the first non-empty line and bounds the title",
  () => {
    NodeAssert.equal(
      deriveBtwTitle("\n   Why   does this work?   \nignore me"),
      "Why does this work?",
    );
    NodeAssert.equal(deriveBtwTitle(" \n\t"), "by the way");

    const title = deriveBtwTitle("x".repeat(BTW_TITLE_MAX_LENGTH + 10));
    NodeAssert.equal(title.length, BTW_TITLE_MAX_LENGTH);
    NodeAssert.equal(title, `${"x".repeat(BTW_TITLE_MAX_LENGTH - 1)}…`);

    const emojiTitle = deriveBtwTitle(
      `${"x".repeat(BTW_TITLE_MAX_LENGTH - 2)}😀 more`,
    );
    NodeAssert.equal(emojiTitle, `${"x".repeat(BTW_TITLE_MAX_LENGTH - 2)}😀…`);
  },
);
