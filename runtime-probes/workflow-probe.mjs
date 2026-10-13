import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";

// Load the installed helper so native Pi, not checkout dependencies, owns its SDKs.
const { agent, parallel } = await import(
  NodeURL.pathToFileURL(process.argv[2]).href
);

const schema = {
  type: "object",
  properties: {
    result: {
      const: "dotfiles-native-workflow-completed",
      type: "string",
    },
  },
  required: ["result"],
  additionalProperties: false,
};

const results = await parallel([
  () =>
    agent("Return the synthetic native workflow fixture.", {
      label: "valid",
      model: "dotfiles-package-probe/probe",
      schema,
    }),
  () =>
    agent("Return an invalid synthetic workflow fixture.", {
      label: "invalid",
      model: "dotfiles-package-probe/probe",
      schema,
    }),
  () =>
    agent("Fail the synthetic native workflow fixture.", {
      label: "failure",
      model: "dotfiles-package-probe/probe",
    }),
]);

NodeFS.writeFileSync(process.argv[3], JSON.stringify(results, null, 2));

NodeAssert.equal(results[0].ok, true);

NodeAssert.deepEqual(results[0].structured, {
  result: "dotfiles-native-workflow-completed",
});

NodeAssert.equal(results[1].ok, false);

NodeAssert.equal(results[1].structured, undefined);

NodeAssert.match(results[1].error, /structured_output/);

NodeAssert.equal(results[2].ok, false);

NodeAssert.match(results[2].error, /synthetic workflow provider failure/);

NodeAssert.equal(new Set(results.map((result) => result.sessionId)).size, 3);

NodeAssert.ok(
  results.every((result) => result.model === "dotfiles-package-probe/probe"),
);
