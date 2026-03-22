import type { ProjectEntry } from "@t3tools/contracts";

export interface ExtensionManifest {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly rootDir: string;
  readonly manifestPath: string | null;
  readonly serverEntryPath: string | null;
  readonly webEntryPath: string | null;
}

export interface ExtensionListItemShape {
  id: string;
  name: string;
  webUrl?: string | undefined;
  hasServer: boolean;
  error?: string | undefined;
}

export type ServerExtensionMethod = (args: unknown) => Promise<unknown> | unknown;

export interface ServerExtensionContext {
  readonly id: string;
  readonly log: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  readonly method: (name: string, handler: ServerExtensionMethod) => void;
  readonly onDispose: (cleanup: () => void | Promise<void>) => void;
  readonly host: {
    listSkills: (input: { cwd?: string }) => Promise<unknown>;
    searchWorkspace: (input: {
      cwd: string;
      query?: string;
      limit?: number;
    }) => Promise<{ entries: readonly ProjectEntry[]; truncated: boolean }>;
    readWorkspaceFile: (input: { cwd: string; path: string }) => Promise<{ contents: string }>;
  };
}

export interface DiscoveredExtensionRoot {
  readonly rootDir: string;
  readonly manifestPath: string | null;
}
