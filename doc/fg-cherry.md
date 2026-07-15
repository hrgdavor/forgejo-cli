# Cherry-pick / branch lookup - `src/fg-cherry.js`

Fast, offline lookup - no network calls, and no live `git branch --contains` calls once the cache is populated (it reads the branch/first-parent data `cherry-cache.js` already resolved). Given a commit hash, computes its patch-id and reports every branch containing that commit or a same-diff copy of it, anywhere in history. If PR metadata is already cached, the originating PR is shown too.

Requires the cache to be built first via `bun run src/fg-cherry-cache.js`.

## Usage

```bash
bun run src/fg-cherry.js <commit-hash>
bun run src/fg-cherry.js <commit-hash> <branch-name>
```

Pass an optional second argument to get a quick pass/fail summary at the end for one specific branch, so you don't have to scan a long match list by eye. When there's a match, it also traces **how and when** the patch actually entered that branch:

- **Authored vs. committed timestamps** - a cherry-pick keeps the original author date but sets the committer date to whenever it was actually applied, so the gap between the two tells you when it landed.
- **Path** - whether the commit sits directly on the branch's first-parent history (committed/cherry-picked straight onto it) or only arrived via a merge commit (some other branch already had the same patch and was merged in later).

## Environment variables

None required for basic usage. `FORGEJO_TOKEN` only needed if the cache was built with PR sync.