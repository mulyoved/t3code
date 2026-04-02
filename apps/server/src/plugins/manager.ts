import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Exit, Schema } from "effect";

import type { PluginBootstrap, PluginListItem, ProjectEntry } from "@t3tools/contracts";
import type {
  ServerPluginContext,
  ServerPluginFactory,
  ServerPluginProcedure,
} from "@t3tools/plugin-sdk";
import { formatSchemaError } from "@t3tools/shared/schemaJson";

import { listAvailableSkills } from "../skills";
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

function createLogger(scope: string) {
  const prefix = `[${scope}]`;
  return {
    info: (...args: unknown[]) => console.info(prefix, ...args),
    warn: (...args: unknown[]) => console.warn(prefix, ...args),
    error: (...args: unknown[]) => console.error(prefix, ...args),
  };
}

function safeMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return String(error);
}

const WORKSPACE_SEARCH_MAX_ENTRIES = 25_000;
const WORKSPACE_SEARCH_IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".convex",
  "node_modules",
  ".next",
  ".turbo",
  "dist",
  "build",
  "out",
  ".cache",
]);

function parentPathOf(input: string): string | undefined {
  const separatorIndex = input.lastIndexOf("/");
  if (separatorIndex === -1) {
    return undefined;
  }
  return input.slice(0, separatorIndex);
}

function normalizeWorkspaceSearchQuery(input: string): string {
  return input
    .trim()
    .replace(/^[@./]+/, "")
    .toLowerCase();
}

function basenameOfPath(input: string): string {
  const separatorIndex = input.lastIndexOf("/");
  if (separatorIndex === -1) {
    return input;
  }
  return input.slice(separatorIndex + 1);
}

function scoreSubsequenceMatch(value: string, query: string): number | null {
  if (!query) return 0;

  let queryIndex = 0;
  let firstMatchIndex = -1;
  let previousMatchIndex = -1;
  let gapPenalty = 0;

  for (let valueIndex = 0; valueIndex < value.length; valueIndex += 1) {
    if (value[valueIndex] !== query[queryIndex]) {
      continue;
    }

    if (firstMatchIndex === -1) {
      firstMatchIndex = valueIndex;
    }
    if (previousMatchIndex !== -1) {
      gapPenalty += valueIndex - previousMatchIndex - 1;
    }

    previousMatchIndex = valueIndex;
    queryIndex += 1;
    if (queryIndex === query.length) {
      const spanPenalty = valueIndex - firstMatchIndex + 1 - query.length;
      const lengthPenalty = Math.min(64, value.length - query.length);
      return firstMatchIndex * 2 + gapPenalty * 3 + spanPenalty + lengthPenalty;
    }
  }

  return null;
}

function scoreWorkspaceEntry(entry: ProjectEntry, query: string): number | null {
  if (!query) {
    return entry.kind === "directory" ? 0 : 1;
  }

  const normalizedPath = entry.path.toLowerCase();
  const normalizedName = basenameOfPath(normalizedPath);

  if (normalizedName === query) return 0;
  if (normalizedPath === query) return 1;
  if (normalizedName.startsWith(query)) return 2;
  if (normalizedPath.startsWith(query)) return 3;
  if (normalizedPath.includes(`/${query}`)) return 4;
  if (normalizedName.includes(query)) return 5;
  if (normalizedPath.includes(query)) return 6;

  const nameFuzzyScore = scoreSubsequenceMatch(normalizedName, query);
  if (nameFuzzyScore !== null) {
    return 100 + nameFuzzyScore;
  }

  const pathFuzzyScore = scoreSubsequenceMatch(normalizedPath, query);
  if (pathFuzzyScore !== null) {
    return 200 + pathFuzzyScore;
  }

  return null;
}

async function searchWorkspaceEntries(input: {
  cwd: string;
  query: string;
  limit: number;
}): Promise<{ entries: ProjectEntry[]; truncated: boolean }> {
  const entries: ProjectEntry[] = [];
  let scannedCount = 0;
  let truncated = false;

  const walk = async (directoryPath: string, relativePrefix = ""): Promise<void> => {
    if (truncated) {
      return;
    }

    const dirEntries = await fs.promises
      .readdir(directoryPath, { withFileTypes: true })
      .catch(() => []);

    for (const dirEntry of dirEntries.toSorted((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      if (truncated) {
        return;
      }

      if (dirEntry.isDirectory() && WORKSPACE_SEARCH_IGNORED_DIRECTORY_NAMES.has(dirEntry.name)) {
        continue;
      }

      const relativePath = relativePrefix ? `${relativePrefix}/${dirEntry.name}` : dirEntry.name;
      const absolutePath = path.join(directoryPath, dirEntry.name);

      if (dirEntry.isDirectory()) {
        entries.push({
          path: relativePath,
          kind: "directory",
          ...(parentPathOf(relativePath) ? { parentPath: parentPathOf(relativePath) } : {}),
        });
        scannedCount += 1;
        if (scannedCount >= WORKSPACE_SEARCH_MAX_ENTRIES) {
          truncated = true;
          return;
        }
        await walk(absolutePath, relativePath);
        continue;
      }

      if (!dirEntry.isFile()) {
        continue;
      }

      entries.push({
        path: relativePath,
        kind: "file",
        ...(parentPathOf(relativePath) ? { parentPath: parentPathOf(relativePath) } : {}),
      });
      scannedCount += 1;
      if (scannedCount >= WORKSPACE_SEARCH_MAX_ENTRIES) {
        truncated = true;
        return;
      }
    }
  };

  await walk(input.cwd);

  const normalizedQuery = normalizeWorkspaceSearchQuery(input.query);
  const limit = Math.max(0, Math.floor(input.limit));
  const rankedEntries = entries
    .map((entry) => ({
      entry,
      score: scoreWorkspaceEntry(entry, normalizedQuery),
    }))
    .filter(
      (candidate): candidate is { entry: ProjectEntry; score: number } => candidate.score !== null,
    )
    .toSorted(
      (left, right) => left.score - right.score || left.entry.path.localeCompare(right.entry.path),
    );

  return {
    entries: rankedEntries.slice(0, limit).map((candidate) => candidate.entry),
    truncated: truncated || rankedEntries.length > limit,
  };
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
