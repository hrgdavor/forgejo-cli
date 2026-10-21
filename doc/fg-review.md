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

# Machine-readable output
bun run src/fg-review.js 123 --json

# Show what would run, without calling ocr
bun run src/fg-review.js 123 --dry-run
```

## Flags

| Flag               | Description                                                                     |
| ------------------ | ------------------------------------------------------------------------------- |
| `--json`           | Pass `--format json --audience agent` to `ocr review`                           |
| `--effort <level>` | `low`, `medium`, or `high` — passed to `ocr review`                             |
| `--model <name>`   | Override the model for this run (`ocr review --model`)                          |
| `--url <endpoint>` | Model endpoint for this run (alias: `--endpoint`)                               |
| `--token <key>`    | Model API key for this run (alias: `--api-key`; `-` reads stdin)                |
| `--token-stdin`    | Read the model API key from stdin instead of passing it as an argument          |
| `--protocol <p>`   | `anthropic`, `openai`, or `openai-responses` — overrides `OCR_LLM_PROTOCOL`     |
| `--no-fetch`       | Use existing `origin/<base>` and `origin/pr/<n>` refs; do not touch the network |
| `--dry-run`        | Print the resolved OCR command and model environment, then exit                 |
| `-- <args...>`     | Pass the remaining arguments straight to `ocr review`                           |
| `-h`, `--help`     | Show help                                                                       |

## Model configuration

`fg-review.js` passes model access to OCR through OCR's own environment
variables, so an existing OCR or Claude Code environment keeps working.

| Variable                | Required   | Description                                           |
| ----------------------- | ---------- | ----------------------------------------------------- |
| `OCR_LLM_URL`           | Yes*       | Model endpoint, e.g. `https://gateway.example.com/v1` |
| `OCR_LLM_TOKEN`         | Yes*       | Model API key                                         |
| `OCR_LLM_MODEL`         | Yes*       | Model name, e.g. `gpt-5`, `claude-sonnet-4-6`         |
| `OCR_LLM_PROTOCOL`      | No         | `anthropic`, `openai`, or `openai-responses`          |
| `OCR_LLM_AUTH_HEADER`   | No         | Passed through to OCR                                 |
| `OCR_LLM_EXTRA_HEADERS` | No         | Passed through to OCR                                 |
| `OCR_LLM_TIMEOUT`       | No         | Per-request timeout in seconds (passed through)       |
| `FORGEJO_TOKEN`         | Yes        | Forgejo/Gitea personal access token                   |

\* Required only for env-based model setup. When none of `OCR_LLM_URL`,
`OCR_LLM_TOKEN`, or `OCR_LLM_MODEL` are set, OCR falls back to its own
`~/.opencodereview/config.json` (or to Claude Code's `ANTHROPIC_*` variables),
exactly as it would when run directly.

### Choosing the endpoint and key per run

Pass `--url`, `--token`, `--model`, and optionally `--protocol` to pick a
different endpoint, model, or key for a single review without touching your
environment:

```bash
bun run src/fg-review.js 123 \
  --url https://gateway.example.com/v1 \
  --model gpt-5 \
  --token-stdin < ~/.secrets/model-key
```

Precedence, most specific first:

1. CLI flags — `--url`, `--token`, `--model`, `--protocol`
2. `OCR_LLM_URL`, `OCR_LLM_TOKEN`, `OCR_LLM_MODEL`, `OCR_LLM_PROTOCOL`
3. `~/.forgejo-cli.env`
4. OS credential vault — `ocr-llm-url` and `ocr-llm-token` only

> **Prefer `--token-stdin` (or the environment/vault) over `--token`.**
> Command-line arguments are visible in shell history and process listings.
> `--token -` is shorthand for `--token-stdin`.

> **Saved OCR config takes precedence.** OCR resolves
> `~/.opencodereview/config.json` before its `OCR_LLM_*` environment. If that
> file has an active provider or a complete legacy `llm` block, the saved
> configuration wins and the environment is ignored. `fg-review.js` prints a
> warning when it detects this. Clear the saved provider (or the legacy `llm`
> block) to use the environment instead.

`OCR_LLM_URL` and `OCR_LLM_TOKEN` can also be stored in `~/.forgejo-cli.env`
or in the OS credential vault (services `ocr-llm-url` and `ocr-llm-token`).
`OCR_LLM_MODEL` is read from the environment or `~/.forgejo-cli.env`.

When `OCR_LLM_PROTOCOL` is unset, the script infers it from `OCR_LLM_URL`:

| URL shape                                    | Inferred protocol   |
| -------------------------------------------- | ------------------- |
| ends in `/messages`, or contains `anthropic` | `anthropic`         |
| ends in `/responses`                         | `openai-responses`  |
| anything else                                | `openai`            |

Set `OCR_LLM_PROTOCOL` explicitly when the gateway speaks a protocol the URL
does not reveal (for example an Anthropic-compatible gateway mounted at
`/v1`).

If only part of the triplet is configured, the script fails before calling
OCR instead of letting OCR silently ignore the incomplete environment and
fall back to its config file.

### Examples

PowerShell:

```powershell
$env:FORGEJO_TOKEN = "your_forgejo_token"
$env:OCR_LLM_URL   = "https://gateway.example.com/v1"
$env:OCR_LLM_TOKEN = "sk-your-model-key"
$env:OCR_LLM_MODEL = "gpt-5"

bun run src/fg-review.js 123
```

Linux/macOS:

```bash
export FORGEJO_TOKEN="your_forgejo_token"
export OCR_LLM_URL="https://gateway.example.com/v1"
export OCR_LLM_TOKEN="sk-your-model-key"
export OCR_LLM_MODEL="gpt-5"

bun run src/fg-review.js 123
```

Anthropic endpoint:

```bash
export OCR_LLM_URL="https://api.anthropic.com/v1/messages"
export OCR_LLM_TOKEN="$ANTHROPIC_API_KEY"
export OCR_LLM_MODEL="claude-sonnet-4-6"
export OCR_LLM_PROTOCOL="anthropic"
```

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

**`Could not fetch PR #N`** — check `FORGEJO_TOKEN` and that the repository's
`origin` points at the Forgejo/Gitea instance that hosts the PR. The PR number
must belong to `origin`, not to a different fork or upstream.

**OCR ignores my endpoint and uses another model** — OCR only treats
`OCR_LLM_*` as a complete configuration when URL, token, and model are all
present, and a saved `~/.opencodereview/config.json` provider wins over the
environment. `--dry-run` prints the environment the script actually passes.

**Wrong protocol / 404 from the model endpoint** — set `OCR_LLM_PROTOCOL`
explicitly (`openai` for most OpenAI-compatible gateways).

**Large PR fails in OCR** — use `-- --max-tokens-budget <n>`,
`-- --concurrency <n>`, or `-- --effort low` to reduce the review scope.
