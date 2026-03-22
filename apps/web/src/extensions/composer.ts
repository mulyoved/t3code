import type { ProjectEntry } from "@t3tools/contracts";

export type ExtensionComposerTriggerKind =
  | "slash-command"
  | "slash-workspace"
  | "slash-skills"
  | "skill-mention";

export type ExtensionComposerIcon = "bot" | "file-search" | "list" | "sparkles" | "terminal";

export type ExtensionComposerSelectResult =
  | {
      type: "replace-trigger";
      text: string;
    }
  | {
      type: "insert-text";
      text: string;
    }
  | {
      type: "open-secondary";
      title: string;
      items: readonly ExtensionComposerItem[] | Promise<readonly ExtensionComposerItem[]>;
    }
  | {
      type: "none";
    };

export interface ExtensionComposerQueryContext {
  readonly triggerKind: ExtensionComposerTriggerKind;
  readonly query: string;
  readonly threadId?: string | undefined;
  readonly cwd?: string | null | undefined;
}

interface ExtensionComposerBaseItem {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly keywords?: readonly string[] | undefined;
  readonly priority?: number | undefined;
  readonly badge?: string | undefined;
  readonly icon?: ExtensionComposerIcon | undefined;
}

export interface ExtensionComposerSlashCommandItem extends ExtensionComposerBaseItem {
  readonly type: "slash-command";
  readonly action: "insert" | "run" | "pick";
  readonly onSelect: () => ExtensionComposerSelectResult | Promise<ExtensionComposerSelectResult>;
}

export interface ExtensionComposerSkillItem extends ExtensionComposerBaseItem {
  readonly type: "skill";
  readonly replacementText: string;
  readonly sourceLabel: string;
}

export interface ExtensionComposerPathItem extends ExtensionComposerBaseItem {
  readonly type: "path";
  readonly path: string;
  readonly pathKind: ProjectEntry["kind"];
}

export type ExtensionComposerItem =
  | ExtensionComposerSlashCommandItem
  | ExtensionComposerSkillItem
  | ExtensionComposerPathItem;

export interface ExtensionComposerSource {
  readonly id: string;
  readonly triggers: readonly ExtensionComposerTriggerKind[];
  readonly getItems: (
    input: ExtensionComposerQueryContext,
  ) => Promise<readonly ExtensionComposerItem[]> | readonly ExtensionComposerItem[];
}

export type ExtensionUISlotId =
  | "chat.header.actions.after"
  | "sidebar.footer.before"
  | "thread.rightPanel.tabs";
