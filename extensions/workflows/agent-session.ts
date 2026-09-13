import type { RuntimeValue } from "../shared/runtime-values.ts";
import type {
  AgentSession,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  createAgentSession,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Data, Effect } from "effect";
import {
  bindChildSessionExtensions,
  childToolPolicy,
  createChildResources,
  shutdownAndDisposeChildSession,
} from "../shared/child-session.ts";
import { STRUCTURED_OUTPUT_SYSTEM_INSTRUCTION } from "./prompt.ts";
import {
  errorText,
  guardWorkflowChildTools,
  createStructuredOutputTool,
  type RunAgentOptions,
} from "./runner.ts";

class AgentSetupError extends Data.TaggedError("AgentSetupError")<{
  message: string;
  cause: unknown;
}> {}

interface WorkflowSession {
  session: AgentSession;
  unsubscribeToolTimeout: () => void;
}

async function dispose(created: WorkflowSession) {
  try {
    created.unsubscribeToolTimeout();
  } finally {
    await shutdownAndDisposeChildSession(created.session);
  }
}

function acquireSession(
  options: RunAgentOptions,
  captureStructured: (value: RuntimeValue) => void,
) {
  return Effect.callback<WorkflowSession, AgentSetupError>((resume, signal) => {
    const operation = Promise.resolve().then(async () => {
      signal.throwIfAborted();
      if (!options.model)
        throw new Error("Workflow requires a model in the calling thread");
      const customTools: ToolDefinition[] | undefined =
        options.schema === undefined
          ? undefined
          : [createStructuredOutputTool(options.schema, captureStructured)];
      const resourceOptions: Parameters<typeof createChildResources>[0] = {
        cwd: options.cwd,
        projectTrusted: options.projectTrusted,
      };
      if (options.schema !== undefined)
        resourceOptions.appendSystemPrompt = [
          STRUCTURED_OUTPUT_SYSTEM_INSTRUCTION,
        ];
      const resources = await createChildResources(resourceOptions);
      signal.throwIfAborted();
      const sessionOptions: Parameters<typeof createAgentSession>[0] = {
        cwd: options.cwd,
        model: options.model,
        resourceLoader: resources.loader,
        settingsManager: resources.settingsManager,
        sessionManager: SessionManager.inMemory(options.cwd),
        ...childToolPolicy(),
      };
      if (options.thinkingLevel)
        sessionOptions.thinkingLevel = options.thinkingLevel;
      if (customTools) sessionOptions.customTools = customTools;
      const { session } = await createAgentSession(sessionOptions);
      try {
        signal.throwIfAborted();
        await bindChildSessionExtensions(session);
        signal.throwIfAborted();
        return {
          session,
          unsubscribeToolTimeout: guardWorkflowChildTools(
            session,
            options.toolCallTimeoutMs,
          ),
        };
      } catch (error) {
        await shutdownAndDisposeChildSession(session);
        throw error;
      }
    });
    const settled = operation.then(
      (created) => {
        resume(Effect.succeed(created));
        return created;
      },
      (cause) => {
        resume(
          Effect.fail(
            new AgentSetupError({
              message: `Failed to create agent session: ${errorText(cause)}`,
              cause,
            }),
          ),
        );
        return undefined;
      },
    );
    // SDK loading and binding ignore cancellation. Own their settlement before
    // disposal so late setup cannot restart extension resources after teardown.
    return Effect.promise(async () => {
      const created = await settled;
      if (created) await dispose(created);
    });
  });
}

export function createWorkflowSession(
  options: RunAgentOptions,
  captureStructured: (value: RuntimeValue) => void,
) {
  return Effect.uninterruptibleMask((restore) =>
    Effect.acquireRelease(
      restore(acquireSession(options, captureStructured)),
      (created) => Effect.promise(() => dispose(created)),
    ),
  );
}
