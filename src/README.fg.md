# Stacked Pull Request CLI toolkit

These components work directly inside your project directories, using standard Git plumbing and the Forgejo/Gitea APIs to manage stacked branches, PRs, and commit-history tracing entirely from the console.

Per-tool documentation has moved to [doc/](../doc/).

## Tool documentation index

### Stack & PR Management

| Tool             | Description                                                | Doc                                         |
| ---------------- | ---------------------------------------------------------- | ------------------------------------------- |
| `fg-stack.js`    | Create a stacked PR chain from a commit range              | [doc/fg-stack.md](../doc/fg-stack.md)       |
| `fg-rebase.js`   | Rebase an entire stacked PR chain                          | [doc/fg-rebase.md](../doc/fg-rebase.md)     |
| `fg-retarget.js` | Auto-retarget a stack after lower PRs are merged           | [doc/fg-retarget.md](../doc/fg-retarget.md) |
| `fg-align.js`    | Align PR branches with their base (rebase if no conflicts) | [doc/fg-align.md](../doc/fg-align.md)       |
| `fg-prs.js`      | List PRs with optional conflict check                      | [doc/fg-prs.md](../doc/fg-prs.md)           |
| `fg-pr-check.js` | Check auth setup and show PR title/status                  | [doc/fg-pr-check.md](../doc/fg-pr-check.md) |

### Commit Origin & Cache Tooling

| Tool                       | Description                                        | Doc                                                             |
| -------------------------- | -------------------------------------------------- | --------------------------------------------------------------- |
| `fg-cherry-cache.js`       | Build/refresh the commit → patch-id → branch cache | [doc/fg-cherry-cache.md](../doc/fg-cherry-cache.md)             |
| `fg-cherry.js`             | Find which branches contain a commit (offline)     | [doc/fg-cherry.md](../doc/fg-cherry.md)                         |
| `fg-find-commit-origin.js` | Trace commit origin across branches and PRs        | [doc/fg-find-commit-origin.md](../doc/fg-find-commit-origin.md) |
| `fg-branch-diff.js`        | Compare branches by patch content                  | [doc/fg-branch-diff.md](../doc/fg-branch-diff.md)               |
| `fg-branch-parents.js`     | Print fork-parent chain for a branch               | [doc/fg-branch-parents.md](../doc/fg-branch-parents.md)         |
| `fg-sync.js`               | Sync branches/tags between two repos               | [doc/fg-sync.md](../doc/fg-sync.md)                             |
| `gsearch.js`               | Search commit messages across all branches         | [doc/gsearch.md](../doc/gsearch.md)                             |

### Code Review

| Tool           | Description                                  | Doc                                     |
| -------------- | -------------------------------------------- | --------------------------------------- |
| `fg-review.js` | Run Alibaba open-code-review (`ocr`) on a PR | [doc/fg-review.md](../doc/fg-review.md) |

### Redmine Integration

| Tool            | Description                               | Doc                                       |
| --------------- | ----------------------------------------- | ----------------------------------------- |
| `red-commit.js` | Commit with automatic Redmine issue notes | [doc/red-commit.md](../doc/red-commit.md) |
| `red-pr.js`     | Create branch + PR from a Redmine ticket  | [doc/red-pr.md](../doc/red-pr.md)         |

### Cache internals

| Document                                      | Description                                                         |
| --------------------------------------------- | ------------------------------------------------------------------- |
| [doc/commit-cache.md](../doc/commit-cache.md) | Full structure, content, incremental sync, and freshness trade-offs |

## Shared modules

- **`utils.js`** - General-purpose utilities: logging (`fail`/`info`/`ok`), `git()` command runner, `readPackageJson()`, `sanitizeBranchName()`.
- **`forgejo-utils.js`** - Forgejo/Gitea API primitives: `getRepoContext`, `getHeaders`, `fetchAllPages`, `fetchPagesUntil`, `mapWithConcurrency`. Instance URL and token come from `~/.forgejo-cli/<domain>.json` (see `util/forgejo/instanceConfig.js`).
- **`util/review/reviewProfiles.js`** - Global review model profiles from `~/.forgejo-cli/review/<name>.json`.
- **`red-utils.js`** - Redmine API primitives: `getRedmineConfig`, `fetchRedmineIssue`, `updateRedmineField`, `createPullRequest`. Requires `REDMINE_URL` and `REDMINE_API_KEY`.
- **`commit-cache.js`** - The single consolidated cache module used by `fg-cherry-cache.js` (builds/refreshes it), `fg-cherry.js`, and `fg-find-commit-origin.js` (read-only consumers). See [doc/commit-cache.md](../doc/commit-cache.md) for full details.

## Configuration

Per-instance settings can live in a folder in your home directory, named by domain:

```
~/.forgejo-cli/
├── gitea.example.com.json   # { "url": "...", "token": "..." }
└── review/
    └── gpt5.json            # { "url": "...", "model": "...", "protocol": "...", "token": "..." }
```

With a single Forgejo/Gitea instance you can skip the folder entirely: export
`FORGEJO_TOKEN` (or use `~/.forgejo-cli.env` / the vault) and the URL is derived
from the remote. The same goes for review — one model setup can just use
`OCR_LLM_*`; profiles are for switching between several.

The domain is detected from the `origin` remote (`FORGEJO_INSTANCE` overrides
it). Every `fg-*` tool resolves the instance URL and token through it, so
several Forgejo/Gitea instances can be configured side by side. Review profiles
are shared by all repositories; select one with `fg-review.js --profile <name>`
and a profile named `default` is used implicitly.

A domain file can also define named **actors** (extra identities such as a bot):

```json
{ "url": "https://gitea.example.com", "token": "your_token",
  "actors": { "bot": { "token": "bot_token" } } }
```

Select one with `--as bot` (works on every tool) or `FORGEJO_ACTOR=bot`. An
actor's `token` is required, so a bot never falls back to acting as you.

Values not found there fall back to the environment variables below, then
`~/.forgejo-cli.env`, then the OS vault.

## Fallback environment variables

| Variable          | Required by                                  | Description                                                   |
| ----------------- | -------------------------------------------- | ------------------------------------------------------------- |
| `FORGEJO_TOKEN`   | All forgejo-based tools (fg-*.js, red-pr.js) | Forgejo/Gitea token; enough on its own for one instance       |
| `REDMINE_URL`     | red-commit.js, red-pr.js                     | Base URL of your Redmine instance                             |
| `REDMINE_API_KEY` | red-commit.js, red-pr.js                     | Your Redmine API key                                          |
| `OCR_LLM_URL`     | fg-review.js*                                | Model endpoint for open-code-review                           |
| `OCR_LLM_TOKEN`   | fg-review.js*                                | Model API key for open-code-review                            |
| `OCR_LLM_MODEL`   | fg-review.js*                                | Model name for open-code-review                               |

\* Only needed when no review profile supplies the model; profiles in
`~/.forgejo-cli/review/` are preferred. Otherwise `ocr` uses
`~/.opencodereview/config.json`, and a saved OCR provider takes precedence over
the environment (`fg-review.js` warns when that happens). Pass `--url`,
`--token` (prefer `--token-stdin`), `--model`, or `--protocol` to override for a
single run. See [doc/fg-review.md](../doc/fg-review.md).

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