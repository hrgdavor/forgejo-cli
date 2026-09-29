# Search commits - `src/gsearch.js`

Pure git, no cache or API involved. Two modes:

- **Search by text or hash**: find commits matching a message (or exact SHA), then print every local/remote branch containing each match; optionally check whether a specific branch is included.
- **`--contains <sha>`**: given a commit SHA, print every local + remote-tracking branch that contains it.

## Usage

### Find branches containing a commit

```bash
bun run src/gsearch.js --contains <commit-sha>
# or use the short flag:
bun run src/gsearch.js -c <commit-sha>
```

### Search by message text

```bash
bun run src/gsearch.js "search term" [target-branch]
```

## Environment variables

None required.