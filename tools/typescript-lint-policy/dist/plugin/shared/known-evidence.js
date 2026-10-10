import { containsUnknownType, functionParameterBindingName, functionParameterTypeAnnotation, } from "../../vendor/anti-slop/src/shared/function-parameters.js";
import { classifyUnsafeDictionaryValue, isKnownEvidenceExpression, } from "./dictionary-types.js";
function unwrapExpression(expression) {
    let current = expression;
    while (current.type === "ParenthesizedExpression" ||
        current.type === "TSAsExpression" ||
        current.type === "TSSatisfiesExpression" ||
        current.type === "TSTypeAssertion" ||
        current.type === "TSNonNullExpression") {
        current = current.expression;
    }
    return current;
}
export function resolveVariable(sourceCode, identifier) {
    let scope = sourceCode.getScope(identifier);
    while (scope !== null) {
        const variable = scope.set.get(identifier.name);
        if (variable !== undefined)
            return variable;
        scope = scope.upper;
    }
    return null;
}
export function variableDeclarator(variable) {
    if (variable.defs.length !== 1)
        return null;
    const [definition] = variable.defs;
    return definition?.type === "Variable" &&
        definition.node.type === "VariableDeclarator"
        ? definition.node
        : null;
}
function isStableConstVariable(variable, declarator) {
    return (declarator.parent.type === "VariableDeclaration" &&
        declarator.parent.kind === "const" &&
        variable.references.every((reference) => reference.init || !reference.isWrite()));
}
export function hasKnownEvidence(sourceCode, expression, visitedVariables = new Set()) {
    if (isKnownEvidenceExpression(expression))
        return true;
    const unwrapped = unwrapExpression(expression);
    if (unwrapped.type !== "Identifier")
        return false;
    const variable = resolveVariable(sourceCode, unwrapped);
    if (variable === null || visitedVariables.has(variable))
        return false;
    const declarator = variableDeclarator(variable);
    if (declarator === null ||
        declarator.init === null ||
        !isStableConstVariable(variable, declarator)) {
        return false;
    }
    visitedVariables.add(variable);
    return hasKnownEvidence(sourceCode, declarator.init, visitedVariables);
}
function isFunctionExpression(node) {
    return (node.type === "ArrowFunctionExpression" ||
        node.type === "FunctionDeclaration" ||
        node.type === "FunctionExpression" ||
        node.type === "TSDeclareFunction" ||
        node.type === "TSEmptyBodyFunctionExpression");
}
export function localFunctionForCall(sourceCode, callee) {
    const unwrapped = unwrapExpression(callee);
    if (isFunctionExpression(unwrapped))
        return unwrapped;
    if (unwrapped.type !== "Identifier")
        return null;
    const variable = resolveVariable(sourceCode, unwrapped);
    if (variable === null || variable.defs.length !== 1)
        return null;
    const [definition] = variable.defs;
    if (definition === undefined)
        return null;
    if (definition.type === "FunctionName" &&
        isFunctionExpression(definition.node)) {
        return definition.node;
    }
    if (definition.type !== "Variable" ||
        definition.node.type !== "VariableDeclarator") {
        return null;
    }
    const initializer = definition.node.init;
    if (initializer === null)
        return null;
    const unwrappedInitializer = unwrapExpression(initializer);
    return isFunctionExpression(unwrappedInitializer)
        ? unwrappedInitializer
        : null;
}
function variableTypeAnnotation(sourceCode, variable) {
    if (variable.defs.length !== 1)
        return null;
    const [definition] = variable.defs;
    if (definition === undefined)
        return null;
    if (definition.type === "Variable" &&
        definition.node.type === "VariableDeclarator" &&
        definition.node.id.type === "Identifier") {
        return definition.node.id.typeAnnotation ?? null;
    }
    if (definition.type !== "Parameter" ||
        !isFunctionExpression(definition.node)) {
        return null;
    }
    const parameter = definition.node.params.find((candidate) => functionParameterBindingName(candidate, sourceCode) === variable.name);
    return parameter === undefined
        ? null
        : (functionParameterTypeAnnotation(parameter) ?? null);
}
function hasInformativeType(type, environment) {
    return classifyUnsafeDictionaryValue(type, environment) === null;
}
export function hasKnownCallArgumentEvidence(sourceCode, expression, environment, visitedVariables = new Set()) {
    if (expression.type === "ParenthesizedExpression" ||
        expression.type === "TSNonNullExpression") {
        return hasKnownCallArgumentEvidence(sourceCode, expression.expression, environment, visitedVariables);
    }
    if (expression.type === "TSAsExpression" ||
        expression.type === "TSTypeAssertion") {
        return hasInformativeType(expression.typeAnnotation, environment);
    }
    if (expression.type === "TSSatisfiesExpression") {
        return hasKnownCallArgumentEvidence(sourceCode, expression.expression, environment, visitedVariables);
    }
    if (expression.type === "CallExpression") {
        const owner = localFunctionForCall(sourceCode, expression.callee);
        const returnType = owner?.returnType?.typeAnnotation;
        return (returnType !== undefined && hasInformativeType(returnType, environment));
    }
    if (expression.type !== "Identifier")
        return isKnownEvidenceExpression(expression);
    const variable = resolveVariable(sourceCode, expression);
    if (variable === null || visitedVariables.has(variable))
        return false;
    const annotation = variableTypeAnnotation(sourceCode, variable);
    if (annotation !== null) {
        return hasInformativeType(annotation.typeAnnotation, environment);
    }
    const declarator = variableDeclarator(variable);
    if (declarator === null ||
        declarator.init === null ||
        !isStableConstVariable(variable, declarator)) {
        return false;
    }
    visitedVariables.add(variable);
    return hasKnownCallArgumentEvidence(sourceCode, declarator.init, environment, visitedVariables);
}
function typePredicateSubjectIndex(sourceCode, owner) {
    const predicate = owner.returnType?.typeAnnotation;
    if (predicate?.type !== "TSTypePredicate" ||
        predicate.parameterName.type !== "Identifier") {
        return null;
    }
    const predicateParameterName = predicate.parameterName.name;
    const index = owner.params.findIndex((parameter) => functionParameterBindingName(parameter, sourceCode) ===
        predicateParameterName);
    return index === -1 ? null : index;
}
/** Calls are intentionally limited to explicit, same-file predicate signatures. */
export function knownPredicateArgument(sourceCode, node, environment) {
    if (node.callee.type === "Super" ||
        node.callee.type === "V8IntrinsicExpression")
        return null;
    const owner = localFunctionForCall(sourceCode, node.callee);
    if (owner === null)
        return null;
    const index = typePredicateSubjectIndex(sourceCode, owner);
    if (index === null)
        return null;
    const parameter = owner.params[index];
    const argument = node.arguments[index];
    if (parameter === undefined ||
        argument === undefined ||
        argument.type === "SpreadElement")
        return null;
    const annotation = functionParameterTypeAnnotation(parameter);
    if (!annotation || !containsUnknownType(annotation.typeAnnotation))
        return null;
    if (!hasKnownCallArgumentEvidence(sourceCode, argument, environment))
        return null;
    return {
        owner,
        argument,
        parameter: functionParameterBindingName(parameter, sourceCode),
    };
}
