import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { Parse } from "typebox/value";

type CompletionMessage = Parameters<ExtensionAPI["sendMessage"]>[0];

type DeliveryOptions = NonNullable<Parameters<ExtensionAPI["sendMessage"]>[1]>;

const WakePolicy = Type.Union([
  Type.Literal("automatic"),
  Type.Literal("host"),
]);

/** Controls extension-initiated turns, independently of execution and UI mode. */
export class BackgroundDelivery {
  readonly policy: Static<typeof WakePolicy>;
  private readonly pi: ExtensionAPI;

  constructor(pi: ExtensionAPI) {
    this.pi = pi;
    this.policy = Parse(
      WakePolicy,
      process.env["PI_BACKGROUND_WAKE_POLICY"] ?? "automatic",
    );
  }

  send(message: CompletionMessage, options: DeliveryOptions) {
    if (this.policy === "automatic") {
      this.pi.sendMessage(message, options);

      return;
    }

    // Omit triggerTurn to preserve active steering without starting an unowned run.
    const { triggerTurn: _triggerTurn, ...hostOptions } = options;
    this.pi.appendEntry("background-delivery", {
      schemaVersion: 1,
      messageType: message.customType,
      policy: this.policy,
      event: "submission",
      wakeRequested: false,
      consumption: "unconfirmed",
    });
    this.pi.sendMessage(message, hostOptions);
  }

  completion(message: CompletionMessage, wakeAgent: boolean) {
    this.send(
      message,
      wakeAgent
        ? { deliverAs: "followUp", triggerTurn: true }
        : { deliverAs: "steer" },
    );
  }
}

export function registerCompletionFlush(
  pi: ExtensionAPI,
  flush: (wakeAgent: boolean) => void,
) {
  pi.on("turn_end", () => flush(false));
  // Late results must not request another run after the owning run has settled.
  pi.on("agent_settled", () => flush(false));
}
