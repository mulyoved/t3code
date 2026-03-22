# Migration From POC

This migration is a clean break from `extensions` to `plugins`.

## Rename Surface

Replaced:

- `extensions.list` -> `plugins.getBootstrap`
- `extensions.call` -> `plugins.callProcedure`
- `extensions.updated` -> `plugins.registryUpdated`
- `t3.extension.json` -> `t3-plugin.json`
- `extensions/codex-composer/*` -> `plugins/codex-composer/*`

Removed after migration:

- `apps/server/src/extensions/*`
- `apps/web/src/extensions/*`
- `extensions/codex-composer/*`

## Runtime Shape

Server host helpers in v1:

- `ctx.host.skills.list`
- `ctx.host.projects.searchEntries`
- `ctx.host.log`
- `ctx.host.pluginStorageDir`

Web host helpers in v1:

- `callProcedure`
- `registerComposerProvider`
- `registerSlot`

## Reference Plugin

`codex-composer` now owns:

- `/` menu contributions for skills and workspace pickers
- `$` skill suggestions
- secondary picker flows
- server-backed `skills.list`
- server-backed workspace search

The plugin package source is authoritative. `dist/*` is loadable runtime output.
