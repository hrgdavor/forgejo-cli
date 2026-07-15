# Commit Cache - Structure, Content & Usage

A single reference for `commit-cache.js`: the consolidated cache that backs `fg-cherry-cache.js`, `fg-cherry.js`, and `fg-find-commit-origin.js`.

## Where it lives

```
.git/info/forgejo-cache.json.gz
```

Stored gzip-compressed (via `Bun.gzipSync`/`Bun.gunzipSync`) to keep the file small despite holding full commit/branch/PR history. Deliberately stored **inside** `.git/` (not the repo root) so it can never accidentally be committed or tracked, and never needs a `.gitignore` entry.

## Who owns it

**`fg-cherry-cache.js` is the single script responsible for building and refreshing the cache.** It is the only place that calls `syncPatchIds`, `resolveDuplicateBranches`, and `syncPrCache`.

Every other tool (`fg-cherry.js`, `fg-find-commit-origin.js`) is a **pure read-only consumer**: they call `loadCache()`, query it, and error out with a hint to run `bun run src/fg-cherry-cache.js` if it's empty. This avoids the same sync/rebuild logic being duplicated (and drifting) across multiple CLI entry points.

The one exception is **self-healing**: if a lookup tool needs branch info for a commit that hasn't been resolved yet, it resolves it live and writes the result back into the cache (`saveCache`) so the next run - of any tool, including `fg-cherry-cache.js` - reuses it instead of re-shelling out to git.

## Top-level shape

```jsonc
{
  "patch": {
    "patchMap": { "<patchId>": [ /* commit entries, see below */ ] },
    "emptyCommits": [ "<fullHash>", "..." ]
  },
  "pr": {
    "lastUpdatedClosedPrNumber": 42,
    "prs": { "<prNumber>": { /* PR metadata, see below */ } },
    "commitToPr": { "<sha>": "<prNumber>" }
  },
  "branch": {
    "relations": { "<branchA>|<branchB>": { /* fork/ancestry info, see below */ } }
  }
}
```

### `patch` - local git patch-id index (no network)

Built entirely from `git log` + `git patch-id --stable`. Maps a **patch-id** (a hash of the diff content, stable across cherry-picks/rebases) to every commit that produced that exact diff, anywhere in `git log --all`.

Each commit entry:

```jsonc
{
  "hash": "7570f3f",              // short sha (7 chars)
  "fullHash": "7570f3f1a2b3...",  // full sha, the real key used everywhere internally
  "subject": "Fix off-by-one in paginator",
  "authorName": "Alice",
  "authorDate": "2025-11-20 14:02:11 +0000",
  "committerName": "Bob",
  "committerDate": "2025-11-29 09:11:03 +0000",
  "branches": ["main", "origin/release/2026-01"],
  "firstParentBranches": ["main"],  // subset of `branches` where this commit sits on that branch's first-parent path
  "branchesResolved": true          // whether `branches`/`firstParentBranches` are ACCURATE (see below) or just decoration
}
```

- **`authorDate`/`committerDate`/`authorName`/`committerName`** are captured for free during the single bulk `git log --all` pass (no extra `git show` per commit). The gap between author and committer date is exactly "when a cherry-pick/rebase was actually applied", and is used by `fg-cherry.js`'s branch-trace output.
- **`branches`** has two possible sources, distinguished by `branchesResolved`:
  - `branchesResolved: false` (or absent) - cheap **ref decoration** (`git log --format=%D`), which only lists refs that point *exactly* at this commit. Misses ancestor/cherry-picked commits further down a branch's history. This is what every commit gets by default during bulk indexing (cheap, one git call for the whole repo).
  - `branchesResolved: true` - accurate result of `git branch -a --contains <sha>`, authoritative but expensive per-commit. Only computed for commits that are part of a **duplicate patch-id group** (`patchMap[id].length > 1`), i.e. an actual cherry-pick/rebase, since that's the only case where "which branch" is actually interesting for this tool. Bounded cost: singleton commits (the vast majority in most repos) never pay this price.
- **`firstParentBranches`** is only ever populated alongside `branchesResolved: true`. For each branch in `branches`, records whether this commit sits on that branch's first-parent path (i.e. was committed/cherry-picked directly onto it) as opposed to only being pulled in via a merge commit from elsewhere.

`emptyCommits` is a flat list of full hashes that produced no `git patch-id` output (merge commits, empty-diff commits) - tracked so they're not needlessly reprocessed on every incremental sync.

### `pr` - Forgejo/Gitea PR index (network, via API)

- `prs[prNumber]`: full PR metadata - `title`, `sourceBranch`, `targetBranch`, `htmlUrl`, `state`, `merged`, `mergedAt`, `mergeCommitSha`, `updatedAt` (the PR's `updated_at` from Forgejo, used to detect when a PR needs re-indexing), and `commits: [{sha, author, message}]` for every commit inside that PR.
- `commitToPr[sha]`: reverse index from a commit sha straight to its PR number, for O(1) "is this commit in a known PR?" lookups.
- `lastUpdatedClosedPrNumber`: bookmark used for incremental sync (see below).

### `branch` - branch fork/ancestry relationships (local git, no network)

- `relations["<branchA>|<branchB>"]` (key is the two branch names alphabetically sorted and `|`-joined): `{ branchA, branchB, aIsAncestorOfB, bIsAncestorOfA, mergeBase, mergeBaseDate }`, resolved via `git merge-base --is-ancestor` and `git merge-base`.
- Answers "was branch X forked from / fully merged into branch Y?" - as opposed to the two branches merely sharing an old, unrelated common ancestor. This is what lets `fg-cherry.js` distinguish a commit that's simply **inherited history** (reachable from both branches because one was branched from the other) from a **genuine independent cherry-pick** (a different commit hash re-applying the same patch on an unrelated branch).
- Resolved lazily and cached indefinitely per branch pair the first time `fg-cherry.js <hash> <branch>` is asked about it - merge-base results never change for existing commits, so there's no incremental-refresh concern here, only cache growth (one small entry per distinct branch pair ever queried).
- `bases[branchName]`: `{ base, aheadCount, forkPoint, forkDate }` - the single nearest branch this branch was forked from, precomputed for **every** known branch (`git branch -a`) as part of the regular `fg-cherry-cache.js` sync (not resolved on demand like `relations`). `base` is picked as the ancestor branch with the fewest commits between it and this branch's tip (`git rev-list --count base..branch`), so for `main -> DEV -> PROD` chains, `PROD`'s base resolves to `DEV`, not `main`. `base` is `null` if no other known branch is an ancestor. Only branches missing from this map get (re-)resolved on a given run - a branch's fork point doesn't change once established, so this is naturally incremental; `--rebuild` clears it for a full fresh recomputation (e.g. after branches were added/deleted/renamed).

## How incremental sync works

Run via `bun run src/fg-cherry-cache.js` (see CLI flags: `--rebuild`, `--no-prs`).

1. **`syncPatchIds`** - diffs `git log --all` against the hashes already known in `patchMap`/`emptyCommits`. Only genuinely new commits get a `git patch-id` computed (in chunks of 100 via a single `git show | git patch-id` pipe, not one process per commit). Existing commits get their cheap decoration `branches` refreshed and author/committer fields backfilled if missing - but commits already marked `branchesResolved: true` are **never** touched by this cheap pass, since it would only make their accurate data worse.
2. **`resolveDuplicateBranches`** - looks at every patch-id group with more than one member and resolves accurate `branches`/`firstParentBranches` for any member not yet marked `branchesResolved`. This is where the "expensive" `git branch -a --contains` calls happen, but only for actual duplicates, and only once per commit ever (until a `--rebuild`).
3. **`resolveBranchBases`** - resolves each known branch's nearest fork parent (`branch.bases`, see above). Only branches not already in the map are resolved, so this is a one-time cost per branch.
4. **`syncPrCache`** - open PRs are always re-listed (cheap, one paginated call), but each PR's detail (the extra `/commits` API call) is only re-fetched when its `updated_at` differs from the cached `updatedAt` - unchanged open PRs are skipped entirely. Closed PRs are immutable once closed: the closed-PR list is paginated newest-first and fetching stops as soon as a PR number at or below `lastUpdatedClosedPrNumber` is seen, so a run never re-lists a repo's entire closed-PR history - only genuinely new closed PRs are fetched and indexed. Detail fetches that do need to happen run with up to 8 requests in flight at once (`mapWithConcurrency` in `forgejo-utils.js`) instead of one-at-a-time, since round-trip latency, not server load, is the bottleneck.

### Freshness trade-offs

Because resolved branch data is treated as "settled" once computed, two situations won't self-correct without a `--rebuild`:
- A branch is deleted/rebased away after a commit's `branches` was cached - the stale branch name will keep showing up until a rebuild.
- A brand-new branch is created from a point *after* an already-resolved duplicate commit, newly making that branch also contain it - won't appear until a rebuild.

Run `bun run src/fg-cherry-cache.js --rebuild` periodically or after major branch cleanups to reset and fully re-resolve.

## Consuming the cache

```js
import { loadCache, saveCache, computePatchId, lookupPrForSha, findOrigin, traceEntryPath } from "../src/commit-cache.js";

const cache = await loadCache();

// Direct PR lookup by exact sha
const pr = lookupPrForSha(cache, someSha);

// Full "where does this commit live" resolution (branches + PRs + cherry-picks)
const result = findOrigin(cache, someHashOrPrefix);
await saveCache(cache); // persist any lazily-resolved branch data findOrigin() filled in

// How/when did a specific commit enter a specific branch?
const commitEntry = cache.patch.patchMap[somePatchId].find(c => c.fullHash === someSha);
const trace = traceEntryPath(commitEntry, "release/2026-01");
```

Read-only tools should never call `syncPatchIds`, `resolveDuplicateBranches`, or `syncPrCache` directly - that's `fg-cherry-cache.js`'s job. They should only call `loadCache`, the lookup helpers above, and `saveCache` if they lazily resolved something worth persisting.