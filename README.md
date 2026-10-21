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

| Tool                       | Description                                                                             |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `fg-stack.js`              | Create a stacked PR chain from a commit range - [doc](doc/fg-stack.md)                  |
| `fg-rebase.js`             | Rebase an entire stacked PR chain - [doc](doc/fg-rebase.md)                             |
| `fg-retarget.js`           | Auto-retarget a stack after lower PRs are merged - [doc](doc/fg-retarget.md)            |
| `fg-align.js`              | Align PR branches with their base (rebase if no conflicts) - [doc](doc/fg-align.md)     |
| `fg-prs.js`                | List PRs for current/stack branches with optional conflict check - [doc](doc/fg-prs.md) |
| `fg-pr-check.js`           | Verify auth setup and show PR title/status - [doc](doc/fg-pr-check.md)                  |
| `fg-cherry.js`             | Find which branches contain a commit (local cache, offline) - [doc](doc/fg-cherry.md)   |
| `fg-cherry-cache.js`       | Build/refresh the commit → patch-id → branch cache - [doc](doc/fg-cherry-cache.md)      |
| `fg-find-commit-origin.js` | Trace commit origin across branches and PRs - [doc](doc/fg-find-commit-origin.md)       |
| `fg-branch-diff.js`        | Compare branches by patch content (not just SHA) - [doc](doc/fg-branch-diff.md)         |
| `fg-branch-parents.js`     | Print fork-parent chain for a branch - [doc](doc/fg-branch-parents.md)                  |
| `fg-open.js`               | Open the current branch or its PR in the browser - [doc](doc/fg-open.md)                |
| `fg-sync.js`               | Sync branches/tags between two repos - [doc](doc/fg-sync.md)                            |
| `fg-pull.js`               | Batch-pull commits from upstream into current branch - [doc](doc/fg-pull.md)            |
| `fg-log.js`                | View activity log written by forgejo-cli commands - [doc](doc/fg-log.md)                |

### Redmine Integration

| Tool            | Description                                                                                |
| --------------- | ------------------------------------------------------------------------------------------ |
| `red-commit.js` | Commit with automatic Redmine issue notes (also: `--hook` for post-commit, `-f` for force) - [doc](doc/red-commit.md) |
| `red-pr.js`     | Create branch + PR from a Redmine ticket - [doc](doc/red-pr.md)                            |
| `red-open.js`   | Open the current Redmine ticket (from branch name) in the browser - [doc](doc/red-open.md) |

### Code Review

| Tool           | Description                                                            |
| -------------- | ---------------------------------------------------------------------- |
| `fg-review.js` | Run Alibaba open-code-review (`ocr`) on a PR, optionally posting/deleting the review - [doc](doc/fg-review.md) |

### Other Utilities

| Tool         | Description                                                        |
| ------------ | ------------------------------------------------------------------ |
| `gsearch.js` | Search commit messages across all branches - [doc](doc/gsearch.md) |

### Shared Modules

| Module             | Description                                                                             |
| ------------------ | --------------------------------------------------------------------------------------- |
| `commit-cache.js`  | Consolidated cache backing `fg-cherry-cache.js`, `fg-cherry.js`, `fg-find-commit-origin.js` - [doc](doc/commit-cache.md) |
| `forgejo-utils.js` | Forgejo/Gitea API primitives (`getRepoContext`, `getHeaders`, `fetchAllPages`, `mapWithConcurrency`) |
| `red-utils.js`     | Redmine API primitives (`fetchRedmineIssue`, `updateRedmineField`, `createPullRequest`) |
| `utils.js`         | General-purpose utilities (`fail`/`info`/`ok` logging, `git()` runner, `readPackageJson`, `sanitizeBranchName`) |
| `get-secret.js`    | Read secrets from env var / `~/.forgejo-cli.env` / OS vault, with a GUI-friendly "silently degrade" mode |

---

## Configuration

Integration settings can be stored per Forgejo/Gitea **domain**, in a folder in
your home directory — useful when you work against more than one instance:

```
~/.forgejo-cli/
├── gitea.example.com.json      # one integration file per instance
├── github.com.json
└── review/                     # model profiles, shared by all repositories
    ├── default.json
    └── gpt5.json
```

The domain comes from the `origin` remote, so every `fg-*` tool automatically
uses the right instance and token for the repository you are in. Set
`FORGEJO_INSTANCE=<domain>` to override detection (useful behind a mirror), or
`FORGEJO_CONFIG_DIR=<path>` to keep the settings folder somewhere else.

### One instance? No files needed

If you only use a single Forgejo/Gitea server, keep it simple: export
`FORGEJO_TOKEN` (or put it in `~/.forgejo-cli.env`, or the OS vault) and the URL
is derived from the remote, exactly as before. No folder, no files. Create
domain files only when you need more than one instance, or a URL that differs
from the remote.

The same applies to review: a single model setup can just use
`OCR_LLM_URL`/`OCR_LLM_TOKEN`/`OCR_LLM_MODEL`. Profiles are for switching
between several models.

### Multiple instances: `~/.forgejo-cli/<domain>.json`

Add one file per domain. Each repository picks the file matching its `origin`,
so instances never share credentials, and a domain file's `token` wins over
`FORGEJO_TOKEN` for that instance.

```json
{
  "url": "https://gitea.example.com",
  "token": "your_forgejo_token"
}
```

| Key      | Required | Description                                                                                   |
| -------- | -------- | --------------------------------------------------------------------------------------------- |
| `url`    | No       | API base. Defaults to `https://<domain>` (`http` for localhost). A sub-path install works too (`https://host/gitea` → `.../gitea/api/v1`). |
| `token`  | No       | Personal access token. When present it wins over the environment and the vault.               |
| `actors` | No       | Named extra identities, e.g. `{ "bot": { "token": "..." } }`. Select with `--as` (see below). |

The file name is the domain. A port is part of the domain and is sanitized, so
`localhost:3000` becomes `localhost-3000.json`.

When no file exists for a domain, the tools keep working exactly as before: the
URL is derived from the remote, and the token comes from the environment,
`~/.forgejo-cli.env`, or the OS vault.

### Actors (bot identities)

A domain file can hold additional named identities, so one command can run as
you and another as a bot:

```json
{
  "url": "https://gitea.example.com",
  "token": "your_personal_token",
  "actors": {
    "bot": { "token": "bot_token" },
    "review-bot": { "token": "review_bot_token" }
  }
}
```

Select one per command with `--as <actor>`, or set `FORGEJO_ACTOR=<actor>` for a
whole shell:

```bash
bun run src/fg-review.js 123 --post --as bot
bun run src/fg-align.js --auth-only --as bot
```

`--as` is consumed once before each command parses its arguments, so it works on
every tool. An actor's `token` is required — there is no fallback to the default
identity, so a bot never silently acts as you. Actor settings override the
domain-level `url`/`token`, and `--auth-only` shows which actor was used.

To verify the setup at any time, use `--auth-only`, which every tool reports the
same way: `bun run src/fg-pr-check.js --auth-only` or
`bun run src/fg-align.js --auth-only` for Forgejo, and
`bun run src/fg-review.js --auth-only` for Forgejo plus the model endpoint
(`ocr llm test`). It prints the resolved instance, where the token came from,
and whether the API accepts it. The check asks for PR access — the data every
command actually reads — so a repository-scoped token is not penalized for
endpoints no tool uses.

### Review profiles: `~/.forgejo-cli/review/<name>.json`

`fg-review.js` reads named model profiles from this folder, shared by every
repository and every instance:

```json
{
  "url": "https://gateway.example.com/v1",
  "model": "gpt-5",
  "protocol": "openai",
  "token": "sk-your-model-key"
}
```

| Key        | Required | Description                                                              |
| ---------- | -------- | ------------------------------------------------------------------------ |
| `url`      | Yes      | Model endpoint                                                           |
| `model`    | Yes      | Model name                                                               |
| `protocol` | No       | `anthropic`, `openai`, or `openai-responses` (inferred from `url`)       |
| `token`    | No       | API key; falls back to `OCR_LLM_TOKEN`, `~/.forgejo-cli.env`, then vault |

Select one with `fg-review.js --profile <name>`. A profile named `default` is
used automatically when it exists, and `fg-review.js --list-profiles` shows what
is available. See [doc/fg-review.md](doc/fg-review.md).

### Precedence

Most specific source first:

| Setting        | Order                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------- |
| Instance URL   | domain file `url` → derived from the `origin` remote                                      |
| Instance token | domain file `token` → `FORGEJO_TOKEN` → `~/.forgejo-cli.env` → OS vault (`forgejo-token`) |
| Review config  | CLI flags (`--url`/`--token`/`--model`/`--protocol`) → profile → `OCR_LLM_*` → `~/.forgejo-cli.env` → vault |

### GUI client safety (silent degradation)

When a tool runs as a git hook spawned by a GUI Git client (VS Code, GitKraken,
Sourcetree, GitHub Desktop, `git gui`), the secret lookup uses a **GUI-friendly
mode** that never crashes or freezes the client:

- It **never calls `process.exit`** and returns `null` on a missing secret instead
  of printing an error and aborting.
- It **skips the OS credential vault entirely** (domain config file, env var, and
  `~/.forgejo-cli.env` only). GUI clients spawn hooks as background processes that
  cannot surface a Keychain / Credential Manager authorization dialog, so querying
  the vault would hang or freeze the client. (In normal terminal use, every vault
  lookup also has a 5-second timeout so a prompt can never block indefinitely.)
- GUI clients don't inherit your shell's environment variables, so if the secret
  is blanked out the hook just skips the action (e.g. `red-commit.js --hook` skips
  the Redmine note) rather than failing.

This is the "silently degrade" pattern: the hook tries to fetch the secret, and if
it can't (or would require interactive input), it fails silently with a warning.

## Fallback sources

When no domain file or profile provides a value, tools fall back to the sources
below.

### 1. Environment Variables

| Variable           | Required by               | Description                                                            |
| ------------------ | ------------------------- | ---------------------------------------------------------------------- |
| `FORGEJO_TOKEN`    | All fg-* tools, red-pr.js | Forgejo/Gitea token; fine on its own for a single instance, otherwise the fallback when a domain file omits `token` |
| `REDMINE_URL`      | red-commit.js, red-pr.js  | Base URL of your Redmine instance (e.g. `https://redmine.example.com`) |
| `REDMINE_API_KEY`  | red-commit.js, red-pr.js  | Your Redmine API key                                                   |
| `OCR_LLM_URL`      | fg-review.js*             | Model endpoint (e.g. `https://gateway.example.com/v1`)                 |
| `OCR_LLM_TOKEN`    | fg-review.js*             | Model API key                                                          |
| `OCR_LLM_MODEL`    | fg-review.js*             | Model name (e.g. `gpt-5`)                                              |
| `OCR_LLM_PROTOCOL` | fg-review.js              | `anthropic`, `openai`, or `openai-responses` (optional)                |

\* Only needed when no review profile supplies the model. Prefer a profile in
`~/.forgejo-cli/review/`; these variables are the fallback. Otherwise `ocr`
uses `~/.opencodereview/config.json`, and a saved OCR provider takes precedence
over the environment (`fg-review.js` warns when that happens). Pass `--url`,
`--token` (prefer `--token-stdin`), `--model`, or `--protocol` to override for a
single run. See [doc/fg-review.md](doc/fg-review.md).

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

Create a file at `~/.forgejo-cli.env` with `KEY=VALUE` entries, one per line. Lines starting with `#` are ignored. This is the fallback used when a value is not provided by a domain file or review profile. Like domain files, it is read without the OS vault, so it is safe for GUI Git clients (which can hang/freeze on vault prompts spawned by VS Code, GitKraken, etc.).

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

| Environment Variable   | Vault Service Name       | Description                         |
| ---------------------- | ------------------------ | ----------------------------------- |
| `FORGEJO_TOKEN`        | `forgejo-token`          | Forgejo/Gitea personal access token |
| `REDMINE_URL`          | `redmine-url`            | Base URL of your Redmine instance   |
| `REDMINE_API_KEY`      | `redmine-api-token`      | Your Redmine API key                |
| `OCR_LLM_URL`          | `ocr-llm-url`            | Model endpoint for `fg-review.js`   |
| `OCR_LLM_TOKEN`        | `ocr-llm-token`          | Model API key for `fg-review.js`    |

When a review profile is selected, its key is read from
`ocr-llm-token-<profile>` first, then from `ocr-llm-token`.

#### Windows (Credential Manager)

Built-in — no additional dependencies.

```cmd
:: Store each secret
cmdkey /generic:forgejo-token   /user:%USERNAME% /pass:your_token
cmdkey /generic:redmine-url     /user:%USERNAME% /pass:https://redmine.example.com
cmdkey /generic:redmine-api-token /user:%USERNAME% /pass:your_api_key
cmdkey /generic:ocr-llm-url     /user:%USERNAME% /pass:https://gateway.example.com/v1
cmdkey /generic:ocr-llm-token   /user:%USERNAME% /pass:sk-your-model-key
```

The scripts use PowerShell's `Get-StoredCredential` cmdlet to read them back, which is available on Windows 10/11 and Windows Server 2016+.

#### macOS (Keychain)

Built-in — no additional dependencies.

```bash
# Store each secret
security add-generic-password -a "$USER" -s forgejo-token -w "your_token"
security add-generic-password -a "$USER" -s redmine-url -w "https://redmine.example.com"
security add-generic-password -a "$USER" -s redmine-api-token -w "your_api_key"
security add-generic-password -a "$USER" -s ocr-llm-url -w "https://gateway.example.com/v1"
security add-generic-password -a "$USER" -s ocr-llm-token -w "sk-your-model-key"
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
secret-tool store --label="OCR LLM URL"     service ocr-llm-url     username "$USER"
secret-tool store --label="OCR LLM Token"   service ocr-llm-token   username "$USER"
```

---

## Script Structure

All scripts are in `src/`. The code is organized as:

- **`src/*.js`** — CLI entry points (shebang `#!/usr/bin/env bun`, ready to run with `bun run src/xxx.js`)
- **`src/utils.js`** — General utilities (logging, git runner, package.json reader, branch name sanitizer, `getLastCommitMessage`)
- **`src/get-secret.js`** — Cross-platform secret reader (env var → `~/.forgejo-cli.env` → OS vault) with a GUI-friendly silent-degrade mode for git hooks
- **`src/util/forgejo/instanceConfig.js`** — Per-domain instance resolution (`~/.forgejo-cli/<domain>.json`, remote fallback, token precedence)
- **`src/util/review/reviewProfiles.js`** — Global review model profiles (`~/.forgejo-cli/review/<name>.json`)
- **`src/forgejo-utils.js`** — Forgejo/Gitea API helpers (`getRepoContext`, `getHeaders`, pagination, concurrency)
- **`src/red-utils.js`** — Redmine API helpers (`fetchRedmineIssue`, `addRedmineNote`, `updateRedmineField`, `createPullRequest`, git helpers)
- **`src/commit-cache.js`** — Cache layer backing all commit-origin tools