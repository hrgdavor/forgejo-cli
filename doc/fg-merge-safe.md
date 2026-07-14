# Merge stacked PRs safely — `src/fg-merge-safe.js`

To clear out ready features across your repository stack, execute the safe merge pipeline.

## Usage

```bash
bun run src/fg-merge-safe.js
```

## What happens behind the scenes

1. **Conflict Screening:** The utility checks merge targets, automatically bypassing blocked PRs or lines displaying raw conflicts.
2. **Server Merging:** It closes out ready PRs down into your trunk branch one by one.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FORGEJO_TOKEN` | Yes | Forgejo/Gitea personal access token |