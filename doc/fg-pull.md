# Pull commits from upstream - `src/fg-pull.js`

Batch-pull commits from the upstream/remote tracking branch into the current branch.
Skips commits already present locally (same patch-id) and shows live progress.

## Usage

```bash
bun run src/fg-pull.js [batch-size]
```

| Argument | Description |
|----------|-------------|
| `batch-size` | Optional positive integer. Number of commits to cherry-pick per batch (default: `1`). |

## How it works

1. Determines the current branch (`git branch --show-current`).
2. Resolves the upstream tracking branch (`@{u}`), falling back to `origin/<branch>`.
3. Fetches the upstream ref.
4. Reports commits that exist locally but not on the remote (they are kept).
5. Uses `git cherry -v` to identify commits present on the remote but missing locally, skipping any with the same patch-id as an existing local commit.
6. Cherry-picks the missing commits in batches, aborting on conflict.

## Environment variables

None required.