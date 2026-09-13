import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import {
  defineTool,
  truncateHead,
  type ExtensionAPI,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { latestText, REASONING_EFFORTS } from "./domain.ts";
import { resolveStandaloneChildProjectTrust } from "../../shared/child-session.ts";
import { describeAgent } from "./extension-output.ts";
import { rootControls } from "./swarm-controls.ts";
import type { SwarmExtensionSession } from "./extension-session.ts";
import {
  buildAgentSpawnResult,
  SWARM_SPAWN_PROMPT_GUIDELINES,
  SWARM_SPAWN_PROMPT_SNIPPET,
  SWARM_SPAWN_TOOL_DESCRIPTION,
  SWARM_CHECK_TOOL_DESCRIPTION,
  SWARM_LIST_TOOL_DESCRIPTION,
} from "./prompt.ts";
import { runTool } from "./runtime.ts";
import {
  sendSwarmMessage,
  swarmAccess,
  swarmMember,
  type SwarmActor,
} from "./swarm-routing.ts";

function spawnTool(session: SwarmExtensionSession, actor?: SwarmActor) {
  return defineTool({
    name: "swarm_spawn",
    label: "Spawn Swarm Agent",
    description: SWARM_SPAWN_TOOL_DESCRIPTION,
    promptSnippet: SWARM_SPAWN_PROMPT_SNIPPET,
    promptGuidelines: SWARM_SPAWN_PROMPT_GUIDELINES,
    parameters: Type.Object(
      {
        prompt: Type.String({
          minLength: 1,
          description:
            "Self-contained task, paths, constraints, and expected report.",
        }),
        name: Type.String({
          minLength: 1,
          description: "Short human-readable agent name.",
        }),
        working_dir: Type.Optional(
          Type.String({
            description:
              "Trusted working directory; defaults to caller's directory.",
          }),
        ),
        reasoning_effort: Type.Optional(StringEnum(REASONING_EFFORTS)),
        allow_spawn: Type.Optional(
          Type.Boolean({
            description:
              "Explicitly let this child delegate further. Defaults to false.",
          }),
        ),
      },
      { additionalProperties: false },
    ),
    async execute(_id, params, signal, _update, context) {
      signal?.throwIfAborted();
      const access = await swarmAccess(session, actor);
      if (actor && !swarmMember(access, actor.id).canSpawn)
        throw new Error("This agent has no delegation permission.");
      const cwd = NodePath.resolve(context.cwd, params.working_dir ?? ".");
      if (!NodeFS.statSync(cwd).isDirectory())
        throw new Error(`Not a directory: ${cwd}`);
      if (!params.prompt.trim() || !params.name.trim())
        throw new Error("Task and name must not be empty.");
      const canSpawn = params.allow_spawn ?? false;
      const snapshot = await runTool(
        access.runtime,
        access.manager.spawn({
          prompt: params.prompt,
          title: params.name.trim(),
          cwd,
          reasoningEffort: params.reasoning_effort,
          parent: {
            projectTrusted: resolveStandaloneChildProjectTrust({
              parentCwd: context.cwd,
              childCwd: cwd,
              parentTrusted: context.isProjectTrusted(),
            }),
            inheritedModel: context.model,
            inheritedThinkingLevel: context.thinkingLevel,
            modelRegistry: context.modelRegistry,
          },
          swarm: {
            parentId: access.callerId,
            canSpawn,
            toolsFor: (id) =>
              createSwarmTools(
                session,
                { id, runtimeId: access.runtimeId },
                canSpawn,
              ),
          },
        }),
        { signal, interruptMessage: "Swarm spawn aborted." },
      );
      return {
        content: [
          {
            type: "text",
            text: buildAgentSpawnResult({
              id: snapshot.id,
              title: snapshot.title,
              modelLabel: snapshot.meta.modelLabel ?? "?",
              cwd,
            }),
          },
        ],
        details: session.details(snapshot, "started"),
      };
    },
  });
}

function messagingTool(session: SwarmExtensionSession, actor?: SwarmActor) {
  return defineTool({
    name: "swarm_send",
    label: "Message Swarm Agent",
    description:
      "Send an addressed message to root or a swarm agent id. Use it for progress, questions, peer coordination, or more work. Running recipients receive queued steering; idle recipients start a turn, subject to shared capacity. Submission is not proof the model consumed it. Do not blindly retry an interrupted submission. Only root may restart a cancelled agent.",
    parameters: Type.Object(
      {
        to: Type.String({
          description: "Recipient: root or an id from swarm_list.",
        }),
        message: Type.String({ minLength: 1 }),
      },
      { additionalProperties: false },
    ),
    async execute(_id, params, signal) {
      const receipt = await sendSwarmMessage(
        session,
        actor,
        params.to,
        params.message,
        signal,
      );
      return {
        content: [
          {
            type: "text",
            text: `Submitted ${receipt.messageId} to ${receipt.to}; model consumption is unconfirmed.`,
          },
        ],
        details: receipt,
      };
    },
  });
}

function inspectionTools(session: SwarmExtensionSession, actor?: SwarmActor) {
  return [
    defineTool({
      name: "swarm_check",
      label: "Check Swarm Agent",
      description: SWARM_CHECK_TOOL_DESCRIPTION,
      parameters: Type.Object(
        { id: Type.String() },
        { additionalProperties: false },
      ),
      async execute(_id, params) {
        const access = await swarmAccess(session, actor);
        const snapshot = swarmMember(access, params.id);
        let text = `${describeAgent(snapshot)}\nParent: ${snapshot.parentId}\nTurns: ${snapshot.turns}`;
        if (snapshot.errorText) text += `\nError: ${snapshot.errorText}`;
        const output = latestText(snapshot);
        if (output) {
          const preview = truncateHead(output, {
            maxBytes: 2048,
            maxLines: 20,
          });
          text += `\n\nLatest output:\n${preview.content}`;
          if (preview.truncated)
            text += `\n[Truncated; transcript: ${snapshot.meta.sessionFilePath ?? "unavailable"}]`;
        }
        return {
          content: [{ type: "text", text }],
          details: session.details(snapshot, "snapshot"),
        };
      },
    }),
    defineTool({
      name: "swarm_list",
      label: "List Swarm Agents",
      description: SWARM_LIST_TOOL_DESCRIPTION,
      parameters: Type.Object({}, { additionalProperties: false }),
      async execute() {
        const access = await swarmAccess(session, actor);
        const snapshots = access.manager.view
          .list()
          .filter((snapshot) => snapshot.origin === "model");
        const text =
          `You: ${access.callerId}. Main agent: root.\n` +
          snapshots
            .map(
              (snapshot) =>
                `${describeAgent(snapshot)}; parent=${snapshot.parentId}; allow_spawn=${snapshot.canSpawn}`,
            )
            .join("\n");
        return {
          content: [{ type: "text", text }],
          details: {
            self: access.callerId,
            agents: snapshots.map((snapshot) =>
              session.details(snapshot, "snapshot"),
            ),
          },
        };
      },
    }),
  ];
}

export function createSwarmTools(
  session: SwarmExtensionSession,
  actor?: SwarmActor,
  canSpawn = true,
): ToolDefinition[] {
  return [
    ...(canSpawn ? [spawnTool(session, actor)] : []),
    messagingTool(session, actor),
    ...inspectionTools(session, actor),
    ...(!actor ? rootControls(session) : []),
  ];
}

export function registerSwarmTools(
  pi: ExtensionAPI,
  session: SwarmExtensionSession,
) {
  for (const tool of createSwarmTools(session)) pi.registerTool(tool);
}
