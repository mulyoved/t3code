# Upstream Update Runbook

This runbook documents how to pull newer code from `pingdotgg/t3code` into the fork at `mulyoved/t3code` while keeping the fork-only product work.

It is written from the April 2, 2026 upgrade that moved the fork onto `upstream/main` at [`d8aa2f85`](https://github.com/pingdotgg/t3code/commit/d8aa2f85dfd76dde3698754f195c9b4bb9c613a3) and replayed the three intentional fork feature lines:

- plugin host runtime and codex composer plugin
- skill autocomplete fallback
- fullscreen difit integration

The replay branch created for that upgrade was `chore/replay-upstream-main-2026-04-02`, with these replayed commits:

- `27a4c369` Add plugin host runtime and codex composer plugin
- `81e126e9` Fix skill autocomplete fallback
- `9fdbf41f` Add fullscreen difit integration

## Branch Strategy

Treat `origin/main` as the fork integration branch, but do not start upstream upgrades from it.

For each upstream upgrade:

1. Fetch `origin` and `upstream`.
2. Inventory the local-only work that still matters.
3. Create a fresh replay branch from `upstream/main`.
4. Cherry-pick only the local feature commits you still want.
5. Port each feature onto the current upstream architecture where needed.
6. Run the quality gates.
7. Push the replay branch and open a PR into `origin/main`.

Do not continue old merge branches like `t3code/merge-main-changes` or `chore/merge-upstream-v0.0.14`. Keep them only as references for prior conflict resolution.

## One-Time Setup

If `upstream` is not configured yet:

```bash
git remote add upstream https://github.com/pingdotgg/t3code.git
git fetch upstream --prune --tags
```

Verify remotes:

```bash
git remote -v
```

Expected shape:

```text
origin   git@github.com:mulyoved/t3code.git
upstream https://github.com/pingdotgg/t3code.git
```

## Recurring Upgrade Procedure

### 1. Start clean

Make sure the main checkout is clean before planning the replay:

```bash
git status --short --branch
```

If it is not clean, commit the work first or use a separate worktree.

### 2. Fetch both remotes

```bash
git fetch origin --prune
git fetch upstream --prune --tags
```

### 3. Inventory fork-only work

Before replaying anything, separate local changes into:

- keep: real fork features that must survive
- rework: commits whose behavior still matters but whose implementation must change for upstream
- drop: experiments or fixes that upstream already replaced

Useful commands:

```bash
git log --oneline --decorate --graph upstream/main..origin/main
git diff --stat upstream/main...origin/main
git range-diff upstream/main...origin/main
```

Do not blindly preserve every local diff.

### 4. Create a dedicated replay branch from upstream

Prefer a separate worktree so the replay is isolated:

```bash
git worktree add ../t3code-replay-$(date +%Y%m%d) -b chore/replay-upstream-main-YYYY-MM-DD upstream/main
```

If you do not want a separate worktree:

```bash
git checkout -b chore/replay-upstream-main-YYYY-MM-DD upstream/main
```

### 5. Replay the curated local commits

Cherry-pick the commits you decided to keep in dependency order:

```bash
git cherry-pick <commit-1>
git cherry-pick <commit-2>
git cherry-pick <commit-3>
```

For the April 2, 2026 replay, the source commits were:

```bash
git cherry-pick 0a76a238
git cherry-pick bd061264
git cherry-pick 21bc4f3f
```

Do not cherry-pick merge commits from `origin/main`. Replay the actual feature commits instead.

### 6. Resolve conflicts deliberately

Inspect conflicts:

```bash
git status --short
rg -n "^(<<<<<<<|=======|>>>>>>>)" .
```

Conflict rule:

- keep upstream structure
- preserve fork behavior when it is intentional product scope
- port the feature when upstream changed the architecture
- do not blindly use `--ours` or `--theirs`

Known hotspot files from the April 2, 2026 replay:

- `apps/web/src/components/ChatView.browser.tsx`
- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/wsNativeApi.ts`
- `apps/web/src/keybindings.ts`
- `apps/server/src/ws.ts`
- `apps/server/src/http.ts`
- `packages/contracts/src/ipc.ts`
- `packages/contracts/src/rpc.ts`

The difit replay is the best example of the rule above:

- do not resurrect the old websocket server files just because the historical fork used them
- keep difit behavior, but port it onto the current Effect RPC and HTTP router stack

After resolving, stage the result:

```bash
git add -A
```

Continue the replay:

```bash
GIT_EDITOR=true git cherry-pick --continue
```

### 7. Add or update the runbook

Keep this file current whenever the fork-maintenance approach changes.

If a replay taught you anything new, record:

- which source commits were preserved
- which files were recurring conflict hotspots
- which local changes were intentionally dropped
- whether the chosen strategy should change next time

### 8. Run required validation

This repository is not considered updated until these pass:

```bash
bun fmt
bun lint
bun typecheck
bun run test
```

Do not use `bun test`.

### 9. Review the result

Before pushing, confirm the branch still only contains the intended fork work:

```bash
git log --oneline --decorate upstream/main..HEAD
git diff --stat upstream/main...HEAD
git diff --stat origin/main...HEAD
```

Interpretation:

- `upstream/main..HEAD` should be the curated replay commits only
- `upstream/main...HEAD` should show only intentional fork customizations
- `origin/main...HEAD` should show what the PR will change relative to the fork

If the upstream diff contains unrelated drift from old merge branches, stop and fix it before pushing.

### 10. Push and open a PR into the fork

```bash
git push -u origin chore/replay-upstream-main-YYYY-MM-DD
```

Open a PR from that branch into `mulyoved/t3code:main`.

The PR description should include:

- upstream target commit or tag
- preserved fork-only features
- dropped or replaced local commits
- conflict files and how they were resolved
- validation results

### 11. After PR merge

Update local `main`:

```bash
git checkout main
git pull origin main
```

Keep `main` tracking `origin/main`. Do not repoint it to `upstream/main`.

## Copy-Paste Checklist

```bash
git fetch origin --prune
git fetch upstream --prune --tags
git status --short --branch
git log --oneline --decorate --graph upstream/main..origin/main
git diff --stat upstream/main...origin/main
git worktree add ../t3code-replay-$(date +%Y%m%d) -b chore/replay-upstream-main-YYYY-MM-DD upstream/main
git cherry-pick <commit-1>
git cherry-pick <commit-2>
git cherry-pick <commit-3>
git status --short
rg -n "^(<<<<<<<|=======|>>>>>>>)" .
git add -A
GIT_EDITOR=true git cherry-pick --continue
bun fmt
bun lint
bun typecheck
bun run test
git log --oneline --decorate upstream/main..HEAD
git diff --stat upstream/main...HEAD
git push -u origin chore/replay-upstream-main-YYYY-MM-DD
```

## Rules To Keep

- Never hard reset `origin/main` to upstream.
- Never use old merge branches as the new sync base.
- Never preserve every local diff by default.
- Never resolve conflicts by blindly taking `--ours` or `--theirs`.
- Always start the upgrade from `upstream/main` on a fresh replay branch.
- Always verify that the final diff against `upstream/main` contains only intended fork behavior.
- Always run `bun fmt`, `bun lint`, `bun typecheck`, and `bun run test` before calling the upgrade done.
