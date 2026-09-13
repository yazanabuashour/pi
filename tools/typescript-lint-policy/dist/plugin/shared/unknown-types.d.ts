import type { ESTree } from "@oxlint/plugins";
import { type TypeAliasEnvironment } from "./type-alias-resolution.ts";
export declare function resolvesToUnknown(type: ESTree.TSType, environment: TypeAliasEnvironment): boolean;
