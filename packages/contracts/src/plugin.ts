import { Schema } from "effect";

import type { ProjectEntry } from "./project";
import { TrimmedNonEmptyString } from "./baseSchemas";

export const PluginSlotId = Schema.Literals([
  "chat.header.actions.after",
  "sidebar.footer.before",
  "thread.rightPanel.tabs",
]);
export type PluginSlotId = typeof PluginSlotId.Type;

export const PluginComposerTriggerKind = Schema.Literals([
  "slash-command",
  "slash-workspace",
  "slash-skills",
  "skill-mention",
]);
export type PluginComposerTriggerKind = typeof PluginComposerTriggerKind.Type;

export type PluginComposerIcon = "bot" | "file-search" | "list" | "sparkles" | "terminal";

export const PluginManifest = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  version: TrimmedNonEmptyString,
  hostApiVersion: Schema.Literal("1"),
  enabled: Schema.optional(Schema.Boolean),
  serverEntry: Schema.optional(TrimmedNonEmptyString),
  webEntry: Schema.optional(TrimmedNonEmptyString),
});
export type PluginManifest = typeof PluginManifest.Type;

export const PluginListItem = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  version: TrimmedNonEmptyString,
  hostApiVersion: TrimmedNonEmptyString,
  enabled: Schema.Boolean,
  compatible: Schema.Boolean,
  hasServer: Schema.Boolean,
  hasWeb: Schema.Boolean,
  webUrl: Schema.optional(TrimmedNonEmptyString),
  error: Schema.optional(TrimmedNonEmptyString),
});
export type PluginListItem = typeof PluginListItem.Type;

export const PluginBootstrap = Schema.Struct({
  plugins: Schema.Array(PluginListItem),
});
export type PluginBootstrap = typeof PluginBootstrap.Type;

export const PluginProcedureCallInput = Schema.Struct({
  pluginId: TrimmedNonEmptyString,
  procedure: TrimmedNonEmptyString,
  payload: Schema.optional(Schema.Unknown),
});
export type PluginProcedureCallInput = typeof PluginProcedureCallInput.Type;

export const PluginRegistryUpdatedPayload = Schema.Struct({
  ids: Schema.Array(TrimmedNonEmptyString),
});
export type PluginRegistryUpdatedPayload = typeof PluginRegistryUpdatedPayload.Type;

export interface PluginComposerQueryContext {
  readonly triggerKind: PluginComposerTriggerKind;
  readonly query: string;
  readonly threadId?: string | undefined;
  readonly cwd?: string | null | undefined;
}

interface PluginComposerBaseItem {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly keywords?: readonly string[] | undefined;
  readonly priority?: number | undefined;
  readonly badge?: string | undefined;
  readonly icon?: PluginComposerIcon | undefined;
}

export type PluginComposerSelectResult =
  | {
      readonly type: "replace-trigger";
      readonly text: string;
    }
  | {
      readonly type: "insert-text";
      readonly text: string;
    }
  | {
      readonly type: "open-secondary";
      readonly title: string;
      readonly items: readonly PluginComposerItem[] | Promise<readonly PluginComposerItem[]>;
    }
  | {
      readonly type: "none";
    };

export interface PluginComposerCommandItem extends PluginComposerBaseItem {
  readonly type: "slash-command";
  readonly action: "insert" | "run" | "pick";
  readonly onSelect: () => PluginComposerSelectResult | Promise<PluginComposerSelectResult>;
}

export interface PluginComposerSkillItem extends PluginComposerBaseItem {
  readonly type: "skill";
  readonly replacementText: string;
  readonly sourceLabel: string;
}

export interface PluginComposerPathItem extends PluginComposerBaseItem {
  readonly type: "path";
  readonly path: string;
  readonly pathKind: ProjectEntry["kind"];
}

export type PluginComposerItem =
  | PluginComposerCommandItem
  | PluginComposerSkillItem
  | PluginComposerPathItem;
