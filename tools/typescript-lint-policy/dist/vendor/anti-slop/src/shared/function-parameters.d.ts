import type { ESTree, SourceCode } from "@oxlint/plugins";
export type FunctionParameter = ESTree.ParamPattern;
/** Return whether a type is or contains TypeScript's absorbing unknown top type. */
export declare function containsUnknownType(type: ESTree.TSType): boolean;
/** Return the TypeScript annotation attached to a function parameter or its wrapped binding. */
export declare function functionParameterTypeAnnotation(parameter: FunctionParameter): ESTree.TSTypeAnnotation | null | undefined;
/** Return only a function parameter's local binding, excluding its annotation and default value. */
export declare function functionParameterBindingName(parameter: FunctionParameter, sourceCode: SourceCode): string;
