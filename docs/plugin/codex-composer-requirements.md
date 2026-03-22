# Codex Composer Extension Requirements

## Summary

`codex-composer` is the sample extension currently implemented in this repo. Its job is to extend the chat composer with:

- additional `/` menu actions
- skill selection via `$`
- workspace file browsing through a secondary picker
- server-backed skill and workspace lookup

This document describes the requirements and actual behavior of that implemented extension. It is intentionally narrower than the host extension system requirements.

## Manifest

The extension manifest is currently:

```json
{
  "id": "codex-composer",
  "name": "Codex Composer",
  "server": "dist/server.js",
  "web": "dist/web.js",
  "enabled": true
}
```

Requirements:

- `id` must remain `codex-composer` unless the host references are updated accordingly.
- The extension may provide both server and web entrypoints.
- The extension is expected to be enabled by default.

## Server Requirements

The server side of the extension must expose two methods:

### `skills.list`

Requirements:

- accepts optional `cwd`
- delegates to the host skill listing capability
- returns an object with `skills`

### `workspace.list`

Requirements:

- requires a non-empty `cwd`
- accepts optional `query`
- accepts optional `limit`
- delegates to the host workspace search capability
- returns workspace entries in the host search format

Failure requirements:

- `workspace.list` must throw a deterministic error if `cwd` is missing or empty.
- Method failures must remain scoped to this extension call.

## Composer Trigger Requirements

The extension currently participates in these trigger kinds:

- `slash-command`
- `slash-skills`
- `skill-mention`
- `slash-workspace`

These map to two user-facing behaviors:

- slash menu augmentation through `/`
- skill menu augmentation through `$`

## Slash Menu Requirements

When triggered under `slash-command`, the extension must contribute these actions:

### `Browse workspace files`

Requirements:

- item type: slash command
- action type: `pick`
- icon: workspace/file-search style
- opens a secondary picker titled `Workspace files`
- secondary picker items are workspace path items derived from `workspace.list`

### `Insert skill`

Requirements:

- item type: slash command
- action type: `pick`
- icon: sparkles
- opens a secondary picker titled `Skills`
- secondary picker items are skill items derived from `skills.list`

### `List project skills`

Requirements:

- item type: slash command
- action type: `run`
- icon: sparkles
- fetches skills via `skills.list`
- replaces the current trigger text with a generated summary sentence

## Skill Menu Requirements

When triggered under `skill-mention` or `slash-skills`, the extension must:

- fetch available skills from the server
- filter them against the current query
- rank them deterministically
- render them as skill items with:
  - display label
  - description
  - source label
  - replacement text

Skill replacement behavior:

- selecting a skill must insert the skill’s `defaultPrompt`
- the current implementation expects that prompt to be `$<skill-name> `

## Workspace Picker Requirements

When triggered under `slash-workspace`, the extension must:

- require `cwd`
- call `workspace.list` with the current query
- map workspace search results to path items
- return those items for host rendering

Workspace item requirements:

- item type: `path`
- include the original path
- include `pathKind`
- use basename as the label
- use parent path as the description

## Selection Behavior Requirements

The extension relies on the host support for these selection results:

- `open-secondary`
- `replace-trigger`
- `insert-text`
- `none`

Current implemented behaviors:

- `Browse workspace files` returns `open-secondary`
- `Insert skill` returns `open-secondary`
- `List project skills` returns `replace-trigger`

Skill items rely on the host’s standard skill item insertion behavior rather than a custom extension-side callback.

Workspace items rely on the host’s standard path insertion behavior rather than a custom extension-side callback.

## Ranking And Filtering Requirements

### Skill ranking

Skill ranking must prefer:

1. exact name matches
2. exact display-name matches
3. prefix matches
4. substring matches
5. description matches

When query is empty:

- project skills rank first
- then user skills
- then system skills

Tie-breaking:

- source rank
- shorter names first
- lexical name order

### Slash item ranking

Slash command ranking must prefer:

1. label prefix matches
2. keyword prefix matches
3. label substring matches
4. keyword substring matches
5. description matches

Items that do not match should be excluded.

## Source Labels And Generated Text

The extension must map skill source kinds to user-facing labels:

- `project` → `Project`
- `user` → `User`
- otherwise → `System`

The generated text for `List project skills` must:

- produce a human-readable summary sentence
- mention skill names using `$skill-name`
- truncate long lists after a small prefix of results

## Dependencies On The Host System

This extension depends on host support for:

- extension server method registration
- extension web activation
- composer source registration
- slash-command rendering
- skill item rendering
- path item rendering
- secondary picker state in the composer UI
- native API transport for extension method calls

The extension also depends on host-backed data providers for:

- workspace search
- skill discovery from project, user, and system locations

## User-Visible Behavior

A user should observe all of the following:

- the `/` menu contains extension-provided actions beyond the built-in commands
- the `/` flow can open a second picker for files
- the `/` flow can open a second picker for skills
- the `$` flow can browse skills with descriptions and source labels
- selecting a skill inserts a skill mention prompt
- selecting a workspace path inserts a path mention

## Known Constraints

Current constraints of `codex-composer`:

- it is composer-focused only
- it does not currently add header buttons, sidebar UI, or right-panel UI
- it depends on host rendering primitives instead of shipping a custom picker UI
- it only uses the currently exposed host server helpers

## Acceptance Criteria

This extension is correctly documented only if:

- all three slash actions are named and described
- both server methods are named and described
- both `/` and `$` flows are explained accurately
- the doc reflects current shipped behavior rather than speculative future extension features
