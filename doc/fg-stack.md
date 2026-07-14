# Create a stacked PR — `src/fg-stack.js`

When you have built a new iteration layer directly on top of an unmerged feature branch locally, check out your feature branch (`git checkout feature-step-3`) and execute the stack creator.

## Usage

```bash
bun run src/fg-stack.js --title "Part 3: Add database validation schemas"
```

## What happens behind the scenes

1. **Parent Detection:** The script interrogates local git commits via `merge-base` calculations to determine which parent branch you split away from.
2. **Remote Registration:** It issues a dynamic upstream push (`git push -u origin <current-branch>`).
3. **Target Alignment:** It executes a REST command targeting the Forgejo server to instantly launch a new PR set up to track directly against your parent feature branch (`feature-step-3` ➔ `feature-step-2`) instead of blindly crashing into `main`.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FORGEJO_TOKEN` | Yes | Forgejo/Gitea personal access token |