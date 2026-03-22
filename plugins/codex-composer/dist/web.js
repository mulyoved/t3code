function normalize(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function basenameOf(pathValue) {
  const normalizedPath = typeof pathValue === "string" ? pathValue.replaceAll("\\", "/") : "";
  const lastSeparator = normalizedPath.lastIndexOf("/");
  return lastSeparator >= 0 ? normalizedPath.slice(lastSeparator + 1) : normalizedPath;
}

function parentPathOf(pathValue) {
  const normalizedPath = typeof pathValue === "string" ? pathValue.replaceAll("\\", "/") : "";
  const lastSeparator = normalizedPath.lastIndexOf("/");
  return lastSeparator >= 0 ? normalizedPath.slice(0, lastSeparator) : "";
}

function scoreSkill(skill, query) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) {
    return skill.sourceKind === "project" ? 0 : skill.sourceKind === "user" ? 10 : 20;
  }

  const name = normalize(skill.name);
  const displayName = normalize(skill.displayName);
  const description = normalize(skill.description);

  if (name === normalizedQuery) return 0;
  if (displayName === normalizedQuery) return 1;
  if (name.startsWith(normalizedQuery)) return 2;
  if (displayName.startsWith(normalizedQuery)) return 3;
  if (name.includes(normalizedQuery)) return 4;
  if (displayName.includes(normalizedQuery)) return 5;
  if (description.includes(normalizedQuery)) return 6;
  return Number.POSITIVE_INFINITY;
}

function compareSkills(left, right, query) {
  const scoreDelta = scoreSkill(left, query) - scoreSkill(right, query);
  if (scoreDelta !== 0) return scoreDelta;
  const sourceRank =
    (left.sourceKind === "project" ? 0 : left.sourceKind === "user" ? 1 : 2) -
    (right.sourceKind === "project" ? 0 : right.sourceKind === "user" ? 1 : 2);
  if (sourceRank !== 0) return sourceRank;
  return left.name.localeCompare(right.name);
}

function buildSkillSourceLabel(skill) {
  if (skill.sourceKind === "project") return "Project";
  if (skill.sourceKind === "user") return "User";
  return "System";
}

function buildSkillsSummary(skills) {
  if (!Array.isArray(skills) || skills.length === 0) {
    return "No skills found in this workspace or your user skill directories.";
  }
  const summary = skills
    .slice(0, 8)
    .map((skill) => `$${skill.name}`)
    .join(", ");
  return `Available skills: ${summary}${skills.length > 8 ? ", ..." : ""}`;
}

function scoreSlashItem(item, query) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return 0;

  const label = normalize(item.label);
  const description = normalize(item.description);
  const keywords = Array.isArray(item.keywords) ? item.keywords.map(normalize) : [];

  if (label.startsWith(normalizedQuery)) return 0;
  if (keywords.some((keyword) => keyword.startsWith(normalizedQuery))) return 1;
  if (label.includes(normalizedQuery)) return 2;
  if (keywords.some((keyword) => keyword.includes(normalizedQuery))) return 3;
  if (description.includes(normalizedQuery)) return 4;
  return Number.POSITIVE_INFINITY;
}

export default function activateWeb(ctx) {
  ctx.registerComposerProvider({
    id: "slash-commands",
    triggers: ["slash-command"],
    async getItems(input) {
      const [skillsResult, workspaceResult] = await Promise.all([
        ctx
          .callProcedure({
            procedure: "skills.list",
            ...(input.cwd ? { payload: { cwd: input.cwd } } : {}),
          })
          .catch(() => ({ skills: [] })),
        input.cwd
          ? ctx
              .callProcedure({
                procedure: "workspace.search",
                payload: { cwd: input.cwd, query: "", limit: 40 },
              })
              .catch(() => ({ entries: [] }))
          : Promise.resolve({ entries: [] }),
      ]);

      const secondarySkills = Array.isArray(skillsResult?.skills)
        ? [...skillsResult.skills]
            .sort((left, right) => compareSkills(left, right, ""))
            .slice(0, 40)
            .map((skill) => ({
              id: `skill:${skill.id}`,
              type: "skill",
              label: skill.displayName,
              description: skill.description,
              sourceLabel: buildSkillSourceLabel(skill),
              replacementText: skill.defaultPrompt,
            }))
        : [];

      const secondaryWorkspaceEntries = Array.isArray(workspaceResult?.entries)
        ? workspaceResult.entries.slice(0, 40).map((entry) => ({
            id: `workspace:${entry.kind}:${entry.path}`,
            type: "path",
            path: entry.path,
            pathKind: entry.kind,
            label: basenameOf(entry.path),
            description: parentPathOf(entry.path),
          }))
        : [];

      const items = [
        {
          id: "browse-workspace-files",
          type: "slash-command",
          action: "pick",
          label: "Browse workspace files",
          description: "Open a second picker and insert an @path mention",
          keywords: ["workspace", "files", "mention", "open"],
          badge: "Picker",
          icon: "file-search",
          onSelect: () => ({
            type: "open-secondary",
            title: "Workspace files",
            items: secondaryWorkspaceEntries,
          }),
        },
        {
          id: "insert-skill",
          type: "slash-command",
          action: "pick",
          label: "Insert skill",
          description: "Open the skill picker and insert a $skill mention",
          keywords: ["skills", "skill", "mention"],
          badge: "Picker",
          icon: "sparkles",
          onSelect: () => ({
            type: "open-secondary",
            title: "Skills",
            items: secondarySkills,
          }),
        },
        {
          id: "list-project-skills",
          type: "slash-command",
          action: "run",
          label: "List project skills",
          description: "Insert a summary of skills available for this workspace",
          keywords: ["skills", "list", "project"],
          badge: "Action",
          icon: "sparkles",
          onSelect: async () => {
            const result = await ctx.callProcedure({
              procedure: "skills.list",
              ...(input.cwd ? { payload: { cwd: input.cwd } } : {}),
            });
            return {
              type: "replace-trigger",
              text: `${buildSkillsSummary(result?.skills)} `,
            };
          },
        },
      ];

      return items
        .filter((item) => scoreSlashItem(item, input.query) !== Number.POSITIVE_INFINITY)
        .sort((left, right) => scoreSlashItem(left, input.query) - scoreSlashItem(right, input.query));
    },
  });

  ctx.registerComposerProvider({
    id: "skills",
    triggers: ["skill-mention", "slash-skills"],
    async getItems(input) {
      const result = await ctx.callProcedure({
        procedure: "skills.list",
        ...(input.cwd ? { payload: { cwd: input.cwd } } : {}),
      });
      const skills = Array.isArray(result?.skills) ? [...result.skills] : [];

      return skills
        .filter((skill) => scoreSkill(skill, input.query) !== Number.POSITIVE_INFINITY)
        .sort((left, right) => compareSkills(left, right, input.query))
        .map((skill) => ({
          id: `skill:${skill.id}`,
          type: "skill",
          label: skill.displayName,
          description: skill.description,
          sourceLabel: buildSkillSourceLabel(skill),
          replacementText: skill.defaultPrompt,
        }));
    },
  });

  ctx.registerComposerProvider({
    id: "workspace",
    triggers: ["slash-workspace"],
    async getItems(input) {
      if (!input.cwd) {
        return [];
      }

      const result = await ctx.callProcedure({
        procedure: "workspace.search",
        payload: {
          cwd: input.cwd,
          query: input.query,
          limit: 120,
        },
      });

      return (Array.isArray(result?.entries) ? result.entries : []).map((entry) => ({
        id: `workspace:${entry.kind}:${entry.path}`,
        type: "path",
        path: entry.path,
        pathKind: entry.kind,
        label: basenameOf(entry.path),
        description: parentPathOf(entry.path),
      }));
    },
  });
}
