import type { ESTree } from "@oxlint/plugins";
import { type TypeEnvironment } from "./type-environment.ts";
export type UnsafeDictionary = {
    readonly kind: "unsafe-dictionary";
    readonly unsafeValue: "any" | "empty-object" | "object" | "union" | "unknown";
};
export declare function classifyUnsafeDictionaryValue(valueType: ESTree.TSType, environment: TypeEnvironment): UnsafeDictionary | null;
export declare function classifyUnsafeDictionary(type: ESTree.TSType, environment: TypeEnvironment): UnsafeDictionary | null;
