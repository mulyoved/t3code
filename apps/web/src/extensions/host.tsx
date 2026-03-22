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
import type { QueryClient } from "@tanstack/react-query";

import { ensureNativeApi } from "~/nativeApi";
import type {
  ExtensionComposerItem,
  ExtensionComposerSource,
  ExtensionComposerTriggerKind,
  ExtensionUISlotId,
} from "./composer";
import { resolveWebExtensionActivator } from "./runtime";

interface LoadedWebExtensionHandle {
  readonly cleanup: (() => void | Promise<void>) | null;
}

type SlotRenderer = (props: Record<string, unknown>) => ReactNode;

interface RegisteredSlotRenderer {
  readonly id: string;
  readonly extensionId: string;
  readonly renderer: SlotRenderer;
}

interface ExtensionHostContextValue {
  readonly revision: number;
  readonly getComposerSources: (
    triggerKind: ExtensionComposerTriggerKind,
  ) => readonly ExtensionComposerSource[];
  readonly getSlotRenderers: (slotId: ExtensionUISlotId) => readonly RegisteredSlotRenderer[];
}

const ExtensionHostContext = createContext<ExtensionHostContextValue | null>(null);

class ExtensionRenderErrorBoundary extends Component<
  PropsWithChildren,
  {
    hasError: boolean;
  }
> {
  override state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  override componentDidCatch(error: unknown) {
    console.warn("Extension render failed", error);
  }

  override render() {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}

function compareExtensionItems(left: ExtensionComposerItem, right: ExtensionComposerItem): number {
  const leftPriority = left.priority ?? 0;
  const rightPriority = right.priority ?? 0;
  if (leftPriority !== rightPriority) {
    return rightPriority - leftPriority;
  }
  return left.label.localeCompare(right.label);
}

export function ExtensionHostProvider(
  props: PropsWithChildren<{
    queryClient: QueryClient;
  }>,
) {
  const nativeApi = useMemo(() => ensureNativeApi(), []);
  const composerSourcesRef = useRef<ExtensionComposerSource[]>([]);
  const slotRenderersRef = useRef<Map<ExtensionUISlotId, RegisteredSlotRenderer[]>>(new Map());
  const loadedExtensionsRef = useRef<Map<string, LoadedWebExtensionHandle>>(new Map());
  const [revision, setRevision] = useState(0);

  const bumpRevision = useCallback(() => {
    setRevision((current) => current + 1);
  }, []);

  const unregisterExtension = useCallback(async (extensionId: string) => {
    composerSourcesRef.current = composerSourcesRef.current.filter(
      (source) => !source.id.startsWith(`${extensionId}:`),
    );
    for (const [slotId, renderers] of slotRenderersRef.current) {
      const nextRenderers = renderers.filter((renderer) => renderer.extensionId !== extensionId);
      if (nextRenderers.length === 0) {
        slotRenderersRef.current.delete(slotId);
      } else {
        slotRenderersRef.current.set(slotId, nextRenderers);
      }
    }
    const handle = loadedExtensionsRef.current.get(extensionId);
    loadedExtensionsRef.current.delete(extensionId);
    if (handle?.cleanup) {
      await handle.cleanup();
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadedExtensionsRefValue = loadedExtensionsRef;

    const loadExtensions = async () => {
      const result = await nativeApi.extensions.list();
      if (cancelled) {
        return;
      }

      await Promise.all(
        [...loadedExtensionsRef.current.keys()].map((extensionId) =>
          unregisterExtension(extensionId),
        ),
      );

      for (const extension of result.extensions) {
        if (!extension.webUrl) {
          continue;
        }
        try {
          const module = await import(/* @vite-ignore */ extension.webUrl);
          if (cancelled) {
            return;
          }

          const activate = resolveWebExtensionActivator(module);
          if (!activate) {
            continue;
          }

          const extensionId = extension.id;
          const cleanupHandles: Array<() => void> = [];
          const cleanup = await activate({
            id: extensionId,
            callServer: (method: string, args?: unknown) =>
              nativeApi.extensions.call({
                extensionId,
                method,
                ...(args !== undefined ? { args } : {}),
              }),
            composer: {
              registerSource: (source: ExtensionComposerSource) => {
                const registeredSource = {
                  ...source,
                  id: `${extensionId}:${source.id}`,
                };
                composerSourcesRef.current = [...composerSourcesRef.current, registeredSource];
                bumpRevision();
                const unregister = () => {
                  composerSourcesRef.current = composerSourcesRef.current.filter(
                    (candidate) => candidate.id !== registeredSource.id,
                  );
                  bumpRevision();
                };
                cleanupHandles.push(unregister);
                return unregister;
              },
            },
            ui: {
              registerSlot: (slotId: ExtensionUISlotId, renderer: SlotRenderer) => {
                const rendererId = `${extensionId}:${slotId}:${crypto.randomUUID()}`;
                const current = slotRenderersRef.current.get(slotId) ?? [];
                slotRenderersRef.current.set(slotId, [
                  ...current,
                  { id: rendererId, extensionId, renderer },
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
            },
            host: {
              React,
              nativeApi,
              queryClient: props.queryClient,
            },
          });

          loadedExtensionsRef.current.set(extensionId, {
            cleanup: async () => {
              for (const dispose of cleanupHandles.toReversed()) {
                dispose();
              }
              if (typeof cleanup === "function") {
                await cleanup();
              }
            },
          });
          bumpRevision();
        } catch (error) {
          console.warn(`Failed to load web extension '${extension.id}'`, error);
        }
      }
    };

    void loadExtensions();
    const unsubscribe = nativeApi.extensions.onUpdated(() => {
      void loadExtensions();
    });

    return () => {
      cancelled = true;
      unsubscribe();
      void Promise.all(
        [...loadedExtensionsRefValue.current.keys()].map((extensionId) =>
          unregisterExtension(extensionId),
        ),
      );
    };
  }, [bumpRevision, nativeApi, props.queryClient, unregisterExtension]);

  const contextValue = useMemo<ExtensionHostContextValue>(
    () => ({
      revision,
      getComposerSources: (triggerKind) =>
        composerSourcesRef.current.filter((source) => source.triggers.includes(triggerKind)),
      getSlotRenderers: (slotId) => slotRenderersRef.current.get(slotId) ?? [],
    }),
    [revision],
  );

  return (
    <ExtensionHostContext.Provider value={contextValue}>
      {props.children}
    </ExtensionHostContext.Provider>
  );
}

function useExtensionHostContext(): ExtensionHostContextValue {
  const value = useContext(ExtensionHostContext);
  if (!value) {
    throw new Error("ExtensionHostProvider is missing");
  }
  return value;
}

export function useExtensionComposerItems(input: {
  triggerKind: ExtensionComposerTriggerKind | null;
  query: string;
  threadId?: string;
  cwd?: string | null;
}) {
  const host = useExtensionHostContext();
  const [items, setItems] = useState<readonly ExtensionComposerItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const triggerKind = input.triggerKind;
    if (!triggerKind) {
      setItems([]);
      setIsLoading(false);
      return;
    }

    const matchingSources = host.getComposerSources(triggerKind);
    if (matchingSources.length === 0) {
      setItems([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    void Promise.all(
      matchingSources.map(async (source) => {
        try {
          return await source.getItems({
            triggerKind,
            query: input.query,
            ...(input.threadId ? { threadId: input.threadId } : {}),
            ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
          });
        } catch (error) {
          console.warn(`Failed to resolve extension composer source '${source.id}'`, error);
          return [];
        }
      }),
    ).then((results) => {
      if (cancelled) {
        return;
      }
      setItems(results.flat().toSorted(compareExtensionItems));
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

export function ExtensionSlot(props: {
  slotId: ExtensionUISlotId;
  renderProps?: Record<string, unknown>;
}) {
  const host = useExtensionHostContext();
  const renderers = host.getSlotRenderers(props.slotId);
  if (renderers.length === 0) {
    return null;
  }

  return (
    <>
      {renderers.map((renderer) => (
        <ExtensionRenderErrorBoundary key={renderer.id}>
          {renderer.renderer(props.renderProps ?? {})}
        </ExtensionRenderErrorBoundary>
      ))}
    </>
  );
}
