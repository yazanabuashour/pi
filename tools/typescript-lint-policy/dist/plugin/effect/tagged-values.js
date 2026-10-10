import { isInsideBroadEffectHandler as upstreamIsInsideBroadEffectHandler } from "../../vendor/anti-slop/src/effect/shared/tagged-values.js";
/** Upstream skips declaration boundaries; every function owns its own branches. */
export function isInsideBroadEffectHandler(node) {
    let current = node.parent;
    while (current !== null && current !== undefined) {
        if (current.type === "FunctionDeclaration")
            return false;
        if (current.type === "ArrowFunctionExpression" ||
            current.type === "FunctionExpression") {
            return upstreamIsInsideBroadEffectHandler(node);
        }
        current = current.parent;
    }
    return false;
}
