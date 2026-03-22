import { Schema } from "effect";

import { TrimmedNonEmptyString } from "./baseSchemas";

export const SkillSourceKind = Schema.Literals(["project", "user", "system"]);
export type SkillSourceKind = typeof SkillSourceKind.Type;

export const SkillSummary = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  displayName: TrimmedNonEmptyString,
  description: TrimmedNonEmptyString,
  sourceKind: SkillSourceKind,
  sourcePath: TrimmedNonEmptyString,
  allowImplicitInvocation: Schema.Boolean,
  defaultPrompt: TrimmedNonEmptyString,
  iconUrl: Schema.optional(TrimmedNonEmptyString),
});
export type SkillSummary = typeof SkillSummary.Type;

export const SkillsListInput = Schema.Struct({
  cwd: Schema.optional(TrimmedNonEmptyString),
});
export type SkillsListInput = typeof SkillsListInput.Type;

export const SkillsListResult = Schema.Struct({
  skills: Schema.Array(SkillSummary),
});
export type SkillsListResult = typeof SkillsListResult.Type;
