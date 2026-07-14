# Find commit origin — `src/fg-find-commit-origin.js`

The complete answer: combines the local patch-id cache with Forgejo PR history to resolve which branch **and/or** which PR (open or closed) a commit came from — even when it was cherry-picked or rebased into a different SHA elsewhere.

A pure read-only consumer of the cache — run `bun run src/fg-cherry-cache.js` first.

- **Direct match:** this exact SHA is one of the commits inside a known PR.
- **Patch-id match:** every other commit sharing the identical diff is reported together, each annotated with its own branch(es) and originating PR (if any).

## Usage

```bash
bun run src/fg-find-commit-origin.js <commit-hash>
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FORGEJO_TOKEN` | Yes | Forgejo/Gitea personal access token |