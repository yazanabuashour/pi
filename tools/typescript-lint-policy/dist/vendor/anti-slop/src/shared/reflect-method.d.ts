import type { ESTree, SourceCode } from "@oxlint/plugins";
/** Reports whether a call target names one method on the global Reflect object. */
export declare function isGlobalReflectMethodCall(sourceCode: SourceCode, callee: ESTree.Expression, methodName: string): boolean;
