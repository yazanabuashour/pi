import * as NodeAssert from "node:assert/strict";
import NodeTest from "node:test";
import { runCommand } from "./src/process.ts";
import { createRuntime } from "./src/runtime.ts";

const runtime = createRuntime();

NodeTest.after(async () => {
  await runtime.dispose();
});

const runNode = (source: string, timeout = 1_000) =>
  runtime.runPromise(
    runCommand(
      process.execPath,
      ["--input-type=module", "--eval", source],
      process.cwd(),
      timeout,
    ),
  );

NodeTest("captures output and tolerates command failures", async () => {
  const success = await runNode(
    'process.stdout.write("out"); process.stderr.write("err")',
  );
  NodeAssert.deepEqual(success, { code: 0, stderr: "err", stdout: "out" });

  const failure = await runNode("process.exitCode = 7");
  NodeAssert.equal(failure.code, 7);
});

NodeTest(
  "renders platform failures without making callers handle them",
  async () => {
    const command = "git-info-command-that-does-not-exist";
    const result = await runtime.runPromise(
      runCommand(command, [], process.cwd(), 1_000),
    );

    NodeAssert.equal(result.code, 1);
    NodeAssert.match(result.stderr, new RegExp(`Failed to run ${command}:`));
    NodeAssert.match(result.stderr, /NotFound|not found|ENOENT/i);
  },
);

NodeTest("reports command timeouts as failures", async () => {
  const result = await runNode("setTimeout(() => {}, 1_000)", 20);
  NodeAssert.equal(result.code, -1);
});
