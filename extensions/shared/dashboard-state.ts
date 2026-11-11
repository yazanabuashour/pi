import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

export const GIT_INFO_CHANNEL = "dashboard:git-info";

export const REFRESH_CHANNEL = "dashboard:refresh";

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

export function emptyGitInfoState(): GitInfoState {
  return { unavailable: "Git unavailable: not refreshed" };
}

export function isGitInfoState<Input1>(
  value: Input1,
): value is Input1 & GitInfoState {
  return Value.Check(gitInfoStateSchema, value);
}
