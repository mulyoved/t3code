# Plugin Reapply Prompt

Reapply the plugin-host seam onto upstream with the following invariants:

1. Keep terminology as `plugin`, not `extension`.
2. Preserve transport names exactly:
   - `plugins.getBootstrap`
   - `plugins.callProcedure`
   - `plugins.registryUpdated`
3. Preserve manifest file name `t3-plugin.json`.
4. Preserve slot ids exactly:
   - `chat.header.actions.after`
   - `sidebar.footer.before`
   - `thread.rightPanel.tabs`
5. Preserve v1 host helpers exactly:
   - `ctx.host.skills.list`
   - `ctx.host.projects.searchEntries`
   - `ctx.host.log`
   - `ctx.host.pluginStorageDir`
6. Do not reintroduce:
   - override surfaces
   - raw React/nativeApi/queryClient exposure
   - external plugin-root config files
   - extra slot ids
7. Keep composer/plugin merge logic isolated to `apps/web/src/plugins/composerBridge.ts`.
8. Keep server discovery/activation isolated to `apps/server/src/plugins/*`.
9. Keep reference plugin behavior in `plugins/codex-composer/*`, not host UI files.
10. Keep registry ordering deterministic by `pluginId`.
