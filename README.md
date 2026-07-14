# forgejo-cli

Bun scripts for Forgejo/Gitea stacked PR management, Redmine integration, and git commit history tracing.

To install dependencies:

```bash
bun install
```

---

## CLI Tools

All tools are Bun scripts in [src/](src/). Per-tool documentation is in [doc/](doc/).

### Forgejo/Gitea Stacked PR Toolkit

Stacked PR management, safe merging/retargeting, and commit/patch-id origin tracing against a Forgejo/Gitea server.

| Tool | Description |
|------|-------------|
| `fg-stack.js` | Create a stacked PR chain from a commit range — [doc](doc/fg-stack.md) |
| `fg-rebase.js` | Rebase an entire stacked PR chain — [doc](doc/fg-rebase.md) |
| `fg-retarget.js` | Auto-retarget a stack after lower PRs are merged — [doc](doc/fg-retarget.md) |
| `fg-merge-safe.js` | Safely merge stacked PRs bottom-up — [doc](doc/fg-merge-safe.md) |
| `fg-prs.js` | List PRs for current/stack branches with optional conflict check — [doc](doc/fg-prs.md) |
| `fg-cherry.js` | Find which branches contain a commit (local cache, offline) — [doc](doc/fg-cherry.md) |
| `fg-cherry-cache.js` | Build/refresh the commit → patch-id → branch cache — [doc](doc/fg-cherry-cache.md) |
| `fg-find-commit-origin.js` | Trace commit origin across branches and PRs — [doc](doc/fg-find-commit-origin.md) |
| `fg-branch-diff.js` | Compare branches by patch content (not just SHA) — [doc](doc/fg-branch-diff.md) |
| `fg-branch-parents.js` | Print fork-parent chain for a branch — [doc](doc/fg-branch-parents.md) |
| `fg-sync.js` | Sync branches/tags between two repos — [doc](doc/fg-sync.md) |

### Redmine Integration

| Tool | Description |
|------|-------------|
| `red-commit.js` | Commit with automatic Redmine issue notes (also: `--hook` for post-commit, `-f` for force) — [doc](doc/red-commit.md) |
| `red-pr.js` | Create branch + PR from a Redmine ticket — [doc](doc/red-pr.md) |

### Other Utilities

| Tool | Description |
|------|-------------|
| `gsearch.js` | Search commit messages across all branches — [doc](doc/gsearch.md) |

### Shared Modules

| Module | Description |
|--------|-------------|
| `commit-cache.js` | Consolidated cache backing `fg-cherry-cache.js`, `fg-cherry.js`, `fg-find-commit-origin.js` — [doc](doc/commit-cache.md) |
| `forgejo-utils.js` | Forgejo/Gitea API primitives (`getRepoContext`, `getHeaders`, `fetchAllPages`, `mapWithConcurrency`) |
| `red-utils.js` | Redmine API primitives (`fetchRedmineIssue`, `updateRedmineField`, `createPullRequest`) |
| `utils.js` | General-purpose utilities (`fail`/`info`/`ok` logging, `git()` runner, `readPackageJson`, `sanitizeBranchName`) |

### Environment Variables

| Variable | Required by | Description |
|----------|-------------|-------------|
| `FORGEJO_TOKEN` | All fg-* tools, red-pr.js | Forgejo/Gitea personal access token |
| `REDMINE_URL` | red-commit.js, red-pr.js | Base URL of your Redmine instance (e.g. `https://redmine.example.com`) |
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