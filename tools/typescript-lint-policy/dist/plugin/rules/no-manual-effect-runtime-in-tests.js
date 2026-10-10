import { defineRule } from "@oxlint/plugins";
import { getPropertyName, isIdentifier, unwrapExpression, } from "../shared/ast.js";
const TEST_FILE_PATTERN = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;
const EFFECT_RUNTIME_METHODS = new Set([
    "runCallback",
    "runCallbackWith",
    "runFork",
    "runForkWith",
    "runPromise",
    "runPromiseExit",
    "runPromiseExitWith",
    "runPromiseWith",
    "runSync",
    "runSyncExit",
    "runSyncExitWith",
    "runSyncWith",
]);
function manualRunnerName(callee) {
    const expression = unwrapExpression(callee);
    if (expression?.type !== "MemberExpression")
        return null;
    const object = unwrapExpression(expression.object);
    const property = getPropertyName(expression.property);
    if (property === null)
        return null;
    if (isIdentifier(object, "Effect") && EFFECT_RUNTIME_METHODS.has(property)) {
        return `Effect.${property}`;
    }
    return isIdentifier(object, "ManagedRuntime") && property === "make"
        ? "ManagedRuntime.make"
        : null;
}
export const noManualEffectRuntimeInTestsRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Disallow manually creating or running Effect runtimes in tests.",
        },
    },
    create(context) {
        if (!TEST_FILE_PATTERN.test(context.filename))
            return {};
        return {
            CallExpression(node) {
                const runner = manualRunnerName(node.callee);
                if (runner === null)
                    return;
                context.report({
                    node: node.callee,
                    message: `Do not use ${runner} in tests. Use @effect/vitest with it.effect(...) and test layers instead.`,
                });
            },
        };
    },
});
