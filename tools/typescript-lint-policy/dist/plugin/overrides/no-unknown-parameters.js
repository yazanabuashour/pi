import { defineRule } from "@oxlint/plugins";
import { functionParameterBindingName, functionParameterTypeAnnotation, } from "../../vendor/anti-slop/src/shared/function-parameters.js";
import { createTypeAliasEnvironment, } from "../shared/type-alias-resolution.js";
import { resolvesToUnknown } from "../shared/unknown-types.js";
/** Disallow unknown inputs except error causes and the exact subject of a predicate. */
export const noUnknownParametersRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Disallow explicitly unknown function parameters except `cause` and type-predicate subjects; decode unknown input at its I/O boundary instead.",
        },
        messages: {
            unknownParameter: "Parameter `{{parameter}}` leaves input unparsed. Accept a named domain type; run the expected schema or parser at the I/O boundary before calling this function.",
        },
    },
    createOnce(context) {
        let environment = null;
        const checkParameters = (node) => {
            if (environment === null)
                return;
            const predicate = node.returnType?.typeAnnotation;
            for (const parameter of node.params) {
                const annotation = functionParameterTypeAnnotation(parameter);
                if (!annotation ||
                    !resolvesToUnknown(annotation.typeAnnotation, environment))
                    continue;
                const name = functionParameterBindingName(parameter, context.sourceCode);
                if (name === "cause")
                    continue;
                if (predicate?.type === "TSTypePredicate" &&
                    predicate.parameterName.type === "Identifier" &&
                    predicate.parameterName.name === name)
                    continue;
                context.report({
                    node: annotation.typeAnnotation,
                    messageId: "unknownParameter",
                    data: { parameter: name },
                });
            }
        };
        return {
            Program(node) {
                environment = createTypeAliasEnvironment(node, context.sourceCode.visitorKeys);
            },
            ArrowFunctionExpression: checkParameters,
            FunctionDeclaration: checkParameters,
            FunctionExpression: checkParameters,
            TSCallSignatureDeclaration: checkParameters,
            TSConstructSignatureDeclaration: checkParameters,
            TSConstructorType: checkParameters,
            TSDeclareFunction: checkParameters,
            TSEmptyBodyFunctionExpression: checkParameters,
            TSFunctionType: checkParameters,
            TSMethodSignature: checkParameters,
        };
    },
});
