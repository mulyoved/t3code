import fs from "node:fs/promises";
import path from "node:path";

import type { DiscoveredExtensionRoot, ExtensionManifest } from "./types";

const EXTENSIONS_ENV_VAR = "T3CODE_EXTENSION_DIRS";
const DEFAULT_LOCAL_EXTENSIONS_DIR = "extensions";

function normalizeConfiguredRoots(cwd: string): string[] {
  const configured = (process.env[EXTENSIONS_ENV_VAR] ?? "")
    .split(path.delimiter)
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .map((value) => path.resolve(value));
  const localDefaultRoot = path.resolve(cwd, DEFAULT_LOCAL_EXTENSIONS_DIR);
  return Array.from(new Set([...configured, localDefaultRoot]));
}

async function pathExists(candidatePath: string): Promise<boolean> {
  try {
    await fs.access(candidatePath);
    return true;
  } catch {
    return false;
  }
}

async function statDirectory(candidatePath: string): Promise<boolean> {
  try {
    return (await fs.stat(candidatePath)).isDirectory();
  } catch {
    return false;
  }
}

async function discoverRootCandidates(rootPath: string): Promise<DiscoveredExtensionRoot[]> {
  if (!(await statDirectory(rootPath))) {
    return [];
  }

  const directManifestPath = path.join(rootPath, "t3.extension.json");
  const directServerEntry = path.join(rootPath, "dist", "server.js");
  const directWebEntry = path.join(rootPath, "dist", "web.js");
  if (
    (await pathExists(directManifestPath)) ||
    (await pathExists(directServerEntry)) ||
    (await pathExists(directWebEntry))
  ) {
    return [
      {
        rootDir: rootPath,
        manifestPath: (await pathExists(directManifestPath)) ? directManifestPath : null,
      },
    ];
  }

  const entries = await fs.readdir(rootPath, { withFileTypes: true }).catch(() => []);
  const childCandidates = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const childRoot = path.join(rootPath, entry.name);
        const manifestPath = path.join(childRoot, "t3.extension.json");
        const serverEntry = path.join(childRoot, "dist", "server.js");
        const webEntry = path.join(childRoot, "dist", "web.js");
        if (
          (await pathExists(manifestPath)) ||
          (await pathExists(serverEntry)) ||
          (await pathExists(webEntry))
        ) {
          return {
            rootDir: childRoot,
            manifestPath: (await pathExists(manifestPath)) ? manifestPath : null,
          } satisfies DiscoveredExtensionRoot;
        }
        return null;
      }),
  );

  return childCandidates.filter(
    (candidate): candidate is DiscoveredExtensionRoot => candidate !== null,
  );
}

export async function discoverExtensionRoots(cwd: string): Promise<DiscoveredExtensionRoot[]> {
  const rootPaths = normalizeConfiguredRoots(cwd);
  const discovered = await Promise.all(
    rootPaths.map((rootPath) => discoverRootCandidates(rootPath)),
  );
  return discovered.flat();
}

interface ManifestFileShape {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly enabled?: unknown;
  readonly server?: unknown;
  readonly web?: unknown;
}

function trimNonEmpty(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function loadExtensionManifest(
  root: DiscoveredExtensionRoot,
): Promise<ExtensionManifest | null> {
  const manifestData: ManifestFileShape =
    root.manifestPath !== null
      ? await fs
          .readFile(root.manifestPath, "utf8")
          .then((contents) => JSON.parse(contents) as ManifestFileShape)
          .catch(() => ({}))
      : {};

  const resolvedId = trimNonEmpty(manifestData.id) ?? path.basename(root.rootDir);
  const resolvedName = trimNonEmpty(manifestData.name) ?? resolvedId;
  if (!resolvedId || !resolvedName) {
    return null;
  }

  const enabled = manifestData.enabled !== false;
  const serverRelative = trimNonEmpty(manifestData.server) ?? "dist/server.js";
  const webRelative = trimNonEmpty(manifestData.web) ?? "dist/web.js";
  const serverCandidate = path.resolve(root.rootDir, serverRelative);
  const webCandidate = path.resolve(root.rootDir, webRelative);

  return {
    id: resolvedId,
    name: resolvedName,
    enabled,
    rootDir: root.rootDir,
    manifestPath: root.manifestPath,
    serverEntryPath: (await pathExists(serverCandidate)) ? serverCandidate : null,
    webEntryPath: (await pathExists(webCandidate)) ? webCandidate : null,
  };
}
