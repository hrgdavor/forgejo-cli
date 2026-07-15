# Build/refresh commit cache - `src/fg-cherry-cache.js`

The **only** script that builds or refreshes the consolidated commit → patch-id → branch cache (`cherry-cache.js` in the source tree). `cherry.js` and `fg-find-commit-origin.js` are pure read-only consumers - they never call git or the Forgejo API to build the cache themselves. Run it whenever you want fresher results (e.g. after pulling new commits or PR activity).

It scans `git log --all`, computes a stable patch-id for every new commit (via `git patch-id --stable`), records author/committer identity+dates for free, and - for any commit that shares a patch-id with another (an actual cherry-pick/rebase duplicate) - resolves accurate branch membership and first-parent-path info via `git branch -a --contains`, bounded to just those duplicate groups so it stays fast even on large repos.

## Usage

```bash
bun run src/fg-cherry-cache.js
# Skip the Forgejo API sync (offline / no token available):
bun run src/fg-cherry-cache.js --no-prs
# Force a full rebuild (e.g. after deleting/renaming branches):
bun run src/fg-cherry-cache.js --rebuild
```

## Cache details

See [doc/commit-cache.md](commit-cache.md) for the full structure, content, incremental sync behavior, and freshness trade-offs.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FORGEJO_TOKEN` | For PR sync | Forgejo/Gitea personal access token (not needed with `--no-prs`) |