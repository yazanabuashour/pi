import type { ESTree } from "@oxlint/plugins";
import { type TypeAliasEnvironment, type TypeEnvironment } from "./type-environment.ts";
export type ResolvedType = {
    readonly type: ESTree.TSType;
    readonly substitutions: TypeAliasEnvironment;
};
export type UnsafeDictionary = {
    readonly kind: "unsafe-dictionary";
    readonly unsafeValue: "any" | "empty-object" | "object" | "union" | "unknown";
};
export declare function dictionaryValueTypes(type: ESTree.TSType, environment: TypeEnvironment, substitutions: TypeAliasEnvironment, resolvingAliases: ReadonlySet<string>): readonly ResolvedType[];
export declare function classifyUnsafeDictionaryValue(valueType: ESTree.TSType, environment: TypeEnvironment): UnsafeDictionary | null;
export declare function classifyUnsafeDictionary(type: ESTree.TSType, environment: TypeEnvironment): UnsafeDictionary | null;
