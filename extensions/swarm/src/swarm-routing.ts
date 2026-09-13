import * as NodeCrypto from "node:crypto";
import type { SwarmExtensionSession } from "./extension-session.ts";
import { runTool } from "./runtime.ts";

export interface SwarmActor {
  readonly id: string;
  readonly runtimeId: string;
}

export async function swarmAccess(
  session: SwarmExtensionSession,
  actor?: SwarmActor,
) {
  const manager = await session.getManager();
  const runtime = session.getRuntime();
  const runtimeId = session.identity;
  const callerId = actor?.id ?? "root";
  const generation = actor ? manager.view.get(actor.id)?.generation : undefined;
  const assertCurrent = () => {
    session.assertCurrent(actor?.runtimeId ?? runtimeId);
    if (!actor) return;
    const caller = manager.view.get(actor.id);
    if (
      !caller ||
      caller.origin !== "model" ||
      caller.status !== "running" ||
      caller.generation !== generation ||
      !manager.view.canAct(actor.id)
    )
      throw new Error(`Swarm caller ${actor.id} is no longer active.`);
  };
  assertCurrent();
  return { manager, runtime, runtimeId, callerId, assertCurrent };
}

export function swarmMember(
  access: Awaited<ReturnType<typeof swarmAccess>>,
  id: string,
) {
  const member = access.manager.view.get(id);
  if (!member || member.origin !== "model")
    throw new Error(`Unknown swarm agent "${id}".`);
  return member;
}

function swarmEnvelope(message: {
  id: string;
  from: string;
  to: string;
  text: string;
}) {
  return `Swarm message ${message.id} from ${message.from} to ${message.to}:\n\n${message.text}`;
}

export async function sendSwarmMessage(
  session: SwarmExtensionSession,
  actor: SwarmActor | undefined,
  to: string,
  text: string,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const access = await swarmAccess(session, actor);
  signal?.throwIfAborted();
  if (!text.trim()) throw new Error("Swarm messages must not be empty.");
  if (to === access.callerId)
    throw new Error("Send to another swarm agent, not yourself.");
  if (to !== "root") {
    const target = swarmMember(access, to);
    if (
      actor &&
      (target.outcome === "interrupted" || !access.manager.view.canAct(to))
    )
      throw new Error(`Only the main agent can restart cancelled agent ${to}.`);
  }
  const message = {
    schemaVersion: 1 as const,
    id: NodeCrypto.randomUUID(),
    from: access.callerId,
    to,
    text,
  };
  access.assertCurrent();
  session.messages.record({ ...message, status: "submitted" });
  try {
    const envelope = swarmEnvelope(message);
    if (to === "root") session.messages.receive(message, envelope);
    else
      await runTool(access.runtime, access.manager.send(to, envelope), {
        signal,
        interruptMessage:
          "Message submission interrupted; inspect the recipient before retrying.",
      });
  } catch (error) {
    if (session.isCurrent(access.runtimeId))
      session.messages.record({
        ...message,
        status: "failed",
        error: String(error),
      });
    throw error;
  }
  // Submission is not proof of model consumption. The recipient may still be
  // executing a tool; native API steering and durable replay are not used.
  return {
    messageId: message.id,
    from: message.from,
    to,
    status: "submitted" as const,
    consumption: "unconfirmed" as const,
  };
}
