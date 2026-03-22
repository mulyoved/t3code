import fs from "node:fs/promises";
import path from "node:path";

import type { DiscoveredPluginManifest, DiscoveredPluginRoot } from "./types";

const PLUGINS_ENV_VAR = "T3CODE_PLUGIN_DIRS";
const DEFAULT_LOCAL_PLUGINS_DIR = "plugins";
const PLUGIN_MANIFEST_FILE = "t3-plugin.json";

interface RawPluginManifest {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly version?: unknown;
  readonly hostApiVersion?: unknown;
  readonly enabled?: unknown;
  readonly serverEntry?: unknown;
  readonly webEntry?: unknown;
}

function trimNonEmpty(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function pathExists(candidatePath: string): Promise<boolean> {
  try {
    await fs.access(candidatePath);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(candidatePath: string): Promise<boolean> {
  try {
    return (await fs.stat(candidatePath)).isDirectory();
  } catch {
    return false;
  }
}

function normalizePluginRoots(cwd: string): string[] {
  const configuredRoots = (process.env[PLUGINS_ENV_VAR] ?? "")
    .split(path.delimiter)
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .map((value) => path.resolve(value));
  const localRoot = path.resolve(cwd, DEFAULT_LOCAL_PLUGINS_DIR);
  return Array.from(new Set([localRoot, ...configuredRoots]));
}

async function discoverRootCandidates(rootPath: string): Promise<DiscoveredPluginRoot[]> {
  if (!(await isDirectory(rootPath))) {
    return [];
  }

  const directManifestPath = path.join(rootPath, PLUGIN_MANIFEST_FILE);
  if (await pathExists(directManifestPath)) {
    return [{ rootDir: rootPath, manifestPath: directManifestPath }];
  }

  const entries = await fs.readdir(rootPath, { withFileTypes: true }).catch(() => []);
  const childCandidates = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      rootDir: path.join(rootPath, entry.name),
      manifestPath: path.join(rootPath, entry.name, PLUGIN_MANIFEST_FILE),
    }));

  const existingCandidates = await Promise.all(
    childCandidates.map(async (candidate) =>
      (await pathExists(candidate.manifestPath)) ? candidate : null,
    ),
  );

  return existingCandidates.filter(
    (candidate): candidate is DiscoveredPluginRoot => candidate !== null,
  );
}

export async function discoverPluginRoots(cwd: string): Promise<DiscoveredPluginRoot[]> {
  const rootCandidates = await Promise.all(
    normalizePluginRoots(cwd).map((rootPath) => discoverRootCandidates(rootPath)),
  );

  const flatCandidates = rootCandidates.flat();
  const existingCandidates = await Promise.all(
    flatCandidates.map(async (candidate) =>
      (await pathExists(candidate.manifestPath)) ? candidate : null,
    ),
  );

  return existingCandidates.filter(
    (candidate): candidate is DiscoveredPluginRoot => candidate !== null,
  );
}

export async function loadPluginManifest(
  root: DiscoveredPluginRoot,
): Promise<DiscoveredPluginManifest> {
  const rawManifest = await fs
    .readFile(root.manifestPath, "utf8")
    .then((contents) => JSON.parse(contents) as RawPluginManifest)
    .catch(() => ({}) as RawPluginManifest);

  const fallbackId = path.basename(root.rootDir);
  const id = trimNonEmpty(rawManifest.id) ?? fallbackId;
  const name = trimNonEmpty(rawManifest.name) ?? id;
  const version = trimNonEmpty(rawManifest.version) ?? "0.0.0";
  const hostApiVersion = trimNonEmpty(rawManifest.hostApiVersion) ?? "unknown";
  const enabled = rawManifest.enabled !== false;
  const serverEntry = trimNonEmpty(rawManifest.serverEntry) ?? "dist/server.js";
  const webEntry = trimNonEmpty(rawManifest.webEntry) ?? "dist/web.js";
  const serverEntryPath = (await pathExists(path.resolve(root.rootDir, serverEntry)))
    ? path.resolve(root.rootDir, serverEntry)
    : null;
  const webEntryPath = (await pathExists(path.resolve(root.rootDir, webEntry)))
    ? path.resolve(root.rootDir, webEntry)
    : null;

  let error: string | null = null;
  if (!trimNonEmpty(rawManifest.id)) {
    error = "Plugin manifest is missing a valid 'id'.";
  } else if (!trimNonEmpty(rawManifest.name)) {
    error = "Plugin manifest is missing a valid 'name'.";
  } else if (!trimNonEmpty(rawManifest.version)) {
    error = "Plugin manifest is missing a valid 'version'.";
  } else if (!trimNonEmpty(rawManifest.hostApiVersion)) {
    error = "Plugin manifest is missing a valid 'hostApiVersion'.";
  }

  return {
    id,
    name,
    version,
    hostApiVersion,
    enabled,
    compatible: hostApiVersion === "1" && error === null,
    rootDir: root.rootDir,
    manifestPath: root.manifestPath,
    serverEntryPath,
    webEntryPath,
    error,
  };
}
