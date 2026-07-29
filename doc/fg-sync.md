# Sync branches - `src/fg-sync.js`

Sync repositories by finding commits present in the source branch but missing in the target branch.

## Usage

```bash
bun run src/fg-sync.js <source-folder> <target-folder> [commit]
```

## Modes

- **Default** (no third argument) — only lists missing commits in the target folder.
- **`commit`** — also cherry-picks the missing commits from the source into the target.

## Environment variables

None required.