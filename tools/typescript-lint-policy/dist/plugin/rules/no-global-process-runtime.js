import { defineRule, } from "@oxlint/plugins";
import { getPropertyName, literalStringValue, unwrapExpression, } from "../shared/ast.js";
const RUNTIME_PROPERTIES = new Set(["platform", "arch"]);
const NODE_OS_MODULES = new Set(["node:os", "os"]);
function normalizePath(path) {
    return path.replaceAll("\\", "/");
}
function repoPath(filename, cwd) {
    const normalizedFilename = normalizePath(filename);
    const normalizedCwd = normalizePath(cwd).replace(/\/+$/u, "");
    const prefix = `${normalizedCwd}/`;
    return normalizedFilename.startsWith(prefix)
        ? normalizedFilename.slice(prefix.length)
        : normalizedFilename;
}
function allowedFiles(options) {
    const [option] = options ?? [];
    if (option === undefined || option === null)
        return [];
    // SAFETY: Oxlint validates this value against the rule schema before create runs.
    const config = option;
    return config.allowFiles ?? [];
}
function isAllowedFile(filename, cwd, allowed) {
    const path = repoPath(filename, cwd);
    return allowed.some((suffix) => path === suffix || path.endsWith(`/${suffix}`));
}
function resolveVariable(sourceCode, identifier) {
    if (identifier.type !== "Identifier")
        return null;
    let scope = sourceCode.getScope(identifier);
    while (scope !== null) {
        const variable = scope.set.get(identifier.name);
        if (variable !== undefined)
            return variable;
        scope = scope.upper;
    }
    return null;
}
function isUnshadowedGlobal(sourceCode, node, name) {
    const expression = unwrapExpression(node);
    if (expression?.type !== "Identifier" || expression.name !== name) {
        return false;
    }
    const variable = resolveVariable(sourceCode, expression);
    return variable === null || variable.defs.length === 0;
}
function isGlobalProcessObject(sourceCode, node) {
    const expression = unwrapExpression(node);
    if (isUnshadowedGlobal(sourceCode, expression ?? node, "process"))
        return true;
    if (expression?.type !== "MemberExpression")
        return false;
    return (isUnshadowedGlobal(sourceCode, expression.object, "globalThis") &&
        getPropertyName(expression.property) === "process");
}
function runtimeMessage(property) {
    return `Inject a project-owned host ${property} contract instead of reading process.${property} directly.`;
}
export const noGlobalProcessRuntimeRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Disallow direct host platform and architecture reads outside declared adapter files.",
        },
        schema: [
            {
                type: "object",
                properties: {
                    allowFiles: {
                        type: "array",
                        items: { type: "string" },
                        uniqueItems: true,
                    },
                },
                additionalProperties: false,
            },
        ],
    },
    create(context) {
        const nodeOsNamespaces = new Set();
        const nodeOsRuntimeImports = new Map();
        const allowed = allowedFiles(context.options);
        function trackImportDeclaration(node) {
            const source = literalStringValue(node.source);
            if (source === null || !NODE_OS_MODULES.has(source))
                return;
            for (const specifier of node.specifiers) {
                const localName = specifier.local.name;
                if (specifier.type === "ImportNamespaceSpecifier" ||
                    specifier.type === "ImportDefaultSpecifier") {
                    nodeOsNamespaces.add(localName);
                    continue;
                }
                const imported = getPropertyName(specifier.imported);
                if (imported !== null && RUNTIME_PROPERTIES.has(imported)) {
                    nodeOsRuntimeImports.set(localName, imported);
                }
            }
        }
        function nodeOsRuntimeCall(callee) {
            const expression = unwrapExpression(callee);
            if (expression?.type === "Identifier") {
                return nodeOsRuntimeImports.get(expression.name) ?? null;
            }
            if (expression?.type !== "MemberExpression")
                return null;
            const object = unwrapExpression(expression.object);
            if (object?.type !== "Identifier" || !nodeOsNamespaces.has(object.name)) {
                return null;
            }
            const property = getPropertyName(expression.property);
            return property !== null && RUNTIME_PROPERTIES.has(property)
                ? property
                : null;
        }
        return {
            ImportDeclaration: trackImportDeclaration,
            MemberExpression(node) {
                if (isAllowedFile(context.filename, context.cwd, allowed))
                    return;
                const property = getPropertyName(node.property);
                if (property === null || !RUNTIME_PROPERTIES.has(property))
                    return;
                if (!isGlobalProcessObject(context.sourceCode, node.object))
                    return;
                context.report({ node, message: runtimeMessage(property) });
            },
            CallExpression(node) {
                if (isAllowedFile(context.filename, context.cwd, allowed))
                    return;
                const property = nodeOsRuntimeCall(node.callee);
                if (property === null)
                    return;
                context.report({ node, message: runtimeMessage(property) });
            },
        };
    },
});
