import { defineRule } from "@oxlint/plugins";
import { literalStringValue } from "../shared/ast.js";
const NODE_MODULE_ALIASES = new Map([
    ["assert/strict", "Assert"],
    ["fs/promises", "FSP"],
]);
const NODE_SEGMENT_ALIASES = new Map([
    ["fs", "FS"],
    ["os", "OS"],
    ["url", "URL"],
    ["vm", "VM"],
]);
const CALLABLE_DEFAULT_MODULES = new Set(["node:test"]);
function toPascalCase(value) {
    return value
        .split(/[_-]/u)
        .filter((segment) => segment.length > 0)
        .map((segment) => segment[0]?.toUpperCase() + segment.slice(1))
        .join("");
}
function expectedNamespaceAlias(source) {
    const moduleName = source.slice("node:".length);
    const knownAlias = NODE_MODULE_ALIASES.get(moduleName);
    if (knownAlias !== undefined)
        return `Node${knownAlias}`;
    return `Node${moduleName
        .split("/")
        .map((segment) => NODE_SEGMENT_ALIASES.get(segment) ?? toPascalCase(segment))
        .join("")}`;
}
export const namespaceNodeImportsRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Require canonical namespace imports for Node.js built-in modules.",
        },
    },
    create(context) {
        return {
            ImportDeclaration(node) {
                const source = literalStringValue(node.source);
                if (source === null || !source.startsWith("node:"))
                    return;
                const expectedAlias = expectedNamespaceAlias(source);
                const namespaceImport = node.specifiers.length === 1 &&
                    node.specifiers[0]?.type === "ImportNamespaceSpecifier"
                    ? node.specifiers[0]
                    : null;
                const actualAlias = namespaceImport?.local.type === "Identifier"
                    ? namespaceImport.local.name
                    : null;
                if (actualAlias === expectedAlias)
                    return;
                const defaultImport = node.specifiers.length === 1 &&
                    node.specifiers[0]?.type === "ImportDefaultSpecifier"
                    ? node.specifiers[0]
                    : null;
                const defaultAlias = defaultImport?.local.type === "Identifier"
                    ? defaultImport.local.name
                    : null;
                // TypeScript does not model callable CommonJS exports as callable
                // namespace objects under NodeNext module resolution.
                if (CALLABLE_DEFAULT_MODULES.has(source) &&
                    defaultAlias === expectedAlias) {
                    return;
                }
                context.report({
                    node,
                    message: `Import ${source} with its canonical alias ${expectedAlias}.`,
                });
            },
        };
    },
});
