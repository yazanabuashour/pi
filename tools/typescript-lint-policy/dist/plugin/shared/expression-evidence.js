export function isKnownEvidenceExpression(expression) {
    let current = expression;
    while (current.type === "ParenthesizedExpression" ||
        current.type === "TSAsExpression" ||
        current.type === "TSTypeAssertion" ||
        current.type === "TSNonNullExpression" ||
        current.type === "TSSatisfiesExpression") {
        current = current.expression;
    }
    if (current.type === "ObjectExpression")
        return true;
    return (current.type === "ArrayExpression" ||
        current.type === "ArrowFunctionExpression" ||
        current.type === "ClassExpression" ||
        current.type === "FunctionExpression" ||
        current.type === "NewExpression" ||
        current.type === "Literal" ||
        current.type === "TemplateLiteral" ||
        current.type === "UnaryExpression");
}
