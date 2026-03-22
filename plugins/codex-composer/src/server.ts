import {
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  SkillsListInput,
  SkillsListResult,
} from "@t3tools/contracts";
import { defineServerPlugin } from "@t3tools/plugin-sdk";

export default defineServerPlugin((ctx) => {
  ctx.registerProcedure({
    name: "skills.list",
    input: SkillsListInput,
    output: SkillsListResult,
    handler: (input) => ctx.host.skills.list(input) as Promise<SkillsListResult>,
  });

  ctx.registerProcedure({
    name: "workspace.search",
    input: ProjectSearchEntriesInput,
    output: ProjectSearchEntriesResult,
    handler: (input) =>
      ctx.host.projects.searchEntries(input) as Promise<ProjectSearchEntriesResult>,
  });
});
