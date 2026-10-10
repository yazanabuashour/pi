import type { ESTree, SourceCode, Variable } from "@oxlint/plugins";
/** Unwrap syntax-only wrappers when inspecting array methods and accumulator references. */
export declare function unwrapArrayExpression(node: ESTree.Node): ESTree.Node;
/** Resolve a local binding by scope, not by identifier spelling. */
export declare function resolveArrayBinding(sourceCode: SourceCode, node: ESTree.Node): Variable | null;
/** Read static method names, including computed string literals, without evaluating expressions. */
export declare function arrayMethodTarget(node: ESTree.Node): {
    readonly name: string;
    readonly object: ESTree.Node;
} | null;
/** Recognize local array evidence; unknown receivers and iterator pipelines are deliberately excluded. */
export declare function isKnownArrayExpression(sourceCode: SourceCode, node: ESTree.Node, visited?: Set<Variable>): boolean;
