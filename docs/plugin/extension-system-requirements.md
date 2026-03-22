# Extension System Requirements

## Summary

T3 Code currently implements a trusted local extension system for augmenting server behavior, composer behavior, and a small number of web UI slots.

This is not a general marketplace plugin platform. The current implementation is intentionally narrow:

- local discovery only
- manifest-based loading
- optional server and web entrypoints
- extension server methods
- extension-provided composer sources
- a limited set of extension UI slots
- watch and reload of local extension assets

This document describes the current extension system requirements and constraints. It also records where the broader design direction in [`trusted-local-plugin-system-for-ui-server-extensions.md`](/home/muly/t3code/docs/plugin/trusted-local-plugin-system-for-ui-server-extensions.md) goes beyond what is implemented today.

## Scope

### In scope

- Discover extensions from local directories.
- Load extension metadata from `t3.extension.json`.
- Allow extensions to ship a server entry, a web entry, or both.
- Allow server extensions to register callable methods.
- Allow web extensions to register composer sources.
- Allow web extensions to register renderers for a small set of named UI slots.
- Watch extension files and reload them when they change.
- Expose extension state to the web app through the existing WebSocket/native API layer.

### Out of scope

- Sandboxing or untrusted code execution.
- Remote distribution, marketplace, or install UX.
- Arbitrary component-tree patching.
- General override surfaces.
- A stable external SDK package.
- Broad host API access beyond the explicitly exposed helpers.

## Discovery And Packaging Requirements

Extensions must be discoverable from local filesystem roots.

Discovery requirements:

- The server must read `T3CODE_EXTENSION_DIRS`.
- The server must also look in the repo-local default `extensions/` directory.
- Each configured root may itself be an extension root, or may contain child directories that are extension roots.
- An extension root is recognized if any of the following exist:
  - `t3.extension.json`
  - `dist/server.js`
  - `dist/web.js`

Packaging requirements:

- The manifest file name is `t3.extension.json`.
- If the manifest omits entrypoint paths, the host must default to:
  - `dist/server.js`
  - `dist/web.js`
- Missing server or web bundles are allowed.
- If a bundle path is configured but the file does not exist, that side of the extension is treated as unavailable.

## Manifest Requirements

The current effective manifest model is minimal.

Supported fields:

- `id`
- `name`
- `enabled`
- `server`
- `web`

Defaulting rules:

- `id` defaults to the extension root directory name if omitted.
- `name` defaults to `id` if omitted.
- `enabled` defaults to `true`.
- `server` defaults to `dist/server.js`.
- `web` defaults to `dist/web.js`.

Validity requirements:

- The extension must have a non-empty effective `id`.
- The extension must have a non-empty effective `name`.
- If those cannot be resolved, the extension must not load.

## Server Host Requirements

The server must provide an extension manager responsible for:

- discovering extension roots
- loading manifests
- activating server entry modules
- tracking registered methods per extension
- tracking extension cleanup callbacks
- tracking extension load errors
- watching manifest and entry files
- reloading an extension when one of its watched files changes
- advertising web extension assets through a stable host URL

Activation requirements:

- A server entry module may export `activateServer` or a default function.
- The host must call that function with a `ServerExtensionContext`.
- If the activator returns a cleanup function, the host must call it on unload.

Server extension context requirements:

- `id`
- `log.info`
- `log.warn`
- `log.error`
- `method(name, handler)`
- `onDispose(cleanup)`
- `host.listSkills`
- `host.searchWorkspace`
- `host.readWorkspaceFile`

Server failure isolation requirements:

- An extension activation failure must not crash the host.
- A failing extension must record an error against that extension only.
- Unload must clear methods, dispose watchers, and invoke cleanup handlers.

## Web Host Requirements

The web host must provide an extension runtime responsible for:

- fetching the current extension registry from the native API
- dynamically importing each extension `webUrl`
- activating each web extension module
- registering composer sources
- registering slot renderers
- rebuilding extension registrations when the server pushes an extension update
- isolating extension render failures behind an error boundary

Web activation requirements:

- A web entry module must resolve to a supported activator via the runtime helper.
- The activator receives:
  - `id`
  - `callServer`
  - `composer.registerSource`
  - `ui.registerSlot`
  - `host.React`
  - `host.nativeApi`
  - `host.queryClient`

Web runtime cleanup requirements:

- All composer sources registered by an extension must be removed on unload.
- All slot renderers registered by an extension must be removed on unload.
- If the web activator returns a cleanup function, it must be invoked on unload.

## Current Public Extension Interfaces

### Server-side interface

The current server-side extension boundary is defined by [`ServerExtensionContext`](/home/muly/t3code/apps/server/src/extensions/types.ts).

The current extension manifest shape is represented in [`ExtensionManifest`](/home/muly/t3code/apps/server/src/extensions/types.ts).

### Web-side interface

The current web-side composer boundary is defined by:

- [`ExtensionComposerTriggerKind`](/home/muly/t3code/apps/web/src/extensions/composer.ts)
- [`ExtensionComposerItem`](/home/muly/t3code/apps/web/src/extensions/composer.ts)
- [`ExtensionComposerSelectResult`](/home/muly/t3code/apps/web/src/extensions/composer.ts)
- [`ExtensionUISlotId`](/home/muly/t3code/apps/web/src/extensions/composer.ts)

### Native API and transport

The current web/runtime transport relies on:

- `extensions.list`
- `extensions.call`
- `extensions.onUpdated`

The WebSocket layer must support:

- extension list RPC
- extension call RPC
- extension updated push notifications

## Current Supported Composer Triggers

The host must support these extension composer trigger kinds:

- `slash-command`
- `slash-workspace`
- `slash-skills`
- `skill-mention`

These are the current compatibility boundary for extension-provided composer sources.

## Current Supported UI Slots

The host must support these extension UI slot IDs:

- `chat.header.actions.after`
- `sidebar.footer.before`
- `thread.rightPanel.tabs`

No other slot IDs should be treated as supported unless they are added to the typed extension interface.

## Reload Requirements

The host must watch the following per extension when present:

- manifest file
- server entry file
- web entry file

On change, the host must:

1. unload the existing extension instance
2. re-read the manifest
3. reload the extension if still valid and enabled
4. notify web clients that the extension registry changed

The web runtime must then:

1. receive the update event
2. re-fetch the extension list
3. unload old web registrations
4. import the new version of each active extension web bundle

## Compatibility And Constraints

Compatibility rules for the current system:

- trusted local code only
- extension compatibility is defined by the current typed manifest/context/composer APIs
- extensions must not rely on host internals outside those explicit interfaces
- extensions are expected to tolerate missing web or server sides
- the host may evolve internally as long as the typed extension surface remains coherent

Current constraints:

- no generic override system
- no external SDK package
- no broad host API surface
- no marketplace or install lifecycle
- no security sandbox

## Gaps Between Design And Implementation

The broader design doc describes a larger long-term plugin system than the one currently implemented.

Notable gaps:

- `packages/plugin-sdk` is not implemented.
- Generic `plugins.*` bootstrap/procedure APIs are not the current runtime model.
- The current implementation uses `extensions.*` transport, not a full generic plugin namespace.
- The current slot set is much smaller than the future design proposes.
- Override surfaces are not implemented.
- The current server host API is limited to:
  - skill listing
  - workspace search
  - workspace file read
- The current implementation is rooted in local extension directories and the repo-local `extensions/` folder, not a richer external plugin config model.

The current requirements doc should be treated as authoritative for what exists now. The broader design doc should be treated as forward-looking.

## Acceptance Criteria

This extension system is correctly documented only if all of the following are true:

- a reader can identify what extension capabilities are implemented today
- a reader can identify which interfaces are intentionally supported
- a reader can distinguish current implementation from future plugin ambitions
- a future extension author can understand discovery, activation, and reload behavior without reverse-engineering the code first
