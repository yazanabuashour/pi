import { defineRule } from "@oxlint/plugins";
import { classifyWideningTarget, createTypeEnvironment, } from "../shared/dictionary-types.js";
import { hasKnownEvidence, knownPredicateArgument, resolveVariable, variableDeclarator, } from "../shared/known-evidence.js";
function unwrapExpression(expression) {
    let current = expression;
    while (current.type === "ParenthesizedExpression" ||
        current.type === "TSAsExpression" ||
        current.type === "TSSatisfiesExpression" ||
        current.type === "TSTypeAssertion" ||
        current.type === "TSNonNullExpression") {
        current = current.expression;
    }
    return current;
}
function annotationTarget(annotation, environment) {
    return annotation === null || annotation === undefined
        ? null
        : classifyWideningTarget(annotation.typeAnnotation, environment);
}
function enclosingFunction(node) {
    let current = node.parent;
    while (current !== null && current.type !== "Program") {
        if (current.type === "ArrowFunctionExpression" ||
            current.type === "FunctionDeclaration" ||
            current.type === "FunctionExpression") {
            return current;
        }
        current = current.parent;
    }
    return null;
}
function sourceKeyName(sourceCode, key) {
    if (key.type === "Identifier" || key.type === "PrivateIdentifier")
        return key.name;
    if (key.type === "Literal")
        return String(key.value);
    return sourceCode.getText(key);
}
function functionName(sourceCode, owner) {
    if (owner === null)
        return "anonymous function";
    if (owner.id !== null)
        return owner.id.name;
    const parent = owner.parent;
    if (parent.type === "VariableDeclarator" && parent.id.type === "Identifier")
        return parent.id.name;
    if (parent.type === "MethodDefinition")
        return sourceKeyName(sourceCode, parent.key);
    return "anonymous function";
}
function isEmptyObjectExpression(expression) {
    const unwrapped = unwrapExpression(expression);
    return (unwrapped.type === "ObjectExpression" && unwrapped.properties.length === 0);
}
function isDictionaryAccumulatorTarget(destination) {
    return (destination.kind === "open dictionary" ||
        destination.kind === "generic container");
}
function hasParentAssertion(node) {
    return (node.parent?.type === "TSAsExpression" ||
        node.parent?.type === "TSTypeAssertion");
}
function reportFlow(context, expression, destination, subject) {
    if (destination === null)
        return;
    if (isDictionaryAccumulatorTarget(destination) &&
        isEmptyObjectExpression(expression))
        return;
    if (!hasKnownEvidence(context.sourceCode, expression))
        return;
    context.report({
        node: expression,
        messageId: "widening",
        data: { subject, target: destination.kind },
    });
}
/** Detect sound syntactic cases where a known value is explicitly widened and loses evidence. */
export const noKnownValueWideningRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Disallow syntactically established values from flowing into explicitly broad or anonymous target types that discard useful evidence.",
        },
        messages: {
            widening: "The explicit {{target}} type on {{subject}} discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.",
        },
    },
    createOnce(context) {
        let environment = null;
        const targetFromAnnotation = (annotation) => environment === null ? null : annotationTarget(annotation, environment);
        const reportProperty = (node) => {
            if (node.value === null)
                return;
            reportFlow(context, node.value, targetFromAnnotation(node.typeAnnotation), `property \`${sourceKeyName(context.sourceCode, node.key)}\``);
        };
        const reportAssertion = (node) => {
            if (environment === null || hasParentAssertion(node))
                return;
            reportFlow(context, node.expression, classifyWideningTarget(node.typeAnnotation, environment), "assertion");
        };
        return {
            Program(node) {
                environment = createTypeEnvironment(node, context.sourceCode.visitorKeys);
            },
            VariableDeclarator(node) {
                if (node.init === null || node.id.type !== "Identifier")
                    return;
                reportFlow(context, node.init, targetFromAnnotation(node.id.typeAnnotation), `binding \`${node.id.name}\``);
            },
            PropertyDefinition: reportProperty,
            AccessorProperty: reportProperty,
            AssignmentExpression(node) {
                if (node.operator !== "=" || node.left.type !== "Identifier")
                    return;
                const variable = resolveVariable(context.sourceCode, node.left);
                if (variable === null)
                    return;
                const declarator = variableDeclarator(variable);
                if (declarator === null || declarator.id.type !== "Identifier")
                    return;
                reportFlow(context, node.right, targetFromAnnotation(declarator.id.typeAnnotation), `binding \`${declarator.id.name}\``);
            },
            CallExpression(node) {
                if (environment === null)
                    return;
                const flow = knownPredicateArgument(context.sourceCode, node, environment);
                if (flow === null)
                    return;
                context.report({
                    node: flow.argument,
                    messageId: "widening",
                    data: {
                        subject: `argument for parameter \`${flow.parameter}\` of \`${functionName(context.sourceCode, flow.owner)}\``,
                        target: "unknown",
                    },
                });
            },
            ReturnStatement(node) {
                if (node.argument === null)
                    return;
                const owner = enclosingFunction(node);
                reportFlow(context, node.argument, targetFromAnnotation(owner?.returnType), `return value of \`${functionName(context.sourceCode, owner)}\``);
            },
            ArrowFunctionExpression(node) {
                if (node.body.type === "BlockStatement")
                    return;
                reportFlow(context, node.body, targetFromAnnotation(node.returnType), `return value of \`${functionName(context.sourceCode, node)}\``);
            },
            TSAsExpression: reportAssertion,
            TSTypeAssertion: reportAssertion,
        };
    },
});
