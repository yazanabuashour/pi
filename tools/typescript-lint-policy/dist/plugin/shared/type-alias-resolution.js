import { childNodes } from "./ast.js";
import { lexicalTypeParameterBinding } from "./lexical-type-parameters.js";
const environmentsByProgram = new WeakMap();
function enclosingTypeScope(node) {
    let current = node.parent;
    while (current !== null) {
        if (current.type === "Program" ||
            current.type === "BlockStatement" ||
            current.type === "TSModuleBlock" ||
            current.type === "StaticBlock" ||
            current.type === "SwitchStatement") {
            return current;
        }
        current = current.parent;
    }
    return node;
}
function declaredTypeBinding(node) {
    if (node.type === "TSTypeAliasDeclaration" ||
        node.type === "TSInterfaceDeclaration" ||
        node.type === "TSEnumDeclaration" ||
        node.type === "ClassDeclaration" ||
        node.type === "ClassExpression") {
        return node.id === null ? null : { declaration: node, name: node.id.name };
    }
    if (node.type === "ImportSpecifier" ||
        node.type === "ImportDefaultSpecifier" ||
        node.type === "ImportNamespaceSpecifier") {
        return { declaration: node, name: node.local.name };
    }
    return null;
}
function collectTypeBindings(node, visitorKeys, bindingsByName) {
    const declared = declaredTypeBinding(node);
    if (declared !== null) {
        const bindings = bindingsByName.get(declared.name) ?? [];
        bindings.push({
            declaration: declared.declaration,
            scope: node.type === "ClassExpression" ? node : enclosingTypeScope(node),
        });
        bindingsByName.set(declared.name, bindings);
    }
    for (const child of childNodes(node, visitorKeys)) {
        collectTypeBindings(child, visitorKeys, bindingsByName);
    }
}
/** Collect every lexical type alias and competing type binding in a program. */
export function createTypeAliasEnvironment(program, visitorKeys) {
    const cached = environmentsByProgram.get(program);
    if (cached !== undefined)
        return cached;
    const bindingsByName = new Map();
    collectTypeBindings(program, visitorKeys, bindingsByName);
    const environment = { bindingsByName, visitorKeys };
    environmentsByProgram.set(program, environment);
    return environment;
}
function ancestorDistance(ancestor, node) {
    let current = node;
    let distance = 0;
    while (current !== null) {
        if (current === ancestor)
            return distance;
        current = current.parent;
        distance += 1;
    }
    return null;
}
function nearestTypeBindings(name, use, environment) {
    const parameter = lexicalTypeParameterBinding(name, use, environment.visitorKeys);
    const candidates = [
        ...(environment.bindingsByName.get(name) ?? []),
        ...(parameter === null ? [] : [parameter]),
    ];
    let nearestDistance = Number.POSITIVE_INFINITY;
    let nearest = [];
    for (const candidate of candidates) {
        const distance = ancestorDistance(candidate.scope, use);
        if (distance === null || distance > nearestDistance)
            continue;
        if (distance === nearestDistance) {
            nearest.push(candidate);
            continue;
        }
        nearestDistance = distance;
        nearest = [candidate];
    }
    return nearest;
}
/** Resolve the nearest visible alias with this name, respecting lexical shadowing. */
export function visibleTypeAlias(name, use, environment) {
    const bindings = nearestTypeBindings(name, use, environment);
    const declaration = bindings.length === 1 ? bindings[0]?.declaration : null;
    return declaration?.type === "TSTypeAliasDeclaration" ? declaration : null;
}
/** Return whether a local declaration shadows a built-in type at this use. */
export function hasVisibleTypeBinding(name, use, environment) {
    return nearestTypeBindings(name, use, environment).length > 0;
}
function typeReferenceName(type) {
    return type.typeName.type === "Identifier" ? type.typeName.name : null;
}
function aliasSubstitutions(alias, reference, base, resolvingAliases) {
    const parameters = alias.typeParameters?.params ?? [];
    const arguments_ = reference.typeArguments?.params ?? [];
    const next = new Map(base);
    for (const [index, parameter] of parameters.entries()) {
        const explicitArgument = arguments_[index];
        const argument = explicitArgument ?? parameter.default;
        if (argument === null || argument === undefined)
            return null;
        // Explicit arguments belong to the caller; defaults belong to this alias.
        const argumentSubstitutions = explicitArgument === undefined ? next : base;
        next.set(parameter, {
            type: argument,
            substitutions: new Map(argumentSubstitutions),
            resolvingAliases: explicitArgument === undefined
                ? new Set([...resolvingAliases, alias])
                : resolvingAliases,
        });
    }
    return next;
}
/** Match a type after resolving visible aliases and substituting their type parameters. */
export function resolvedTypeMatches(type, environment, matcher) {
    const evaluate = (current, substitutions, resolvingAliases) => {
        if (current.type === "TSTypeReference") {
            const name = typeReferenceName(current);
            if (name !== null) {
                const bindings = nearestTypeBindings(name, current, environment);
                const declaration = bindings.length === 1 ? bindings[0]?.declaration : null;
                const substitution = declaration == null ? undefined : substitutions.get(declaration);
                if (substitution !== undefined &&
                    !current.typeArguments?.params.length) {
                    // Resume the argument's caller context, not the alias body's cycle guard.
                    return evaluate(substitution.type, substitution.substitutions, substitution.resolvingAliases);
                }
                const alias = declaration?.type === "TSTypeAliasDeclaration" ? declaration : null;
                if (alias !== null && !resolvingAliases.has(alias)) {
                    const nextSubstitutions = aliasSubstitutions(alias, current, substitutions, resolvingAliases);
                    if (nextSubstitutions !== null) {
                        const nextResolving = new Set(resolvingAliases);
                        nextResolving.add(alias);
                        return evaluate(alias.typeAnnotation, nextSubstitutions, nextResolving);
                    }
                }
            }
        }
        return matcher(current, (child) => evaluate(child, substitutions, resolvingAliases));
    };
    return evaluate(type, new Map(), new Set());
}
