# Upstream Update Runbook

This runbook documents how to pull the latest changes from `pingdotgg/t3code` into the fork at `mulyoved/t3code` while preserving local fork-only work.

It is written from the March 25, 2026 upgrade that moved the fork from the `v0.0.13` line to upstream `main` at [`bf71e0bc`](https://github.com/pingdotgg/t3code/commit/bf71e0bc), which includes the `v0.0.14` release tag [`28afb140`](https://github.com/pingdotgg/t3code/commit/28afb140).

The fork-specific changes preserved during this upgrade were the three merged PRs already on `origin/main`:

- PR #7: plugin host runtime and codex composer plugin
- PR #8: skill autocomplete fallback fix
- PR #9: fullscreen difit integration

## Branch Strategy

Treat `origin/main` as the source of truth for fork-only work. Do not hard reset it to upstream.

For each upstream upgrade:

1. Fetch upstream.
2. Create a fresh upgrade branch from `origin/main`.
3. Merge `upstream/main` into that branch.
4. Resolve conflicts by keeping both upstream behavior and fork-only behavior.
5. Run the required quality gates.
6. Push the branch and merge it back into the fork.

This keeps fork history explicit and makes every upstream update reviewable.

## One-Time Setup

If `upstream` is not configured yet:

```bash
git remote add upstream https://github.com/pingdotgg/t3code.git
git fetch upstream --prune
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

Make sure the worktree is clean before merging:

```bash
git status --short --branch
```

If there are local edits, either commit them first or use a separate worktree.

### 2. Fetch both remotes

```bash
git fetch origin --prune
git fetch upstream --prune
```

### 3. Inspect divergence

Check where the fork and upstream split:

```bash
git merge-base origin/main upstream/main
git rev-list --left-right --count origin/main...upstream/main
git log --oneline --decorate --graph --left-right --cherry-pick origin/main...upstream/main
```

For the March 25, 2026 upgrade, the split point was commit `9e29c9d7`, with:

- `origin/main`: 6 commits ahead
- `upstream/main`: 20 commits ahead

That told us the fork only had the three local PR merges plus their branch commits, while upstream had continued from the shared base.

### 4. Create a dedicated upgrade branch from the fork

Create the branch from `origin/main`, not from `upstream/main`:

```bash
git checkout -b chore/merge-upstream-v0.0.14 origin/main
```

For future upgrades, name the branch after the target tag or date, for example:

```bash
git checkout -b chore/merge-upstream-v0.0.15 origin/main
```

### 5. Merge upstream into the upgrade branch

```bash
git merge --no-ff upstream/main
```

Why `--no-ff`:

- it makes the upstream sync explicit in history
- it groups conflict resolution into one merge commit
- it is easier to audit later than replaying many cherry-picks

### 6. Resolve conflicts

Inspect conflicts:

```bash
git status --short
rg -n "^(<<<<<<<|=======|>>>>>>>)" .
```

For the March 25, 2026 upgrade, the conflicts were:

- `apps/web/src/components/ChatView.browser.tsx`
- `apps/web/src/components/ChatView.tsx`
- `apps/web/src/wsNativeApi.ts`

Resolution rule used:

- keep upstream `v0.0.14` changes
- re-apply fork-only features where they overlap
- do not discard local behavior just because upstream touched the same file

Concrete examples from this merge:

- kept upstream composer, prompt, and skill changes in `ChatView.tsx`
- kept fork-specific `difit.toggle` behavior in `ChatView.tsx`
- kept upstream git action progress subscription in `wsNativeApi.ts`
- kept fork-specific plugin, prompt, skill, and difit native API methods in `wsNativeApi.ts`
- kept the fork browser test for the `Alt+G` fullscreen difit shortcut in `ChatView.browser.tsx`
- kept the upstream terminal-context regression test in the same test file

After resolving, stage the files:

```bash
git add <resolved-files>
```

### 7. Run required validation

This repository is not considered updated until all three pass:

```bash
bun fmt
bun lint
bun typecheck
```

Do not skip these. They are required by this repo's `AGENTS.md`.

If tests are needed, use:

```bash
bun run test
```

Do not use `bun test`.

### 8. Commit the merge

Once conflicts are resolved and quality gates pass:

```bash
git commit
```

Suggested merge commit message:

```text
Merge upstream/main into origin/main for v0.0.14
```

If you want the exact upstream target in the message:

```text
Merge upstream/main (bf71e0bc) into fork main
```

### 9. Review the result

Useful checks before pushing:

```bash
git log --oneline --decorate --graph --max-count=30
git diff origin/main...HEAD --stat
git diff upstream/main...HEAD --stat
```

Interpretation:

- `origin/main...HEAD` shows everything introduced by the upgrade branch
- `upstream/main...HEAD` shows what remains fork-specific after the merge

The second diff is especially useful because it proves the fork-only behavior is still present.

### 10. Push and open a PR in the fork

```bash
git push -u origin chore/merge-upstream-v0.0.14
```

Open a PR from that branch into `mulyoved/t3code:main`.

The PR description should include:

- upstream target commit or tag
- list of preserved fork PRs
- conflict files and how they were resolved
- validation results

### 11. After PR merge

Update local `main` and optionally fast-forward any long-lived local branches:

```bash
git checkout main
git pull origin main
```

If your local default branch tracks `origin/main`, keep it that way. Do not repoint it to `upstream/main`.

## Copy-Paste Checklist

```bash
git fetch origin --prune
git fetch upstream --prune
git status --short --branch
git merge-base origin/main upstream/main
git rev-list --left-right --count origin/main...upstream/main
git checkout -b chore/merge-upstream-vX.Y.Z origin/main
git merge --no-ff upstream/main
git status --short
rg -n "^(<<<<<<<|=======|>>>>>>>)" .
bun fmt
bun lint
bun typecheck
git commit
git push -u origin chore/merge-upstream-vX.Y.Z
```

## Rules To Keep

- Never force `origin/main` to match upstream.
- Never resolve conflicts by blindly taking `--ours` or `--theirs`.
- Always merge upstream into a fresh branch from `origin/main`.
- Always verify what remains fork-specific after the merge.
- Always run `bun fmt`, `bun lint`, and `bun typecheck` before considering the upgrade done.
