import type { ESTree } from "@oxlint/plugins";
export type BroadTypeKind = "top" | "object" | "record";
export type KnownValueEvidence = {
    readonly type: ESTree.TSType | null;
};
export declare function unwrapExpressionParentheses(expression: ESTree.Expression): ESTree.Expression;
export declare function broadTypeKind(type: ESTree.TSType): BroadTypeKind | null;
export declare function assertedExpression(node: ESTree.TSAsExpression | ESTree.TSTypeAssertion): ESTree.Expression;
export declare function assertionFromExpression(expression: ESTree.Expression): ESTree.TSAsExpression | ESTree.TSTypeAssertion | null;
export declare function assertionIsNarrower(sourceText: string, broadKind: BroadTypeKind, evidence: KnownValueEvidence, assertedType: ESTree.TSType): boolean;
