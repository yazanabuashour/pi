import { resolvedTypeMatches, } from "./type-alias-resolution.js";
export function resolvesToUnknown(type, environment) {
    return resolvedTypeMatches(type, environment, (resolved, matches) => {
        if (resolved.type === "TSUnknownKeyword")
            return true;
        if (resolved.type === "TSParenthesizedType")
            return matches(resolved.typeAnnotation);
        return resolved.type === "TSUnionType" && resolved.types.some(matches);
    });
}
