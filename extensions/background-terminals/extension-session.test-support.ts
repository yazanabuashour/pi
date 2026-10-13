import * as NodeAssert from "node:assert/strict";
import { BackgroundTerminalSession } from "./src/extension-session.ts";
import { runTool } from "./src/runtime.ts";
import { cwd, nodeCmd, pollUntil } from "./manager.test-support.ts";

export async function startSignalHandler(
  session: BackgroundTerminalSession,
  title: string,
  handler: string,
) {
  const manager = await session.getManager();

  const snapshot = await runTool(
    session.getRuntime(),
    manager.start({
      command: `exec ${nodeCmd(`process.on("SIGTERM", () => { ${handler} }); process.stdout.write("ready\\n"); setInterval(() => {}, 1000);`)}`,
      title,
      cwd,
    }),
  );

  NodeAssert.ok(session.recordStart(snapshot));
  NodeAssert.ok(await pollUntil(() => snapshot.stdout.text.includes("ready")));

  return snapshot;
}
