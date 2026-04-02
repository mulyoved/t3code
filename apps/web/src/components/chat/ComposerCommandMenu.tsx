import {
  type ProjectEntry,
  type ProviderKind,
  type PluginComposerIcon,
  type PluginComposerSelectResult,
} from "@t3tools/contracts";
import { memo, useLayoutEffect, useRef } from "react";
import { type ComposerTriggerKind } from "../../composer-logic";
import { BotIcon, FileSearchIcon, ListTodoIcon, SparklesIcon, TerminalIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import { Command, CommandItem, CommandList } from "../ui/command";
import { VscodeEntryIcon } from "./VscodeEntryIcon";

export type ComposerCommandItem =
  | {
      id: string;
      type: "path";
      path: string;
      pathKind: ProjectEntry["kind"];
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "slash-command";
      command: string;
      action: "insert" | "run" | "pick";
      label: string;
      description: string;
      keywords?: string[] | undefined;
      icon?: PluginComposerIcon | undefined;
      badge?: string | undefined;
      onSelect?: () => PluginComposerSelectResult | Promise<PluginComposerSelectResult> | undefined;
    }
  | {
      id: string;
      type: "model";
      provider: ProviderKind;
      model: string;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "skill";
      label: string;
      description: string;
      sourceLabel: string;
      replacementText: string;
    };

export const ComposerCommandMenu = memo(function ComposerCommandMenu(props: {
  items: ComposerCommandItem[];
  resolvedTheme: "light" | "dark";
  isLoading: boolean;
  triggerKind: ComposerTriggerKind | null;
  activeItemId: string | null;
  onHighlightedItemChange: (itemId: string | null) => void;
  onSelect: (item: ComposerCommandItem) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!props.activeItemId || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-composer-item-id="${CSS.escape(props.activeItemId)}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [props.activeItemId]);

  return (
    <Command
      autoHighlight={false}
      mode="none"
      onItemHighlighted={(highlightedValue) => {
        props.onHighlightedItemChange(
          typeof highlightedValue === "string" ? highlightedValue : null,
        );
      }}
    >
      <div
        ref={listRef}
        className="relative overflow-hidden rounded-xl border border-border/80 bg-popover/96 shadow-lg/8 backdrop-blur-xs"
      >
        <CommandList className="max-h-64">
          {props.items.map((item) => (
            <ComposerCommandMenuItem
              key={item.id}
              item={item}
              resolvedTheme={props.resolvedTheme}
              isActive={props.activeItemId === item.id}
              onHighlight={props.onHighlightedItemChange}
              onSelect={props.onSelect}
            />
          ))}
        </CommandList>
        {props.items.length === 0 && (
          <p className="px-3 py-2 text-muted-foreground/70 text-xs">
            {props.isLoading
              ? props.triggerKind === "skill-mention" || props.triggerKind === "slash-skills"
                ? "Loading skills..."
                : "Searching workspace files..."
              : props.triggerKind === "path" || props.triggerKind === "slash-workspace"
                ? "No matching files or folders."
                : props.triggerKind === "skill-mention" || props.triggerKind === "slash-skills"
                  ? "No matching skill."
                  : "No matching command."}
          </p>
        )}
        {props.items.length > 0 && (
          <ComposerCommandPreview
            item={
              props.items.find((item) => item.id === props.activeItemId) ?? props.items[0] ?? null
            }
          />
        )}
      </div>
    </Command>
  );
});

const ComposerCommandMenuItem = memo(function ComposerCommandMenuItem(props: {
  item: ComposerCommandItem;
  resolvedTheme: "light" | "dark";
  isActive: boolean;
  onHighlight: (itemId: string | null) => void;
  onSelect: (item: ComposerCommandItem) => void;
}) {
  return (
    <CommandItem
      value={props.item.id}
      data-composer-item-id={props.item.id}
      className={cn(
        "cursor-pointer select-none gap-2 hover:bg-transparent hover:text-inherit data-highlighted:bg-transparent data-highlighted:text-inherit",
        props.isActive && "bg-accent! text-accent-foreground!",
      )}
      onMouseMove={() => {
        if (!props.isActive) props.onHighlight(props.item.id);
      }}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={() => {
        props.onSelect(props.item);
      }}
    >
      {props.item.type === "path" ? (
        <VscodeEntryIcon
          pathValue={props.item.path}
          kind={props.item.pathKind}
          theme={props.resolvedTheme}
        />
      ) : null}
      {props.item.type === "slash-command" ? (
        <SlashCommandIcon
          command={props.item.command}
          {...(props.item.icon ? { icon: props.item.icon } : {})}
        />
      ) : null}
      {props.item.type === "model" ? (
        <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
          model
        </Badge>
      ) : null}
      {props.item.type === "skill" ? (
        <SparklesIcon className="size-4 text-muted-foreground/80" />
      ) : null}
      <span className="flex min-w-0 items-center gap-1.5 truncate">
        <span className="truncate">{props.item.label}</span>
        {props.item.type === "slash-command" ? (
          <Badge variant="outline" className="px-1.5 py-0 text-[10px] capitalize">
            {props.item.badge ?? props.item.action}
          </Badge>
        ) : null}
        {props.item.type === "skill" ? (
          <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
            skill
          </Badge>
        ) : null}
      </span>
      <span className="truncate text-muted-foreground/70 text-xs">
        {props.item.type === "skill"
          ? `${props.item.sourceLabel} · ${props.item.description}`
          : props.item.description}
      </span>
    </CommandItem>
  );
});

function SlashCommandIcon(props: { command: string; icon?: PluginComposerIcon }) {
  if (props.icon === "file-search" || props.command === "workspace") {
    return <FileSearchIcon className="size-4 text-muted-foreground/80" />;
  }
  if (props.icon === "sparkles" || props.command === "skills" || props.command === "list-skills") {
    return <SparklesIcon className="size-4 text-muted-foreground/80" />;
  }
  if (props.icon === "list" || props.command === "plan") {
    return <ListTodoIcon className="size-4 text-muted-foreground/80" />;
  }
  if (props.icon === "terminal" || props.command === "default") {
    return <TerminalIcon className="size-4 text-muted-foreground/80" />;
  }
  return <BotIcon className="size-4 text-muted-foreground/80" />;
}

const ComposerCommandPreview = memo(function ComposerCommandPreview(props: {
  item: ComposerCommandItem | null;
}) {
  if (!props.item) {
    return null;
  }

  const detail =
    props.item.type === "skill"
      ? `${props.item.sourceLabel} skill`
      : props.item.type === "slash-command"
        ? props.item.badge === "prompt"
          ? "Inserts this custom prompt"
          : props.item.action === "pick"
            ? "Opens a second picker"
            : props.item.action === "run"
              ? "Runs immediately"
              : "Inserts text into the prompt"
        : props.item.type === "model"
          ? "Switches this thread model"
          : "Inserts a workspace path mention";

  return (
    <div className="border-t border-border/70 px-3 py-2 text-muted-foreground/75 text-xs">
      <div className="truncate font-medium text-foreground/85">{props.item.label}</div>
      <div className="truncate">{props.item.description}</div>
      <div className="mt-1 truncate">{detail}</div>
    </div>
  );
});
