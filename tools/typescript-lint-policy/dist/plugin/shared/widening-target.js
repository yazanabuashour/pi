import { visibleTypeAlias } from "./type-alias-resolution.js";
import { aliasSubstitution, isBuiltIn, isUnappliedReferenceTo, TRANSPARENT_WRAPPERS, typeReferenceName, unwrapTransparentType, } from "./type-environment.js";
export function classifyWideningTarget(type, environment) {
    const unwrapped = unwrapTransparentType(type);
    if (unwrapped.type === "TSUnknownKeyword")
        return { kind: "unknown" };
    if (unwrapped.type === "TSObjectKeyword")
        return { kind: "object" };
    if (unwrapped.type === "TSTypeLiteral") {
        return unwrapped.members.some((member) => member.type === "TSIndexSignature")
            ? { kind: "open dictionary" }
            : unwrapped.members.length > 0
                ? { kind: "anonymous object" }
                : null;
    }
    if (unwrapped.type === "TSMappedType")
        return { kind: "open dictionary" };
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
            : classifyWideningTarget(wrapped, environment);
    }
    if (name === "Record" && isBuiltIn(name, unwrapped, environment)) {
        return hasBroadRecordKey(unwrapped, environment, new Map())
            ? { kind: "open dictionary" }
            : null;
    }
    const alias = visibleTypeAlias(name, unwrapped, environment.typeAliases);
    if (alias === null)
        return null;
    if ((alias.typeParameters?.params.length ?? 0) > 0) {
        const substitutions = aliasSubstitution(alias, unwrapped, new Map());
        const resolved = substitutions === null
            ? null
            : classifyAliasBroadTarget(alias.typeAnnotation, environment, substitutions, new Set([name]));
        return resolved?.kind === "open dictionary"
            ? { kind: "generic container" }
            : null;
    }
    const substitutions = aliasSubstitution(alias, unwrapped, new Map());
    if (substitutions === null)
        return null;
    const resolved = classifyAliasBroadTarget(alias.typeAnnotation, environment, substitutions, new Set([name]));
    return resolved;
}
function hasBroadRecordKey(type, environment, substitutions) {
    const key = type.typeArguments?.params[0];
    return key === undefined || isBroadMappedKey(key, environment, substitutions);
}
function isBroadMappedKey(type, environment, substitutions, visitedAliases = new Set()) {
    const unwrapped = unwrapTransparentType(type);
    if (unwrapped.type === "TSStringKeyword" ||
        unwrapped.type === "TSNumberKeyword" ||
        unwrapped.type === "TSSymbolKeyword") {
        return true;
    }
    if (unwrapped.type === "TSUnionType") {
        return unwrapped.types.some((member) => isBroadMappedKey(member, environment, substitutions, visitedAliases));
    }
    if (unwrapped.type !== "TSTypeReference")
        return false;
    const name = typeReferenceName(unwrapped);
    if (name === null)
        return false;
    const substitution = substitutions.get(name);
    if (substitution !== undefined &&
        !isUnappliedReferenceTo(substitution, name)) {
        return isBroadMappedKey(substitution, environment, substitutions, visitedAliases);
    }
    if (name === "PropertyKey" && isBuiltIn(name, unwrapped, environment))
        return true;
    const alias = visibleTypeAlias(name, unwrapped, environment.typeAliases);
    if (alias === null ||
        (alias.typeParameters?.params.length ?? 0) > 0 ||
        visitedAliases.has(name)) {
        return false;
    }
    const nextVisited = new Set(visitedAliases);
    nextVisited.add(name);
    return isBroadMappedKey(alias.typeAnnotation, environment, substitutions, nextVisited);
}
function classifyAliasBroadTarget(type, environment, substitutions, resolvingAliases) {
    const unwrapped = unwrapTransparentType(type);
    if (unwrapped.type === "TSUnknownKeyword")
        return { kind: "unknown" };
    if (unwrapped.type === "TSObjectKeyword")
        return { kind: "object" };
    if (unwrapped.type === "TSTypeLiteral") {
        return unwrapped.members.some((member) => member.type === "TSIndexSignature")
            ? { kind: "open dictionary" }
            : null;
    }
    if (unwrapped.type === "TSMappedType") {
        return isBroadMappedKey(unwrapped.constraint, environment, substitutions)
            ? { kind: "open dictionary" }
            : null;
    }
    if (unwrapped.type !== "TSTypeReference")
        return null;
    const name = typeReferenceName(unwrapped);
    if (name === null)
        return null;
    const substitution = substitutions.get(name);
    if (substitution !== undefined) {
        return isUnappliedReferenceTo(substitution, name)
            ? null
            : classifyAliasBroadTarget(substitution, environment, substitutions, resolvingAliases);
    }
    if (TRANSPARENT_WRAPPERS.has(name) &&
        isBuiltIn(name, unwrapped, environment)) {
        const wrapped = unwrapped.typeArguments?.params[0];
        return wrapped === undefined
            ? null
            : classifyAliasBroadTarget(wrapped, environment, substitutions, resolvingAliases);
    }
    if (name === "Record" && isBuiltIn(name, unwrapped, environment)) {
        return hasBroadRecordKey(unwrapped, environment, substitutions)
            ? { kind: "open dictionary" }
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
    return classifyAliasBroadTarget(alias.typeAnnotation, environment, nextSubstitutions, nextResolving);
}
