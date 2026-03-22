import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Exit, Schema } from "effect";

import type { PluginBootstrap, PluginListItem } from "@t3tools/contracts";
import type {
  ServerPluginContext,
  ServerPluginFactory,
  ServerPluginProcedure,
} from "@t3tools/plugin-sdk";
import { formatSchemaError } from "@t3tools/shared/schemaJson";

import { createLogger } from "../logger";
import { listAvailableSkills } from "../skills";
import { searchWorkspaceEntries } from "../workspaceEntries";
import { discoverPluginRoots, loadPluginManifest } from "./discovery";
import type { DiscoveredPluginManifest, LoadedPluginProcedure, LoadedPluginState } from "./types";

interface PluginModuleShape {
  readonly default?: ServerPluginFactory | undefined;
  readonly activateServer?: ServerPluginFactory | undefined;
}

function resolveServerActivator(module: PluginModuleShape): ServerPluginFactory | null {
  if (typeof module.default === "function") {
    return module.default;
  }
  if (typeof module.activateServer === "function") {
    return module.activateServer;
  }
  return null;
}

export interface PluginManager {
  readonly getBootstrap: () => PluginBootstrap;
  readonly callProcedure: (
    pluginId: string,
    procedureName: string,
    payload: unknown,
  ) => Promise<unknown>;
  readonly getWebEntry: (pluginId: string) => { filePath: string; version: string } | null;
  readonly subscribeToRegistryUpdates: (listener: (ids: string[]) => void) => () => void;
  readonly close: () => Promise<void>;
}

function comparePluginListItems(left: PluginListItem, right: PluginListItem): number {
  return left.id.localeCompare(right.id);
}

function safeMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return String(error);
}

async function maybeCallCleanup(cleanup: (() => void | Promise<void>) | undefined): Promise<void> {
  if (cleanup) {
    await cleanup();
  }
}

function decodeProcedureInput(
  pluginId: string,
  procedureName: string,
  schema: ServerPluginProcedure["input"],
  payload: unknown,
): unknown {
  const result = Schema.decodeUnknownExit(schema as never)(payload);
  if (Exit.isFailure(result)) {
    throw new Error(
      `Invalid plugin procedure input for '${pluginId}.${procedureName}': ${formatSchemaError(result.cause)}`,
    );
  }
  return result.value;
}

function encodeProcedureOutput(
  pluginId: string,
  procedureName: string,
  schema: ServerPluginProcedure["output"],
  output: unknown,
): unknown {
  const result = Schema.encodeUnknownExit(schema as never)(output);
  if (Exit.isFailure(result)) {
    throw new Error(
      `Invalid plugin procedure output for '${pluginId}.${procedureName}': ${formatSchemaError(result.cause)}`,
    );
  }
  return result.value;
}

function pluginListItemFromManifest(
  manifest: DiscoveredPluginManifest,
  input: {
    webVersion: string;
    error?: string | null;
  },
): PluginListItem {
  const effectiveError = input.error ?? manifest.error;
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    hostApiVersion: manifest.hostApiVersion,
    enabled: manifest.enabled,
    compatible: manifest.compatible,
    hasServer: manifest.serverEntryPath !== null,
    hasWeb: manifest.webEntryPath !== null,
    ...(manifest.webEntryPath !== null &&
    manifest.enabled &&
    manifest.compatible &&
    effectiveError === null
      ? {
          webUrl: `/__plugins/${encodeURIComponent(manifest.id)}/web.js?v=${encodeURIComponent(input.webVersion)}`,
        }
      : {}),
    ...(effectiveError ? { error: effectiveError } : {}),
  };
}

export async function createPluginManager(input: { cwd: string }): Promise<PluginManager> {
  const logger = createLogger("plugins");
  const pluginStates = new Map<string, LoadedPluginState>();
  const updateListeners = new Set<(ids: string[]) => void>();
  const watchers: fs.FSWatcher[] = [];
  const reloadTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const rootWatchTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const pluginStorageRoot = path.resolve(input.cwd, ".t3", "plugins");

  const notifyUpdated = (ids: string[]) => {
    if (ids.length === 0) {
      return;
    }
    for (const listener of updateListeners) {
      try {
        listener(ids);
      } catch {
        // Swallow listener errors.
      }
    }
  };

  const clearWatchers = () => {
    for (const watcher of watchers) {
      watcher.close();
    }
    watchers.length = 0;
  };

  const unloadPlugin = async (state: LoadedPluginState) => {
    const cleanupTasks = [...state.cleanup];
    state.cleanup.length = 0;
    state.procedures.clear();
    await Promise.all(cleanupTasks.map((cleanup) => maybeCallCleanup(cleanup)));
  };

  const activatePlugin = async (manifest: DiscoveredPluginManifest): Promise<LoadedPluginState> => {
    const webVersion = `${Date.now()}`;
    const state: LoadedPluginState = {
      manifest,
      listItem: pluginListItemFromManifest(manifest, { webVersion, error: manifest.error }),
      procedures: new Map(),
      cleanup: [],
      webVersion,
    };

    if (!manifest.enabled) {
      return state;
    }

    if (!manifest.compatible) {
      const error =
        manifest.error ??
        `Unsupported hostApiVersion '${manifest.hostApiVersion}' for plugin '${manifest.id}'.`;
      logger.warn(`[${manifest.id}] ${error}`);
      state.listItem = pluginListItemFromManifest(manifest, { webVersion, error });
      return state;
    }

    if (!manifest.serverEntryPath) {
      return state;
    }

    const pluginLog = {
      info: (...args: unknown[]) =>
        logger.info(`[${manifest.id}] ${args.map(safeMessage).join(" ")}`),
      warn: (...args: unknown[]) =>
        logger.warn(`[${manifest.id}] ${args.map(safeMessage).join(" ")}`),
      error: (...args: unknown[]) =>
        logger.error(`[${manifest.id}] ${args.map(safeMessage).join(" ")}`),
    };

    await fs.promises.mkdir(path.join(pluginStorageRoot, manifest.id), { recursive: true });

    const context: ServerPluginContext = {
      pluginId: manifest.id,
      registerProcedure: (procedure) => {
        state.procedures.set(procedure.name, {
          pluginId: manifest.id,
          procedure,
        } satisfies LoadedPluginProcedure);
        return () => {
          state.procedures.delete(procedure.name);
        };
      },
      onDispose: (cleanup) => {
        state.cleanup.push(cleanup);
      },
      host: {
        log: pluginLog,
        pluginStorageDir: path.join(pluginStorageRoot, manifest.id),
        skills: {
          list: ({ cwd }) => listAvailableSkills(cwd ? { cwd } : {}),
        },
        projects: {
          searchEntries: ({ cwd, query, limit }) =>
            searchWorkspaceEntries({
              cwd,
              query: query ?? "",
              limit: typeof limit === "number" ? limit : 100,
            }),
        },
      },
    };

    try {
      const module = (await import(
        `${pathToFileURL(manifest.serverEntryPath).href}?v=${Date.now()}`
      )) as PluginModuleShape;
      const activate = resolveServerActivator(module);
      if (activate) {
        pluginLog.info("activating");
        const maybeCleanup = await activate(context);
        if (typeof maybeCleanup === "function") {
          state.cleanup.push(maybeCleanup);
        }
      }
      pluginLog.info("activated");
    } catch (error) {
      const message = safeMessage(error);
      pluginLog.error("activation failed", message);
      await unloadPlugin(state);
      state.listItem = pluginListItemFromManifest(manifest, {
        webVersion,
        error: `Plugin activation failed: ${message}`,
      });
    }

    return state;
  };

  const scheduleFullReload = (reasonKey: string) => {
    const existing = rootWatchTimers.get(reasonKey);
    if (existing) {
      clearTimeout(existing);
    }
    rootWatchTimers.set(
      reasonKey,
      setTimeout(() => {
        rootWatchTimers.delete(reasonKey);
        void reloadAllPlugins();
      }, 120),
    );
  };

  const watchTarget = (watchPath: string, onChange: () => void) => {
    try {
      const watcher = fs.watch(watchPath, () => {
        onChange();
      });
      watchers.push(watcher);
    } catch (error) {
      logger.warn(`failed to watch plugin path '${watchPath}': ${safeMessage(error)}`);
    }
  };

  const reloadPlugin = async (pluginId: string) => {
    logger.info(`[${pluginId}] reloading`);
    await reloadAllPlugins([pluginId]);
  };

  const installWatches = async () => {
    clearWatchers();

    const localAndEnvRoots = Array.from(
      new Set([
        path.resolve(input.cwd, "plugins"),
        ...(process.env.T3CODE_PLUGIN_DIRS ?? "")
          .split(path.delimiter)
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
          .map((value) => path.resolve(value)),
      ]),
    );

    for (const rootPath of localAndEnvRoots) {
      watchTarget(rootPath, () => scheduleFullReload(rootPath));
    }

    for (const [pluginId, state] of pluginStates) {
      const watchPaths = new Set(
        [
          state.manifest.rootDir,
          state.manifest.manifestPath,
          state.manifest.serverEntryPath,
          state.manifest.webEntryPath,
        ].flatMap((value) => (value ? [value] : [])),
      );
      for (const watchPath of watchPaths) {
        watchTarget(watchPath, () => {
          const existing = reloadTimers.get(pluginId);
          if (existing) {
            clearTimeout(existing);
          }
          reloadTimers.set(
            pluginId,
            setTimeout(() => {
              reloadTimers.delete(pluginId);
              void reloadPlugin(pluginId);
            }, 120),
          );
        });
      }
    }
  };

  const reloadAllPlugins = async (preferredIds?: string[]) => {
    const previousIds = [...pluginStates.keys()];
    const previousStates = [...pluginStates.values()];
    for (const state of previousStates) {
      await unloadPlugin(state);
    }
    pluginStates.clear();

    const discoveredRoots = await discoverPluginRoots(input.cwd);
    const manifests = await Promise.all(discoveredRoots.map((root) => loadPluginManifest(root)));
    for (const manifest of manifests.toSorted((left, right) => left.id.localeCompare(right.id))) {
      const state = await activatePlugin(manifest);
      pluginStates.set(manifest.id, state);
    }

    await installWatches();

    const nextIds = [...pluginStates.keys()];
    const changedIds =
      preferredIds && preferredIds.length > 0
        ? preferredIds
        : Array.from(new Set([...previousIds, ...nextIds])).toSorted((left, right) =>
            left.localeCompare(right),
          );
    notifyUpdated(changedIds);
  };

  await reloadAllPlugins();

  return {
    getBootstrap: () => ({
      plugins: [...pluginStates.values()]
        .map((state) => state.listItem)
        .toSorted(comparePluginListItems),
    }),
    callProcedure: async (pluginId, procedureName, payload) => {
      const pluginState = pluginStates.get(pluginId);
      if (!pluginState) {
        throw new Error(`Unknown plugin '${pluginId}'.`);
      }
      const loadedProcedure = pluginState.procedures.get(procedureName);
      if (!loadedProcedure) {
        throw new Error(`Unknown plugin procedure '${procedureName}' for plugin '${pluginId}'.`);
      }

      const decodedInput = decodeProcedureInput(
        pluginId,
        procedureName,
        loadedProcedure.procedure.input,
        payload,
      );
      const output = await loadedProcedure.procedure.handler(decodedInput);
      return encodeProcedureOutput(
        pluginId,
        procedureName,
        loadedProcedure.procedure.output,
        output,
      );
    },
    getWebEntry: (pluginId) => {
      const state = pluginStates.get(pluginId);
      if (!state?.manifest.webEntryPath || state.listItem.error) {
        return null;
      }
      return {
        filePath: state.manifest.webEntryPath,
        version: state.webVersion,
      };
    },
    subscribeToRegistryUpdates: (listener) => {
      updateListeners.add(listener);
      return () => {
        updateListeners.delete(listener);
      };
    },
    close: async () => {
      clearWatchers();
      for (const timer of reloadTimers.values()) {
        clearTimeout(timer);
      }
      reloadTimers.clear();
      for (const timer of rootWatchTimers.values()) {
        clearTimeout(timer);
      }
      rootWatchTimers.clear();
      for (const state of pluginStates.values()) {
        await unloadPlugin(state);
      }
      pluginStates.clear();
    },
  };
}
