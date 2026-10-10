import type { ESTree } from "@oxlint/plugins";
import { type VisitorKeys } from "./ast.ts";
/** Find the nearest lexical type parameter and the scope where it binds. */
export declare function lexicalTypeParameterBinding(name: string, node: ESTree.Node, visitorKeys: VisitorKeys): {
    readonly declaration: ESTree.Node;
    readonly scope: ESTree.Node;
} | null;
