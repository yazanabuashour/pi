import * as NodePath from "node:path";
import {
  DefaultResourceLoader,
  getAgentDir,
  ProjectTrustStore,
  SettingsManager,
  type AgentSession,
  type SessionShutdownEvent,
} from "@earendil-works/pi-coding-agent";

const CHILD_SHUTDOWN_TIMEOUT_MS = 5_000;

/** Tools that headless children must not receive. Everything else stays enabled. */
export const CHILD_EXCLUDED_TOOL_NAMES = [
  "swarm_spawn",
  "swarm_send",
  "swarm_wait",
  "swarm_cancel",
  "swarm_check",
  "swarm_list",
  "workflow",
  "ask_user",
] as const;

/** Fresh SDK options avoid turning the denylist into an accidental allowlist. */
export function childToolPolicy(allowedCustomToolNames: string[] = []) {
  return {
    excludeTools: CHILD_EXCLUDED_TOOL_NAMES.filter(
      (name) => !allowedCustomToolNames.includes(name),
    ),
  };
}

export interface ChildResourceOptions {
  cwd: string;
  projectTrusted: boolean;
  appendSystemPrompt?: string[];
  agentDir?: string;
}

function snapshotSettingsManager(
  source: SettingsManager,
  projectTrusted: boolean,
) {
  const errors = source.drainErrors();
  if (errors.length > 0) {
    const details = errors
      .map(({ scope, error }) => `${scope}: ${error.message}`)
      .join("; ");
    throw new AggregateError(
      errors.map(({ error }) => error),
      `Could not load child settings: ${details}`,
    );
  }
  const settings = {
    global: JSON.stringify(source.getGlobalSettings()),
    project: JSON.stringify(source.getProjectSettings()),
  };
  return SettingsManager.fromStorage(
    {
      withLock(scope, update) {
        const next = update(settings[scope]);
        if (next !== undefined) settings[scope] = next;
      },
    },
    { projectTrusted },
  );
}

/** Load normal resources with a settings snapshot that children cannot persist. */
export async function createChildResources(options: ChildResourceOptions) {
  const agentDir = options.agentDir ?? getAgentDir();
  const settingsManager = snapshotSettingsManager(
    SettingsManager.create(options.cwd, agentDir, {
      projectTrusted: options.projectTrusted,
    }),
    options.projectTrusted,
  );
  const loaderOptions: ConstructorParameters<typeof DefaultResourceLoader>[0] =
    {
      cwd: options.cwd,
      agentDir,
      settingsManager,
      extensionsOverride: (base) => ({
        ...base,
        extensions: base.extensions.filter(
          (extension) =>
            !extension.resolvedPath.endsWith(
              "/runtime-probes/automation-telemetry.ts",
            ) && !extension.resolvedPath.endsWith("/extensions/swarm/index.ts"),
        ),
      }),
    };
  if (options.appendSystemPrompt)
    loaderOptions.appendSystemPrompt = options.appendSystemPrompt;
  const loader = new DefaultResourceLoader(loaderOptions);
  await loader.reload();
  return { loader, settingsManager };
}

/**
 * Same-directory children inherit the live parent decision. An alternate cwd
 * is trusted only when Pi's persisted trust store explicitly trusts it (or a
 * containing directory); unreadable/invalid trust data fails closed.
 */
export function resolveStandaloneChildProjectTrust(options: {
  parentCwd: string;
  childCwd: string;
  parentTrusted: boolean;
  agentDir?: string;
}) {
  if (
    NodePath.resolve(options.childCwd) === NodePath.resolve(options.parentCwd)
  ) {
    return options.parentTrusted;
  }
  try {
    const trustStore = new ProjectTrustStore(options.agentDir ?? getAgentDir());
    return trustStore.get(options.childCwd) === true;
  } catch {
    return false;
  }
}

/** Start child extension session hooks/resources in headless print mode. */
export async function bindChildSessionExtensions(
  session: Pick<AgentSession, "bindExtensions">,
) {
  await session.bindExtensions({ mode: "print" });
}

interface ChildExtensionRunner {
  hasHandlers(eventType: string): boolean;
  emit(event: SessionShutdownEvent): Promise<void>;
}

export interface DisposableChildSession {
  readonly extensionRunner: ChildExtensionRunner;
  dispose(): void;
}

const childShutdowns = new WeakMap<object, Promise<void>>();

export function waitBounded(operation: Promise<unknown>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  return Promise.race([
    operation.then(
      () => undefined,
      () => undefined,
    ),
    timeout,
  ])
    .catch(() => {})
    .finally(() => {
      if (timer) clearTimeout(timer);
    });
}

/**
 * Emit child session_shutdown once, then dispose once. Hook failures and a
 * bounded hook deadline never prevent disposal.
 */
export function shutdownAndDisposeChildSession(
  session: DisposableChildSession,
  options: { timeoutMs?: number } = {},
) {
  const existing = childShutdowns.get(session);
  if (existing) return existing;

  const shutdown = (async () => {
    try {
      if (session.extensionRunner.hasHandlers("session_shutdown")) {
        await waitBounded(
          session.extensionRunner.emit({
            type: "session_shutdown",
            reason: "quit",
          }),
          options.timeoutMs ?? CHILD_SHUTDOWN_TIMEOUT_MS,
        );
      }
    } catch {
      // Extension runner inspection/emission is best-effort during teardown.
    } finally {
      try {
        session.dispose();
      } catch {
        // Disposal is terminal and must remain idempotent for callers.
      }
    }
  })();

  childShutdowns.set(session, shutdown);
  return shutdown;
}
