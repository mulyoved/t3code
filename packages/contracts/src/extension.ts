import { Schema } from "effect";

import { TrimmedNonEmptyString } from "./baseSchemas";

export const ExtensionListItem = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  webUrl: Schema.optional(TrimmedNonEmptyString),
  hasServer: Schema.Boolean,
  error: Schema.optional(TrimmedNonEmptyString),
});
export type ExtensionListItem = typeof ExtensionListItem.Type;

export const ExtensionListResult = Schema.Struct({
  extensions: Schema.Array(ExtensionListItem),
});
export type ExtensionListResult = typeof ExtensionListResult.Type;

export const ExtensionCallInput = Schema.Struct({
  extensionId: TrimmedNonEmptyString,
  method: TrimmedNonEmptyString,
  args: Schema.optional(Schema.Unknown),
});
export type ExtensionCallInput = typeof ExtensionCallInput.Type;

export const ExtensionsUpdatedPayload = Schema.Struct({
  ids: Schema.Array(TrimmedNonEmptyString),
});
export type ExtensionsUpdatedPayload = typeof ExtensionsUpdatedPayload.Type;
