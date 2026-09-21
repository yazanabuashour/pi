import {
  TERMINAL_SHUTDOWN_TIMEOUT_MS,
  type TerminalManagerService,
} from "./manager.ts";
import { runTool, type TerminalRuntime } from "./runtime.ts";
import type { TerminalSnapshot } from "./domain.ts";

export function shutdownSnapshot(
  snapshot: TerminalSnapshot,
  disposalFailure?: string,
): TerminalSnapshot {
  const cleanupIncomplete = [
    snapshot.cleanupIncomplete,
    snapshot.status === "running"
      ? "Process exit not observed at session shutdown"
      : undefined,
    disposalFailure,
  ]
    .filter(Boolean)
    .join("; ");
  return cleanupIncomplete ? { ...snapshot, cleanupIncomplete } : snapshot;
}

export function reportShutdownFailure(
  incomplete: ReadonlyArray<string>,
  disposalFailure: string | undefined,
  unpersisted: number,
) {
  const failures = [
    incomplete.length > 0
      ? `Cleanup incomplete for terminals: ${incomplete.join(", ")}.`
      : undefined,
    disposalFailure,
    unpersisted > 0
      ? `${unpersisted} lifecycle receipt(s) unpersisted.`
      : undefined,
  ].filter(Boolean);
  if (failures.length > 0)
    throw new Error(`Background terminal shutdown: ${failures.join(" ")}`);
}

export async function stopSessionTerminals(
  manager: TerminalManagerService | undefined,
  runtime: TerminalRuntime | undefined,
) {
  const snapshots = manager?.view.beginShutdown() ?? [];
  const ids = snapshots
    .filter((snapshot) => snapshot.status === "running")
    .map((snapshot) => snapshot.id);
  if (manager && runtime && ids.length > 0) {
    try {
      await runTool(runtime, manager.kill(ids), {
        signal: AbortSignal.timeout(TERMINAL_SHUTDOWN_TIMEOUT_MS),
        interruptMessage:
          "Terminal shutdown deadline reached; runtime disposal will attempt remaining cleanup.",
      });
    } catch (error) {
      console.error("background-terminals: shutdown kill failed", error);
    }
  }
  return snapshots;
}

export async function disposeSessionRuntime(
  runtime: TerminalRuntime | undefined,
) {
  if (!runtime) return undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    // Promise.race retains a rejection observer if disposal outlives the wait.
    await Promise.race([
      runtime.dispose(),
      new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(
          () =>
            reject(
              new Error(
                "Runtime disposal deadline reached; cleanup is still unconfirmed",
              ),
            ),
          TERMINAL_SHUTDOWN_TIMEOUT_MS,
        );
      }),
    ]);
    return undefined;
  } catch (error) {
    return `Runtime disposal failed: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    if (deadline !== undefined) clearTimeout(deadline);
  }
}
