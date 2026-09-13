import { definePlugin } from "@oxlint/plugins";
import { noKnownValueWideningRule } from "./overrides/no-known-value-widening.js";
import { noObjectParametersRule } from "./overrides/no-object-parameters.js";
import { noRuntimeTypeofRule } from "./overrides/no-runtime-typeof.js";
import { noUnknownParametersRule } from "./overrides/no-unknown-parameters.js";
import { noUnknownReturnsRule } from "./overrides/no-unknown-returns.js";
import { noUnknownTypeAliasesRule } from "./overrides/no-unknown-type-aliases.js";
import { noUnsafeDictionaryTypeRule } from "./overrides/no-unsafe-dictionary-type.js";
import { noWidenThenAssertRule } from "./overrides/no-widen-then-assert.js";
import { requireSafetyCommentForTypeAssertionRule } from "./overrides/require-safety-comment-for-type-assertion.js";
import { namespaceNodeImportsRule } from "./rules/namespace-node-imports.js";
import { noGlobalProcessRuntimeRule } from "./rules/no-global-process-runtime.js";
import { noInlineSchemaCompileRule } from "./rules/no-inline-schema-compile.js";
import { noManualEffectRuntimeInTestsRule } from "./rules/no-manual-effect-runtime-in-tests.js";
import { upstreamRules } from "./upstream.js";
/** Keep consumer waiver names stable across upstream and local implementations. */
const projectRulesPlugin = definePlugin({
    meta: { name: "project" },
    rules: {
        ...upstreamRules,
        "no-known-value-widening": noKnownValueWideningRule,
        "no-object-parameters": noObjectParametersRule,
        "no-runtime-typeof": noRuntimeTypeofRule,
        "no-unknown-parameters": noUnknownParametersRule,
        "no-unknown-returns": noUnknownReturnsRule,
        "no-unknown-type-aliases": noUnknownTypeAliasesRule,
        "no-unsafe-dictionary-type": noUnsafeDictionaryTypeRule,
        "no-widen-then-assert": noWidenThenAssertRule,
        "require-safety-comment-for-type-assertion": requireSafetyCommentForTypeAssertionRule,
        "namespace-node-imports": namespaceNodeImportsRule,
        "no-global-process-runtime": noGlobalProcessRuntimeRule,
        "no-inline-schema-compile": noInlineSchemaCompileRule,
        "no-manual-effect-runtime-in-tests": noManualEffectRuntimeInTestsRule,
    },
});
export default projectRulesPlugin;
