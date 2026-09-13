import policy, { effectConfig } from "@yazanabuashour/oxlint-config";
import { defineConfig } from "oxlint";

export default defineConfig({
  extends: [policy, effectConfig],
  ignorePatterns: ["tools/typescript-lint-policy"],
  rules: {
    "project/no-global-process-runtime": [
      "error",
      {
        allowFiles: ["extensions/shared/host-runtime.ts"],
      },
    ],
  },
});
