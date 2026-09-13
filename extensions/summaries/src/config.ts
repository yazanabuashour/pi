import type { RuntimeRecord } from "../../shared/runtime-values.ts";
import { isObjectValue, isString } from "../../shared/runtime-values.ts";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Data, Effect } from "effect";

class ConfigWriteError extends Data.TaggedError("ConfigWriteError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export const REASONING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ReasoningLevel = (typeof REASONING_LEVELS)[number];

export interface SummaryConfig {
  readonly provider: string;
  readonly model: string;
  readonly reasoning: ReasoningLevel;
}

export const PRIVATE_CONFIG_PATH = NodePath.join(
  getAgentDir(),
  "summary-model.json",
);

const isRecord = <Input1>(value: Input1): value is Input1 & RuntimeRecord =>
  isObjectValue(value) && value !== null && !Array.isArray(value);

const isReasoningLevel = <Input1>(
  value: Input1,
): value is Input1 & ReasoningLevel =>
  // SAFETY: The adjacent runtime guard establishes the asserted protocol representation.
  isString(value) && REASONING_LEVELS.includes(value as ReasoningLevel);

export function parseSummaryConfig<Input1>(value: Input1) {
  if (!isRecord(value)) {
    throw new Error(
      "Invalid summary-model.json: expected provider, model, and reasoning.",
    );
  }

  const provider = value["provider"];
  const model = value["model"];
  const reasoning = value["reasoning"];
  if (
    !isString(provider) ||
    !provider.trim() ||
    !isString(model) ||
    !model.trim() ||
    !isReasoningLevel(reasoning)
  ) {
    throw new Error(
      "Invalid summary-model.json: expected provider, model, and reasoning.",
    );
  }

  return {
    provider: provider.trim(),
    model: model.trim(),
    reasoning,
  } satisfies SummaryConfig;
}

export function loadSummaryConfig() {
  try {
    return parseSummaryConfig(
      JSON.parse(NodeFS.readFileSync(PRIVATE_CONFIG_PATH, "utf8")),
    );
  } catch (error) {
    if (isRecord(error) && error["code"] === "ENOENT") return undefined;
    throw new Error(
      "Could not load summary-model.json; fix it or use /summary-model to replace it.",
      { cause: error },
    );
  }
}

export function saveSummaryConfig(
  config: SummaryConfig | undefined,
  signal?: AbortSignal,
) {
  const tempPath = `${PRIVATE_CONFIG_PATH}.${process.pid}.${NodeCrypto.randomUUID()}.tmp`;
  const write = Effect.tryPromise({
    try: async (effectSignal) => {
      if (!config) {
        await NodeFSP.rm(PRIVATE_CONFIG_PATH, { force: true });
        return;
      }
      await NodeFSP.mkdir(NodePath.dirname(PRIVATE_CONFIG_PATH), {
        recursive: true,
      });
      try {
        await NodeFSP.writeFile(
          tempPath,
          `${JSON.stringify(config, null, 2)}\n`,
          {
            encoding: "utf8",
            mode: 0o600,
            signal: effectSignal,
          },
        );
        await NodeFSP.rename(tempPath, PRIVATE_CONFIG_PATH);
      } catch (error) {
        await NodeFSP.unlink(tempPath).catch(() => undefined);
        throw error;
      }
    },
    catch: (cause) =>
      new ConfigWriteError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  }).pipe(Effect.timeout("5 seconds"));

  return Effect.runPromise(write, signal ? { signal } : undefined);
}
