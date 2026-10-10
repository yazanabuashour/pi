import { assertedExpression, assertionFromExpression, broadTypeKind, unwrapExpressionParentheses, } from "./widening-assertion-types.js";
const functionBoundaryTypes = new Set([
    "ArrowFunctionExpression",
    "FunctionDeclaration",
    "FunctionExpression",
    "TSDeclareFunction",
    "TSEmptyBodyFunctionExpression",
]);
export function functionBoundary(node) {
    let current = node.parent;
    while (current !== null && current.type !== "Program") {
        if (functionBoundaryTypes.has(current.type))
            return current;
        current = current.parent;
    }
    return null;
}
export function resolvedVariableForIdentifier(scopes, identifier) {
    for (const scope of scopes) {
        const reference = scope.references.find((candidate) => candidate.identifier.start === identifier.start &&
            candidate.identifier.end === identifier.end);
        if (reference !== undefined)
            return reference.resolved;
    }
    return null;
}
function variableDeclarator(variable) {
    for (const definition of variable.defs) {
        if (definition.type === "Variable" &&
            definition.node.type === "VariableDeclarator") {
            return definition.node;
        }
    }
    return null;
}
function knownValueEvidence(expression, scopes, boundary, visitedVariables) {
    const unwrapped = unwrapExpressionParentheses(expression);
    if (unwrapped.type === "TSAsExpression" ||
        unwrapped.type === "TSTypeAssertion") {
        if (broadTypeKind(unwrapped.typeAnnotation) !== null)
            return null;
        return { type: unwrapped.typeAnnotation };
    }
    if (unwrapped.type === "Literal" || unwrapped.type === "TemplateLiteral") {
        return { type: null };
    }
    if (unwrapped.type === "ArrayExpression" ||
        unwrapped.type === "ArrowFunctionExpression" ||
        unwrapped.type === "ClassExpression" ||
        unwrapped.type === "FunctionExpression" ||
        unwrapped.type === "NewExpression" ||
        unwrapped.type === "ObjectExpression") {
        return { type: null };
    }
    if (unwrapped.type !== "Identifier")
        return null;
    const variable = resolvedVariableForIdentifier(scopes, unwrapped);
    if (variable === null || visitedVariables.has(variable))
        return null;
    const annotatedIdentifier = variable.identifiers.find((identifier) => identifier.typeAnnotation !== null &&
        identifier.typeAnnotation !== undefined);
    const annotation = annotatedIdentifier?.typeAnnotation?.typeAnnotation;
    if (annotation !== undefined && annotatedIdentifier !== undefined) {
        if (functionBoundary(annotatedIdentifier) !== boundary ||
            broadTypeKind(annotation) !== null) {
            return null;
        }
        return { type: annotation };
    }
    const declarator = variableDeclarator(variable);
    if (declarator === null ||
        declarator.parent.type !== "VariableDeclaration" ||
        declarator.parent.kind !== "const" ||
        declarator.init === null ||
        variable.references.some((reference) => reference.isWrite() && !reference.init) ||
        functionBoundary(declarator) !== boundary) {
        return null;
    }
    return knownValueEvidence(declarator.init, scopes, boundary, new Set([...visitedVariables, variable]));
}
export function widenedBinding(variable, scopes) {
    const declarator = variableDeclarator(variable);
    if (declarator === null ||
        declarator.parent.type !== "VariableDeclaration" ||
        declarator.parent.kind !== "const" ||
        declarator.id.type !== "Identifier" ||
        declarator.init === null ||
        variable.references.some((reference) => reference.isWrite() && !reference.init)) {
        return null;
    }
    const boundary = functionBoundary(declarator);
    const declaredType = declarator.id.typeAnnotation?.typeAnnotation;
    const initializerAssertion = assertionFromExpression(declarator.init);
    const initializerBroadKind = initializerAssertion === null
        ? null
        : broadTypeKind(initializerAssertion.typeAnnotation);
    const declaredBroadKind = declaredType === undefined ? null : broadTypeKind(declaredType);
    const broadKind = declaredBroadKind ?? initializerBroadKind;
    if (broadKind === null)
        return null;
    const originalExpression = initializerAssertion !== null && initializerBroadKind !== null
        ? assertedExpression(initializerAssertion)
        : declarator.init;
    const evidence = knownValueEvidence(originalExpression, scopes, boundary, new Set([variable]));
    return evidence === null
        ? null
        : { broadKind, evidence, declaredAt: declarator.end, boundary };
}
