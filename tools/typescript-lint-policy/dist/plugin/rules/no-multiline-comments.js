import { defineRule } from "@oxlint/plugins";
const legalNotice = /(?:^|\n)[\t ]*(?:\*[\t ]*)?(?:@license\b|@preserve\b|Copyright\b|SPDX-(?:License-Identifier|FileCopyrightText):)/iu;
const toolDirective = /^(?:(?:oxlint|eslint)-(?:disable|enable)(?:-next-line|-line)?\b|@ts-(?:check|nocheck|ignore|expect-error)\b|(?:prettier|oxfmt)-ignore\b|(?:istanbul|c8|v8) ignore\b|[#@] source(?:Mapping)?URL=|<reference\s|@jsx(?:ImportSource|Runtime)?\s)/u;
function isToolDirective(comment) {
    return toolDirective.test(comment.value.replaceAll(/^[\t ]*\*[\t ]?/gmu, "").trim());
}
function exportedDocs(sourceCode) {
    const docs = new Set();
    const addDoc = (node) => {
        const comment = sourceCode.getCommentsBefore(node).at(-1);
        if (comment?.type === "Block" &&
            sourceCode.getText(comment).startsWith("/**")) {
            docs.add(comment);
        }
    };
    const addExport = (statement) => {
        if (statement.type !== "ExportNamedDeclaration" &&
            statement.type !== "ExportDefaultDeclaration")
            return;
        const declaration = statement.declaration;
        if (!declaration || !declaration.type.endsWith("Declaration"))
            return;
        addDoc(statement);
        addDoc(declaration);
        if (declaration.type === "ClassDeclaration") {
            for (const member of declaration.body.body) {
                if (member.type === "StaticBlock" ||
                    (member.type !== "TSIndexSignature" &&
                        (member.accessibility === "private" ||
                            member.key.type === "PrivateIdentifier")))
                    continue;
                addDoc(member);
            }
        }
        else if (declaration.type === "TSInterfaceDeclaration") {
            for (const member of declaration.body.body)
                addDoc(member);
        }
        else if (declaration.type === "TSTypeAliasDeclaration" &&
            declaration.typeAnnotation.type === "TSTypeLiteral") {
            for (const member of declaration.typeAnnotation.members)
                addDoc(member);
        }
        else if (declaration.type === "TSEnumDeclaration") {
            for (const member of declaration.body.members)
                addDoc(member);
        }
        else if (declaration.type === "TSModuleDeclaration" &&
            declaration.body?.type === "TSModuleBlock") {
            for (const member of declaration.body.body)
                addExport(member);
        }
    };
    for (const statement of sourceCode.ast.body)
        addExport(statement);
    return docs;
}
/** Limit prose to one physical line; preserve public API docs, tool directives, and legal notices. */
export const noMultilineCommentsRule = defineRule({
    meta: {
        type: "suggestion",
        docs: {
            description: "Keep ordinary comments on one physical line; reserve longer comments for directly exported API documentation.",
        },
        messages: {
            multiline: "Keep this comment to one physical line. Longer documentation belongs on a directly exported declaration or its public members; history belongs in commits or pull requests.",
        },
        schema: [],
    },
    create(context) {
        return {
            "Program:exit"() {
                const sourceCode = context.sourceCode;
                const docs = exportedDocs(sourceCode);
                const comments = sourceCode.getAllComments();
                for (let index = 0; index < comments.length; index += 1) {
                    const first = comments[index];
                    if (!first)
                        continue;
                    const run = [first];
                    if (first.type === "Line" && !isToolDirective(first)) {
                        while (true) {
                            const next = comments[index + 1];
                            const previous = run.at(-1);
                            if (!next ||
                                !previous ||
                                next.type !== "Line" ||
                                isToolDirective(next) ||
                                next.loc.start.line !== previous.loc.end.line + 1 ||
                                sourceCode.text.slice(previous.end, next.start).trim())
                                break;
                            run.push(next);
                            index += 1;
                        }
                    }
                    if (legalNotice.test(run.map((comment) => comment.value).join("\n")))
                        continue;
                    const prose = run.filter((comment) => !docs.has(comment) &&
                        !isToolDirective(comment) &&
                        comment.type !== "Shebang");
                    const firstProse = prose[0];
                    const lastProse = prose.at(-1);
                    if (!firstProse ||
                        !lastProse ||
                        (prose.length === 1 &&
                            firstProse.loc.start.line === firstProse.loc.end.line))
                        continue;
                    context.report({
                        loc: { start: firstProse.loc.start, end: lastProse.loc.end },
                        messageId: "multiline",
                    });
                }
            },
        };
    },
});
