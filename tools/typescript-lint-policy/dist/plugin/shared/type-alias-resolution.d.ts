import type { ESTree } from "@oxlint/plugins";
import { type VisitorKeys } from "./ast.ts";
type TypeScope = ESTree.Node;
type TypeBinding = {
    readonly declaration: ESTree.Node;
    readonly scope: TypeScope;
};
export type TypeAliasEnvironment = {
    readonly bindingsByName: ReadonlyMap<string, readonly TypeBinding[]>;
    readonly visitorKeys: VisitorKeys;
};
export type ResolvedTypeMatcher = (type: ESTree.TSType, matches: (child: ESTree.TSType) => boolean) => boolean;
/** Collect every lexical type alias and competing type binding in a program. */
export declare function createTypeAliasEnvironment(program: ESTree.Program, visitorKeys: VisitorKeys): TypeAliasEnvironment;
/** Resolve the nearest visible alias with this name, respecting lexical shadowing. */
export declare function visibleTypeAlias(name: string, use: ESTree.Node, environment: TypeAliasEnvironment): ESTree.TSTypeAliasDeclaration | null;
/** Return whether a local declaration shadows a built-in type at this use. */
export declare function hasVisibleTypeBinding(name: string, use: ESTree.Node, environment: TypeAliasEnvironment): boolean;
/** Match a type after resolving visible aliases and substituting their type parameters. */
export declare function resolvedTypeMatches(type: ESTree.TSType, environment: TypeAliasEnvironment, matcher: ResolvedTypeMatcher): boolean;
export {};
