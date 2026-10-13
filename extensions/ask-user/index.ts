import { isString } from "../shared/runtime-values.ts";
import { sanitizeOneLine, sanitizeText } from "../shared/terminal-text.ts";

import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Cause, Effect, Exit } from "effect";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import {
  ASK_USER_PARAMETER_DESCRIPTIONS,
  ASK_USER_PROMPT_GUIDELINES,
  ASK_USER_PROMPT_SNIPPET,
  ASK_USER_TOOL_DESCRIPTION,
  buildAskUserResultMessage,
} from "./prompt.ts";
import {
  CUSTOM_OPTION_LABEL,
  type SelectionResult,
  showTuiQuestion,
} from "./src/question-view.ts";

const MIN_OPTIONS = 2;

const MAX_OPTIONS = 5;

const OptionSchema = Type.Object({
  label: Type.String({
    description: ASK_USER_PARAMETER_DESCRIPTIONS.optionLabel,
  }),
  description: Type.Optional(
    Type.String({
      description: ASK_USER_PARAMETER_DESCRIPTIONS.optionDescription,
    }),
  ),
});

const AskUserParams = Type.Object({
  question: Type.String({
    description: ASK_USER_PARAMETER_DESCRIPTIONS.question,
  }),
  options: Type.Array(OptionSchema, {
    minItems: MIN_OPTIONS,
    maxItems: MAX_OPTIONS,
    description: ASK_USER_PARAMETER_DESCRIPTIONS.options,
  }),
});

export type AskUserInput = Static<typeof AskUserParams>;

const AskUserDetailsSchema = Type.Object({
  question: Type.String(),
  options: Type.Array(Type.String()),
  answer: Type.Union([Type.String(), Type.Null()]),
  wasCustom: Type.Boolean(),
  cancelled: Type.Boolean(),
  index: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_OPTIONS })),
  reason: Type.Optional(
    Type.Union([
      Type.Literal("no-ui"),
      Type.Literal("cancelled"),
      Type.Literal("dismissed"),
    ]),
  ),
});

type AskUserDetails = Static<typeof AskUserDetailsSchema>;

/** Use Pi's RPC dialog protocol without depending on terminal components. */
export async function showRpcQuestion(
  params: AskUserInput,
  signal: AbortSignal | undefined,
  ui: Pick<ExtensionUIContext, "select" | "input">,
): Promise<SelectionResult> {
  const options = params.options.map((option, index) =>
    sanitizeOneLine(
      `${index + 1}. ${option.label}${option.description ? ` — ${option.description}` : ""}`,
    ),
  );

  const customOption = `${options.length + 1}. ${CUSTOM_OPTION_LABEL}`;

  while (true) {
    const selected = await ui.select(
      sanitizeText(params.question),
      [...options, customOption],
      signal === undefined ? undefined : { signal },
    );

    if (selected === undefined) return null;

    const index = options.indexOf(selected);
    const option = params.options[index];

    if (index >= 0 && option) {
      return {
        answer: option.label,
        wasCustom: false,
        index: index + 1,
      };
    }

    if (selected !== customOption) return null;

    const answer = (
      await ui.input(
        "Write your answer",
        "Type your answer…",
        signal === undefined ? undefined : { signal },
      )
    )?.trim();

    if (answer) return { answer, wasCustom: true };
  }
}

function reply(
  params: AskUserInput,
  outcome: Parameters<typeof buildAskUserResultMessage>[0],
) {
  const answered = outcome.kind === "selected" || outcome.kind === "custom";

  const details: AskUserDetails = {
    question: params.question,
    options: params.options.map((option) => option.label),
    answer: answered ? outcome.answer : null,
    wasCustom: outcome.kind === "custom",
    cancelled: !answered,
  };

  if (outcome.kind === "selected" && outcome.index !== undefined)
    details.index = outcome.index;

  if (!answered) details.reason = outcome.kind;

  return {
    content: [
      { type: "text" as const, text: buildAskUserResultMessage(outcome) },
    ],
    details,
  };
}

async function executeAskUser(
  pi: ExtensionAPI,
  params: AskUserInput,
  signal: AbortSignal | undefined,
  ctx: ExtensionContext,
) {
  if (
    params.options.length < MIN_OPTIONS ||
    params.options.length > MAX_OPTIONS
  ) {
    throw new Error(
      `ask_user requires between ${MIN_OPTIONS} and ${MAX_OPTIONS} options (got ${params.options.length}). Retry with a valid number of options.`,
    );
  }

  if (
    !ctx.hasUI ||
    (ctx.mode === "rpc" && pi.getFlag("ask-user-rpc") !== true)
  ) {
    return reply(params, { kind: "no-ui" });
  }

  if (signal?.aborted) {
    return reply(params, { kind: "cancelled" });
  }

  const showQuestion =
    ctx.mode === "rpc"
      ? (uiSignal: AbortSignal) => showRpcQuestion(params, uiSignal, ctx.ui)
      : (uiSignal: AbortSignal) => showTuiQuestion(params, uiSignal, ctx.ui);

  const uiExit = await Effect.runPromiseExit(
    Effect.tryPromise(showQuestion),
    signal ? { signal } : undefined,
  );

  if (Exit.isFailure(uiExit)) {
    if (Cause.hasInterruptsOnly(uiExit.cause)) {
      return reply(params, { kind: "cancelled" });
    }

    const [first] = Cause.prettyErrors(uiExit.cause);
    throw new Error(first?.message ?? Cause.pretty(uiExit.cause), {
      cause: uiExit.cause,
    });
  }

  const result = uiExit.value;

  if (!result) return reply(params, { kind: "dismissed" });

  return reply(
    params,
    result.wasCustom
      ? { kind: "custom", answer: result.answer }
      : { kind: "selected", answer: result.answer, index: result.index },
  );
}

export default function askUser(pi: ExtensionAPI) {
  pi.registerFlag("ask-user-rpc", {
    description:
      "Enable ask_user RPC dialogs when the connected client handles extension_ui_request events",
    type: "boolean",
    default: false,
  });

  pi.registerTool({
    name: "ask_user",
    label: "Ask User",
    description: ASK_USER_TOOL_DESCRIPTION,
    promptSnippet: ASK_USER_PROMPT_SNIPPET,
    promptGuidelines: ASK_USER_PROMPT_GUIDELINES,
    parameters: AskUserParams,

    execute: (_toolCallId, params, signal, _onUpdate, ctx) =>
      executeAskUser(pi, params, signal, ctx),

    renderCall(args, theme, _context) {
      let text = theme.fg("toolTitle", theme.bold("ask_user "));
      text += theme.fg(
        "muted",
        isString(args.question) ? sanitizeText(args.question) : "",
      );
      const opts = Array.isArray(args.options) ? args.options : [];

      if (opts.length > 0) {
        const numbered = opts.flatMap((option, index) =>
          Value.Check(OptionSchema, option)
            ? [`${index + 1}. ${sanitizeOneLine(option.label)}`]
            : [],
        );

        text += `\n${theme.fg("dim", `  ${numbered.join("  ")}`)}`;
      }

      return new Text(text, 0, 0);
    },

    renderResult(result, _options, theme, _context) {
      const details = result.details;

      if (!Value.Check(AskUserDetailsSchema, details)) {
        const first = result.content[0];

        return new Text(
          first?.type === "text" ? sanitizeText(first.text) : "",
          0,
          0,
        );
      }

      if (details.cancelled || details.answer === null) {
        const reason =
          details.reason === "no-ui"
            ? "no UI available"
            : (details.reason ?? "unanswered");

        return new Text(theme.fg("warning", `✗ ${reason}`), 0, 0);
      }

      if (details.wasCustom) {
        return new Text(
          theme.fg("success", "✓ ") +
            theme.fg("muted", "(wrote) ") +
            theme.fg("accent", sanitizeText(details.answer)),
          0,
          0,
        );
      }

      const first = details.options.indexOf(details.answer);

      const idx =
        details.index !== undefined &&
        details.options[details.index - 1] === details.answer
          ? details.index
          : first === details.options.lastIndexOf(details.answer)
            ? first + 1
            : 0;

      const answer = sanitizeOneLine(details.answer);
      const display = idx > 0 ? `${idx}. ${answer}` : answer;

      return new Text(
        theme.fg("success", "✓ ") + theme.fg("accent", display),
        0,
        0,
      );
    },
  });
}
