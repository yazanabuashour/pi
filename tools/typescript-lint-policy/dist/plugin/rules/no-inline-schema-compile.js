import { defineRule } from "@oxlint/plugins";
import { getPropertyName, isIdentifier, unwrapExpression, } from "../shared/ast.js";
const COMPILER_METHODS = new Set([
    "is",
    "asserts",
    "decodeEffect",
    "decodeExit",
    "decodeOption",
    "decodePromise",
    "decodeResult",
    "decodeSync",
    "decodeUnknownExit",
    "decodeUnknownEffect",
    "decodeUnknownOption",
    "decodeUnknownPromise",
    "decodeUnknownResult",
    "decodeUnknownSync",
    "encodeExit",
    "encodeEffect",
    "encodeOption",
    "encodePromise",
    "encodeResult",
    "encodeSync",
    "encodeUnknownExit",
    "encodeUnknownEffect",
    "encodeUnknownOption",
    "encodeUnknownPromise",
    "encodeUnknownResult",
    "encodeUnknownSync",
]);
function schemaCompilerMethod(callee) {
    const expression = unwrapExpression(callee);
    if (expression?.type !== "MemberExpression")
        return null;
    if (!isIdentifier(unwrapExpression(expression.object), "Schema"))
        return null;
    const method = getPropertyName(expression.property);
    return method !== null && COMPILER_METHODS.has(method) ? method : null;
}
function isStaticSchemaReference(node) {
    const expression = unwrapExpression(node);
    if (expression?.type === "Identifier") {
        const [firstCharacter] = expression.name;
        return (firstCharacter !== undefined &&
            firstCharacter.toUpperCase() === firstCharacter);
    }
    return expression?.type === "MemberExpression";
}
function isNestedStaticSchemaCall(node) {
    const expression = unwrapExpression(node);
    if (expression?.type !== "CallExpression")
        return false;
    const callee = unwrapExpression(expression.callee);
    if (callee?.type !== "MemberExpression")
        return false;
    if (!isIdentifier(unwrapExpression(callee.object), "Schema"))
        return false;
    if (getPropertyName(callee.property) === "fromJsonString") {
        const [firstArgument] = expression.arguments;
        return (isStaticSchemaReference(firstArgument) ||
            isNestedStaticSchemaCall(firstArgument));
    }
    return true;
}
function isImmediatelyInvoked(node) {
    const expression = unwrapExpression(node);
    if (expression === null || !("parent" in expression))
        return false;
    const parent = unwrapExpression(expression.parent);
    return (parent?.type === "CallExpression" &&
        unwrapExpression(parent.callee) === expression);
}
export const noInlineSchemaCompileRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Disallow rebuilding Effect Schema decoder and encoder compilers inside function bodies.",
        },
    },
    createOnce(context) {
        let functionDepth = 0;
        return {
            before() {
                functionDepth = 0;
            },
            FunctionDeclaration() {
                functionDepth++;
            },
            "FunctionDeclaration:exit"() {
                functionDepth--;
            },
            FunctionExpression() {
                functionDepth++;
            },
            "FunctionExpression:exit"() {
                functionDepth--;
            },
            ArrowFunctionExpression() {
                functionDepth++;
            },
            "ArrowFunctionExpression:exit"() {
                functionDepth--;
            },
            CallExpression(node) {
                if (functionDepth === 0)
                    return;
                const method = schemaCompilerMethod(node.callee);
                if (method === null || !isImmediatelyInvoked(node))
                    return;
                const [firstArgument] = node.arguments;
                const hasInlineSchema = isNestedStaticSchemaCall(firstArgument);
                if (!hasInlineSchema && !isStaticSchemaReference(firstArgument))
                    return;
                const detail = hasInlineSchema
                    ? "both the inline schema and its compiled function are rebuilt"
                    : "the compiled function is rebuilt";
                context.report({
                    node: node.callee,
                    message: `Hoist Schema.${method}(...) to module scope: ${detail} on every call.`,
                });
            },
        };
    },
});
