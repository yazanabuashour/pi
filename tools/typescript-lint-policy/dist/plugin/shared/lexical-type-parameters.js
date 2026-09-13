import { childNodes } from "./ast.js";
function inferTypeParameter(name, node, visitorKeys) {
    if (node.type === "TSInferType" && node.typeParameter.name.name === name)
        return node.typeParameter;
    for (const child of childNodes(node, visitorKeys)) {
        const parameter = inferTypeParameter(name, child, visitorKeys);
        if (parameter !== null)
            return parameter;
    }
    return null;
}
/** Find the nearest lexical type parameter and the scope where it binds. */
export function lexicalTypeParameterBinding(name, node, visitorKeys) {
    let descendant = node;
    let current = node;
    while (current !== null && current.type !== "Program") {
        if ("typeParameters" in current) {
            const parameter = current.typeParameters?.params.find((parameter) => parameter.name.name === name);
            if (parameter !== undefined)
                return { declaration: parameter, scope: current };
        }
        if (current.type === "TSMappedType" &&
            current.key.name === name &&
            (descendant === current.nameType || descendant === current.typeAnnotation)) {
            return { declaration: current.key, scope: current };
        }
        if (current.type === "TSConditionalType" &&
            descendant === current.trueType) {
            const parameter = inferTypeParameter(name, current.extendsType, visitorKeys);
            if (parameter !== null)
                return { declaration: parameter, scope: current };
        }
        descendant = current;
        current = current.parent;
    }
    return null;
}
