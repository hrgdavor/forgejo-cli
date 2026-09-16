# View activity log - `src/fg-log.js`

Lists activity lines written to `~/.forgejo-cli/log` by other forgejo-cli commands (e.g. PR creation from `red-pr.js`, commit comments added from `red-commit.js`). Each log line is a JSON object.

## Usage

```bash
bun run src/fg-log.js              # show today's log, grouped by ticket (no dates)
bun run src/fg-log.js <N>          # show the last N days, day by day, grouped by ticket
bun run src/fg-log.js <N> raw      # show raw log lines for the last N days (+ log file path)
bun run src/fg-log.js -1           # show all log days, day by day, grouped by ticket
bun run src/fg-log.js -1 raw       # show all raw log lines (+ log file path)
bun run src/fg-log.js --help       # show help
```

| Command | Description |
|---------|-------------|
| (no args) | Shows today's log, **grouped by ticket** with commit messages indented under their PR header (no dates shown) |
| `<N>` | Shows the last `N` days (including today), **day by day**, each day grouped by ticket (newest day first) |
| `<N> raw` | Prints the full log file path at the top, then the raw log lines (with timestamps) for the last `N` days |
| `-1` | Shows all log days, day by day, grouped by ticket |
| `-1 raw` | Prints the full log file path, then every raw log line ever written |
| `--help`, `-h` | Shows usage help |

## Example (default grouped view)

```bash
$ bun run src/fg-log.js
#42 Daily ByteBufferPool pool cleanup for jetty
   Commit: backend: Daily ByteBufferPool pool cleanup for jetty
#43 Fix regression for campaign items
   Commit: backend: fix regression for campaign items without task
```

When a commit is logged via `red-commit.js`, the ticket title is fetched from Redmine and stored as a header line (`#<ticket> <title>`) so the daily log displays the title alongside the ticket number.

## Example (day-by-day grouped view)

```bash
$ bun run src/fg-log.js 2

=== 2026-08-03 ===
#42 Daily ByteBufferPool pool cleanup for jetty
   Commit: backend: Daily ByteBufferPool pool cleanup for jetty

=== 2026-08-02 ===
#40 Fix regression for campaign items
   Commit: backend: fix regression for campaign items without task
```

## Example (raw view)

```bash
$ bun run src/fg-log.js 1 raw
Log file: C:\Users\you\.forgejo-cli\log
2026-08-03T09:20:20.000Z #42 Daily ByteBufferPool pool cleanup for jetty
2026-08-03T09:20:21.000Z Commit: fix login flow
```

## Log line format (JSON)

Each line is a JSON object:

```json
{"ts":"2026-08-03T09:20:20.000Z","msg":"#42 Daily ByteBufferPool pool cleanup for jetty","ticket":"42"}
{"ts":"2026-08-03T09:20:21.000Z","msg":"Commit: fix login flow","ticket":"42"}
```

| Key | Description |
|-----|-------------|
| `ts` | ISO-8601 timestamp of when the activity happened |
| `msg` | The activity message |
| `ticket` | (optional) Redmine ticket number the activity relates to |

There are two types of entries per ticket:
- **Header**: `#<ticket> <title>` — fetched from Redmine, used by `fg-log.js` as the group header
- **Action**: e.g. `Commit: ...` or `PR #...` — the actual activity description

## Where the log is stored

The log file is `~/.forgejo-cli/log` (i.e. `.forgejo-cli/log` inside your home directory).