# Align PR branches with base - `src/fg-align.js`

To keep your stack current, rebase PR branches onto their base branch so they are no longer behind.

## Usage

```bash
bun run src/fg-align.js              # list open PRs with mergeable status
bun run src/fg-align.js all          # merge base into all mergeable PR branches and push
bun run src/fg-align.js wip          # try to merge base into all WIP PR branches, report conflicts
bun run src/fg-align.js 123,456      # merge base into specific PR branches and push
```

## What happens behind the scenes

0. **Git fetch:** Runs `git fetch origin` first so local refs are up to date — this is required for accurate merge-base checks.
1. **API rebase attempt:** Tries `Do: "rebase"` via the Forgejo merge endpoint.
2. **Local rebase fallback:** If the API rebase fails (e.g. "head is behind"), does `git rebase <base> <head>` locally and force-pushes the result.
3. **Fork handling:** If the PR is from a fork and the push is rejected, prints manual instructions for the fork owner.

## WIP mode (`wip`)

`fg-align.js wip` fetches all open PRs, filters to those with `mergeable: false` (typically WIP/draft PRs), and attempts to merge the base branch into each one locally. Since WIP PRs are not mergeable on the server, this is a local-only test merge — the push will fail with a permission error, but any **merge conflicts** are detected and reported upfront.

Use this before marking PRs ready to discover hidden conflicts early.

At the end, two summary lists are printed:
- **Not ready / skipped** — PRs that were not behind or had unknown state
- **Merge attempted but failed** — PRs where the local merge produced conflicts (real content conflicts, not just whitespace)

## Alignment merge options

The local merge uses `--no-ff` so history records the alignment, plus `-Xignore-space-change` so purely whitespace-differing conflicts resolve automatically instead of aborting. Real content conflicts still abort and are reported per PR.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FORGEJO_TOKEN` | Yes | Forgejo/Gitea personal access token |
