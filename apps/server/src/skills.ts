import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { SkillSummary, SkillsListInput, SkillSourceKind } from "@t3tools/contracts";

interface SkillRoot {
  readonly rootPath: string;
  readonly sourceKind: SkillSourceKind;
}

function sourceOrder(sourceKind: SkillSourceKind): number {
  return sourceKind === "project" ? 0 : sourceKind === "user" ? 1 : 2;
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

function titleCaseSkillName(name: string): string {
  return name
    .split(/[-_]+/g)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment[0]?.toUpperCase() + segment.slice(1))
    .join(" ");
}

function extractFrontmatterValue(frontmatter: string, key: string): string | undefined {
  const match = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(frontmatter);
  const rawValue = match?.[1]?.trim();
  if (!rawValue) return undefined;
  return rawValue.replace(/^['"]|['"]$/g, "").trim() || undefined;
}

function extractHeading(markdown: string): string | undefined {
  const match = /^#\s+(.+)$/m.exec(markdown);
  const heading = match?.[1]?.trim();
  return heading && heading.length > 0 ? heading : undefined;
}

function parseSkillMarkdown(input: { markdown: string; fallbackName: string }): {
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
} {
  const { markdown, fallbackName } = input;
  const frontmatterMatch = /^---\n([\s\S]*?)\n---\n?/.exec(markdown);
  const frontmatter = frontmatterMatch?.[1] ?? "";

  const name = extractFrontmatterValue(frontmatter, "name") ?? fallbackName;
  const displayName = extractHeading(markdown) ?? titleCaseSkillName(name);
  const description =
    extractFrontmatterValue(frontmatter, "description") ?? `Use the ${displayName} skill.`;

  return {
    name,
    displayName,
    description,
  };
}

async function listSkillDirs(rootPath: string): Promise<string[]> {
  const entries = await fs.readdir(rootPath, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(rootPath, entry.name))
    .toSorted((left, right) => left.localeCompare(right));
}

async function readSkillSummary(input: {
  readonly skillDir: string;
  readonly sourceKind: SkillSourceKind;
}): Promise<SkillSummary | null> {
  const skillFilePath = path.join(input.skillDir, "SKILL.md");
  const markdown = await fs.readFile(skillFilePath, "utf8").catch(() => null);
  if (!markdown) {
    return null;
  }

  const fallbackName = path.basename(input.skillDir).trim();
  if (!fallbackName) {
    return null;
  }

  const parsed = parseSkillMarkdown({
    markdown,
    fallbackName,
  });

  return {
    id: `${input.sourceKind}:${input.skillDir}`,
    name: parsed.name,
    displayName: parsed.displayName,
    description: parsed.description,
    sourceKind: input.sourceKind,
    sourcePath: input.skillDir,
    allowImplicitInvocation: true,
    defaultPrompt: `$${parsed.name}`,
  } satisfies SkillSummary;
}

function skillRootsForInput(input: SkillsListInput): SkillRoot[] {
  const homeDir = os.homedir();
  const projectRoots =
    input.cwd?.trim().length && input.cwd
      ? [
          { rootPath: path.join(input.cwd, ".codex", "skills"), sourceKind: "project" as const },
          { rootPath: path.join(input.cwd, ".agents", "skills"), sourceKind: "project" as const },
        ]
      : [];

  const userRoots = [
    { rootPath: path.join(homeDir, ".codex", "skills"), sourceKind: "user" as const },
    { rootPath: path.join(homeDir, ".agents", "skills"), sourceKind: "user" as const },
  ];

  return dedupeBy([...projectRoots, ...userRoots], (root) => root.rootPath);
}

function compareSkills(left: SkillSummary, right: SkillSummary): number {
  const sourceDelta = sourceOrder(left.sourceKind) - sourceOrder(right.sourceKind);
  if (sourceDelta !== 0) return sourceDelta;

  const nameDelta = left.name.localeCompare(right.name);
  if (nameDelta !== 0) return nameDelta;

  return left.sourcePath.localeCompare(right.sourcePath);
}

export async function listAvailableSkills(input: SkillsListInput): Promise<SkillSummary[]> {
  const roots = skillRootsForInput(input);
  const skillSummaries = await Promise.all(
    roots.map(async ({ rootPath, sourceKind }) => {
      const skillDirs = await listSkillDirs(rootPath);
      const skills = await Promise.all(
        skillDirs.map((skillDir) =>
          readSkillSummary({
            skillDir,
            sourceKind,
          }),
        ),
      );
      return skills.filter((skill): skill is SkillSummary => skill !== null);
    }),
  );

  return skillSummaries.flat().toSorted(compareSkills);
}
