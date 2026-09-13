import * as NodeAssert from "node:assert/strict";
import NodeTest from "node:test";
import { extractMeta, prepareWorkflowScript } from "./meta.ts";

NodeTest(
  "metadata is decoded statically and removed from executable source",
  () => {
    const source = `export const meta = {
    name: "audit",
    description: "safe",
    phases: [{ title: "Scan", detail: "files" }],
  };
  return { ok: true };`;
    const prepared = prepareWorkflowScript(source);
    NodeAssert.deepEqual(prepared.meta, {
      name: "audit",
      description: "safe",
      phases: [{ title: "Scan", detail: "files" }],
    });
    NodeAssert.doesNotMatch(prepared.source, /name:\s*"audit"/);
    NodeAssert.equal(
      prepared.source.split("\n").length,
      source.split("\n").length,
    );
  },
);

NodeTest(
  "export-like text in strings, comments, regexes, and templates is untouched",
  () => {
    const source = `
    const string = "export default notSyntax";
    const template = \`export const meta = \${string}\`;
    const regex = /export\\s+default/;
    // export const fake = 1
    return { string, template, matches: regex.test(string) };
  `;
    const prepared = prepareWorkflowScript(source);
    NodeAssert.equal(prepared.source, source);
    NodeAssert.deepEqual(prepared.meta, { phases: [] });
  },
);

NodeTest("executable and unsupported metadata fail closed", () => {
  NodeAssert.throws(
    () =>
      prepareWorkflowScript(
        `export const meta = { name: (() => "executed")(), phases: [] }; return 1;`,
      ),
    /only static literals/,
  );
  NodeAssert.throws(
    () => prepareWorkflowScript(`export default 1; return 1;`),
    /may only export/,
  );
  NodeAssert.deepEqual(
    extractMeta(`export const meta = { name: process.exit(), phases: [] }`),
    { phases: [] },
  );
});
