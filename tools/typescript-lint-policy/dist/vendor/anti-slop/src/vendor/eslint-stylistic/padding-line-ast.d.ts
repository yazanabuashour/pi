import type { ESTree, SourceCode, Token as SyntaxToken, Comment, Location } from "@oxlint/plugins";
type Token = SyntaxToken | Comment;
/** Line terminators recognized by the upstream padding matcher. */
export declare const LINEBREAKS: Set<string>;
/** Test a closing brace without treating comment text as punctuation. */
export declare const isClosingBraceToken: (token: Token) => boolean;
/** Test a semicolon without treating comment text as punctuation. */
export declare const isSemicolonToken: (token: Token) => boolean;
/** Filter the optional final semicolon when identifying block-like statements. */
export declare const isNotSemicolonToken: (token: Token) => boolean;
/** Compare token/node boundaries, including attached comments. */
export declare const isTokenOnSameLine: (left: {
    loc: Location;
}, right: {
    loc: Location;
}) => boolean;
/** Recognize declarations and expressions used by the upstream IIFE matcher. */
export declare const isFunction: (node: ESTree.Node) => boolean;
/** Preserve the upstream multiline statement heuristic. */
export declare const isSingleLine: (node: ESTree.Node) => boolean;
/** Unwrap optional chaining before checking IIFE syntax. */
export declare const skipChainExpression: (node: ESTree.Node) => ESTree.Node;
/** Only a program or function-body expression can begin a directive prologue. */
export declare const isTopLevelExpressionStatement: (node: ESTree.Node) => node is ESTree.ExpressionStatement;
/** A single wrapping pair suffices to exclude a string from directive syntax. */
export declare function isParenthesized(node: ESTree.Node, sourceCode: SourceCode): boolean;
export {};
