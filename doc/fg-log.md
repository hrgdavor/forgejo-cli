# View activity log - `src/fg-log.js`

Lists activity lines written to `~/.forgejo-cli/log` by other forgejo-cli commands (e.g. PR creation from `red-pr.js`, commit comments added from `red-commit.js`). Each log line is prefixed with `YYYY-MM-DD HH:MM:SS`.

## Usage

```bash
bun run src/fg-log.js          # show log lines from today
bun run src/fg-log.js <N>      # show log lines from the last N days (default: 1)
bun run src/fg-log.js -1       # show all log lines
bun run src/fg-log.js --help   # show help
```

| Command | Description |
|---------|-------------|
| (no args) | Shows log lines written today |
| `<N>` | Shows log lines from the last `N` days, including today (e.g. `2` = today + yesterday) |
| `-1` | Shows every log line ever written |
| `--help`, `-h` | Shows usage help |

## Example

```bash
$ bun run src/fg-log.js
2026-08-03 08:54:10 PR #42 created: https://git.example.com/owner/repo/pulls/42 (#12345 Fix login bug)
2026-08-03 08:55:02 Redmine note added to issue #12345: commit: fix login flow
```

## Where the log is stored

The log file is `~/.forgejo-cli/log` (i.e. `.forgejo-cli/log` inside your home directory).