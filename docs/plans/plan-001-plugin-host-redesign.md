# Plan 001: Plugin Host Redesign

This execution plan lands a clean-break `plugins` architecture that replaces the current extension proof of concept end to end.

Scope:

- add plugin contracts in `packages/contracts/src/plugin.ts`
- add `@t3tools/plugin-sdk`
- add server runtime under `apps/server/src/plugins/*`
- add web runtime under `apps/web/src/plugins/*`
- migrate `codex-composer` into `plugins/codex-composer/*`
- remove legacy extension runtime paths after migration
- add plugin host docs and reapply guidance

V1 includes:

- manifest-driven discovery with `t3-plugin.json`
- `registerProcedure`, `registerComposerProvider`, and `registerSlot`
- slots:
  - `chat.header.actions.after`
  - `sidebar.footer.before`
  - `thread.rightPanel.tabs`
- host helpers:
  - `ctx.host.skills.list`
  - `ctx.host.projects.searchEntries`
  - `ctx.host.log`
  - `ctx.host.pluginStorageDir`

V1 excludes:

- override surfaces
- generic host internals
- persistent external plugin-root config files
- extra capabilities beyond the current `codex-composer` seam
