import { defineRule } from "@oxlint/plugins";
import { createTypeAliasEnvironment, } from "../shared/type-alias-resolution.js";
import { resolvesToUnknown } from "../shared/unknown-types.js";
/** Ban named aliases that merely conceal TypeScript's unknown top type. */
export const noUnknownTypeAliasesRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Disallow type aliases whose resolved type is unknown; unknown must remain visible at an allowed boundary.",
        },
        messages: {
            unknownAlias: "Type alias `{{alias}}` hides `unknown`. Keep `unknown` explicit at the parsing boundary or on an allowed `cause` field; otherwise use the parsed owner type.",
        },
    },
    createOnce(context) {
        let environment = null;
        return {
            Program(node) {
                environment = createTypeAliasEnvironment(node, context.sourceCode.visitorKeys);
            },
            TSTypeAliasDeclaration(node) {
                if (environment === null ||
                    !resolvesToUnknown(node.typeAnnotation, environment))
                    return;
                context.report({
                    node: node.id,
                    messageId: "unknownAlias",
                    data: { alias: node.id.name },
                });
            },
        };
    },
});
