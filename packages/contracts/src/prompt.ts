import { Schema } from "effect";

import { TrimmedNonEmptyString } from "./baseSchemas";

export const PromptSourceKind = Schema.Literals(["project", "user"]);
export type PromptSourceKind = typeof PromptSourceKind.Type;

export const PromptSummary = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  displayName: TrimmedNonEmptyString,
  description: TrimmedNonEmptyString,
  argumentHint: Schema.optional(TrimmedNonEmptyString),
  sourceKind: PromptSourceKind,
  sourcePath: TrimmedNonEmptyString,
  defaultPrompt: TrimmedNonEmptyString,
});
export type PromptSummary = typeof PromptSummary.Type;

export const PromptsListInput = Schema.Struct({
  cwd: Schema.optional(TrimmedNonEmptyString),
});
export type PromptsListInput = typeof PromptsListInput.Type;

export const PromptsListResult = Schema.Struct({
  prompts: Schema.Array(PromptSummary),
});
export type PromptsListResult = typeof PromptsListResult.Type;
