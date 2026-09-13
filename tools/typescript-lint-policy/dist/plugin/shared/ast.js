function isNode(value) {
    return (typeof value === "object" &&
        value !== null &&
        "type" in value &&
        typeof value.type === "string");
}
/** Oxlint visitor keys identify children; never follow the parent reference. */
export function* childNodes(node, visitorKeys) {
    const keys = visitorKeys[node.type] ?? [];
    for (const [key, value] of Object.entries(node)) {
        if (!keys.includes(key))
            continue;
        if (isNode(value))
            yield value;
        else if (Array.isArray(value)) {
            for (const child of value)
                if (isNode(child))
                    yield child;
        }
    }
}
function isExpressionWrapper(node) {
    return (node.type === "ChainExpression" ||
        node.type === "ParenthesizedExpression" ||
        node.type === "TSNonNullExpression" ||
        node.type === "TSAsExpression" ||
        node.type === "TSTypeAssertion");
}
export function unwrapExpression(node) {
    let current = node ?? null;
    while (current !== null && isExpressionWrapper(current)) {
        current = current.expression;
    }
    return current;
}
export function getPropertyName(expression) {
    if (expression === null || expression === undefined)
        return null;
    if (expression.type === "Identifier" ||
        expression.type === "PrivateIdentifier") {
        return expression.name;
    }
    if (expression.type === "Literal" && typeof expression.value === "string") {
        return expression.value;
    }
    return null;
}
export function isIdentifier(node, name) {
    return (node?.type === "Identifier" && (name === undefined || node.name === name));
}
export function literalStringValue(expression) {
    return expression?.type === "Literal" && typeof expression.value === "string"
        ? expression.value
        : null;
}
