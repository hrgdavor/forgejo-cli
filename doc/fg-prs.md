# List PRs — `src/fg-prs.js`

Provides structural visibility into your code repository layout. It maps out dependencies recursively so you can see your entire workflow tree.

## Usage

```bash
bun run src/fg-prs.js
```

### `--check` Inline conflict check

To run an exhaustive audit that forces the backend server to process background git diff calculations on all branches and explicitly append status indicators (`✅` / `❌`) right into the visual rendering tree nodes:

```bash
bun run src/fg-prs.js --check
# Or use the shorthand flag:
bun run src/fg-prs.js -c
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FORGEJO_TOKEN` | Yes | Forgejo/Gitea personal access token |