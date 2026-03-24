import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type {
  DifitCloseResult,
  DifitProcessDiagnostics,
  DifitOpenFailureReason,
  DifitOpenInput,
  DifitOpenResult,
  DifitState,
  DifitStatusResult,
  OrchestrationReadModel,
} from "@t3tools/contracts";
import { buildDifitProxyBasePath, matchDifitProxyPath, proxyDifitRequest } from "./difitProxy";

const DIFIT_VERSION = "3.1.17";
const DIFIT_READY_TIMEOUT_MS = 15_000;
const DIFIT_READY_POLL_INTERVAL_MS = 250;
const LOOPBACK_HOST = "127.0.0.1";
const UNTRACKED_FILES_PROMPT =
  "Would you like to include these untracked files in the diff review?";

type Logger = (message: string, context?: Record<string, unknown>) => void;

interface ResolvedDifitCwd {
  readonly cwd: string | null;
  readonly source: "worktree" | "project" | "none";
  readonly reason?: Extract<DifitOpenFailureReason, "thread_not_found" | "no_active_worktree">;
}

export interface DifitManagerDependencies {
  readonly getSnapshot: () => Promise<OrchestrationReadModel>;
  readonly reserveLoopbackPort: () => Promise<number>;
  readonly fetchImpl?: typeof fetch;
  readonly spawnImpl?: typeof spawn;
  readonly logger?: Logger;
}

interface DifitRuntimeState {
  readonly state: DifitState;
  readonly cwd: string | null;
  readonly proxyPath: string | null;
  readonly sessionRevision: string | null;
  readonly reason?: DifitOpenFailureReason;
  readonly diagnostics?: DifitProcessDiagnostics;
}

interface ActiveProcessState {
  readonly child: ChildProcessWithoutNullStreams;
  readonly port: number;
  readonly cwd: string;
  readonly sessionRevision: string;
  readonly spawnToken: string;
  readonly diagnostics: {
    stdoutTail: string;
    stderrTail: string;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
  };
}

interface MutableDifitProcessDiagnostics {
  stdoutTail: string;
  stderrTail: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export interface DifitManager {
  readonly open: (input: DifitOpenInput) => Promise<DifitOpenResult>;
  readonly close: () => Promise<DifitCloseResult>;
  readonly status: () => Promise<DifitStatusResult>;
  readonly handleProxyRequest: (input: {
    request: Request;
    url: URL;
  }) => Promise<Response | null>;
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function appendTail(existing: string, nextChunk: string): string {
  return `${existing}${nextChunk}`.slice(-4_096);
}

function trimTail(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toDifitDiagnostics(input: {
  stdoutTail: string;
  stderrTail: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}): DifitProcessDiagnostics | undefined {
  const diagnostics = {
    ...(input.exitCode !== null ? { exitCode: input.exitCode } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
    ...(trimTail(input.stdoutTail) ? { stdoutTail: trimTail(input.stdoutTail)! } : {}),
    ...(trimTail(input.stderrTail) ? { stderrTail: trimTail(input.stderrTail)! } : {}),
  } satisfies Partial<DifitProcessDiagnostics>;

  return Object.keys(diagnostics).length > 0 ? (diagnostics as DifitProcessDiagnostics) : undefined;
}

function normalizeDifitLauncherCommand(): string {
  return process.platform === "win32" ? "bunx.cmd" : "bunx";
}

function buildDifitLauncherArgs(port: number): string[] {
  return [
    "--bun",
    `difit@${DIFIT_VERSION}`,
    ".",
    "--host",
    LOOPBACK_HOST,
    "--port",
    String(port),
    "--no-open",
    "--keep-alive",
  ];
}

export function resolveDifitThreadCwd(
  snapshot: OrchestrationReadModel,
  threadId: string,
): ResolvedDifitCwd {
  const thread = snapshot.threads.find(
    (entry) => entry.id === threadId && entry.deletedAt === null,
  );
  if (!thread) {
    return { cwd: null, source: "none", reason: "thread_not_found" };
  }
  if (thread.worktreePath) {
    return { cwd: thread.worktreePath, source: "worktree" };
  }
  const project = snapshot.projects.find(
    (entry) => entry.id === thread.projectId && entry.deletedAt === null,
  );
  if (!project) {
    return { cwd: null, source: "none", reason: "thread_not_found" };
  }
  if (project.workspaceRoot) {
    return { cwd: project.workspaceRoot, source: "project" };
  }
  return { cwd: null, source: "none", reason: "no_active_worktree" };
}

export function createDifitManager(dependencies: DifitManagerDependencies): DifitManager {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const spawnImpl = dependencies.spawnImpl ?? spawn;
  const logger = dependencies.logger ?? (() => undefined);

  let activeProcess: ActiveProcessState | null = null;
  let runtimeState: DifitRuntimeState = {
    state: "idle",
    cwd: null,
    proxyPath: null,
    sessionRevision: null,
  };
  let queue = Promise.resolve();

  const setRuntimeState = (next: DifitRuntimeState) => {
    runtimeState = next;
  };

  const terminateActiveProcess = async (): Promise<void> => {
    const processState = activeProcess;
    if (!processState) {
      setRuntimeState({
        state: "idle",
        cwd: null,
        proxyPath: null,
        sessionRevision: null,
      });
      return;
    }
    activeProcess = null;
    if (processState.child.exitCode !== null || processState.child.signalCode !== null) {
      setRuntimeState({
        state: "idle",
        cwd: null,
        proxyPath: null,
        sessionRevision: null,
      });
      return;
    }
    await new Promise<void>((resolve) => {
      processState.child.once("exit", () => resolve());
      processState.child.kill("SIGTERM");
      const killTimer = setTimeout(() => {
        if (processState.child.exitCode === null && processState.child.signalCode === null) {
          processState.child.kill("SIGKILL");
        }
        resolve();
      }, 1_000);
      killTimer.unref();
    });
    setRuntimeState({
      state: "idle",
      cwd: null,
      proxyPath: null,
      sessionRevision: null,
    });
  };

  const waitUntilReady = async (
    processState: ActiveProcessState,
  ): Promise<DifitOpenFailureReason | null> => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < DIFIT_READY_TIMEOUT_MS) {
      if (activeProcess?.spawnToken !== processState.spawnToken) {
        return "process_exited";
      }
      try {
        const response = await fetchImpl(`http://${LOOPBACK_HOST}:${processState.port}/api/diff`);
        if (response.ok) {
          return null;
        }
      } catch {
        // Continue polling until timeout or process exit.
      }
      await delay(DIFIT_READY_POLL_INTERVAL_MS);
    }
    return "startup_timeout";
  };

  const spawnDifit = async (cwd: string): Promise<DifitOpenResult> => {
    const port = await dependencies.reserveLoopbackPort();
    const sessionRevision = crypto.randomUUID();
    const proxyPath = `${buildDifitProxyBasePath(sessionRevision)}/`;
    const spawnToken = crypto.randomUUID();
    const command = normalizeDifitLauncherCommand();
    const args = buildDifitLauncherArgs(port);

    logger("starting difit process", { cwd, port, version: DIFIT_VERSION });

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawnImpl(command, args, {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      logger("failed to spawn difit process", { cwd, error: String(error) });
      setRuntimeState({
        state: "error",
        cwd,
        proxyPath: null,
        sessionRevision: null,
        reason: "spawn_failed",
      });
      return { ok: false, reason: "spawn_failed" };
    }

    let stdoutBuffer = "";
    let answeredUntrackedPrompt = false;
    const processDiagnostics: MutableDifitProcessDiagnostics = {
      stdoutTail: "",
      stderrTail: "",
      exitCode: null,
      signal: null,
    };
    child.stdout.on("data", (chunk) => {
      const data = chunk.toString();
      stdoutBuffer = appendTail(stdoutBuffer, data);
      processDiagnostics.stdoutTail = appendTail(processDiagnostics.stdoutTail, data);
      logger("difit stdout", { cwd, data: data.trim() });
      if (!answeredUntrackedPrompt && stdoutBuffer.includes(UNTRACKED_FILES_PROMPT)) {
        answeredUntrackedPrompt = true;
        child.stdin.write("n\n");
        logger("difit prompt answered", { cwd, answer: "n" });
      }
    });
    child.stderr.on("data", (chunk) => {
      const data = chunk.toString();
      processDiagnostics.stderrTail = appendTail(processDiagnostics.stderrTail, data);
      logger("difit stderr", { cwd, data: data.trim() });
    });

    const processState: ActiveProcessState = {
      child,
      port,
      cwd,
      sessionRevision,
      spawnToken,
      diagnostics: processDiagnostics,
    };
    activeProcess = processState;
    setRuntimeState({
      state: "starting",
      cwd,
      proxyPath,
      sessionRevision,
    });

    child.once("exit", (code, signal) => {
      processDiagnostics.exitCode = code;
      processDiagnostics.signal = signal;
      const diagnostics = toDifitDiagnostics(processDiagnostics);
      if (activeProcess?.spawnToken !== spawnToken) {
        return;
      }
      activeProcess = null;
      setRuntimeState({
        state: "error",
        cwd,
        proxyPath,
        sessionRevision,
        reason: "process_exited",
        ...(diagnostics ? { diagnostics } : {}),
      });
      logger("difit process exited", { cwd, code, signal, diagnostics });
    });
    child.once("error", (error) => {
      const diagnostics = toDifitDiagnostics(processDiagnostics);
      if (activeProcess?.spawnToken !== spawnToken) {
        return;
      }
      activeProcess = null;
      setRuntimeState({
        state: "error",
        cwd,
        proxyPath,
        sessionRevision,
        reason: "spawn_failed",
        ...(diagnostics ? { diagnostics } : {}),
      });
      logger("difit process error", { cwd, error: String(error), diagnostics });
    });

    const readinessFailure = await waitUntilReady(processState);
    if (readinessFailure) {
      const diagnostics = toDifitDiagnostics(processDiagnostics);
      await terminateActiveProcess();
      setRuntimeState({
        state: "error",
        cwd,
        proxyPath,
        sessionRevision,
        reason: readinessFailure,
        ...(diagnostics ? { diagnostics } : {}),
      });
      logger("difit readiness failed", { cwd, reason: readinessFailure, diagnostics });
      return {
        ok: false,
        reason: readinessFailure,
        ...(diagnostics ? { diagnostics } : {}),
      };
    }

    if (activeProcess?.spawnToken !== spawnToken) {
      const diagnostics = toDifitDiagnostics(processDiagnostics);
      setRuntimeState({
        state: "error",
        cwd,
        proxyPath,
        sessionRevision,
        reason: "process_exited",
        ...(diagnostics ? { diagnostics } : {}),
      });
      return {
        ok: false,
        reason: "process_exited",
        ...(diagnostics ? { diagnostics } : {}),
      };
    }

    setRuntimeState({
      state: "ready",
      cwd,
      proxyPath,
      sessionRevision,
    });
    logger("difit process ready", { cwd, port });
    return {
      ok: true,
      cwd,
      proxyPath,
      sessionRevision,
    };
  };

  const runExclusive = async <T>(operation: () => Promise<T>): Promise<T> => {
    const next = queue.catch(() => undefined).then(operation);
    queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  return {
    open: (input) =>
      runExclusive(async () => {
        const snapshot = await dependencies.getSnapshot();
        const resolved = resolveDifitThreadCwd(snapshot, input.threadId);
        if (!resolved.cwd) {
          return {
            ok: false,
            reason: resolved.reason ?? "no_active_worktree",
            ...(runtimeState.diagnostics ? { diagnostics: runtimeState.diagnostics } : {}),
          };
        }

        if (activeProcess && runtimeState.state === "ready" && activeProcess.cwd === resolved.cwd) {
          return {
            ok: true,
            cwd: activeProcess.cwd,
            proxyPath: `${buildDifitProxyBasePath(activeProcess.sessionRevision)}/`,
            sessionRevision: activeProcess.sessionRevision,
          };
        }

        if (activeProcess) {
          await terminateActiveProcess();
        }

        return spawnDifit(resolved.cwd);
      }),
    close: () =>
      runExclusive(async () => {
        await terminateActiveProcess();
        return { ok: true };
      }),
    status: () =>
      Promise.resolve({
        state: runtimeState.state,
        ...(runtimeState.cwd ? { cwd: runtimeState.cwd } : {}),
        ...(runtimeState.proxyPath ? { proxyPath: runtimeState.proxyPath } : {}),
        ...(runtimeState.reason ? { reason: runtimeState.reason } : {}),
        ...(runtimeState.diagnostics ? { diagnostics: runtimeState.diagnostics } : {}),
      }),
    handleProxyRequest: async ({ request, url }) => {
      const match = matchDifitProxyPath(url.pathname);
      if (!match) {
        return null;
      }
      if (
        runtimeState.state !== "ready" ||
        !activeProcess ||
        activeProcess.sessionRevision !== match.sessionRevision
      ) {
        return new Response("Difit session unavailable", {
          status: 503,
          headers: {
            "Content-Type": "text/plain",
          },
        });
      }
      return await proxyDifitRequest({
        request,
        url,
        targetOrigin: `http://${LOOPBACK_HOST}:${activeProcess.port}`,
        proxyBasePath: buildDifitProxyBasePath(activeProcess.sessionRevision),
      });
    },
  };
}
