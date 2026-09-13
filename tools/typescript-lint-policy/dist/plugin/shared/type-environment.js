import { createTypeAliasEnvironment, hasVisibleTypeBinding, } from "./type-alias-resolution.js";
export const TRANSPARENT_WRAPPERS = new Set([
    "Readonly",
    "Partial",
    "Required",
    "NonNullable",
]);
export function createTypeEnvironment(program, visitorKeys) {
    const interfaces = new Map();
    for (const statement of program.body) {
        const declaration = statement.type === "ExportNamedDeclaration" ||
            statement.type === "ExportDefaultDeclaration"
            ? statement.declaration
            : statement;
        if (declaration?.type !== "TSInterfaceDeclaration")
            continue;
        const declarations = interfaces.get(declaration.id.name) ?? [];
        declarations.push(declaration);
        interfaces.set(declaration.id.name, declarations);
    }
    return {
        interfaces,
        typeAliases: createTypeAliasEnvironment(program, visitorKeys),
    };
}
export function typeReferenceName(type) {
    return type.typeName.type === "Identifier" ? type.typeName.name : null;
}
export function isBuiltIn(name, use, environment) {
    return !hasVisibleTypeBinding(name, use, environment.typeAliases);
}
export function unwrapTransparentType(type) {
    let current = type;
    while (current.type === "TSParenthesizedType" ||
        (current.type === "TSTypeOperator" && current.operator === "readonly")) {
        current = current.typeAnnotation;
    }
    return current;
}
export function isUnappliedReferenceTo(type, name) {
    const unwrapped = unwrapTransparentType(type);
    return (unwrapped.type === "TSTypeReference" &&
        typeReferenceName(unwrapped) === name &&
        !unwrapped.typeArguments?.params.length);
}
function resolvedSubstitutionArgument(type, base, resolving = new Set()) {
    const unwrapped = unwrapTransparentType(type);
    if (unwrapped.type !== "TSTypeReference")
        return type;
    const name = typeReferenceName(unwrapped);
    if (name === null || resolving.has(name))
        return type;
    const substitution = base.get(name);
    if (substitution === undefined)
        return type;
    return resolvedSubstitutionArgument(substitution, base, new Set([...resolving, name]));
}
export function aliasSubstitution(alias, type, base) {
    const parameters = alias.typeParameters?.params ?? [];
    const typeArguments = type.typeArguments?.params ?? [];
    const next = new Map(base);
    for (const [index, parameter] of parameters.entries()) {
        const argument = typeArguments[index] ?? parameter.default;
        if (argument === null || argument === undefined)
            return null;
        next.set(parameter.name.name, resolvedSubstitutionArgument(argument, next));
    }
    return next;
}
