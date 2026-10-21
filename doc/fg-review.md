# Review a PR with open-code-review - `src/fg-review.js`

Triggers [Alibaba Open Code Review](https://github.com/alibaba/open-code-review)
(`ocr`) on a Forgejo/Gitea pull request.

The script resolves the PR (by number, or the open PR for the current branch),
fetches the base branch and the PR head into the local repository, then runs:

```bash
ocr review --from origin/<base> --to origin/pr/<number>
```

The PR title and description are written to a temporary Markdown file and
passed to `ocr` through `--background-file`, which gives the reviewer the
intent behind the change. The temp file is removed when the review finishes.

The Forgejo/Gitea URL and token come from your per-domain integration file
(`~/.forgejo-cli/<domain>.json`); model access comes from a named review
profile (`~/.forgejo-cli/review/<name>.json`). Both are described below.

## Prerequisites

- [Bun](https://bun.sh/) (already required by this repository)
- Git >= 2.41
- The `ocr` CLI on `PATH`:

  ```bash
  npm install -g @alibaba-group/open-code-review
  ```

## Usage

```bash
# Review the open PR whose head is the current branch
bun run src/fg-review.js

# Review a specific PR
bun run src/fg-review.js 123

# Review a specific PR with a saved model profile
bun run src/fg-review.js 123 --profile gpt5

# Review and post the comments to the PR
bun run src/fg-review.js 123 --post --profile gpt5

# Re-test with another profile, replacing the previous review
bun run src/fg-review.js 123 --post --delete-last-review --profile other-model

# Delete this tool's last posted review
bun run src/fg-review.js 123 --delete-last-review

# Show saved model profiles
bun run src/fg-review.js --list-profiles

# Machine-readable output
bun run src/fg-review.js 123 --json

# Show what would run, without calling ocr
bun run src/fg-review.js 123 --dry-run
```

## Flags

| Flag                   | Description                                                                     |
| ---------------------- | ------------------------------------------------------------------------------- |
| `--json`               | Pass `--format json --audience agent` to `ocr review`                           |
| `--effort <level>`     | `low`, `medium`, or `high` — passed to `ocr review`                             |
| `--model <name>`       | Override the model for this run (`ocr review --model`)                          |
| `--profile <name>`     | Use `~/.forgejo-cli/review/<name>.json` (alias: `-p`)                           |
| `--list-profiles`      | List saved review profiles and exit                                             |
| `--auth-only`          | Verify Forgejo auth and the model endpoint, then exit                           |
| `--as <actor>`         | Act as a named Gitea actor (e.g. `bot`) from the domain config                  |
| `--base <ref>`         | Diff against this ref instead of the PR's target branch                         |
| `--post`               | Post the review comments to the PR as a Forgejo review                          |
| `--delete-last-review` | Delete the newest review this tool posted (combine with `--post` to replace)    |
| `--url <endpoint>`     | Model endpoint for this run (alias: `--endpoint`)                               |
| `--token <key>`        | Model API key for this run (alias: `--api-key`; `-` reads stdin)                |
| `--token-stdin`        | Read the model API key from stdin instead of passing it as an argument          |
| `--protocol <p>`       | `anthropic`, `openai`, or `openai-responses` — overrides `OCR_LLM_PROTOCOL`     |
| `--no-fetch`           | Use existing `origin/<base>` and `origin/pr/<n>` refs; do not touch the network |
| `--dry-run`            | Print the resolved OCR command and model environment, then exit                 |
| `-- <args...>`         | Pass the remaining arguments straight to `ocr review`                           |
| `-h`, `--help`         | Show help                                                                       |

## Model configuration

Model access is passed to OCR through OCR's own environment variables
(`OCR_LLM_*`), so an existing OCR or Claude Code environment keeps working.
In practice you configure a named profile once and select it per run.

### Named profiles

Profiles are shared by every repository and every Forgejo/Gitea instance. They
live in your home folder:

```
~/.forgejo-cli/review/<name>.json
```

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

Select one with `--profile <name>`:

```bash
bun run src/fg-review.js 123 --profile gpt5
```

A profile named `default` is used automatically when `--profile` is omitted.
List what is available — endpoint, model, and whether a key is set — with:

```bash
bun run src/fg-review.js --list-profiles
```

`--list-profiles` needs no repository context, so it works from anywhere. When a
profile is selected, its key is read from the vault service
`ocr-llm-token-<name>` before the generic `ocr-llm-token`.

### Choosing the endpoint and key per run

Flags override the selected profile for a single run:

```bash
bun run src/fg-review.js 123 \
  --profile gpt5 \
  --model o3-mini \
  --url https://other-gateway.example.com/v1 \
  --token-stdin < ~/.secrets/model-key
```

### Precedence

1. CLI flags — `--url`, `--token`, `--model`, `--protocol`
2. Selected profile — `--profile`, or `default.json` when it exists
3. `OCR_LLM_URL`, `OCR_LLM_TOKEN`, `OCR_LLM_MODEL`, `OCR_LLM_PROTOCOL`
4. `~/.forgejo-cli.env`
5. OS credential vault — `ocr-llm-token-<profile>`, then `ocr-llm-token`

> **Prefer a profile, `--token-stdin`, the environment, or the vault over
> `--token`.** Command-line arguments are visible in shell history and process
> listings. `--token -` is shorthand for `--token-stdin`.

> **Saved OCR config takes precedence.** OCR resolves
> `~/.opencodereview/config.json` before its `OCR_LLM_*` environment. If that
> file has an active provider or a complete legacy `llm` block, the saved
> configuration wins and the profile is ignored. `fg-review.js` prints a warning
> when it detects this. Clear the saved provider (or the legacy `llm` block) to
> use profiles instead.

### Environment fallback

| Variable                | Required   | Description                                                   |
| ----------------------- | ---------- | ------------------------------------------------------------- |
| `OCR_LLM_URL`           | Yes*       | Model endpoint, e.g. `https://gateway.example.com/v1`         |
| `OCR_LLM_TOKEN`         | Yes*       | Model API key                                                 |
| `OCR_LLM_MODEL`         | Yes*       | Model name, e.g. `gpt-5`, `claude-sonnet-4-6`                 |
| `OCR_LLM_PROTOCOL`      | No         | `anthropic`, `openai`, or `openai-responses`                  |
| `OCR_LLM_AUTH_HEADER`   | No         | Passed through to OCR                                         |
| `OCR_LLM_EXTRA_HEADERS` | No         | Passed through to OCR                                         |
| `OCR_LLM_TIMEOUT`       | No         | Per-request timeout in seconds (passed through)               |
| `FORGEJO_TOKEN`         | Yes*       | `FORGEJO_TOKEN`, or the domain file for multi-instance setups |

\* Only needed when no review profile supplies the model. These variables can
also be stored in `~/.forgejo-cli.env`; the URL and token additionally work from
the OS vault. When none of `OCR_LLM_URL`, `OCR_LLM_TOKEN`, or `OCR_LLM_MODEL`
are set, OCR falls back to its own `~/.opencodereview/config.json` (or to
Claude Code's `ANTHROPIC_*` variables), exactly as it would when run directly.

When `OCR_LLM_PROTOCOL` is unset, the script infers it from `OCR_LLM_URL`:

| URL shape                                    | Inferred protocol   |
| -------------------------------------------- | ------------------- |
| ends in `/messages`, or contains `anthropic` | `anthropic`         |
| ends in `/responses`                         | `openai-responses`  |
| anything else                                | `openai`            |

Set the protocol explicitly (in a profile or with `--protocol`) when the
gateway speaks a protocol the URL does not reveal, for example an
Anthropic-compatible gateway mounted at `/v1`.

If only part of the triplet is configured, the script fails before calling
OCR instead of letting OCR silently ignore the incomplete environment and
fall back to its config file.

### Examples

Profile-based (recommended):

```bash
# ~/.forgejo-cli/review/anthropic.json holds url/model/token
bun run src/fg-review.js 123 --profile anthropic
```

PowerShell (environment fallback):

```powershell
$env:FORGEJO_TOKEN = "your_forgejo_token"
$env:OCR_LLM_URL   = "https://gateway.example.com/v1"
$env:OCR_LLM_TOKEN = "sk-your-model-key"
$env:OCR_LLM_MODEL = "gpt-5"

bun run src/fg-review.js 123
```

Linux/macOS (environment fallback):

```bash
export FORGEJO_TOKEN="your_forgejo_token"
export OCR_LLM_URL="https://gateway.example.com/v1"
export OCR_LLM_TOKEN="sk-your-model-key"
export OCR_LLM_MODEL="gpt-5"

bun run src/fg-review.js 123
```

Anthropic endpoint as a saved profile — `~/.forgejo-cli/review/anthropic.json`:

```json
{
  "url": "https://api.anthropic.com/v1/messages",
  "model": "claude-sonnet-4-6",
  "protocol": "anthropic",
  "token": "sk-ant-..."
}
```

```bash
bun run src/fg-review.js 123 --profile anthropic
```

The same endpoint through the environment fallback:

```bash
export OCR_LLM_URL="https://api.anthropic.com/v1/messages"
export OCR_LLM_TOKEN="$ANTHROPIC_API_KEY"
export OCR_LLM_MODEL="claude-sonnet-4-6"
export OCR_LLM_PROTOCOL="anthropic"
```

## Checking auth before a review

`--auth-only` verifies both integrations and exits without looking at a PR:

```bash
bun run src/fg-review.js --auth-only --profile gpt5
```

It reports two blocks:

- **Forgejo** — instance, API base URL, config file, the masked token and where
  it came from, then PR access (`GET /repos/{owner}/{repo}/pulls`). Only the
  endpoints the tools actually use are probed; `/user` is not one of them.
- **Model** — profile or environment source, endpoint, model, protocol, masked
  token, then runs `ocr llm test` (45-second timeout) and shows its output.

Exit code `0` only when both pass, so it works as a preflight:

```bash
bun run src/fg-review.js --auth-only && bun run src/fg-review.js 123
```

A missing `ocr` is reported as a model failure, and an incomplete profile/env
triplet (for example URL and model but no key) is reported before anything is
called. A saved `~/.opencodereview/config.json` still wins over the profile; the
check notes when `ocr llm test` is verifying that saved configuration instead.

## Posting the review to the PR

OCR itself only prints comments. With `--post`, `fg-review.js` runs OCR in JSON
mode and uploads the findings as a single Forgejo review:

```bash
bun run src/fg-review.js 123 --post --profile gpt5
```

To post as a bot identity instead of yourself, add `--as`:

```bash
bun run src/fg-review.js 123 --post --as bot --profile gpt5
```

- Inline comments are attempted first (`new_position` = the comment's start
  line). If the server rejects the positions (HTTP 400/422), every comment is
  posted in the review body instead, so nothing is lost.
- Each posted review starts with an invisible `<!-- fg-review -->` marker.
- Nothing is posted when OCR skips the run (no supported files) or returns zero
  comments; the reason is printed.
- Posting needs write access to the repository. A rejected request is reported
  with its status.

## Retesting with another profile or agent

Delete this tool's last review before a retest:

```bash
bun run src/fg-review.js 123 --delete-last-review
```

Combine it with `--post` to replace in one run:

```bash
bun run src/fg-review.js 123 --post --delete-last-review --profile other-model
```

Only reviews carrying the marker are considered, so a human review is never
deleted. The newest one is removed; when none exists the command says so and
exits `0`.

## Diff base and empty ranges

OCR reviews `merge-base(base, head)..head`, which is the PR's own change set.
`fg-review.js` prints the resolved merge-base, head, and changed-file count, and
stops with an explanation when the range is empty:

- the PR head is already contained in the base (already merged, or the commits
  were pushed elsewhere), or
- the fetched base is not the branch the PR actually targets.

Use `--base` to diff against something else:

```bash
bun run src/fg-review.js 123 --base origin/main
```

Any ref that exists locally works (`origin/<branch>`, a local branch, a tag, a
SHA). With `--base origin/<branch>` and no `--no-fetch`, that branch is fetched
first. To inspect what OCR filters out, pass its preview flag through:
`-- --preview`.

## How refs are resolved

For PR `#N`:

1. `origin/<base>` is fetched from `refs/heads/<base>`.
2. The PR head is fetched from `refs/pull/<N>/head` into `origin/pr/<N>`.
   This works for PRs from forks too.
3. If the server does not expose `refs/pull/<N>/head`, the script falls back
   to `refs/heads/<head>` (same-repository PRs only).

With `--no-fetch`, both refs must already exist locally. If `origin/pr/<N>` is
missing, `origin/<head>` is used instead. A warning is printed when the local
head SHA differs from the PR's `head.sha`, which usually means the ref is
stale.

## Exit codes

| Code   | Meaning                                                                  |
| ------ | ------------------------------------------------------------------------ |
| `0`    | Review finished successfully (including "no comments")                   |
| `1`    | Bad arguments, missing PR/refs/token, `ocr` not installed, or OCR failed |
| other  | Propagated from `ocr review`                                             |

## Troubleshooting

**`open-code-review CLI "ocr" was not found on PATH`** — install it with
`npm install -g @alibaba-group/open-code-review`, then reopen the shell.

**`Could not fetch PR #N`** — check the token in
`~/.forgejo-cli/<domain>.json` (or `FORGEJO_TOKEN`) and that the repository's
`origin` points at the Forgejo/Gitea instance that hosts the PR. The PR number
must belong to `origin`, not to a different fork or upstream.

**`Review profile "name" not found`** — run `--list-profiles` to see what
exists. Profiles are files in `~/.forgejo-cli/review/` (`<name>.json`).

**`No changes to review: origin/pr/N is already contained in origin/...`** — the
PR head adds nothing to the base. Check that the commits were pushed, or diff
against a different base with `--base origin/<branch>`.

**OCR ignores my endpoint and uses another model** — OCR only treats
`OCR_LLM_*` as a complete configuration when URL, token, and model are all
present, and a saved `~/.opencodereview/config.json` provider wins over the
environment and profiles. `--dry-run` prints the profile and environment the
script actually passes.

**Wrong protocol / 404 from the model endpoint** — set `protocol` in the
profile (or `--protocol`/`OCR_LLM_PROTOCOL`); use `openai` for most
OpenAI-compatible gateways.

**Large PR fails in OCR** — use `-- --max-tokens-budget <n>`,
`-- --concurrency <n>`, or `-- --effort low` to reduce the review scope.
