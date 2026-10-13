import { hasVisibleTypeBinding, visibleTypeDeclaration, } from "./type-alias-resolution.js";
import { childNodes } from "./ast.js";
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
function isBuiltInReference(type, name, environment) {
    return (type.typeName.type === "Identifier" &&
        type.typeName.name === name &&
        !hasVisibleTypeBinding(name, type, environment));
}
function isUnknownOrAnyType(type) {
    const unwrapped = unwrapTypeParentheses(type);
    return (unwrapped.type === "TSUnknownKeyword" || unwrapped.type === "TSAnyKeyword");
}
function isBroadRecordKeyType(type, environment) {
    const unwrapped = unwrapTypeParentheses(type);
    if (unwrapped.type === "TSStringKeyword" ||
        unwrapped.type === "TSNumberKeyword" ||
        unwrapped.type === "TSSymbolKeyword") {
        return true;
    }
    if (unwrapped.type === "TSUnionType")
        return unwrapped.types.every((type) => isBroadRecordKeyType(type, environment));
    return (unwrapped.type === "TSTypeReference" &&
        isBuiltInReference(unwrapped, "PropertyKey", environment));
}
function isBroadRecordType(type, environment) {
    const unwrapped = unwrapTypeParentheses(type);
    if (unwrapped.type === "TSTypeReference") {
        if (isBuiltInReference(unwrapped, "Readonly", environment)) {
            const [inner] = unwrapped.typeArguments?.params ?? [];
            return inner !== undefined && isBroadRecordType(inner, environment);
        }
        if (!isBuiltInReference(unwrapped, "Record", environment))
            return false;
        const parameters = unwrapped.typeArguments?.params ?? [];
        return (parameters.length === 2 &&
            parameters[0] !== undefined &&
            parameters[1] !== undefined &&
            isBroadRecordKeyType(parameters[0], environment) &&
            isUnknownOrAnyType(parameters[1]));
    }
    if (unwrapped.type !== "TSTypeLiteral" || unwrapped.members.length !== 1)
        return false;
    const [member] = unwrapped.members;
    const [parameter] = member?.type === "TSIndexSignature" ? member.parameters : [];
    return (member?.type === "TSIndexSignature" &&
        member.parameters.length === 1 &&
        parameter !== undefined &&
        isBroadRecordKeyType(parameter.typeAnnotation.typeAnnotation, environment) &&
        isUnknownOrAnyType(member.typeAnnotation.typeAnnotation));
}
export function broadTypeKind(type, environment) {
    const unwrapped = unwrapTypeParentheses(type);
    if (unwrapped.type === "TSUnknownKeyword" ||
        unwrapped.type === "TSAnyKeyword")
        return "top";
    if (unwrapped.type === "TSObjectKeyword")
        return "object";
    return isBroadRecordType(unwrapped, environment) ? "record" : null;
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
function referenceBindings(type, environment) {
    const nodes = [type];
    const bindings = [];
    while (nodes.length > 0) {
        const node = nodes.pop();
        if (node === undefined)
            break;
        if (node.type === "TSTypeQuery")
            return null;
        if (node.type === "TSTypeReference") {
            if (node.typeName.type !== "Identifier")
                return null;
            const name = node.typeName.name;
            const declaration = visibleTypeDeclaration(name, node, environment);
            if (declaration === null &&
                hasVisibleTypeBinding(name, node, environment))
                return null;
            bindings.push(declaration);
        }
        nodes.push(...childNodes(node, environment.visitorKeys));
    }
    return bindings;
}
function typesHaveSameSyntax(sourceText, left, right, environment) {
    if (left === null ||
        normalizedTypeText(sourceText, unwrapTypeParentheses(left)) !==
            normalizedTypeText(sourceText, unwrapTypeParentheses(right)))
        return false;
    const leftBindings = referenceBindings(left, environment);
    const rightBindings = referenceBindings(right, environment);
    return (leftBindings !== null &&
        rightBindings !== null &&
        leftBindings.length === rightBindings.length &&
        leftBindings.every((binding, index) => binding === rightBindings[index]));
}
function isDefinitelyObjectType(type) {
    const unwrapped = unwrapTypeParentheses(type);
    // oxlint-disable-next-line typescript/switch-exhaustiveness-check -- This predicate recognizes only definitely-object syntax; other AST variants intentionally return false.
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
function isDefinitelyNarrowerRecordType(type, environment) {
    const unwrapped = unwrapTypeParentheses(type);
    if (unwrapped.type === "TSTypeLiteral") {
        return unwrapped.members.some((member) => member.type !== "TSIndexSignature");
    }
    if (unwrapped.type !== "TSTypeReference")
        return false;
    if (isBuiltInReference(unwrapped, "Readonly", environment)) {
        const [inner] = unwrapped.typeArguments?.params ?? [];
        return (inner !== undefined && isDefinitelyNarrowerRecordType(inner, environment));
    }
    if (!isBuiltInReference(unwrapped, "Record", environment))
        return false;
    const parameters = unwrapped.typeArguments?.params ?? [];
    return (parameters.length === 2 &&
        parameters[1] !== undefined &&
        !isUnknownOrAnyType(parameters[1]));
}
export function assertionIsNarrower(sourceText, broadKind, evidence, assertedType, environment) {
    if (broadTypeKind(assertedType, environment) !== null)
        return false;
    if (broadKind === "top")
        return true;
    if (typesHaveSameSyntax(sourceText, evidence.type, assertedType, environment))
        return true;
    if (broadKind === "object")
        return isDefinitelyObjectType(assertedType);
    return isDefinitelyNarrowerRecordType(assertedType, environment);
}
