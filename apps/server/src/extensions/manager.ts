import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createLogger } from "../logger";
import { listAvailableSkills } from "../skills";
import { searchWorkspaceEntries } from "../workspaceEntries";
import { discoverExtensionRoots, loadExtensionManifest } from "./discovery";
import type {
  ExtensionListItemShape,
  ExtensionManifest,
  ServerExtensionContext,
  ServerExtensionMethod,
} from "./types";

type ExtensionModuleActivation = (ctx: ServerExtensionContext) => unknown;

interface LoadedExtensionState {
  readonly manifest: ExtensionManifest;
  methods: Map<string, ServerExtensionMethod>;
  cleanup: Array<() => void | Promise<void>>;
  watchers: Array<fs.FSWatcher>;
  webVersion: string;
  error: string | null;
}

function safeMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return String(error);
}

function resolveWorkspaceReadTarget(input: { cwd: string; relativePath: string }): string {
  const absoluteTarget = path.resolve(input.cwd, input.relativePath);
  const relativeToRoot = path.relative(input.cwd, absoluteTarget).replaceAll("\\", "/");
  if (
    relativeToRoot.length === 0 ||
    relativeToRoot === "." ||
    relativeToRoot === ".." ||
    relativeToRoot.startsWith("../") ||
    path.isAbsolute(relativeToRoot)
  ) {
    throw new Error("Workspace file path must stay within the project root.");
  }
  return absoluteTarget;
}

async function maybeCallCleanup(cleanup: (() => void | Promise<void>) | undefined): Promise<void> {
  if (!cleanup) {
    return;
  }
  await cleanup();
}

export interface ExtensionManager {
  readonly listClientExtensions: () => ExtensionListItemShape[];
  readonly call: (extensionId: string, method: string, args: unknown) => Promise<unknown>;
  readonly getWebEntry: (extensionId: string) => { filePath: string; version: string } | null;
  readonly subscribeToUpdates: (listener: (ids: string[]) => void) => () => void;
  readonly close: () => Promise<void>;
}

export async function createExtensionManager(input: { cwd: string }): Promise<ExtensionManager> {
  const logger = createLogger("extensions");
  const extensionStates = new Map<string, LoadedExtensionState>();
  const updateListeners = new Set<(ids: string[]) => void>();
  const reloadTimers = new Map<string, ReturnType<typeof setTimeout>>();

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

  const unloadExtension = async (state: LoadedExtensionState) => {
    for (const watcher of state.watchers) {
      watcher.close();
    }
    state.watchers = [];
    const cleanupTasks = [...state.cleanup];
    state.cleanup = [];
    state.methods.clear();
    await Promise.all(cleanupTasks.map((cleanup) => maybeCallCleanup(cleanup)));
  };

  const activateExtension = async (manifest: ExtensionManifest): Promise<LoadedExtensionState> => {
    const state: LoadedExtensionState = {
      manifest,
      methods: new Map(),
      cleanup: [],
      watchers: [],
      webVersion: `${Date.now()}`,
      error: null,
    };

    const extensionLogger = {
      info: (...args: unknown[]) =>
        logger.info(`[${manifest.id}] ${args.map(safeMessage).join(" ")}`),
      warn: (...args: unknown[]) =>
        logger.warn(`[${manifest.id}] ${args.map(safeMessage).join(" ")}`),
      error: (...args: unknown[]) =>
        logger.error(`[${manifest.id}] ${args.map(safeMessage).join(" ")}`),
    };

    const context: ServerExtensionContext = {
      id: manifest.id,
      log: extensionLogger,
      method: (name, handler) => {
        state.methods.set(name, handler);
      },
      onDispose: (cleanup) => {
        state.cleanup.push(cleanup);
      },
      host: {
        listSkills: ({ cwd }) => listAvailableSkills(cwd ? { cwd } : {}),
        searchWorkspace: ({ cwd, query, limit }) =>
          searchWorkspaceEntries({
            cwd,
            query: query ?? "",
            limit: typeof limit === "number" ? limit : 100,
          }),
        readWorkspaceFile: async ({ cwd, path: relativePath }) => {
          const targetPath = resolveWorkspaceReadTarget({ cwd, relativePath });
          return {
            contents: await fs.promises.readFile(targetPath, "utf8"),
          };
        },
      },
    };

    if (manifest.serverEntryPath) {
      try {
        const serverModule = await import(
          `${pathToFileURL(manifest.serverEntryPath).href}?v=${Date.now()}`
        );
        const activate = (
          typeof serverModule.activateServer === "function"
            ? serverModule.activateServer
            : typeof serverModule.default === "function"
              ? serverModule.default
              : null
        ) as ExtensionModuleActivation | null;
        if (activate) {
          const maybeCleanup = await activate(context);
          if (typeof maybeCleanup === "function") {
            state.cleanup.push(maybeCleanup as () => void | Promise<void>);
          }
        }
      } catch (error) {
        state.error = safeMessage(error);
        extensionLogger.error("failed to activate server extension", error);
      }
    }

    const watchTargets = new Set<string>(
      [manifest.manifestPath, manifest.serverEntryPath, manifest.webEntryPath].flatMap((value) =>
        value ? [value] : [],
      ),
    );
    for (const watchTarget of watchTargets) {
      const watchDir = path.dirname(watchTarget);
      try {
        const watcher = fs.watch(watchDir, (_eventType, filename) => {
          if (!filename) {
            return;
          }
          const changedPath = path.resolve(watchDir, filename.toString());
          if (changedPath !== watchTarget) {
            return;
          }
          const existingTimer = reloadTimers.get(manifest.id);
          if (existingTimer) {
            clearTimeout(existingTimer);
          }
          reloadTimers.set(
            manifest.id,
            setTimeout(() => {
              reloadTimers.delete(manifest.id);
              void reloadExtension(manifest.id);
            }, 120),
          );
        });
        state.watchers.push(watcher);
      } catch (error) {
        extensionLogger.warn("failed to watch extension path", watchTarget, safeMessage(error));
      }
    }

    return state;
  };

  const reloadExtension = async (extensionId: string) => {
    const existing = extensionStates.get(extensionId);
    if (!existing) {
      return;
    }
    await unloadExtension(existing);
    const nextManifest = await loadExtensionManifest({
      rootDir: existing.manifest.rootDir,
      manifestPath: existing.manifest.manifestPath,
    });
    if (!nextManifest || !nextManifest.enabled) {
      extensionStates.delete(extensionId);
      notifyUpdated([extensionId]);
      return;
    }
    const reloaded = await activateExtension(nextManifest);
    extensionStates.set(nextManifest.id, reloaded);
    notifyUpdated([nextManifest.id]);
  };

  const discoveredRoots = await discoverExtensionRoots(input.cwd);
  const manifests = (
    await Promise.all(discoveredRoots.map((root) => loadExtensionManifest(root)))
  ).filter((manifest): manifest is ExtensionManifest => manifest !== null && manifest.enabled);

  for (const manifest of manifests) {
    const loaded = await activateExtension(manifest);
    extensionStates.set(manifest.id, loaded);
  }

  return {
    listClientExtensions: () =>
      [...extensionStates.values()].map((state) => {
        const webUrl = state.manifest.webEntryPath
          ? `/__extensions/${encodeURIComponent(state.manifest.id)}/web.js?v=${encodeURIComponent(state.webVersion)}`
          : undefined;
        const item: ExtensionListItemShape = {
          id: state.manifest.id,
          name: state.manifest.name,
          hasServer: state.manifest.serverEntryPath !== null,
        };
        if (webUrl) {
          item.webUrl = webUrl;
        }
        if (state.error) {
          item.error = state.error;
        }
        return item;
      }),
    call: async (extensionId, method, args) => {
      const state = extensionStates.get(extensionId);
      if (!state) {
        throw new Error(`Unknown extension: ${extensionId}`);
      }
      const handler = state.methods.get(method);
      if (!handler) {
        throw new Error(`Unknown extension method '${method}' for ${extensionId}`);
      }
      return handler(args);
    },
    getWebEntry: (extensionId) => {
      const state = extensionStates.get(extensionId);
      if (!state?.manifest.webEntryPath) {
        return null;
      }
      return {
        filePath: state.manifest.webEntryPath,
        version: state.webVersion,
      };
    },
    subscribeToUpdates: (listener) => {
      updateListeners.add(listener);
      return () => {
        updateListeners.delete(listener);
      };
    },
    close: async () => {
      for (const timer of reloadTimers.values()) {
        clearTimeout(timer);
      }
      reloadTimers.clear();
      await Promise.all([...extensionStates.values()].map((state) => unloadExtension(state)));
      extensionStates.clear();
    },
  };
}
