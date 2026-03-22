# Plugin Host Spec

## Boundary

Public terminology is `plugin`.

The host exposes:

- transport:
  - `plugins.getBootstrap`
  - `plugins.callProcedure`
  - `plugins.registryUpdated`
- manifest file:
  - `t3-plugin.json`
- SDK:
  - `@t3tools/plugin-sdk`
- shared schemas/types:
  - `@t3tools/contracts`

Plugin code may import only `@t3tools/plugin-sdk` and `@t3tools/contracts`.

## Manifest

Required fields:

- `id`
- `name`
- `version`
- `hostApiVersion`

Optional fields:

- `enabled` default `true`
- `serverEntry` default `dist/server.js`
- `webEntry` default `dist/web.js`

Compatibility:

- only `hostApiVersion: "1"` is active
- incompatible plugins remain visible in bootstrap diagnostics and are disabled

## Discovery

Discovery order:

1. repo-local `plugins/`
2. directories from `T3CODE_PLUGIN_DIRS`

Rules:

- each configured root may itself be a plugin root or a container of child plugin roots
- only directories with `t3-plugin.json` count as plugin roots
- there is no implicit `dist/*` discovery

## Server Runtime

Host files touched:

- `apps/server/src/plugins/discovery.ts`
- `apps/server/src/plugins/manager.ts`
- `apps/server/src/plugins/types.ts`
- `apps/server/src/wsServer.ts`

Responsibilities:

- discover and validate manifests
- reject incompatible `hostApiVersion`
- activate server plugins
- register typed procedures
- reload on manifest or entry changes
- unload procedures and cleanup handlers before reload
- serve web bundles at `/__plugins/:pluginId/web.js?v=:version`
- publish `plugins.registryUpdated`

Procedure guarantees:

- missing procedure is a deterministic request error
- input decode failure is a deterministic request error
- output encode failure is a deterministic request error
- activation failure disables only that plugin

## Web Runtime

Host files touched:

- `apps/web/src/plugins/runtime.ts`
- `apps/web/src/plugins/host.tsx`
- `apps/web/src/plugins/composer.ts`
- `apps/web/src/plugins/composerBridge.ts`
- `apps/web/src/router.ts`
- `apps/web/src/wsNativeApi.ts`
- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/components/chat/ChatHeader.tsx`
- `apps/web/src/components/Sidebar.tsx`

Responsibilities:

- fetch plugin bootstrap
- dynamically import enabled compatible web bundles
- register/unregister composer providers
- register/unregister slot renderers
- reload on `plugins.registryUpdated`
- isolate plugin render failures with error boundaries

Web boundary rules:

- plugin code gets `callProcedure`, `registerComposerProvider`, and `registerSlot`
- no raw React, native API, query client, stores, or host components are exposed
- slot rendering order is deterministic by `pluginId`
- reload rebuilds registry state from scratch

## Composer Bridge

`apps/web/src/plugins/composerBridge.ts` owns plugin-related composer merging:

- built-in slash commands
- prompt slash commands
- plugin slash commands
- plugin skill results
- plugin workspace picker results
- secondary picker state shaping

`ChatView` should not understand plugin item internals directly beyond invoking mapped `ComposerCommandItem`s.

## V1 Exclusions

Not part of this issue:

- `registerOverride`
- extra slot ids
- raw host stores/components
- git internals
- generic write APIs
- `~/.t3/plugins.json`
- new capabilities beyond current `codex-composer` replacement
