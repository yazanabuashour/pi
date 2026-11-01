import type { ESTree, SourceCode, Variable } from "@oxlint/plugins";
import type { TypeEnvironment } from "./type-environment.ts";
export type FunctionExpression = ESTree.ArrowFunctionExpression | ESTree.Function;
export type FunctionSignature = FunctionExpression | ESTree.TSFunctionType;
export declare function resolveVariable(sourceCode: SourceCode, identifier: ESTree.IdentifierReference): Variable | null;
export declare function variableDeclarator(variable: Variable): ESTree.VariableDeclarator | null;
export declare function hasKnownEvidence(sourceCode: SourceCode, expression: ESTree.Expression, visitedVariables?: Set<Variable>): boolean;
export declare function localFunctionForCall(sourceCode: SourceCode, callee: ESTree.Expression): FunctionSignature | null;
export declare function hasKnownCallArgumentEvidence(sourceCode: SourceCode, expression: ESTree.Expression, environment: TypeEnvironment, visitedVariables?: Set<Variable>): boolean;
/** Calls are intentionally limited to explicit, same-file predicate signatures. */
export declare function knownPredicateArgument(sourceCode: SourceCode, node: ESTree.CallExpression, environment: TypeEnvironment): {
    owner: FunctionSignature;
    argument: ESTree.Expression;
    parameter: string;
} | null;
