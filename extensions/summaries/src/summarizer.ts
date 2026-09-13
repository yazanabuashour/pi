import { Type, type Static } from "typebox";
import { Check } from "typebox/value";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import type {
  Api,
  AssistantMessage,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { Data, Effect } from "effect";
import type { SummaryConfig } from "./config.ts";
import { buildSummaryPrompt, SUMMARY_SYSTEM_PROMPT } from "./prompt.ts";

const RECAP_MAX_LENGTH = 2_400;
const NEXT_MAX_LENGTH = 400;
const ANSI_PATTERN = new RegExp(
  String.raw`\x1b(?:\][^\x07]*(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~])`,
  "g",
);
const CONTROL_PATTERN = new RegExp(
  String.raw`[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]`,
  "g",
);

class SummaryError extends Data.TaggedError("SummaryError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const RecapSchema = Type.Object(
  {
    recap: Type.String(),
    next: Type.String(),
    title: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
export type RunRecap = Readonly<Static<typeof RecapSchema>>;

function cleanField(value: string, maxLength: number) {
  const cleaned = value
    .replace(ANSI_PATTERN, "")
    .replace(CONTROL_PATTERN, "")
    .trim();
  return cleaned.length <= maxLength
    ? cleaned
    : `${cleaned.slice(0, maxLength - 1).trimEnd()}…`;
}

function parseCandidate(candidate: string) {
  try {
    const value: unknown = JSON.parse(candidate);
    if (!Check(RecapSchema, value)) return undefined;
    const recap = cleanField(value.recap, RECAP_MAX_LENGTH);
    const next = cleanField(
      value.next.replace(/^next\s*:\s*/i, ""),
      NEXT_MAX_LENGTH,
    );
    if (!recap || !next) return undefined;
    // Titles share the existing short-field bound.
    const title = cleanField(
      (value.title ?? "").replace(/\s+/g, " "),
      NEXT_MAX_LENGTH,
    );
    return title ? { recap, next, title } : { recap, next };
  } catch {
    return undefined;
  }
}

export function parseRecapResponse(text: string) {
  const trimmed = text.trim();
  const candidates = [trimmed];
  for (const match of trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    if (match[1]) candidates.push(match[1].trim());
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    const parsed = parseCandidate(candidate);
    if (parsed) return parsed;
  }
  throw new SummaryError({
    message: "The summary model did not return valid recap JSON.",
  });
}

export function reasoningOptions(reasoning: SummaryConfig["reasoning"]) {
  return reasoning === "off" ? {} : { reasoning };
}

function assistantText(content: AssistantMessage["content"]) {
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

export function summarizeRun(options: {
  readonly modelRegistry: ModelRegistry;
  readonly model: Model<Api>;
  readonly reasoning: SummaryConfig["reasoning"];
  readonly transcript: string;
  readonly includeTitle?: boolean;
  readonly signal: AbortSignal;
}) {
  const completion = Effect.tryPromise({
    try: async (effectSignal) => {
      const { model } = options;
      const provider = options.modelRegistry.getProvider(model.provider);
      if (!provider) {
        throw new SummaryError({
          message: `Summary provider is unavailable: ${model.provider}`,
        });
      }
      const auth = await options.modelRegistry.getApiKeyAndHeaders(model);
      if (!auth.ok) throw new SummaryError({ message: auth.error });

      const requestOptions: SimpleStreamOptions = {
        maxTokens: 1_000,
        maxRetries: 1,
        signal: effectSignal,
        timeoutMs: 40_000,
        ...reasoningOptions(options.reasoning),
      };
      if (auth.apiKey !== undefined) requestOptions.apiKey = auth.apiKey;
      if (auth.env !== undefined) requestOptions.env = auth.env;
      if (auth.headers !== undefined) requestOptions.headers = auth.headers;

      // Use the session's effective provider, including private provider overrides.
      const response = await provider
        .streamSimple(
          auth.baseUrl ? { ...model, baseUrl: auth.baseUrl } : model,
          {
            systemPrompt: SUMMARY_SYSTEM_PROMPT,
            messages: [
              {
                role: "user",
                content: buildSummaryPrompt(
                  options.transcript,
                  options.includeTitle,
                ),
                timestamp: Date.now(),
              },
            ],
          },
          requestOptions,
        )
        .result();

      if (
        response.stopReason === "error" ||
        response.stopReason === "aborted"
      ) {
        throw new SummaryError({
          message: response.errorMessage ?? "Summary model request failed.",
        });
      }
      return parseRecapResponse(assistantText(response.content));
    },
    catch: (cause) =>
      cause instanceof SummaryError
        ? cause
        : new SummaryError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
  }).pipe(Effect.timeout("45 seconds"));

  return Effect.runPromise(completion, { signal: options.signal });
}
