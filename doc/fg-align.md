# Align PR branches with base - `src/fg-align.js`

To keep your stack current, rebase PR branches onto their base branch so they are no longer behind.

## Usage

```bash
bun run src/fg-align.js
```

## What happens behind the scenes

1. **API rebase attempt:** Tries `Do: "rebase"` via the Forgejo merge endpoint.
2. **Local rebase fallback:** If the API rebase fails (e.g. "head is behind"), does `git rebase <base> <head>` locally and force-pushes the result.
3. **Fork handling:** If the PR is from a fork and the push is rejected, prints manual instructions for the fork owner.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FORGEJO_TOKEN` | Yes | Forgejo/Gitea personal access token |
