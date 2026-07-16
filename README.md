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
| `fg-stack.js` | Create a stacked PR chain from a commit range - [doc](doc/fg-stack.md) |
| `fg-rebase.js` | Rebase an entire stacked PR chain - [doc](doc/fg-rebase.md) |
| `fg-retarget.js` | Auto-retarget a stack after lower PRs are merged - [doc](doc/fg-retarget.md) |
| `fg-merge-safe.js` | Safely merge stacked PRs bottom-up - [doc](doc/fg-merge-safe.md) |
| `fg-prs.js` | List PRs for current/stack branches with optional conflict check - [doc](doc/fg-prs.md) |
| `fg-cherry.js` | Find which branches contain a commit (local cache, offline) - [doc](doc/fg-cherry.md) |
| `fg-cherry-cache.js` | Build/refresh the commit → patch-id → branch cache - [doc](doc/fg-cherry-cache.md) |
| `fg-find-commit-origin.js` | Trace commit origin across branches and PRs - [doc](doc/fg-find-commit-origin.md) |
| `fg-branch-diff.js` | Compare branches by patch content (not just SHA) - [doc](doc/fg-branch-diff.md) |
| `fg-branch-parents.js` | Print fork-parent chain for a branch - [doc](doc/fg-branch-parents.md) |
| `fg-sync.js` | Sync branches/tags between two repos - [doc](doc/fg-sync.md) |

### Redmine Integration

| Tool | Description |
|------|-------------|
| `red-commit.js` | Commit with automatic Redmine issue notes (also: `--hook` for post-commit, `-f` for force) - [doc](doc/red-commit.md) |
| `red-pr.js` | Create branch + PR from a Redmine ticket - [doc](doc/red-pr.md) |

### Other Utilities

| Tool | Description |
|------|-------------|
| `gsearch.js` | Search commit messages across all branches - [doc](doc/gsearch.md) |

### Shared Modules

| Module | Description |
|--------|-------------|
| `commit-cache.js` | Consolidated cache backing `fg-cherry-cache.js`, `fg-cherry.js`, `fg-find-commit-origin.js` - [doc](doc/commit-cache.md) |
| `forgejo-utils.js` | Forgejo/Gitea API primitives (`getRepoContext`, `getHeaders`, `fetchAllPages`, `mapWithConcurrency`) |
| `red-utils.js` | Redmine API primitives (`fetchRedmineIssue`, `updateRedmineField`, `createPullRequest`) |
| `utils.js` | General-purpose utilities (`fail`/`info`/`ok` logging, `git()` runner, `readPackageJson`, `sanitizeBranchName`) |
| `get-secret.js` | Read secrets from env var / `~/.forgejo-cli.env` / OS vault, with a GUI-friendly "silently degrade" mode |

---

## Secrets Setup

Each tool looks up its secrets in this order:

1. **Environment variable** (fast path, ideal for CI/containers)
2. **`~/.forgejo-cli.env` file** (simple key=value file, one per line)
3. **OS credential vault** (macOS Keychain, Windows Credential Manager, Linux libsecret)

### GUI client safety (silent degradation)

When a tool runs as a git hook spawned by a GUI Git client (VS Code, GitKraken,
Sourcetree, GitHub Desktop, `git gui`), the secret lookup uses a **GUI-friendly
mode** that never crashes or freezes the client:

- It **never calls `process.exit`** and returns `null` on a missing secret instead
  of printing an error and aborting.
- It **skips the OS credential vault entirely** (env var + `~/.forgejo-cli.env`
  only). GUI clients spawn hooks as background processes that cannot surface a
  Keychain / Credential Manager authorization dialog, so querying the vault would
  hang or freeze the client. (In normal terminal use, every vault lookup also has
  a 5-second timeout so a prompt can never block indefinitely.)
- GUI clients don't inherit your shell's environment variables, so if the secret
  is blanked out the hook just skips the action (e.g. `red-commit.js --hook` skips
  the Redmine note) rather than failing.

This is the "silently degrade" pattern: the hook tries to fetch the secret, and if
it can't (or would require interactive input), it fails silently with a warning.

### 1. Environment Variables

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
```

### 2. `~/.forgejo-cli.env` File

Create a file at `~/.forgejo-cli.env` with `KEY=VALUE` entries, one per line. Lines starting with `#` are ignored. **If the file doesn't exist, create it** — this is the recommended approach for GUI Git clients, since it avoids the OS vault (which can hang/freeze hooks spawned by VS Code, GitKraken, etc.).

```
# forgejo-cli config
FORGEJO_TOKEN=your_forgejo_token
REDMINE_URL=https://redmine.example.com
REDMINE_API_KEY=your_redmine_api_key
```

Create it on Linux/macOS:

```bash
cat > ~/.forgejo-cli.env <<'EOF'
# forgejo-cli config
FORGEJO_TOKEN=your_forgejo_token
REDMINE_URL=https://redmine.example.com
REDMINE_API_KEY=your_redmine_api_key
EOF
chmod 600 ~/.forgejo-cli.env
```

Create it on Windows (PowerShell):

```powershell
@'
# forgejo-cli config
FORGEJO_TOKEN=your_forgejo_token
REDMINE_URL=https://redmine.example.com
REDMINE_API_KEY=your_redmine_api_key
'@ | Set-Content -Path "$HOME\.forgejo-cli.env"
```

This file is checked after environment variables but before the OS vault.

### 3. OS Credential Vault

Store secrets once in your OS vault — the scripts will read them automatically.  
Below is the mapping of environment variables to vault service names:

| Environment Variable | Vault Service Name     | Description                      |
|----------------------|------------------------|----------------------------------|
| `FORGEJO_TOKEN`      | `forgejo-token`        | Forgejo/Gitea personal access token |
| `REDMINE_URL`        | `redmine-url`          | Base URL of your Redmine instance |
| `REDMINE_API_KEY`    | `redmine-api-token`    | Your Redmine API key              |

#### Windows (Credential Manager)

Built-in — no additional dependencies.

```cmd
:: Store each secret
cmdkey /generic:forgejo-token   /user:%USERNAME% /pass:your_token
cmdkey /generic:redmine-url     /user:%USERNAME% /pass:https://redmine.example.com
cmdkey /generic:redmine-api-token /user:%USERNAME% /pass:your_api_key
```

The scripts use PowerShell's `Get-StoredCredential` cmdlet to read them back, which is available on Windows 10/11 and Windows Server 2016+.

#### macOS (Keychain)

Built-in — no additional dependencies.

```bash
# Store each secret
security add-generic-password -a "$USER" -s forgejo-token -w "your_token"
security add-generic-password -a "$USER" -s redmine-url -w "https://redmine.example.com"
security add-generic-password -a "$USER" -s redmine-api-token -w "your_api_key"
```

#### Linux (libsecret)

Requires `secret-tool` from `libsecret`:

```bash
# Debian/Ubuntu
sudo apt install libsecret-tools

# Fedora
sudo dnf install libsecret

# Arch
sudo pacman -S libsecret
```

Then store each secret:

```bash
secret-tool store --label="Forgejo Token"   service forgejo-token   username "$USER"
secret-tool store --label="Redmine URL"     service redmine-url     username "$USER"
secret-tool store --label="Redmine API Key" service redmine-api-token username "$USER"
```

---

## Script Structure

All scripts are in `src/`. The code is organized as:

- **`src/*.js`** — CLI entry points (shebang `#!/usr/bin/env bun`, ready to run with `bun run src/xxx.js`)
- **`src/utils.js`** — General utilities (logging, git runner, package.json reader, branch name sanitizer, `getLastCommitMessage`)
- **`src/get-secret.js`** — Cross-platform secret reader (env var → `~/.forgejo-cli.env` → OS vault) with a GUI-friendly silent-degrade mode for git hooks
- **`src/forgejo-utils.js`** — Forgejo/Gitea API helpers (`getRepoContext`, `getHeaders`, pagination, concurrency)
- **`src/red-utils.js`** — Redmine API helpers (`fetchRedmineIssue`, `addRedmineNote`, `updateRedmineField`, `createPullRequest`, git helpers)
- **`src/commit-cache.js`** — Cache layer backing all commit-origin tools