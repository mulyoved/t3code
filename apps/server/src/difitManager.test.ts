import { describe, expect, it } from "vitest";

import { ProjectId, ThreadId, type OrchestrationReadModel } from "@t3tools/contracts";
import { resolveDifitThreadCwd } from "./difitManager";

function makeSnapshot(): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    updatedAt: "2026-03-23T00:00:00.000Z",
    projects: [
      {
        id: ProjectId.makeUnsafe("project-1"),
        title: "Project",
        workspaceRoot: "/repo/root",
        defaultModelSelection: null,
        scripts: [],
        createdAt: "2026-03-23T00:00:00.000Z",
        updatedAt: "2026-03-23T00:00:00.000Z",
        deletedAt: null,
      },
    ],
    threads: [
      {
        id: ThreadId.makeUnsafe("thread-1"),
        projectId: ProjectId.makeUnsafe("project-1"),
        title: "Thread",
        modelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: "/repo/worktrees/feature-a",
        latestTurn: null,
        createdAt: "2026-03-23T00:00:00.000Z",
        updatedAt: "2026-03-23T00:00:00.000Z",
        deletedAt: null,
        messages: [],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
      },
      {
        id: ThreadId.makeUnsafe("thread-2"),
        projectId: ProjectId.makeUnsafe("project-1"),
        title: "Thread 2",
        modelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurn: null,
        createdAt: "2026-03-23T00:00:00.000Z",
        updatedAt: "2026-03-23T00:00:00.000Z",
        deletedAt: null,
        messages: [],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
      },
    ],
  };
}

describe("resolveDifitThreadCwd", () => {
  it("prefers thread worktree paths", () => {
    expect(resolveDifitThreadCwd(makeSnapshot(), "thread-1")).toEqual({
      cwd: "/repo/worktrees/feature-a",
      source: "worktree",
    });
  });

  it("falls back to project workspace root", () => {
    expect(resolveDifitThreadCwd(makeSnapshot(), "thread-2")).toEqual({
      cwd: "/repo/root",
      source: "project",
    });
  });

  it("returns thread_not_found for unknown threads", () => {
    expect(resolveDifitThreadCwd(makeSnapshot(), "thread-404")).toEqual({
      cwd: null,
      source: "none",
      reason: "thread_not_found",
    });
  });
});
