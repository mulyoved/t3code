import { describe, expect, it } from "vitest";

import type { SkillSummary } from "@t3tools/contracts";

import { buildComposerMenuItems, buildSkillComposerItems } from "./composerBridge";

const skills: SkillSummary[] = [
  {
    id: "user:/skills/react-doctor",
    name: "react-doctor",
    displayName: "React Doctor",
    description: "Diagnose React code health issues.",
    sourceKind: "user",
    sourcePath: "/skills/react-doctor",
    allowImplicitInvocation: true,
    defaultPrompt: "$react-doctor",
  },
  {
    id: "project:/skills/megaplan",
    name: "megaplan",
    displayName: "Megaplan",
    description: "Build robust plans.",
    sourceKind: "project",
    sourcePath: "/skills/megaplan",
    allowImplicitInvocation: true,
    defaultPrompt: "$megaplan",
  },
];

describe("buildSkillComposerItems", () => {
  it("sorts project skills before user skills when query is empty", () => {
    expect(buildSkillComposerItems({ skills, query: "" })).toMatchObject([
      { label: "Megaplan", replacementText: "$megaplan ", sourceLabel: "Project" },
      { label: "React Doctor", replacementText: "$react-doctor ", sourceLabel: "User" },
    ]);
  });

  it("filters to matching skills for the current query", () => {
    expect(buildSkillComposerItems({ skills, query: "react" })).toMatchObject([
      { label: "React Doctor", replacementText: "$react-doctor " },
    ]);
  });
});

describe("buildComposerMenuItems", () => {
  it("falls back to core skills when no plugin skill provider is available", () => {
    const items = buildComposerMenuItems({
      composerTrigger: {
        kind: "skill-mention",
        query: "mega",
      },
      secondaryComposerMenu: null,
      workspaceEntries: [],
      availablePrompts: [],
      pluginComposerItems: [],
      availableSkills: skills,
      searchableModelOptions: [],
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: "skill",
      label: "Megaplan",
      replacementText: "$megaplan ",
    });
  });
});
