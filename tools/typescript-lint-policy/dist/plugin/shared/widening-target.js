import { resolveType, visibleTypeAlias, } from "./type-alias-resolution.js";
import { isBuiltIn, TRANSPARENT_WRAPPERS, typeReferenceName, unwrapTransparentType, } from "./type-environment.js";
function broadKeyVisitor(environment) {
    return function visit(type, resolve) {
        const unwrapped = unwrapTransparentType(type);
        if (unwrapped !== type)
            return resolve(unwrapped, visit);
        if (unwrapped.type === "TSStringKeyword" ||
            unwrapped.type === "TSNumberKeyword" ||
            unwrapped.type === "TSSymbolKeyword")
            return true;
        if (unwrapped.type === "TSUnionType") {
            return unwrapped.types.some((member) => resolve(member, visit));
        }
        return (unwrapped.type === "TSTypeReference" &&
            typeReferenceName(unwrapped) === "PropertyKey" &&
            isBuiltIn("PropertyKey", unwrapped, environment));
    };
}
function broadTargetVisitor(environment) {
    const classifyKey = broadKeyVisitor(environment);
    return function visit(type, resolve) {
        const unwrapped = unwrapTransparentType(type);
        if (unwrapped !== type)
            return resolve(unwrapped, visit);
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
            return resolve(unwrapped.constraint, classifyKey)
                ? { kind: "open dictionary" }
                : null;
        }
        if (unwrapped.type !== "TSTypeReference")
            return null;
        const name = typeReferenceName(unwrapped);
        if (name === null || !isBuiltIn(name, unwrapped, environment))
            return null;
        if (TRANSPARENT_WRAPPERS.has(name)) {
            const wrapped = unwrapped.typeArguments?.params[0];
            return wrapped === undefined ? null : resolve(wrapped, visit);
        }
        if (name === "Record") {
            const key = unwrapped.typeArguments?.params[0];
            return key === undefined || resolve(key, classifyKey)
                ? { kind: "open dictionary" }
                : null;
        }
        return null;
    };
}
export function classifyWideningTarget(type, environment) {
    const unwrapped = unwrapTransparentType(type);
    if (unwrapped.type === "TSTypeLiteral") {
        return unwrapped.members.some((member) => member.type === "TSIndexSignature")
            ? { kind: "open dictionary" }
            : unwrapped.members.length > 0
                ? { kind: "anonymous object" }
                : null;
    }
    if (unwrapped.type === "TSMappedType")
        return { kind: "open dictionary" };
    const name = unwrapped.type === "TSTypeReference" ? typeReferenceName(unwrapped) : null;
    if (name !== null &&
        unwrapped.type === "TSTypeReference" &&
        TRANSPARENT_WRAPPERS.has(name) &&
        isBuiltIn(name, unwrapped, environment)) {
        const wrapped = unwrapped.typeArguments?.params[0];
        return wrapped === undefined
            ? null
            : classifyWideningTarget(wrapped, environment);
    }
    const alias = name === null
        ? null
        : visibleTypeAlias(name, unwrapped, environment.typeAliases);
    const resolved = resolveType(unwrapped, environment.typeAliases, broadTargetVisitor(environment));
    if ((alias?.typeParameters?.params.length ?? 0) > 0) {
        return resolved?.kind === "open dictionary"
            ? { kind: "generic container" }
            : null;
    }
    return resolved;
}
