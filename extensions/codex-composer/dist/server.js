function isObject(value) {
  return value !== null && typeof value === "object";
}

export function activateServer(ctx) {
  ctx.method("skills.list", async (args) => {
    const cwd = isObject(args) && typeof args.cwd === "string" ? args.cwd : undefined;
    return {
      skills: await ctx.host.listSkills(cwd ? { cwd } : {}),
    };
  });

  ctx.method("workspace.list", async (args) => {
    if (!isObject(args) || typeof args.cwd !== "string" || args.cwd.trim().length === 0) {
      throw new Error("workspace.list requires a cwd string");
    }

    return ctx.host.searchWorkspace({
      cwd: args.cwd,
      query: typeof args.query === "string" ? args.query : "",
      limit: typeof args.limit === "number" ? args.limit : 120,
    });
  });
}
