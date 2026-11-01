import type { ESTree } from "@oxlint/plugins";
import { type TypeAliasEnvironment } from "./type-alias-resolution.ts";
export declare const TRANSPARENT_WRAPPERS: Set<string>;
export type TypeEnvironment = {
    readonly interfaces: ReadonlyMap<string, readonly ESTree.TSInterfaceDeclaration[]>;
    readonly typeAliases: TypeAliasEnvironment;
};
export declare function createTypeEnvironment(program: ESTree.Program, visitorKeys: Readonly<Record<string, readonly string[]>>): TypeEnvironment;
export declare function typeReferenceName(type: ESTree.TSTypeReference): string | null;
export declare function isBuiltIn(name: string, use: ESTree.Node, environment: TypeEnvironment): boolean;
export declare function unwrapTransparentType(type: ESTree.TSType): ESTree.TSType;
