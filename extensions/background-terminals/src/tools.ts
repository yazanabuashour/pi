import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { BackgroundTerminalSession } from "./extension-session.ts";
import {
  BG_KILL_PARAMETER_DESCRIPTIONS,
  BG_KILL_TOOL_DESCRIPTION,
  BG_LIST_TOOL_DESCRIPTION,
  BG_START_PARAMETER_DESCRIPTIONS,
  BG_START_PROMPT_GUIDELINES,
  BG_START_PROMPT_SNIPPET,
  BG_START_TOOL_DESCRIPTION,
  BG_STATUS_PARAMETER_DESCRIPTIONS,
  BG_STATUS_TOOL_DESCRIPTION,
  buildKillReport,
  buildStartResult,
  buildStatusResult,
  describeTerminal,
} from "./prompt.ts";
import { runTool } from "./runtime.ts";

function registerStart(pi: ExtensionAPI, session: BackgroundTerminalSession) {
  pi.registerTool({
    name: "bg_start",
    label: "Start Background Terminal",
    description: BG_START_TOOL_DESCRIPTION,
    promptSnippet: BG_START_PROMPT_SNIPPET,
    promptGuidelines: BG_START_PROMPT_GUIDELINES,
    parameters: Type.Object({
      command: Type.String({
        description: BG_START_PARAMETER_DESCRIPTIONS.command,
      }),
      title: Type.String({
        description: BG_START_PARAMETER_DESCRIPTIONS.title,
      }),
      working_dir: Type.Optional(
        Type.String({
          description: BG_START_PARAMETER_DESCRIPTIONS.workingDir,
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, context) {
      const manager = await session.getManager();
      const runtime = session.getRuntime();
      const command = params.command.trim();
      if (!command) throw new Error("command must not be empty.");
      const cwd = NodePath.resolve(context.cwd, params.working_dir ?? ".");
      if (!NodeFS.existsSync(cwd) || !NodeFS.statSync(cwd).isDirectory()) {
        throw new Error(`working_dir is not a directory: ${cwd}`);
      }
      const title =
        params.title.replace(/\s+/g, " ").trim().slice(0, 80) || "terminal";
      const snapshot = await runTool(
        runtime,
        manager.start({ command, title, cwd }),
      );
      if (!session.recordStart(snapshot)) {
        try {
          await runTool(runtime, manager.kill([snapshot.id]));
        } catch (error) {
          console.error(
            "background-terminals: cleanup after lifecycle failure failed",
            error,
          );
        }
        throw new Error(
          "Background terminal was stopped because its lifecycle receipt could not be persisted.",
        );
      }
      return {
        content: [{ type: "text", text: buildStartResult(snapshot) }],
        details: session.details(snapshot, "started"),
      };
    },
  });
}

function registerStatus(pi: ExtensionAPI, session: BackgroundTerminalSession) {
  pi.registerTool({
    name: "bg_status",
    label: "Check Background Terminal",
    description: BG_STATUS_TOOL_DESCRIPTION,
    parameters: Type.Object({
      id: Type.String({ description: BG_STATUS_PARAMETER_DESCRIPTIONS.id }),
    }),
    async execute(_toolCallId, params) {
      const manager = await session.getManager();
      const snapshot = manager.view.get(params.id);
      if (!snapshot) {
        const known = manager.view.list().map((entry) => entry.id);
        throw new Error(
          `Unknown terminal id "${params.id}". Known: ${known.join(", ") || "none"}.`,
        );
      }
      if (snapshot.status !== "running") session.consume([snapshot.id]);
      return {
        content: [{ type: "text", text: buildStatusResult(snapshot) }],
        details: session.details(snapshot, "snapshot"),
      };
    },
  });
}

function registerList(pi: ExtensionAPI, session: BackgroundTerminalSession) {
  pi.registerTool({
    name: "bg_list",
    label: "List Background Terminals",
    description: BG_LIST_TOOL_DESCRIPTION,
    parameters: Type.Object({}),
    async execute() {
      const manager = await session.getManager();
      const terminals = manager.view.list();
      const text =
        terminals.length === 0
          ? "No background terminals."
          : terminals.map((snapshot) => describeTerminal(snapshot)).join("\n");
      return {
        content: [{ type: "text", text }],
        details: {
          terminals: terminals.map((snapshot) =>
            session.details(snapshot, "snapshot"),
          ),
        },
      };
    },
  });
}

function registerKill(pi: ExtensionAPI, session: BackgroundTerminalSession) {
  pi.registerTool({
    name: "bg_kill",
    label: "Kill Background Terminals",
    description: BG_KILL_TOOL_DESCRIPTION,
    parameters: Type.Object({
      ids: Type.Array(Type.String(), {
        description: BG_KILL_PARAMETER_DESCRIPTIONS.ids,
      }),
    }),
    async execute(_toolCallId, params, signal) {
      const manager = await session.getManager();
      const ids = [...new Set(params.ids)];
      if (ids.length === 0)
        throw new Error("Provide at least one terminal id.");
      const known = manager.view.list().map((snapshot) => snapshot.id);
      const unknown = ids.filter((id) => !manager.view.get(id));
      if (unknown.length > 0) {
        throw new Error(
          `Unknown terminal id(s): ${unknown.join(", ")}. Known: ${known.join(", ") || "none"}.`,
        );
      }
      const report = await runTool(session.getRuntime(), manager.kill(ids), {
        signal,
        interruptMessage:
          "Kill wait aborted; termination continues in the background.",
      });
      session.consume(ids);
      return {
        content: [{ type: "text", text: buildKillReport(report) }],
        details: {
          results: report.map((entry) => {
            const snapshot = manager.view.get(entry.id);
            return snapshot
              ? {
                  ...session.details(snapshot, "settled"),
                  killed: entry.killed,
                }
              : {
                  id: entry.id,
                  title: entry.title,
                  status: entry.status,
                  killed: entry.killed,
                };
          }),
        },
      };
    },
  });
}

export function registerTerminalTools(
  pi: ExtensionAPI,
  session: BackgroundTerminalSession,
) {
  registerStart(pi, session);
  registerStatus(pi, session);
  registerList(pi, session);
  registerKill(pi, session);
}
