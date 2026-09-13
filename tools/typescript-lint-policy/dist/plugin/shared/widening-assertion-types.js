export function unwrapExpressionParentheses(expression) {
    let current = expression;
    while (current.type === "ParenthesizedExpression")
        current = current.expression;
    return current;
}
function unwrapTypeParentheses(type) {
    let current = type;
    while (current.type === "TSParenthesizedType")
        current = current.typeAnnotation;
    return current;
}
function typeReferenceName(type) {
    return type.typeName.type === "Identifier" ? type.typeName.name : null;
}
function isUnknownOrAnyType(type) {
    const unwrapped = unwrapTypeParentheses(type);
    return (unwrapped.type === "TSUnknownKeyword" || unwrapped.type === "TSAnyKeyword");
}
function isBroadRecordKeyType(type) {
    const unwrapped = unwrapTypeParentheses(type);
    if (unwrapped.type === "TSStringKeyword" ||
        unwrapped.type === "TSNumberKeyword" ||
        unwrapped.type === "TSSymbolKeyword") {
        return true;
    }
    if (unwrapped.type === "TSUnionType")
        return unwrapped.types.every(isBroadRecordKeyType);
    return (unwrapped.type === "TSTypeReference" &&
        typeReferenceName(unwrapped) === "PropertyKey");
}
function isBroadRecordType(type) {
    const unwrapped = unwrapTypeParentheses(type);
    if (unwrapped.type === "TSTypeReference") {
        if (typeReferenceName(unwrapped) === "Readonly") {
            const [inner] = unwrapped.typeArguments?.params ?? [];
            return inner !== undefined && isBroadRecordType(inner);
        }
        if (typeReferenceName(unwrapped) !== "Record")
            return false;
        const parameters = unwrapped.typeArguments?.params ?? [];
        return (parameters.length === 2 &&
            parameters[0] !== undefined &&
            parameters[1] !== undefined &&
            isBroadRecordKeyType(parameters[0]) &&
            isUnknownOrAnyType(parameters[1]));
    }
    if (unwrapped.type !== "TSTypeLiteral" || unwrapped.members.length !== 1)
        return false;
    const [member] = unwrapped.members;
    const [parameter] = member?.type === "TSIndexSignature" ? member.parameters : [];
    return (member?.type === "TSIndexSignature" &&
        member.parameters.length === 1 &&
        parameter !== undefined &&
        isBroadRecordKeyType(parameter.typeAnnotation.typeAnnotation) &&
        isUnknownOrAnyType(member.typeAnnotation.typeAnnotation));
}
export function broadTypeKind(type) {
    const unwrapped = unwrapTypeParentheses(type);
    if (unwrapped.type === "TSUnknownKeyword" ||
        unwrapped.type === "TSAnyKeyword")
        return "top";
    if (unwrapped.type === "TSObjectKeyword")
        return "object";
    return isBroadRecordType(unwrapped) ? "record" : null;
}
export function assertedExpression(node) {
    return unwrapExpressionParentheses(node.expression);
}
export function assertionFromExpression(expression) {
    const unwrapped = unwrapExpressionParentheses(expression);
    return unwrapped.type === "TSAsExpression" ||
        unwrapped.type === "TSTypeAssertion"
        ? unwrapped
        : null;
}
function normalizedTypeText(sourceText, type) {
    return sourceText.slice(type.start, type.end).replaceAll(/\s+/gu, "");
}
function typesHaveSameSyntax(sourceText, left, right) {
    return (left !== null &&
        normalizedTypeText(sourceText, unwrapTypeParentheses(left)) ===
            normalizedTypeText(sourceText, unwrapTypeParentheses(right)));
}
function isDefinitelyObjectType(type) {
    const unwrapped = unwrapTypeParentheses(type);
    switch (unwrapped.type) {
        case "TSArrayType":
        case "TSConstructorType":
        case "TSFunctionType":
        case "TSMappedType":
        case "TSObjectKeyword":
        case "TSTupleType":
            return true;
        case "TSTypeLiteral":
            return unwrapped.members.length > 0;
        case "TSIntersectionType":
            return unwrapped.types.every(isDefinitelyObjectType);
        case "TSTypeOperator":
            return (unwrapped.operator === "readonly" &&
                isDefinitelyObjectType(unwrapped.typeAnnotation));
        default:
            return false;
    }
}
function isDefinitelyNarrowerRecordType(type) {
    const unwrapped = unwrapTypeParentheses(type);
    if (unwrapped.type === "TSTypeLiteral") {
        return unwrapped.members.some((member) => member.type !== "TSIndexSignature");
    }
    if (unwrapped.type !== "TSTypeReference")
        return false;
    if (typeReferenceName(unwrapped) === "Readonly") {
        const [inner] = unwrapped.typeArguments?.params ?? [];
        return inner !== undefined && isDefinitelyNarrowerRecordType(inner);
    }
    if (typeReferenceName(unwrapped) !== "Record")
        return false;
    const parameters = unwrapped.typeArguments?.params ?? [];
    return (parameters.length === 2 &&
        parameters[1] !== undefined &&
        !isUnknownOrAnyType(parameters[1]));
}
export function assertionIsNarrower(sourceText, broadKind, evidence, assertedType) {
    if (broadTypeKind(assertedType) !== null)
        return false;
    if (broadKind === "top")
        return true;
    if (typesHaveSameSyntax(sourceText, evidence.type, assertedType))
        return true;
    if (broadKind === "object")
        return isDefinitelyObjectType(assertedType);
    return isDefinitelyNarrowerRecordType(assertedType);
}
