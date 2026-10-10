import { defineRule } from "@oxlint/plugins";
import { preferEffectMatchRule as upstreamRule } from "../../vendor/anti-slop/src/effect/rules/prefer-effect-match.js";
import { tagMemberFromComparison } from "../../vendor/anti-slop/src/effect/shared/tagged-values.js";
import { isInsideBroadEffectHandler } from "./tagged-values.js";
export const preferEffectMatchRule = defineRule({
    ...upstreamRule,
    createOnce(context) {
        if (!("createOnce" in upstreamRule)) {
            throw new Error("Upstream prefer-effect-match must expose createOnce");
        }
        const visitor = upstreamRule.createOnce(context);
        const checkConditional = visitor.ConditionalExpression;
        if (checkConditional === undefined) {
            throw new Error("Upstream prefer-effect-match must visit conditional expressions");
        }
        return {
            ...visitor,
            ConditionalExpression(node) {
                // Tagged catch branches belong to catchTag/catchReason, not Match.
                if (node.test.type === "BinaryExpression" &&
                    node.test.operator !== "in" &&
                    tagMemberFromComparison(node.test) !== undefined &&
                    isInsideBroadEffectHandler(node)) {
                    return;
                }
                checkConditional(node);
            },
        };
    },
});
