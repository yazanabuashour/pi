import { visibleTypeAlias } from "./type-alias-resolution.js";
import { aliasSubstitution, isBuiltIn, isUnappliedReferenceTo, TRANSPARENT_WRAPPERS, typeReferenceName, unwrapTransparentType, } from "./type-environment.js";
function isNeverType(type) {
    return unwrapTransparentType(type).type === "TSNeverKeyword";
}
function isEffectivelyEmptyMember(member) {
    return (member.type === "TSPropertySignature" &&
        member.optional === true &&
        member.typeAnnotation !== null &&
        member.typeAnnotation !== undefined &&
        isNeverType(member.typeAnnotation.typeAnnotation));
}
function isEffectivelyEmptyTypeLiteral(type) {
    return (type.members.length === 0 || type.members.every(isEffectivelyEmptyMember));
}
function isEffectivelyEmptyInterface(declarations) {
    if (declarations.length !== 1)
        return false;
    const [type] = declarations;
    return (type !== undefined &&
        type.extends.length === 0 &&
        (type.body.body.length === 0 ||
            type.body.body.every(isEffectivelyEmptyMember)));
}
function unsafeDirectValue(type, environment, substitutions, resolvingAliases) {
    const unwrapped = unwrapTransparentType(type);
    if (unwrapped.type === "TSUnknownKeyword")
        return "unknown";
    if (unwrapped.type === "TSAnyKeyword")
        return "any";
    if (unwrapped.type === "TSObjectKeyword")
        return "object";
    if (unwrapped.type === "TSTypeLiteral" &&
        isEffectivelyEmptyTypeLiteral(unwrapped))
        return "empty-object";
    if (unwrapped.type === "TSUnionType") {
        return unwrapped.types.some((member) => unsafeDirectValue(member, environment, substitutions, resolvingAliases) !== null)
            ? "union"
            : null;
    }
    if (unwrapped.type === "TSIntersectionType") {
        const unsafeMembers = unwrapped.types.map((member) => unsafeDirectValue(member, environment, substitutions, resolvingAliases));
        if (unsafeMembers.includes("any"))
            return "any";
        return unsafeMembers.length > 0 &&
            unsafeMembers.every((member) => member !== null)
            ? (unsafeMembers[0] ?? null)
            : null;
    }
    if (unwrapped.type !== "TSTypeReference")
        return null;
    const name = typeReferenceName(unwrapped);
    if (name === null)
        return null;
    if (TRANSPARENT_WRAPPERS.has(name) &&
        isBuiltIn(name, unwrapped, environment)) {
        const wrapped = unwrapped.typeArguments?.params[0];
        return wrapped === undefined
            ? null
            : unsafeDirectValue(wrapped, environment, substitutions, resolvingAliases);
    }
    const substitution = substitutions.get(name);
    if (substitution !== undefined) {
        return isUnappliedReferenceTo(substitution, name)
            ? null
            : unsafeDirectValue(substitution, environment, substitutions, resolvingAliases);
    }
    const interfaceDeclarations = environment.interfaces.get(name);
    if (interfaceDeclarations !== undefined) {
        return isEffectivelyEmptyInterface(interfaceDeclarations)
            ? "empty-object"
            : null;
    }
    const alias = visibleTypeAlias(name, unwrapped, environment.typeAliases);
    if (alias === null || resolvingAliases.has(name))
        return null;
    const nextSubstitutions = aliasSubstitution(alias, unwrapped, substitutions);
    if (nextSubstitutions === null)
        return null;
    const nextResolving = new Set(resolvingAliases);
    nextResolving.add(name);
    return unsafeDirectValue(alias.typeAnnotation, environment, nextSubstitutions, nextResolving);
}
export function dictionaryValueTypes(type, environment, substitutions, resolvingAliases) {
    const unwrapped = unwrapTransparentType(type);
    if (unwrapped.type === "TSTypeLiteral") {
        return unwrapped.members.flatMap((member) => member.type === "TSIndexSignature" && member.typeAnnotation !== null
            ? [{ type: member.typeAnnotation.typeAnnotation, substitutions }]
            : []);
    }
    if (unwrapped.type === "TSMappedType") {
        return unwrapped.typeAnnotation === null
            ? []
            : [{ type: unwrapped.typeAnnotation, substitutions }];
    }
    if (unwrapped.type !== "TSTypeReference")
        return [];
    const name = typeReferenceName(unwrapped);
    if (name === null)
        return [];
    const substitution = substitutions.get(name);
    if (substitution !== undefined) {
        return isUnappliedReferenceTo(substitution, name)
            ? []
            : dictionaryValueTypes(substitution, environment, substitutions, resolvingAliases);
    }
    if (TRANSPARENT_WRAPPERS.has(name) &&
        isBuiltIn(name, unwrapped, environment)) {
        const wrapped = unwrapped.typeArguments?.params[0];
        return wrapped === undefined
            ? []
            : dictionaryValueTypes(wrapped, environment, substitutions, resolvingAliases);
    }
    if (name === "Record" && isBuiltIn(name, unwrapped, environment)) {
        const value = unwrapped.typeArguments?.params[1] ?? null;
        return value === null ? [] : [{ type: value, substitutions }];
    }
    if ((name === "Pick" || name === "Omit") &&
        isBuiltIn(name, unwrapped, environment)) {
        const source = unwrapped.typeArguments?.params[0];
        return source === undefined
            ? []
            : dictionaryValueTypes(source, environment, substitutions, resolvingAliases);
    }
    const alias = visibleTypeAlias(name, unwrapped, environment.typeAliases);
    if (alias === null || resolvingAliases.has(name))
        return [];
    const nextSubstitutions = aliasSubstitution(alias, unwrapped, substitutions);
    if (nextSubstitutions === null)
        return [];
    const nextResolving = new Set(resolvingAliases);
    nextResolving.add(name);
    return dictionaryValueTypes(alias.typeAnnotation, environment, nextSubstitutions, nextResolving);
}
export function classifyUnsafeDictionaryValue(valueType, environment) {
    const unsafeValue = unsafeDirectValue(valueType, environment, new Map(), new Set());
    return unsafeValue === null
        ? null
        : { kind: "unsafe-dictionary", unsafeValue };
}
export function classifyUnsafeDictionary(type, environment) {
    for (const valueType of dictionaryValueTypes(type, environment, new Map(), new Set())) {
        const unsafeValue = unsafeDirectValue(valueType.type, environment, valueType.substitutions, new Set());
        if (unsafeValue !== null)
            return { kind: "unsafe-dictionary", unsafeValue };
    }
    return null;
}
