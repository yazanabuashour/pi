import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { isNumber, isRuntimeRecord, isString } from "./runtime-values.ts";
export const MODEL_INFO_CHANNEL = "dashboard:model-info";
export const GIT_INFO_CHANNEL = "dashboard:git-info";
export const REFRESH_CHANNEL = "dashboard:refresh";

export interface ModelInfoState {
  provider: string;
  modelId: string;
  thinking: string;
  contextWindow: number;
  contextPercent: number | null;
  cost: number;
}

export const pullRequestInfoSchema = Type.Object({
  number: Type.Integer({ minimum: 1 }),
  url: Type.String({ pattern: "^https://[^\\s\\u0000-\\u001f\\u007f]+$" }),
  isDraft: Type.Boolean(),
});
export type PullRequestInfo = Static<typeof pullRequestInfoSchema>;

const gitInfoStateSchema = Type.Union([
  Type.Object({ unavailable: Type.String({ minLength: 1 }) }),
  Type.Object({
    unavailable: Type.Null(),
    isRepository: Type.Boolean(),
    branch: Type.Union([Type.String(), Type.Null()]),
    changedFiles: Type.Integer({ minimum: 0 }),
    pullRequest: Type.Union([pullRequestInfoSchema, Type.Null()]),
  }),
]);
export type GitInfoState = Static<typeof gitInfoStateSchema>;

export function emptyModelInfoState(): ModelInfoState {
  return {
    provider: "",
    modelId: "no-model",
    thinking: "off",
    contextWindow: 0,
    contextPercent: null,
    cost: 0,
  };
}

export function emptyGitInfoState(): GitInfoState {
  return { unavailable: "Git unavailable: not refreshed" };
}

function isNullableNumber<Input1>(value: Input1) {
  return value === null || isNumber(value);
}

export function isModelInfoState<Input1>(
  value: Input1,
): value is Input1 & ModelInfoState {
  if (!isRuntimeRecord(value)) return false;
  const provider = value["provider"];
  const modelId = value["modelId"];
  const thinking = value["thinking"];
  const contextWindow = value["contextWindow"];
  const contextPercent = value["contextPercent"];
  const cost = value["cost"];

  return (
    isString(provider) &&
    isString(modelId) &&
    isString(thinking) &&
    isNumber(contextWindow) &&
    isNullableNumber(contextPercent) &&
    isNumber(cost)
  );
}

export function isGitInfoState<Input1>(
  value: Input1,
): value is Input1 & GitInfoState {
  return Value.Check(gitInfoStateSchema, value);
}
