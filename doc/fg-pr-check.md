# Check auth and PR status - `src/fg-pr-check.js`

Answers two questions in one command: **is my Forgejo/Gitea auth set up
correctly**, and **what is the title and status of this PR**.

It resolves the instance exactly like every other tool (`~/.forgejo-cli/<domain>.json`,
then `FORGEJO_TOKEN`, then `~/.forgejo-cli.env`, then the vault), so a green
result here means the rest of the `fg-*` tools will authenticate too.

## Usage

```bash
# PR for the current branch
bun run src/fg-pr-check.js

# a specific PR
bun run src/fg-pr-check.js 123

# every open PR, title + status
bun run src/fg-pr-check.js --all

# only verify the token and repo access
bun run src/fg-pr-check.js --auth-only

# machine-readable
bun run src/fg-pr-check.js 123 --json
```

## Flags

| Flag           | Description                                        |
| -------------- | -------------------------------------------------- |
| `--all`        | List every open PR instead of a single PR          |
| `--auth-only`  | Skip the PR lookup                                 |
| `--as <actor>` | Act as a named Gitea actor from the domain config  |
| `--json`       | Emit a single JSON object instead of text          |
| `-h`, `--help` | Show help                                          |

## What it checks

1. **Config** — which instance file was found (or that none exists and the
   env/vault fallback is in use).
2. **Token** — masked value and where it came from: the domain file,
   `FORGEJO_TOKEN`, `~/.forgejo-cli.env`, or the OS vault. With `--as <actor>`,
   the actor's token is used and an `Actor` line is shown.
3. **PR access** — `GET /repos/{owner}/{repo}/pulls`, the deciding check, because
   it is the data every command actually reads. A 401 means the token is wrong,
   expired, or revoked; a 403/404 means it is valid but cannot see this
   repository. Endpoints no command uses (such as `/user`) are not probed.
4. **PR** — number, title, state, draft, merged, mergeable (single PR), branch,
   author, and web URL.

`--auth-only` verifies **read** access. Write permissions (creating, merging, or
pushing to PRs) cannot be proven without performing the action, so those
failures still surface when the operation itself runs.

## Example

```text
🔐 Forgejo
  Instance : gitea.example.com
  API      : https://gitea.example.com/api/v1
  Config   : ~/.forgejo-cli/gitea.example.com.json
  Token    : abcd…wxyz from domain file ~/.forgejo-cli/gitea.example.com.json
  Result   : ✅ PR access — team/proj

📋 PR #123  [open, draft]
  Title  : Add retry to the uploader
  Branch : feature-upload-retry → main
  Author : alice
  Merge  : ✅ mergeable
  URL    : https://gitea.example.com/team/proj/pulls/123
```

`--all` prints one line per open PR:

```text
📋 Open PRs (2)
  #123   open, draft        Add retry to the uploader
  #124   open               Fix the parser
```

## Exit codes

| Code | Meaning                                                             |
| ---- | ------------------------------------------------------------------- |
| `0`  | Auth works and the requested PR(s) were read successfully           |
| `1`  | No token, rejected token, wrong repo, network error, or no PR found |

That makes it usable as a preflight step before batch operations:

```bash
bun run src/fg-pr-check.js --auth-only && bun run src/fg-review.js 123
```

`fg-review.js` can run the same Forgejo check plus a model check itself:
`bun run src/fg-review.js --auth-only` (see
[doc/fg-review.md](fg-review.md#checking-auth-before-a-review)).

## Troubleshooting

**`❌ no token configured`** — add `"token"` to the printed domain file, or
export `FORGEJO_TOKEN` (enough on its own for a single instance).

**`❌ token rejected (HTTP 401)`** — the token printed as its source is wrong,
expired, or revoked. Issue a new one and update the same source.

**`❌ cannot access owner/repo (HTTP 404)`** — the token is valid but has no
access to this repository, or the repository name changed. Check the token's
scopes and that `origin` points at the right instance.

**`❌ No open PR found for branch "..."`** — the branch has no open PR (or it
was closed). Pass a PR number or use `--all`.
