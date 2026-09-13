import type { TerminalSnapshot } from "./src/domain.ts";
import { TerminalManager, type TerminalManagerService } from "./src/manager.ts";
import { createTerminalRuntime } from "./src/runtime.ts";

export const cwd = process.cwd();

export function nodeCmd(script: string) {
  return `node -e '${script}'`;
}

export async function withManager(
  run: (
    manager: TerminalManagerService,
    runtime: ReturnType<typeof createTerminalRuntime>,
  ) => Promise<void>,
) {
  const runtime = createTerminalRuntime();
  try {
    const manager = await runtime.runPromise(TerminalManager);
    await run(manager, runtime);
  } finally {
    await runtime.dispose();
  }
}

export function settlement(manager: TerminalManagerService, id: string) {
  return new Promise<{ snap: TerminalSnapshot; consumed: boolean }>(
    (resolve) => {
      const existing = manager.view.get(id);
      if (existing && existing.status !== "running") {
        resolve({ snap: existing, consumed: false });
        return;
      }
      const unsubscribe = manager.view.subscribeTo(id, () => {
        const snapshot = manager.view.get(id);
        if (snapshot && snapshot.status !== "running") {
          unsubscribe();
          resolve({ snap: snapshot, consumed: false });
        }
      });
    },
  );
}

export function processGone(pid: number) {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}

export async function pollUntil(check: () => boolean, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return true;
}
