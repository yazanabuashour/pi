import type { ESTree, Variable } from "@oxlint/plugins";
import { type BroadTypeKind, type KnownValueEvidence } from "./widening-assertion-types.ts";
type Scopes = readonly {
    readonly references: readonly {
        readonly identifier: ESTree.Node;
        readonly resolved: Variable | null;
    }[];
}[];
export type WidenedBinding = {
    readonly broadKind: BroadTypeKind;
    readonly evidence: KnownValueEvidence;
    readonly declaredAt: number;
    readonly boundary: ESTree.Node | null;
};
export declare function functionBoundary(node: ESTree.Node): ESTree.Node | null;
export declare function resolvedVariableForIdentifier(scopes: Scopes, identifier: ESTree.IdentifierReference): Variable | null;
export declare function widenedBinding(variable: Variable, scopes: Scopes): WidenedBinding | null;
export {};
