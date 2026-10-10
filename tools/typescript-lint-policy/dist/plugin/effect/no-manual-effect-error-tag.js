import { defineRule } from "@oxlint/plugins";
import { noManualEffectErrorTagRule as upstreamRule } from "../../vendor/anti-slop/src/effect/rules/no-manual-effect-error-tag.js";
import { isReasonTagMember, isTagMember, tagMemberFromComparison, } from "../../vendor/anti-slop/src/effect/shared/tagged-values.js";
import { isInsideBroadEffectHandler } from "./tagged-values.js";
export const noManualEffectErrorTagRule = defineRule({
    ...upstreamRule,
    createOnce(context) {
        return {
            BinaryExpression(node) {
                const tagMember = tagMemberFromComparison(node);
                if (tagMember === undefined || !isInsideBroadEffectHandler(node))
                    return;
                context.report({
                    node,
                    messageId: isReasonTagMember(tagMember) ? "reason" : "tag",
                });
            },
            SwitchStatement(node) {
                if (!isTagMember(node.discriminant) ||
                    !isInsideBroadEffectHandler(node))
                    return;
                context.report({
                    node,
                    messageId: isReasonTagMember(node.discriminant) ? "reason" : "tag",
                });
            },
        };
    },
});
