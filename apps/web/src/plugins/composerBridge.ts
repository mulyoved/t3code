import type {
  PromptSummary,
  ProjectEntry,
  ProviderKind,
  ModelSlug,
  PluginComposerItem,
} from "@t3tools/contracts";

import type { ComposerTriggerKind } from "~/composer-logic";
import { basenameOfPath } from "~/vscode-icons";
import type { ComposerCommandItem } from "~/components/chat/ComposerCommandMenu";

export interface SecondaryComposerMenuState {
  readonly title: string;
  readonly items: readonly ComposerCommandItem[];
}

interface SearchableModelOption {
  readonly provider: ProviderKind;
  readonly providerLabel: string;
  readonly slug: ModelSlug;
  readonly name: string;
  readonly searchSlug: string;
  readonly searchName: string;
  readonly searchProvider: string;
}

function normalizeComposerSearchValue(value: string): string {
  return value.trim().toLowerCase();
}

function scoreSlashCommandMatch(
  item: Extract<ComposerCommandItem, { type: "slash-command" }>,
  rawQuery: string,
): number | null {
  const query = normalizeComposerSearchValue(rawQuery);
  if (!query) {
    return item.action === "pick" ? 0 : item.action === "run" ? 1 : 2;
  }

  const command = item.command.toLowerCase();
  const label = item.label.toLowerCase();
  const description = item.description.toLowerCase();
  const keywords = item.keywords?.map((keyword) => keyword.toLowerCase()) ?? [];

  if (command === query) return 0;
  if (command.startsWith(query)) return 1;
  if (label.startsWith(query)) return 2;
  if (keywords.some((keyword) => keyword.startsWith(query))) return 3;
  if (label.includes(query)) return 4;
  if (keywords.some((keyword) => keyword.includes(query))) return 5;
  if (description.includes(query)) return 6;
  return null;
}

export function mapPluginComposerItem(item: PluginComposerItem): ComposerCommandItem {
  if (item.type === "path") {
    return {
      id: item.id,
      type: "path",
      path: item.path,
      pathKind: item.pathKind,
      label: item.label,
      description: item.description,
    };
  }

  if (item.type === "skill") {
    return {
      id: item.id,
      type: "skill",
      label: item.label,
      description: item.description,
      sourceLabel: item.sourceLabel,
      replacementText: item.replacementText,
    };
  }

  return {
    id: item.id,
    type: "slash-command",
    command: item.id,
    action: item.action,
    label: item.label,
    description: item.description,
    keywords: item.keywords ? [...item.keywords] : undefined,
    icon: item.icon,
    badge: item.badge,
    onSelect: item.onSelect,
  };
}

export function buildComposerMenuItems(input: {
  composerTrigger: {
    kind: ComposerTriggerKind;
    query: string;
  } | null;
  secondaryComposerMenu: SecondaryComposerMenuState | null;
  workspaceEntries: readonly ProjectEntry[];
  availablePrompts: readonly PromptSummary[];
  pluginComposerItems: readonly PluginComposerItem[];
  searchableModelOptions: readonly SearchableModelOption[];
}): ComposerCommandItem[] {
  if (input.secondaryComposerMenu) {
    return [...input.secondaryComposerMenu.items];
  }
  if (!input.composerTrigger) {
    return [];
  }

  if (input.composerTrigger.kind === "path") {
    return input.workspaceEntries.map((entry) => ({
      id: `path:${entry.kind}:${entry.path}`,
      type: "path",
      path: entry.path,
      pathKind: entry.kind,
      label: basenameOfPath(entry.path),
      description: entry.parentPath ?? "",
    }));
  }

  if (
    input.composerTrigger.kind === "skill-mention" ||
    input.composerTrigger.kind === "slash-skills" ||
    input.composerTrigger.kind === "slash-workspace"
  ) {
    return input.pluginComposerItems.map(mapPluginComposerItem);
  }

  if (input.composerTrigger.kind === "slash-command") {
    const slashQuery = input.composerTrigger.query;
    const slashCommandItems = [
      {
        id: "slash:model",
        type: "slash-command",
        command: "model",
        action: "insert",
        label: "Switch model",
        description: "Insert /model to choose a different thread model",
        keywords: ["model", "switch", "provider"],
      },
      {
        id: "slash:plan",
        type: "slash-command",
        command: "plan",
        action: "run",
        label: "Insert plan request",
        description: "Switch this thread into plan mode",
        keywords: ["plan", "mode"],
      },
      {
        id: "slash:default",
        type: "slash-command",
        command: "default",
        action: "run",
        label: "Return to default mode",
        description: "Switch this thread back to normal chat mode",
        keywords: ["default", "chat", "mode"],
      },
    ] satisfies ReadonlyArray<Extract<ComposerCommandItem, { type: "slash-command" }>>;

    const builtInItems = [...slashCommandItems]
      .filter((item) => scoreSlashCommandMatch(item, slashQuery) !== null)
      .toSorted(
        (left, right) =>
          (scoreSlashCommandMatch(left, slashQuery) ?? Number.MAX_SAFE_INTEGER) -
            (scoreSlashCommandMatch(right, slashQuery) ?? Number.MAX_SAFE_INTEGER) ||
          left.label.localeCompare(right.label),
      );

    const promptItems = input.availablePrompts
      .map(
        (prompt) =>
          ({
            id: `prompt:${prompt.sourceKind}:${prompt.name}`,
            type: "slash-command",
            command: prompt.name,
            action: "insert",
            label: `/${prompt.name}`,
            description: prompt.description,
            keywords: [
              prompt.name,
              prompt.displayName,
              ...(prompt.argumentHint ? [prompt.argumentHint] : []),
            ],
            badge: "prompt",
          }) satisfies Extract<ComposerCommandItem, { type: "slash-command" }>,
      )
      .filter((item) => scoreSlashCommandMatch(item, slashQuery) !== null)
      .toSorted(
        (left, right) =>
          (scoreSlashCommandMatch(left, slashQuery) ?? Number.MAX_SAFE_INTEGER) -
            (scoreSlashCommandMatch(right, slashQuery) ?? Number.MAX_SAFE_INTEGER) ||
          left.label.localeCompare(right.label),
      );

    const pluginItems = input.pluginComposerItems.flatMap((item) =>
      item.type === "slash-command" ? [mapPluginComposerItem(item)] : [],
    );

    return [...builtInItems, ...promptItems, ...pluginItems];
  }

  return input.searchableModelOptions
    .filter(({ searchSlug, searchName, searchProvider }) => {
      const query = input.composerTrigger?.query.trim().toLowerCase() ?? "";
      if (!query) return true;
      return (
        searchSlug.includes(query) || searchName.includes(query) || searchProvider.includes(query)
      );
    })
    .map(({ provider, providerLabel, slug, name }) => ({
      id: `model:${provider}:${slug}`,
      type: "model",
      provider,
      model: slug,
      label: name,
      description: `${providerLabel} · ${slug}`,
    }));
}

export async function resolveSecondaryComposerMenuState(input: {
  title: string;
  items: readonly PluginComposerItem[] | Promise<readonly PluginComposerItem[]>;
}): Promise<SecondaryComposerMenuState> {
  return {
    title: input.title,
    items: (await Promise.resolve(input.items)).map(mapPluginComposerItem),
  };
}
