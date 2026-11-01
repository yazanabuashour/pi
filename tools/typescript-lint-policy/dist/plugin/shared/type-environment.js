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
