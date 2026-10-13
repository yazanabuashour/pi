import * as NodeAssert from "node:assert/strict";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { AskUserInput } from "./index.ts";
import { showTuiQuestion } from "./src/question-view.ts";

export async function assertTuiSelection(
  params: AskUserInput,
  expected: Awaited<ReturnType<typeof showTuiQuestion>>,
  theme: ExtensionUIContext["theme"],
) {
  const controller = new AbortController();

  const actual = await showTuiQuestion(
    params,
    controller.signal,
    Object.assign(Object.create(null), {
      custom: async (factory: Parameters<ExtensionUIContext["custom"]>[0]) => {
        let selected: unknown;

        const view = await factory(
          Object.assign(Object.create(null), { requestRender() {} }),
          theme,
          Object.assign(Object.create(null), {}),
          (value) => {
            selected = value;
          },
        );

        try {
          NodeAssert.equal(
            view.render(100).join("\n").includes("\u001b]52;"),
            false,
          );
          view.handleInput?.("1");

          return selected;
        } finally {
          controller.abort();
        }
      },
    }),
  );

  NodeAssert.deepEqual(actual, expected);
}
