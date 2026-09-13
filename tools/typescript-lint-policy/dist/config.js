import * as NodeURL from "node:url";
import { defineConfig } from "oxlint";
const pluginExtension = import.meta.url.endsWith(".ts") ? "ts" : "js";
const projectPlugin = NodeURL.fileURLToPath(new URL(`./plugin/index.${pluginExtension}`, import.meta.url));
export const strictestConfig = defineConfig({
    categories: {
        correctness: "error",
        perf: "error",
        suspicious: "error",
    },
    plugins: ["eslint", "jsx-a11y", "oxc", "react", "unicorn", "typescript"],
    jsPlugins: [{ name: "project", specifier: projectPlugin }],
    options: {
        typeAware: false,
        typeCheck: false,
    },
    rules: {
        "eslint/no-await-in-loop": "off",
        "eslint/no-shadow": "off",
        "eslint/no-underscore-dangle": "off",
        "oxc/no-map-spread": "off",
        "react-in-jsx-scope": "off",
        "typescript/consistent-return": "off",
        "typescript/no-unnecessary-boolean-literal-compare": "off",
        "typescript/no-unnecessary-type-arguments": "off",
        "typescript/no-unnecessary-type-assertion": "off",
        "typescript/no-unnecessary-type-conversion": "off",
        "typescript/no-unnecessary-type-parameters": "off",
        "typescript/no-unsafe-type-assertion": "off",
        "unicorn/consistent-function-scoping": "off",
        "unicorn/no-array-sort": "off",
        "react/exhaustive-deps": "error",
        "react/rules-of-hooks": "error",
        "typescript/no-explicit-any": "error",
        "typescript/no-non-null-assertion": "error",
        "oxc/no-accumulating-spread": "error",
        "project/no-array-filter-map": "error",
        "project/no-reduce-accumulator-copy": "error",
        "project/namespace-node-imports": "error",
        "project/no-chained-type-assertions": "error",
        "project/no-conditional-empty-object-spread": "error",
        "project/no-global-process-runtime": "error",
        "project/no-inline-schema-compile": "error",
        "project/no-known-value-widening": "error",
        "project/no-manual-effect-runtime-in-tests": "error",
        "project/no-module-mocking": "error",
        "project/no-object-parameters": "error",
        "project/no-reflect-apply": "error",
        "project/no-reflect-get": "error",
        "project/no-runtime-typeof": "error",
        "project/no-shape-in-symbol-names": "error",
        "project/no-unknown-parameters": "error",
        "project/no-unknown-returns": "error",
        "project/no-unknown-type-aliases": "error",
        "project/no-unsafe-dictionary-type": "error",
        "project/no-widen-then-assert": "error",
        "project/require-safety-comment-for-type-assertion": "error",
        // Receipt: receipts/size-limits.json
        "eslint/max-lines": [
            "error",
            { max: 300, skipBlankLines: true, skipComments: true },
        ],
        "eslint/max-lines-per-function": [
            "error",
            { IIFEs: true, max: 100, skipBlankLines: true, skipComments: true },
        ],
    },
});
/** Opt in only in repositories that depend directly on Effect. */
export const effectConfig = defineConfig({
    jsPlugins: [
        {
            name: "project-effect",
            specifier: NodeURL.fileURLToPath(new URL(`./plugin/effect/index.${pluginExtension}`, import.meta.url)),
        },
    ],
    rules: { "project-effect/no-service-constructor-imports": "error" },
});
export default strictestConfig;
