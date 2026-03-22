import type {
  PluginComposerItem,
  PluginComposerQueryContext,
  PluginManifest,
  PluginSlotId,
} from "@t3tools/contracts";
import { Schema } from "effect";

export { Schema };
export type {
  PluginComposerIcon,
  PluginComposerItem,
  PluginComposerPathItem,
  PluginComposerQueryContext,
  PluginComposerSelectResult,
  PluginComposerSkillItem,
  PluginComposerTriggerKind,
  PluginListItem,
  PluginManifest,
  PluginSlotId,
} from "@t3tools/contracts";

export interface ServerPluginProcedure<
  TInputSchema extends Schema.Schema<unknown> = Schema.Schema<unknown>,
  TOutputSchema extends Schema.Schema<unknown> = Schema.Schema<unknown>,
> {
  readonly name: string;
  readonly input: TInputSchema;
  readonly output: TOutputSchema;
  readonly handler: (
    input: Schema.Schema.Type<TInputSchema>,
  ) => Schema.Schema.Type<TOutputSchema> | Promise<Schema.Schema.Type<TOutputSchema>>;
}

export interface ServerPluginContext {
  readonly pluginId: string;
  readonly registerProcedure: <
    TInputSchema extends Schema.Schema<unknown>,
    TOutputSchema extends Schema.Schema<unknown>,
  >(
    procedure: ServerPluginProcedure<TInputSchema, TOutputSchema>,
  ) => () => void;
  readonly onDispose: (cleanup: () => void | Promise<void>) => void;
  readonly host: {
    readonly log: {
      readonly info: (...args: unknown[]) => void;
      readonly warn: (...args: unknown[]) => void;
      readonly error: (...args: unknown[]) => void;
    };
    readonly pluginStorageDir: string;
    readonly skills: {
      readonly list: (input: { cwd?: string }) => Promise<unknown>;
    };
    readonly projects: {
      readonly searchEntries: (input: {
        cwd: string;
        query?: string;
        limit?: number;
      }) => Promise<unknown>;
    };
  };
}

export interface WebPluginComposerProvider {
  readonly id: string;
  readonly triggers: readonly PluginComposerQueryContext["triggerKind"][];
  readonly getItems: (
    input: PluginComposerQueryContext,
  ) => readonly PluginComposerItem[] | Promise<readonly PluginComposerItem[]>;
}

export interface WebPluginContext {
  readonly pluginId: string;
  readonly callProcedure: (input: {
    pluginId?: string;
    procedure: string;
    payload?: unknown;
  }) => Promise<unknown>;
  readonly registerComposerProvider: (provider: WebPluginComposerProvider) => () => void;
  readonly registerSlot: (
    slotId: PluginSlotId,
    renderer: (props: Record<string, unknown>) => unknown,
  ) => () => void;
  readonly onDispose: (cleanup: () => void | Promise<void>) => void;
}

export type ServerPluginFactory = (
  ctx: ServerPluginContext,
) => void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>;

export type WebPluginFactory = (
  ctx: WebPluginContext,
) => void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>;

export function defineServerPlugin(factory: ServerPluginFactory): ServerPluginFactory {
  return factory;
}

export function defineWebPlugin(factory: WebPluginFactory): WebPluginFactory {
  return factory;
}

export type PluginManifestShape = PluginManifest;
