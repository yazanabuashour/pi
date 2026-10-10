import type { ESTree } from "@oxlint/plugins";
import { type TypeAliasEnvironment as LexicalTypeAliasEnvironment } from "./type-alias-resolution.ts";
export declare const TRANSPARENT_WRAPPERS: Set<string>;
export type TypeAliasEnvironment = ReadonlyMap<string, ESTree.TSType>;
export type TypeEnvironment = {
    readonly interfaces: ReadonlyMap<string, readonly ESTree.TSInterfaceDeclaration[]>;
    readonly typeAliases: LexicalTypeAliasEnvironment;
};
export declare function createTypeEnvironment(program: ESTree.Program, visitorKeys: Readonly<Record<string, readonly string[]>>): TypeEnvironment;
export declare function typeReferenceName(type: ESTree.TSTypeReference): string | null;
export declare function isBuiltIn(name: string, use: ESTree.Node, environment: TypeEnvironment): boolean;
export declare function unwrapTransparentType(type: ESTree.TSType): ESTree.TSType;
export declare function isUnappliedReferenceTo(type: ESTree.TSType, name: string): boolean;
export declare function aliasSubstitution(alias: ESTree.TSTypeAliasDeclaration, type: ESTree.TSTypeReference, base: TypeAliasEnvironment): TypeAliasEnvironment | null;
