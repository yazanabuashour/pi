import type { ESTree } from "@oxlint/plugins";
/** Upstream skips declaration boundaries; every function owns its own branches. */
export declare function isInsideBroadEffectHandler(node: ESTree.Node): boolean;
