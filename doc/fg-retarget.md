# Retarget stacked PRs - `src/fg-retarget.js`

`fg-align.js` does **not** automatically retarget dependent PRs. Once a lower branch (like `feature-step-1`) has been merged into `main`, any PR still targeting it (like `feature-step-2`, now stranded against a closed branch) needs its base updated. Run the companion script afterwards.

## Usage

```bash
bun run src/fg-retarget.js
```

## What happens behind the scenes

It scans open PRs, detects any whose base branch was already merged/closed, and PATCHes their base directly to where that branch ended up (e.g. `main`) so the stack shifts seamlessly downstream.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FORGEJO_TOKEN` | Yes | Forgejo/Gitea personal access token |