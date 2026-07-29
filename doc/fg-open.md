# Open branch/PR in browser - `src/fg-open.js`

Opens the current branch in your default browser. If there's an open PR for the branch, it opens the PR page instead.

## Usage

```bash
bun run src/fg-open.js
bun run src/fg-open.js --help
```

## How it works

1. Reads the current git branch via `git branch --show-current`
2. Calls the Forgejo API to check for any PR (open or closed) with that branch as the head
3. Opens the PR page if found (showing "closed" label if applicable), otherwise opens the branch page in the repository

## Environment variables

| Variable        | Description                                    |
|-----------------|------------------------------------------------|
| `FORGEJO_TOKEN` | Forgejo/Gitea personal access token (optional) |

If `FORGEJO_TOKEN` is not set, the script falls back to opening the branch page directly (no API call).