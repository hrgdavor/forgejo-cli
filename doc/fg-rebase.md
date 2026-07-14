# Cascade rebase — `src/fg-rebase.js`

If a reviewer asks for changes on an early tier branch (e.g., `feature-step-1`), making edits will inherently drift your subsequent dependent branches out of sync. Fix the issue, commit your code on that early branch, and while sitting directly on that branch, issue the chain-reaction command.

## Usage

```bash
bun run src/fg-rebase.js
```

## What happens behind the scenes

1. **Tree Evaluation:** It analyzes your active branch configuration, looking up the branch map to identify every higher branch layer depending on your work.
2. **Automated Hops:** The utility checks out every branch layer step-by-step up the chain.
3. **Clean Synchronization:** It runs a localized `git rebase` against the newly updated tier right beneath it and executes a safe `--force-with-lease` remote push to gracefully update your server PRs without risk of wiping out collaborative code modifications.
4. **Return Home:** It returns you right back to your starting branch.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FORGEJO_TOKEN` | Yes | Forgejo/Gitea personal access token |