import policy, { effectConfig } from "@yazanabuashour/oxlint-config";
import { defineConfig } from "oxlint";

export default defineConfig({
  extends: [policy, effectConfig],
  rules: {
    "project/no-global-process-runtime": [
      "error",
      {
        allowFiles: ["extensions/shared/host-runtime.ts"],
      },
    ],
  },
});
