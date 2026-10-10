import type { ESTree, SourceCode, Variable } from "@oxlint/plugins";
/** Resolve an identifier to its binding by walking lexical scopes upward. */
export declare function resolveVariable(sourceCode: SourceCode, identifier: ESTree.IdentifierReference): Variable | null;
