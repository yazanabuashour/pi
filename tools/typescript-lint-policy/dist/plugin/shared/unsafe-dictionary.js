import { resolveType, visibleTypeDeclaration, } from "./type-alias-resolution.js";
import { isBuiltIn, TRANSPARENT_WRAPPERS, typeReferenceName, unwrapTransparentType, } from "./type-environment.js";
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
function unsafeValueVisitor(environment) {
    return function visit(type, resolve) {
        const unwrapped = unwrapTransparentType(type);
        if (unwrapped !== type)
            return resolve(unwrapped, visit);
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
            return unwrapped.types.some((member) => resolve(member, visit) !== null)
                ? "union"
                : null;
        }
        if (unwrapped.type === "TSIntersectionType") {
            const unsafeMembers = unwrapped.types.map((member) => resolve(member, visit));
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
            return wrapped === undefined ? null : resolve(wrapped, visit);
        }
        const declarations = environment.interfaces.get(name);
        return declarations !== undefined &&
            declarations[0] ===
                visibleTypeDeclaration(name, unwrapped, environment.typeAliases) &&
            isEffectivelyEmptyInterface(declarations)
            ? "empty-object"
            : null;
    };
}
export function classifyUnsafeDictionaryValue(valueType, environment) {
    const unsafeValue = resolveType(valueType, environment.typeAliases, unsafeValueVisitor(environment));
    return unsafeValue === null
        ? null
        : { kind: "unsafe-dictionary", unsafeValue };
}
export function classifyUnsafeDictionary(type, environment) {
    const classifyValue = unsafeValueVisitor(environment);
    const visit = (current, resolve) => {
        const unwrapped = unwrapTransparentType(current);
        if (unwrapped !== current)
            return resolve(unwrapped, visit);
        if (unwrapped.type === "TSTypeLiteral") {
            for (const member of unwrapped.members) {
                if (member.type !== "TSIndexSignature" ||
                    member.typeAnnotation === null)
                    continue;
                const value = resolve(member.typeAnnotation.typeAnnotation, classifyValue);
                if (value !== null)
                    return value;
            }
            return null;
        }
        if (unwrapped.type === "TSMappedType") {
            return unwrapped.typeAnnotation === null
                ? null
                : resolve(unwrapped.typeAnnotation, classifyValue);
        }
        if (unwrapped.type !== "TSTypeReference")
            return null;
        const name = typeReferenceName(unwrapped);
        if (name === null || !isBuiltIn(name, unwrapped, environment))
            return null;
        if (TRANSPARENT_WRAPPERS.has(name) || name === "Pick" || name === "Omit") {
            const wrapped = unwrapped.typeArguments?.params[0];
            return wrapped === undefined ? null : resolve(wrapped, visit);
        }
        if (name === "Record") {
            const value = unwrapped.typeArguments?.params[1];
            return value === undefined ? null : resolve(value, classifyValue);
        }
        return null;
    };
    const unsafeValue = resolveType(type, environment.typeAliases, visit);
    return unsafeValue === null
        ? null
        : { kind: "unsafe-dictionary", unsafeValue };
}
