import type { PluginListItem } from "@t3tools/contracts";
import type { ServerPluginProcedure } from "@t3tools/plugin-sdk";

export interface DiscoveredPluginRoot {
  readonly rootDir: string;
  readonly manifestPath: string;
}

export interface DiscoveredPluginManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly hostApiVersion: string;
  readonly enabled: boolean;
  readonly compatible: boolean;
  readonly rootDir: string;
  readonly manifestPath: string;
  readonly serverEntryPath: string | null;
  readonly webEntryPath: string | null;
  readonly error: string | null;
}

export interface LoadedPluginProcedure {
  readonly pluginId: string;
  readonly procedure: ServerPluginProcedure;
}

export interface LoadedPluginState {
  readonly manifest: DiscoveredPluginManifest;
  listItem: PluginListItem;
  readonly procedures: Map<string, LoadedPluginProcedure>;
  readonly cleanup: Array<() => void | Promise<void>>;
  readonly webVersion: string;
}
