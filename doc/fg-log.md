# View activity log - `src/fg-log.js`

Lists activity lines written to `~/.forgejo-cli/log` by other forgejo-cli commands (e.g. PR creation from `red-pr.js`, commit comments added from `red-commit.js`). Each log line is a JSON object.

## Usage

```bash
bun run src/fg-log.js          # show today's log, grouped by ticket (no dates)
bun run src/fg-log.js <N>      # show log lines from the last N days (default: 1)
bun run src/fg-log.js -1       # show all log lines
bun run src/fg-log.js --help   # show help
```

| Command | Description |
|---------|-------------|
| (no args) | Shows today's log, **grouped by ticket** with commit messages indented under their PR header (no dates shown) |
| `<N>` | Shows raw log lines (with timestamps) from the last `N` days, including today (e.g. `2` = today + yesterday) |
| `-1` | Shows every raw log line ever written |
| `--help`, `-h` | Shows usage help |

## Example (default grouped view)

```bash
$ bun run src/fg-log.js
PR #42: https://git.example.com/owner/repo/pulls/42
   Commit: fix login flow
   Commit: add tests
PR #43: https://git.example.com/owner/repo/pulls/43
   Commit: update docs
```

## Log line format (JSON)

Each line is a JSON object:

```json
{"ts":"2026-08-03T09:20:20.000Z","msg":"PR #42: https://git.example.com/owner/repo/pulls/42","ticket":"12345"}
{"ts":"2026-08-03T09:20:21.000Z","msg":"Commit: fix login flow","ticket":"12345"}
```

| Key | Description |
|-----|-------------|
| `ts` | ISO-8601 timestamp of when the activity happened |
| `msg` | The activity message |
| `ticket` | (optional) Redmine ticket number the activity relates to |

## Where the log is stored

The log file is `~/.forgejo-cli/log` (i.e. `.forgejo-cli/log` inside your home directory).