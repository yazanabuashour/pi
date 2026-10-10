import { defineRule } from "@oxlint/plugins";
import { noManualTagComparisonRule as upstreamRule } from "../../vendor/anti-slop/src/effect/rules/no-manual-tag-comparison.js";
import { isTagMember, tagMemberFromComparison, } from "../../vendor/anti-slop/src/effect/shared/tagged-values.js";
import { isInsideBroadEffectHandler } from "./tagged-values.js";
export const noManualTagComparisonRule = defineRule({
    ...upstreamRule,
    createOnce(context) {
        return {
            BinaryExpression(node) {
                if (tagMemberFromComparison(node) === undefined ||
                    isInsideBroadEffectHandler(node))
                    return;
                context.report({ node, messageId: "manualComparison" });
            },
            SwitchStatement(node) {
                if (!isTagMember(node.discriminant) || isInsideBroadEffectHandler(node))
                    return;
                context.report({ node, messageId: "manualSwitch" });
            },
        };
    },
});
