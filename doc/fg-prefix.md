# Change PR title prefixes - `src/fg-prefix.js`

Forgejo decides whether a pull request is a draft from a prefix in its title (`WORK_IN_PROGRESS_PREFIXES`). This script adds, replaces, or removes that prefix on one or more PRs. Removing the prefix makes a PR mergeable again — that is the only way to clear the WIP gate, since `mergeable: false` for a draft is a deliberate server rule, not a conflict.

## Usage

```bash
# add or replace the prefix
bun run src/fg-prefix.js WIP: 123
bun run src/fg-prefix.js W: 123,456

# PR numbers also work one per argument, and the forms can be mixed
bun run src/fg-prefix.js W: 123 456 789
bun run src/fg-prefix.js W: 123,456 789

# remove the prefix (mark ready for review)
bun run src/fg-prefix.js - 123
bun run src/fg-prefix.js ready 123

# every open PR
bun run src/fg-prefix.js WIP: --all

# preview without patching
bun run src/fg-prefix.js - 123 -n
```

## Flags

| Flag | Description |
|------|-------------|
| `-n`, `--dry-run` | Print old and new titles without patching |
| `--all` | Apply to every open PR |
| `-h`, `--help` | Show help |

## What counts as a prefix

A prefix is a run of letters and digits at the very start of the title with a colon immediately after it, optionally followed by a space. No spaces or punctuation are allowed inside it.

| Title | Treated as prefix | Result of stripping |
|-------|-------------------|----------------------|
| `WIP: Fix crash in parser` | `WIP:` | `Fix crash in parser` |
| `W:Fix crash in parser` | `W:` | `Fix crash in parser` |
| `Draft: new API` | `Draft:` | `new API` |
| `fix parser: handle empty input` | none | unchanged — the colon is not a prefix |
| `refactor: a: b` | `refactor:` | `a: b` — only the leading prefix is removed |
| `10:30 standup notes` | none | unchanged — purely numeric starts are not prefixes |
| `CVE-2024-1234: security fix` | none | unchanged — the hyphen breaks the prefix |
| `[WIP] old style` | none | unchanged — brackets are not part of the prefix form |

## Behaviour

- The existing prefix is detected and removed first, so `WIP:` → `W:` and `W:` → removal work without manual cleanup.
- A prefix given without a trailing colon gets one appended: `WIP` becomes `WIP:`. Anything that is not letters/digits followed by a colon is rejected, including bracket forms like `[WIP]`.
- Titles that already match the target are reported as already correct and are not patched.
- Non-open PRs and titles consisting only of a prefix are skipped.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FORGEJO_TOKEN` | Yes | Forgejo/Gitea personal access token |