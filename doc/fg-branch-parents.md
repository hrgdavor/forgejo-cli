# Branch parents — `src/fg-branch-parents.js`

Prints the fork-parent chain for a branch — branch → its base → that base's base → ... → root. Useful for sanity-checking the `resolveBranchBase()` calculation in the commit cache against actual git history. Also useful standalone: "what was this branch forked from, and what was THAT forked from?".

Pure local git, no network. Only resolves the branches actually needed for this branch's chain, NOT the entire repo's branch list — use `bun run src/fg-cherry-cache.js` if you want every branch precomputed.

## Usage

```bash
bun run src/fg-branch-parents.js <branch>
bun run src/fg-branch-parents.js <branch> --rebuild
```

## Environment variables

None required.