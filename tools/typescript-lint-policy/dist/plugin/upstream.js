import { noArrayFilterMapRule } from "../vendor/anti-slop/src/rules/no-array-filter-map.js";
import { noChainedTypeAssertionsRule } from "../vendor/anti-slop/src/rules/no-chained-type-assertions.js";
import { noConditionalEmptyObjectSpreadRule } from "../vendor/anti-slop/src/rules/no-conditional-empty-object-spread.js";
import { noModuleMockingRule } from "../vendor/anti-slop/src/rules/no-module-mocking.js";
import { noReduceAccumulatorCopyRule } from "../vendor/anti-slop/src/rules/no-reduce-accumulator-copy.js";
import { noReflectApplyRule } from "../vendor/anti-slop/src/rules/no-reflect-apply.js";
import { noReflectGetRule } from "../vendor/anti-slop/src/rules/no-reflect-get.js";
import { noForbiddenTermInSymbolNamesRule } from "../vendor/anti-slop/src/rules/no-shape-in-symbol-names.js";
export const upstreamRules = {
    "no-array-filter-map": noArrayFilterMapRule,
    "no-chained-type-assertions": noChainedTypeAssertionsRule,
    "no-conditional-empty-object-spread": noConditionalEmptyObjectSpreadRule,
    "no-module-mocking": noModuleMockingRule,
    "no-reduce-accumulator-copy": noReduceAccumulatorCopyRule,
    "no-reflect-apply": noReflectApplyRule,
    "no-reflect-get": noReflectGetRule,
    "no-shape-in-symbol-names": noForbiddenTermInSymbolNamesRule,
};
