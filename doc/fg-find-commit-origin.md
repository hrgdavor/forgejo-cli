# Find commit origin - `src/fg-find-commit-origin.js`

The complete answer: combines the local patch-id cache with Forgejo PR history to resolve which branch **and/or** which PR (open or closed) a commit came from - even when it was cherry-picked or rebased into a different SHA elsewhere.

By default the tool **incrementally syncs the cache** before querying (calls `syncPatchIds` + `resolveDuplicateBranches` + `syncPrCache`), so no separate `fg-cherry-cache.js` run is needed. The sync is fast when the cache is already up-to-date — it only scans for new commits and skips everything already indexed.

- **Direct match:** this exact SHA is one of the commits inside a known PR.
- **Patch-id match:** every other commit sharing the identical diff is reported together, each annotated with its own branch(es) and originating PR (if any).

## Usage

```bash
# Auto-sync cache (incremental), then look up the commit:
bun run src/fg-find-commit-origin.js <commit-hash>

# Skip the auto-sync and query the cache as-is:
bun run src/fg-find-commit-origin.js --no-sync <commit-hash>

# Skip the Forgejo PR metadata sync (use only local cache; works fully offline):
bun run src/fg-find-commit-origin.js --no-prs <commit-hash>

# Both flags together (fully offline, no network at all):
bun run src/fg-find-commit-origin.js --no-sync --no-prs <commit-hash>
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FORGEJO_TOKEN` | Only for PR sync | Forgejo/Gitea personal access token. If missing, local-only results are still returned (branch + cherry-pick detection works without any token). |

## When to use `fg-cherry-cache.js` instead

`fg-cherry-cache.js` is still useful for:
- Full `--rebuild` (wipe + rebuild from scratch)
- When you want to see detailed sync progress output
- Pre-populating the cache in CI or a pre-push hook

`fg-find-commit-origin.js` auto-sync covers day-to-day ad-hoc lookups without pre-warming.
