import * as React from "react";
import {
  type PropsWithChildren,
  type ReactNode,
  Component,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  PluginComposerItem,
  PluginComposerQueryContext,
  PluginSlotId,
} from "@t3tools/contracts";

import { ensureNativeApi } from "~/nativeApi";
import { comparePluginComposerItems } from "./composer";
import { resolveWebPluginActivator } from "./runtime";

interface LoadedWebPluginHandle {
  readonly cleanup: (() => void | Promise<void>) | null;
}

type SlotRenderer = (props: Record<string, unknown>) => ReactNode;

interface RegisteredSlotRenderer {
  readonly id: string;
  readonly pluginId: string;
  readonly renderer: SlotRenderer;
}

interface PluginComposerProvider {
  readonly id: string;
  readonly pluginId: string;
  readonly triggers: readonly PluginComposerQueryContext["triggerKind"][];
  readonly getItems: (
    input: PluginComposerQueryContext,
  ) => readonly PluginComposerItem[] | Promise<readonly PluginComposerItem[]>;
}

interface PluginHostContextValue {
  readonly revision: number;
  readonly getComposerProviders: (
    triggerKind: PluginComposerQueryContext["triggerKind"],
  ) => readonly PluginComposerProvider[];
  readonly getSlotRenderers: (slotId: PluginSlotId) => readonly RegisteredSlotRenderer[];
}

const PluginHostContext = createContext<PluginHostContextValue | null>(null);

class PluginRenderErrorBoundary extends Component<
  PropsWithChildren<{ pluginId: string }>,
  { hasError: boolean }
> {
  override state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  override componentDidCatch(error: unknown) {
    console.warn(`Plugin render failed '${this.props.pluginId}'`, error);
  }

  override render() {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}

export function PluginHostProvider(props: PropsWithChildren) {
  const nativeApi = useMemo(() => ensureNativeApi(), []);
  const composerProvidersRef = useRef<PluginComposerProvider[]>([]);
  const slotRenderersRef = useRef<Map<PluginSlotId, RegisteredSlotRenderer[]>>(new Map());
  const loadedPluginsRef = useRef<Map<string, LoadedWebPluginHandle>>(new Map());
  const [revision, setRevision] = useState(0);

  const bumpRevision = useCallback(() => {
    setRevision((current) => current + 1);
  }, []);

  const unregisterPlugin = useCallback(
    async (pluginId: string) => {
      composerProvidersRef.current = composerProvidersRef.current.filter(
        (provider) => provider.pluginId !== pluginId,
      );
      for (const [slotId, renderers] of slotRenderersRef.current) {
        const nextRenderers = renderers.filter((renderer) => renderer.pluginId !== pluginId);
        if (nextRenderers.length === 0) {
          slotRenderersRef.current.delete(slotId);
        } else {
          slotRenderersRef.current.set(slotId, nextRenderers);
        }
      }

      const handle = loadedPluginsRef.current.get(pluginId);
      loadedPluginsRef.current.delete(pluginId);
      if (handle?.cleanup) {
        await handle.cleanup();
      }
      bumpRevision();
    },
    [bumpRevision],
  );

  useEffect(() => {
    let cancelled = false;
    const loadedPluginsRefValue = loadedPluginsRef;

    const loadPlugins = async () => {
      const bootstrap = await nativeApi.plugins.getBootstrap();
      if (cancelled) {
        return;
      }

      await Promise.all(
        [...loadedPluginsRef.current.keys()].map((pluginId) => unregisterPlugin(pluginId)),
      );

      for (const plugin of bootstrap.plugins) {
        if (!plugin.webUrl || !plugin.enabled || !plugin.compatible) {
          continue;
        }

        try {
          const module = await import(/* @vite-ignore */ plugin.webUrl);
          if (cancelled) {
            return;
          }

          const activate = resolveWebPluginActivator(module);
          if (!activate) {
            continue;
          }

          const pluginId = plugin.id;
          let slotRegistrationCount = 0;
          const cleanupHandles: Array<() => void> = [];
          const cleanupRegistrations = () => {
            for (const cleanup of cleanupHandles.toReversed()) {
              cleanup();
            }
          };

          const cleanup = await activate({
            pluginId,
            callProcedure: (input: { pluginId?: string; procedure: string; payload?: unknown }) =>
              nativeApi.plugins.callProcedure({
                pluginId: input.pluginId ?? pluginId,
                procedure: input.procedure,
                ...(input.payload !== undefined ? { payload: input.payload } : {}),
              }),
            registerComposerProvider: (provider: Omit<PluginComposerProvider, "pluginId">) => {
              const registeredProvider: PluginComposerProvider = {
                ...provider,
                pluginId,
                id: `${pluginId}:${provider.id}`,
              };
              composerProvidersRef.current = [...composerProvidersRef.current, registeredProvider];
              bumpRevision();
              const unregister = () => {
                composerProvidersRef.current = composerProvidersRef.current.filter(
                  (candidate) => candidate.id !== registeredProvider.id,
                );
                bumpRevision();
              };
              cleanupHandles.push(unregister);
              return unregister;
            },
            registerSlot: (slotId: PluginSlotId, renderer: SlotRenderer) => {
              slotRegistrationCount += 1;
              const rendererId = `${pluginId}:${slotId}:${slotRegistrationCount}`;
              const current = slotRenderersRef.current.get(slotId) ?? [];
              slotRenderersRef.current.set(slotId, [
                ...current,
                { id: rendererId, pluginId, renderer },
              ]);
              bumpRevision();
              const unregister = () => {
                const existing = slotRenderersRef.current.get(slotId) ?? [];
                const next = existing.filter((candidate) => candidate.id !== rendererId);
                if (next.length === 0) {
                  slotRenderersRef.current.delete(slotId);
                } else {
                  slotRenderersRef.current.set(slotId, next);
                }
                bumpRevision();
              };
              cleanupHandles.push(unregister);
              return unregister;
            },
            onDispose: (cleanup: () => void | Promise<void>) => {
              cleanupHandles.push(() => {
                void cleanup();
              });
            },
          });

          loadedPluginsRef.current.set(pluginId, {
            cleanup: async () => {
              cleanupRegistrations();
              if (typeof cleanup === "function") {
                await cleanup();
              }
            },
          });
          bumpRevision();
        } catch (error) {
          console.warn(`Failed to load web plugin '${plugin.id}'`, error);
        }
      }
    };

    void loadPlugins();
    const unsubscribe = nativeApi.plugins.onRegistryUpdated(() => {
      void loadPlugins();
    });

    return () => {
      cancelled = true;
      unsubscribe();
      void Promise.all(
        [...loadedPluginsRefValue.current.keys()].map((pluginId) => unregisterPlugin(pluginId)),
      );
    };
  }, [bumpRevision, nativeApi, unregisterPlugin]);

  const contextValue = useMemo<PluginHostContextValue>(
    () => ({
      revision,
      getComposerProviders: (triggerKind) =>
        composerProvidersRef.current
          .filter((provider) => provider.triggers.includes(triggerKind))
          .toSorted((left, right) => left.pluginId.localeCompare(right.pluginId)),
      getSlotRenderers: (slotId) =>
        (slotRenderersRef.current.get(slotId) ?? []).toSorted((left, right) =>
          left.pluginId.localeCompare(right.pluginId),
        ),
    }),
    [revision],
  );

  return (
    <PluginHostContext.Provider value={contextValue}>{props.children}</PluginHostContext.Provider>
  );
}

function usePluginHostContext(): PluginHostContextValue {
  const value = useContext(PluginHostContext);
  if (!value) {
    throw new Error("PluginHostProvider is missing");
  }
  return value;
}

export function usePluginComposerItems(input: {
  triggerKind: PluginComposerQueryContext["triggerKind"] | null;
  query: string;
  threadId?: string;
  cwd?: string | null;
}) {
  const host = usePluginHostContext();
  const [items, setItems] = useState<readonly PluginComposerItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!input.triggerKind) {
      setItems([]);
      setIsLoading(false);
      return;
    }

    const matchingProviders = host.getComposerProviders(input.triggerKind);
    if (matchingProviders.length === 0) {
      setItems([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    void Promise.all(
      matchingProviders.map(async (provider) => {
        try {
          return await provider.getItems({
            triggerKind: input.triggerKind!,
            query: input.query,
            ...(input.threadId ? { threadId: input.threadId } : {}),
            ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
          });
        } catch (error) {
          console.warn(`Failed to resolve plugin composer provider '${provider.id}'`, error);
          return [];
        }
      }),
    ).then((results) => {
      if (cancelled) {
        return;
      }
      setItems(results.flat().toSorted(comparePluginComposerItems));
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [host, host.revision, input.cwd, input.query, input.threadId, input.triggerKind]);

  return {
    items,
    isLoading,
  };
}

export function PluginSlot(props: { slotId: PluginSlotId; renderProps?: Record<string, unknown> }) {
  const host = usePluginHostContext();
  const renderers = host.getSlotRenderers(props.slotId);
  if (renderers.length === 0) {
    return null;
  }

  return (
    <>
      {renderers.map((renderer) => (
        <PluginRenderErrorBoundary key={renderer.id} pluginId={renderer.pluginId}>
          {renderer.renderer(props.renderProps ?? {})}
        </PluginRenderErrorBoundary>
      ))}
    </>
  );
}
