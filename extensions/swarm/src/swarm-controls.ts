import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { SwarmExtensionSession } from "./extension-session.ts";
import { buildWaitOutput } from "./extension-output.ts";
import {
  SWARM_WAIT_TOOL_DESCRIPTION,
  SWARM_CANCEL_TOOL_DESCRIPTION,
} from "./prompt.ts";
import { runTool } from "./runtime.ts";
import { swarmAccess, swarmMember } from "./swarm-routing.ts";

/** Blocking joins and branch cancellation belong to the main coordinator. */
export function rootControls(session: SwarmExtensionSession) {
  const parameters = Type.Object(
    { ids: Type.Array(Type.String()) },
    { additionalProperties: false },
  );
  return [
    defineTool({
      name: "swarm_wait",
      label: "Wait for Swarm Agents",
      description: SWARM_WAIT_TOOL_DESCRIPTION,
      parameters,
      async execute(_id, params, signal, onUpdate) {
        const access = await swarmAccess(session);
        const ids = [...new Set(params.ids)];
        for (const id of ids) swarmMember(access, id);
        const snapshots = await runTool(
          access.runtime,
          access.manager.waitFor(ids, (pending) =>
            onUpdate?.({
              content: [
                { type: "text", text: `Waiting for ${pending.join(", ")}...` },
              ],
              details: { pending },
            }),
          ),
          {
            signal,
            interruptMessage: "Wait aborted. Swarm agents keep running.",
          },
        );
        session.consume(snapshots);
        return {
          content: [{ type: "text", text: buildWaitOutput(snapshots) }],
          details: {
            results: snapshots.map((snapshot) =>
              session.details(snapshot, "settled"),
            ),
          },
        };
      },
    }),
    defineTool({
      name: "swarm_cancel",
      label: "Cancel Swarm Branch",
      description: SWARM_CANCEL_TOOL_DESCRIPTION,
      parameters,
      async execute(_id, params, signal) {
        const access = await swarmAccess(session);
        for (const id of params.ids) swarmMember(access, id);
        const report = await runTool(
          access.runtime,
          access.manager.cancel(params.ids),
          {
            signal,
            interruptMessage:
              "Cancellation interrupted; inspect branch status before continuing.",
          },
        );
        return {
          content: [
            {
              type: "text",
              text: report
                .map(
                  (entry) =>
                    `${entry.id}: ${entry.cancelled ? "cancelled" : entry.status}`,
                )
                .join("\n"),
            },
          ],
          details: { results: report },
        };
      },
    }),
  ];
}
