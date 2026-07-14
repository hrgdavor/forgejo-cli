# Stacked Pull Request CLI toolkit

These components work directly inside your project directories, using standard Git plumbing and the Forgejo/Gitea APIs to manage stacked branches, PRs, and commit-history tracing entirely from the console.

Per-tool documentation has moved to [doc/](../doc/).

## Tool documentation index

### Stack & PR Management

| Tool | Description | Doc |
|------|-------------|-----|
| `fg-stack.js` | Create a stacked PR chain from a commit range | [doc/fg-stack.md](../doc/fg-stack.md) |
| `fg-rebase.js` | Rebase an entire stacked PR chain | [doc/fg-rebase.md](../doc/fg-rebase.md) |
| `fg-retarget.js` | Auto-retarget a stack after lower PRs are merged | [doc/fg-retarget.md](../doc/fg-retarget.md) |
| `fg-merge-safe.js` | Safely merge stacked PRs bottom-up | [doc/fg-merge-safe.md](../doc/fg-merge-safe.md) |
| `fg-prs.js` | List PRs with optional conflict check | [doc/fg-prs.md](../doc/fg-prs.md) |

### Commit Origin & Cache Tooling

| Tool | Description | Doc |
|------|-------------|-----|
| `fg-cherry-cache.js` | Build/refresh the commit → patch-id → branch cache | [doc/fg-cherry-cache.md](../doc/fg-cherry-cache.md) |
| `fg-cherry.js` | Find which branches contain a commit (offline) | [doc/fg-cherry.md](../doc/fg-cherry.md) |
| `fg-find-commit-origin.js` | Trace commit origin across branches and PRs | [doc/fg-find-commit-origin.md](../doc/fg-find-commit-origin.md) |
| `fg-branch-diff.js` | Compare branches by patch content | [doc/fg-branch-diff.md](../doc/fg-branch-diff.md) |
| `fg-branch-parents.js` | Print fork-parent chain for a branch | [doc/fg-branch-parents.md](../doc/fg-branch-parents.md) |
| `fg-sync.js` | Sync branches/tags between two repos | [doc/fg-sync.md](../doc/fg-sync.md) |
| `gsearch.js` | Search commit messages across all branches | [doc/gsearch.md](../doc/gsearch.md) |

### Redmine Integration

| Tool | Description | Doc |
|------|-------------|-----|
| `red-commit.js` | Commit with automatic Redmine issue notes | [doc/red-commit.md](../doc/red-commit.md) |
| `red-pr.js` | Create branch + PR from a Redmine ticket | [doc/red-pr.md](../doc/red-pr.md) |

### Cache internals

| Document | Description |
|----------|-------------|
| [doc/commit-cache.md](../doc/commit-cache.md) | Full structure, content, incremental sync, and freshness trade-offs |

## Shared modules

- **`utils.js`** — General-purpose utilities: logging (`fail`/`info`/`ok`), `git()` command runner, `readPackageJson()`, `sanitizeBranchName()`.
- **`forgejo-utils.js`** — Forgejo/Gitea API primitives: `getRepoContext`, `getHeaders` (`FORGEJO_TOKEN`), `fetchAllPages`, `fetchPagesUntil`, `mapWithConcurrency`.
- **`red-utils.js`** — Redmine API primitives: `getRedmineConfig`, `fetchRedmineIssue`, `updateRedmineField`, `createPullRequest`. Requires `REDMINE_URL` and `REDMINE_API_KEY`.
- **`commit-cache.js`** — The single consolidated cache module used by `fg-cherry-cache.js` (builds/refreshes it), `fg-cherry.js`, and `fg-find-commit-origin.js` (read-only consumers). See [doc/commit-cache.md](../doc/commit-cache.md) for full details.

## Environment Variables

| Variable | Required by | Description |
|----------|-------------|-------------|
| `FORGEJO_TOKEN` | All forgejo-based tools (fg-*.js, red-pr.js) | Forgejo/Gitea personal access token |
| `REDMINE_URL` | red-commit.js, red-pr.js | Base URL of your Redmine instance |
| `REDMINE_API_KEY` | red-commit.js, red-pr.js | Your Redmine API key |

To set them temporarily (PowerShell):

```powershell
$env:FORGEJO_TOKEN="your_secret_access_token_here"
$env:REDMINE_URL="https://redmine.example.com"
$env:REDMINE_API_KEY="your_redmine_api_key_here"
```

To set them temporarily (Linux/macOS):

```bash
export FORGEJO_TOKEN="your_secret_access_token_here"
export REDMINE_URL="https://redmine.example.com"
export REDMINE_API_KEY="your_redmine_api_key_here"