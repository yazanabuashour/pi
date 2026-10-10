import type { ESTree } from "@oxlint/plugins";
import { type TypeEnvironment } from "./type-environment.ts";
export type WideningTargetKind = "anonymous object" | "generic container" | "object" | "open dictionary" | "unknown";
export type WideningTarget = {
    readonly kind: WideningTargetKind;
};
export declare function classifyWideningTarget(type: ESTree.TSType, environment: TypeEnvironment): WideningTarget | null;
