# Search commit messages - `src/gsearch.js`

Pure git, no cache or API involved. Search by text or an exact hash, then print every local/remote branch containing each match; optionally check whether a specific branch is included.

## Usage

```bash
bun run src/gsearch.js "search term" [target-branch]
```

## Environment variables

None required.