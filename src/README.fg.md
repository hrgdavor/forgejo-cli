# Stacked Pull Request CLI toolkit

These components work directly inside your project directories, using standard Git plumbing and the Forgejo/Gitea APIs to manage stacked branches, PRs, and commit-history tracing entirely from the console.

---

To make an environment variable temporary so that it only exists within your **current terminal session** (and disappears as soon as you close that specific window), you skip saving it to your user profile entirely.

Here is how you do that in both PowerShell and Linux.

### The PowerShell Variant (Per-Terminal Only)

```powershell
$env:FORGEJO_TOKEN="your_secret_access_token_here"
```
* **Scope:** This only lives inside this specific PowerShell window. If you open a second window, it won't be there. If you close the window, it's gone.

---

### The Linux Variant (Per-Terminal Only)

In Linux, you achieve the exact same behavior by using the `export` command directly in your command line without writing it to any files.

```bash
export FORGEJO_TOKEN="your_secret_access_token_here"
```

---

## Stack & PR Management

## `fg-prs.js`: Visual Inspection & Conflict Audit

Provides structural visibility into your code repository layout. It maps out dependencies recursively so you can see your entire workflow tree.

```powershell
bun ./fg-prs.js
```

#### `--check` The Inline Conflict Check

To run an exhaustive audit that forces the backend server to process background git diff calculations on all branches and explicitly append status indicators (`✅` / `❌`) right into the visual rendering tree nodes:

```powershell
bun ./fg-prs.js --check
# Or use the shorthand flag:
bun ./fg-prs.js -c

```

---

## Submitting a New Dependent Layer

### File: `fg-stack.js`

When you have built a new iteration layer directly on top of an unmerged feature branch locally, do not head out to your web browser to click dropdown menus. Check out your feature branch (`git checkout feature-step-3`) and execute the stack creator:

```powershell
bun ./fg-stack.js --title "Part 3: Add database validation schemas"

```

### What happens behind the scenes:

1. **Parent Detection:** The script interrogates local git commits via `merge-base` calculations to determine which parent branch you split away from.
2. **Remote Registration:** It issues a dynamic upstream push (`git push -u origin <current-branch>`).
3. **Target Alignment:** It executes a REST command targeting the Forgejo server to instantly launch a new PR set up to track directly against your parent feature branch (`feature-step-3` ➔ `feature-step-2`) instead of blindly crashing into `main`.

---

## Cascade Rebase Management

### File: `fg-rebase.js`

If a reviewer asks for changes on an early tier branch (e.g., `feature-step-1`), making edits will inherently drift your subsequent dependent branches out of sync.

Fix the issue, commit your code on that early branch, and while sitting directly on that branch, issue the chain-reaction command:

```powershell
bun ./fg-rebase.js

```

### What happens behind the scenes:

1. **Tree Evaluation:** It analyzes your active branch configuration, looking up the branch map to identify every higher branch layer depending on your work.
2. **Automated Hops:** The utility checks out every branch layer step-by-step up the chain.
3. **Clean Synchronization:** It runs a localized `git rebase` against the newly updated tier right beneath it and executes a safe `--force-with-lease` remote push to gracefully update your server PRs without risk of wiping out collaborative code modifications.
4. **Return Home:** It returns you right back to your starting branch.

---

## Merging & Retargeting

### Files: `fg-merge-safe.js` and `fg-retarget.js`

To clear out ready features across your repository stack, execute the safe merge pipeline:

```powershell
bun ./fg-merge-safe.js

```

### What happens behind the scenes:

1. **Conflict Screening:** The utility checks merge targets, automatically bypassing blocked PRs or lines displaying raw conflicts.
2. **Server Merging:** It closes out ready PRs down into your trunk branch one by one.

`fg-merge-safe.js` does **not** automatically retarget dependent PRs. Once a lower branch (like `feature-step-1`) has been merged into `main`, any PR still targeting it (like `feature-step-2`, now stranded against a closed branch) needs its base updated. Run the companion script afterwards:

```powershell
bun ./fg-retarget.js

```

It scans open PRs, detects any whose base branch was already merged/closed, and PATCHes their base directly to where that branch ended up (e.g. `main`) so the stack shifts seamlessly downstream.

---

## Commit Origin & Cache Tooling

Finding "where does this commit actually live?" is hard once commits get cherry-picked or rebased between branches and PRs — the SHA changes but the diff (patch-id) doesn't. These tools share one consolidated cache — see [README.cache.md](README.cache.md) for the full structure/content/usage reference — to answer that from either direction: by branch, or by PR.

### `cherry-cache.js`: THE single script that builds/refreshes the cache

This is the **only** script that syncs anything. `cherry.js` and `fg-find-commit-origin.js` are pure read-only consumers of what it produces — they never call git or the Forgejo API to build the cache themselves. Run it whenever you want fresher results (e.g. after pulling new commits or PR activity).

It scans `git log --all`, computes a stable patch-id for every new commit (via `git patch-id --stable`), records author/committer identity+dates for free in the same pass, and — for any commit that shares a patch-id with another (an actual cherry-pick/rebase duplicate) — resolves accurate branch membership and first-parent-path info via `git branch -a --contains`, bounded to just those duplicate groups so it stays fast even on large repos.

```powershell
bun ./cherry-cache.js
# Skip the Forgejo API sync (offline / no token available):
bun ./cherry-cache.js --no-prs
# Force a full rebuild (e.g. after deleting/renaming branches):
bun ./cherry-cache.js --rebuild
```

### `cherry.js`: Local cherry-pick / branch lookup

Fast, offline lookup — no network calls, and no live `git branch --contains` calls either once the cache is populated (it reads the branch/first-parent data `cherry-cache.js` already resolved). Given a commit hash, computes its patch-id and reports every branch containing that commit or a same-diff copy of it, anywhere in history. If PR metadata is already cached, the originating PR is shown too. Requires the cache to be built first via `cherry-cache.js`.

Pass an optional second argument to get a quick pass/fail summary at the end for one specific branch, so you don't have to scan a long match list by eye. When there's a match, it also traces **how and when** the patch actually entered that branch:

- **Authored vs. committed timestamps** — a cherry-pick keeps the original author date but sets the committer date to whenever it was actually applied, so the gap between the two tells you when it landed.
- **Path** — whether the commit sits directly on the branch's first-parent history (committed/cherry-picked straight onto it) or only arrived via a merge commit (some other branch already had the same patch and was merged in later — e.g. the branch was forked from a base that already contained the cherry-pick, rather than the cherry-pick happening on the branch itself).

```powershell
bun ./cherry.js <commit-hash>
bun ./cherry.js <commit-hash> <branch-name>
```

### `fg-find-commit-origin.js`: Full branch + PR origin resolution

The complete answer: combines the local patch-id cache with Forgejo PR history to resolve which branch **and/or** which PR (open or closed) a commit came from — even when it was cherry-picked or rebased into a different SHA elsewhere. Also a pure read-only consumer of the cache — run `cherry-cache.js` first.

- **Direct match:** this exact SHA is one of the commits inside a known PR.
- **Patch-id match:** every other commit sharing the identical diff is reported together, each annotated with its own branch(es) and originating PR (if any).

```powershell
bun ./fg-find-commit-origin.js <commit-hash>
```

### `gsearch.js`: Search commit messages across branches

Pure git, no cache or API involved. Search by text or an exact hash, then print every local/remote branch containing each match; optionally check whether a specific branch is included.

```powershell
bun ./gsearch.js "search term" [target-branch]
```

### `fg-branch-diff.js`: Which commits are actually missing between two branches?

Compares two branches by **patch content**, not just commit hash — the classic trap is a commit that was cherry-picked onto a base branch, with the newer branch forked from that base *later*: by sha alone it looks "missing" from the newer branch, but the patch is already there. Wraps `git cherry` (which already does patch-id equivalence checking internally), then enriches genuinely-missing commits with cached PR info for context.

```powershell
bun ./fg-branch-diff.js <older-branch> <newer-branch>
```

Reports two groups: commits with **no equivalent patch anywhere** in the newer branch (flagged `❌ MISSING` — these need attention), and commits already carried over via cherry-pick/rebase (`♻️`, informational only).

---

## Shared modules

- **`forgejo-utils.js`** — Forgejo/Gitea API primitives: `getRepoContext`, `headers`, `fetchAllPages`.
- **`commit-cache.js`** — the single consolidated cache module used by `cherry-cache.js` (builds/refreshes it), `cherry.js`, and `fg-find-commit-origin.js` (read-only consumers). See [README.cache.md](README.cache.md) for full details on its structure, incremental behavior, and freshness trade-offs.

