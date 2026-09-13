import { defineRule } from "@oxlint/plugins";
import { functionBoundary, resolvedVariableForIdentifier, widenedBinding, } from "../shared/widened-binding.js";
import { assertedExpression, assertionIsNarrower, } from "../shared/widening-assertion-types.js";
/** Detect immutable local bindings that erase a known type and are later asserted back to a narrower type. */
export const noWidenThenAssertRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Disallow local const flows that explicitly widen a known value before asserting the widened binding to a narrower type.",
        },
        messages: {
            widenThenAssert: 'Binding "{{name}}" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.',
        },
    },
    create(context) {
        const scopes = context.sourceCode.scopeManager.scopes;
        const checkAssertion = (node) => {
            const expression = assertedExpression(node);
            if (expression.type !== "Identifier")
                return;
            const variable = resolvedVariableForIdentifier(scopes, expression);
            if (variable === null)
                return;
            const widened = widenedBinding(variable, scopes);
            if (widened === null ||
                node.start <= widened.declaredAt ||
                functionBoundary(node) !== widened.boundary ||
                !assertionIsNarrower(context.sourceCode.text, widened.broadKind, widened.evidence, node.typeAnnotation)) {
                return;
            }
            context.report({
                node,
                messageId: "widenThenAssert",
                data: { name: expression.name },
            });
        };
        return {
            TSAsExpression: checkAssertion,
            TSTypeAssertion: checkAssertion,
        };
    },
});
