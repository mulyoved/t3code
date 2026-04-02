import {
  type DifitOpenFailureReason,
  ThreadId,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon, LoaderCircleIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "../components/ui/button";
import { toastManager } from "../components/ui/toast";
import { readNativeApi } from "../nativeApi";
import { resolveShortcutCommand, shortcutLabelForCommand } from "../keybindings";
import { useServerKeybindings } from "../rpc/serverState";
import { useStore } from "../store";

const EMPTY_KEYBINDINGS: ResolvedKeybindingsConfig = [];
const DIFIT_IFRAME_SANDBOX =
  "allow-downloads allow-forms allow-modals allow-popups allow-same-origin allow-scripts";

function buildDifitProxyPath(sessionRevision: string): string {
  return `/__difit/${encodeURIComponent(sessionRevision)}/`;
}

function difitFailureMessage(reason: DifitOpenFailureReason): string {
  switch (reason) {
    case "no_active_worktree":
      return "No active worktree is available for this thread.";
    case "thread_not_found":
      return "This thread is not available for fullscreen diff.";
    case "spawn_failed":
      return "Failed to start difit.";
    case "startup_timeout":
      return "Timed out while starting difit.";
    case "process_exited":
      return "Difit exited before it was ready.";
  }
}

function DifitRouteView() {
  const navigate = useNavigate();
  const threadId = Route.useParams({
    select: (params) => ThreadId.makeUnsafe(params.threadId),
  });
  const search = Route.useSearch();
  const thread = useStore((store) => store.threads.find((entry) => entry.id === threadId) ?? null);
  const api = readNativeApi();
  const keybindings = useServerKeybindings() ?? EMPTY_KEYBINDINGS;
  const difitShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "difit.toggle"),
    [keybindings],
  );
  const [iframeSrc, setIframeSrc] = useState<string | null>(
    search.sessionRevision ? buildDifitProxyPath(search.sessionRevision) : null,
  );
  const [isOpening, setIsOpening] = useState(search.sessionRevision === undefined);
  const [isFrameLoading, setIsFrameLoading] = useState(search.sessionRevision !== undefined);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const closeDifit = useCallback(() => {
    void navigate({
      to: "/$threadId",
      params: { threadId },
      replace: true,
    });
  }, [navigate, threadId]);

  useEffect(() => {
    if (!thread) {
      void navigate({ to: "/", replace: true });
    }
  }, [navigate, thread]);

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeDifit();
        return;
      }
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: false,
          terminalOpen: false,
        },
      });
      if (command !== "difit.toggle") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      closeDifit();
    };
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, [closeDifit, keybindings]);

  useEffect(() => {
    if (!api || !thread) {
      return;
    }

    let cancelled = false;
    setIsOpening(true);
    setErrorMessage(null);

    void api.difit
      .open({ threadId })
      .then(async (result) => {
        if (cancelled) {
          return;
        }
        if (!result.ok) {
          const message = difitFailureMessage(result.reason);
          setErrorMessage(message);
          setIsOpening(false);
          toastManager.add({
            type: "error",
            title: message,
          });
          return;
        }

        setIsOpening(false);
        if (iframeSrc !== result.proxyPath) {
          setIframeSrc(result.proxyPath);
          setIsFrameLoading(true);
        } else {
          setIsFrameLoading(false);
        }
        if (search.sessionRevision !== result.sessionRevision) {
          await navigate({
            to: "/difit/$threadId",
            params: { threadId },
            replace: true,
            search: { sessionRevision: result.sessionRevision },
          });
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setIsOpening(false);
        setErrorMessage(error instanceof Error ? error.message : "Failed to open difit.");
      });

    return () => {
      cancelled = true;
    };
  }, [api, iframeSrc, navigate, search.sessionRevision, thread, thread?.worktreePath, threadId]);

  if (!thread) {
    return null;
  }

  return (
    <div className="relative flex h-dvh min-h-0 flex-col bg-background text-foreground">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex p-4">
        <Button
          size="sm"
          variant="outline"
          onClick={closeDifit}
          className="pointer-events-auto bg-background/92 backdrop-blur-sm"
        >
          <ArrowLeftIcon />
          Back{difitShortcutLabel ? ` (${difitShortcutLabel})` : ""}
        </Button>
      </div>
      <div className="relative min-h-0 flex-1 bg-background">
        {iframeSrc ? (
          <iframe
            key={iframeSrc}
            title="Difit"
            src={iframeSrc}
            className="h-full w-full border-0"
            sandbox={DIFIT_IFRAME_SANDBOX}
            onLoad={() => {
              setIsFrameLoading(false);
            }}
            onError={() => {
              setErrorMessage("Failed to load the diff viewer.");
              setIsFrameLoading(false);
            }}
          />
        ) : null}
        {(isOpening || isFrameLoading || errorMessage) && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/94 backdrop-blur-sm">
            <div className="flex max-w-md flex-col items-center gap-3 px-6 text-center">
              {errorMessage ? null : <LoaderCircleIcon className="size-5 animate-spin" />}
              <p className="text-sm font-medium">
                {errorMessage ?? (isOpening ? "Starting difit..." : "Loading diff viewer...")}
              </p>
              {errorMessage ? (
                <Button size="sm" variant="outline" onClick={closeDifit}>
                  Return to thread
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/difit/$threadId")({
  validateSearch: (search) => ({
    sessionRevision:
      typeof search.sessionRevision === "string" && search.sessionRevision.length > 0
        ? search.sessionRevision
        : undefined,
  }),
  component: DifitRouteView,
});
