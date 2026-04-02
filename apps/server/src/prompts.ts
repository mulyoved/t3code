import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { PromptSourceKind, PromptSummary, PromptsListInput } from "@t3tools/contracts";

interface PromptRoot {
  readonly rootPath: string;
  readonly sourceKind: PromptSourceKind;
}

function sourceOrder(sourceKind: PromptSourceKind): number {
  return sourceKind === "project" ? 0 : 1;
}

function dedupeBy<T>(values: readonly T[], keyOf: (value: T) => string): T[] {
  const seen = new Set<string>();
  const next: T[] = [];
  for (const value of values) {
    const key = keyOf(value);
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(value);
  }
  return next;
}

function extractFrontmatter(markdown: string): string {
  return /^---\n([\s\S]*?)\n---\n?/.exec(markdown)?.[1] ?? "";
}

function extractFrontmatterValue(frontmatter: string, key: string): string | undefined {
  const match = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(frontmatter);
  const rawValue = match?.[1]?.trim();
  if (!rawValue) return undefined;
  return rawValue.replace(/^['"]|['"]$/g, "").trim() || undefined;
}

function extractHeading(markdown: string): string | undefined {
  const heading = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim();
  return heading && heading.length > 0 ? heading : undefined;
}

function parsePromptMarkdown(input: { markdown: string; fallbackName: string }) {
  const frontmatter = extractFrontmatter(input.markdown);
  const heading = extractHeading(input.markdown);
  const displayName = heading ?? input.fallbackName;
  const description =
    extractFrontmatterValue(frontmatter, "description") ??
    (heading ? `Use the ${heading} prompt.` : `Use the /${input.fallbackName} prompt.`);
  const argumentHint = extractFrontmatterValue(frontmatter, "argument-hint");

  return {
    displayName,
    description,
    argumentHint,
  };
}

async function listPromptFiles(rootPath: string): Promise<string[]> {
  const entries = await fs.readdir(rootPath, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
    .map((entry) => path.join(rootPath, entry.name))
    .toSorted((left, right) => left.localeCompare(right));
}

async function readPromptSummary(input: {
  readonly promptFilePath: string;
  readonly sourceKind: PromptSourceKind;
}): Promise<PromptSummary | null> {
  const markdown = await fs.readFile(input.promptFilePath, "utf8").catch(() => null);
  if (!markdown) {
    return null;
  }

  const fallbackName = path
    .basename(input.promptFilePath, path.extname(input.promptFilePath))
    .trim();
  if (!fallbackName) {
    return null;
  }

  const parsed = parsePromptMarkdown({
    markdown,
    fallbackName,
  });

  return {
    id: `${input.sourceKind}:${input.promptFilePath}`,
    name: fallbackName,
    displayName: parsed.displayName,
    description: parsed.description,
    ...(parsed.argumentHint ? { argumentHint: parsed.argumentHint } : {}),
    sourceKind: input.sourceKind,
    sourcePath: input.promptFilePath,
    defaultPrompt: `/${fallbackName} `,
  } satisfies PromptSummary;
}

function promptRootsForInput(input: PromptsListInput): PromptRoot[] {
  const homeDir = os.homedir();
  const projectRoots =
    input.cwd?.trim().length && input.cwd
      ? [{ rootPath: path.join(input.cwd, ".codex", "prompts"), sourceKind: "project" as const }]
      : [];

  const userRoots = [
    { rootPath: path.join(homeDir, ".codex", "prompts"), sourceKind: "user" as const },
  ];

  return dedupeBy([...projectRoots, ...userRoots], (root) => root.rootPath);
}

function comparePrompts(left: PromptSummary, right: PromptSummary): number {
  const sourceDelta = sourceOrder(left.sourceKind) - sourceOrder(right.sourceKind);
  if (sourceDelta !== 0) return sourceDelta;

  const nameDelta = left.name.localeCompare(right.name);
  if (nameDelta !== 0) return nameDelta;

  return left.sourcePath.localeCompare(right.sourcePath);
}

export async function listAvailablePrompts(input: PromptsListInput): Promise<PromptSummary[]> {
  const roots = promptRootsForInput(input);
  const promptSummaries = await Promise.all(
    roots.map(async ({ rootPath, sourceKind }) => {
      const promptFiles = await listPromptFiles(rootPath);
      const prompts = await Promise.all(
        promptFiles.map((promptFilePath) =>
          readPromptSummary({
            promptFilePath,
            sourceKind,
          }),
        ),
      );
      return prompts.filter((prompt): prompt is PromptSummary => prompt !== null);
    }),
  );

  return dedupeBy(promptSummaries.flat().toSorted(comparePrompts), (prompt) => prompt.name);
}
