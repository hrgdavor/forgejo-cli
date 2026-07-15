// commit-cache.js
//
// Single consolidated cache for answering "where does this commit live?":
//   - patch:  local git patch-id -> [{hash, fullHash, subject, branches}]   (cherry-pick / same-diff detection)
//   - pr:     PR metadata + a commit-sha -> PR-number reverse index         (Forgejo/Gitea origin tracking)
//
// Both halves are stored together in one file under .git/info/ so it never
// risks being committed to the repo and never drifts out of sync with itself.
import { spawnSync } from "bun";
import { getRepoContext, getHeaders, fetchAllPages, fetchPagesUntil, mapWithConcurrency } from "./forgejo-utils.js";

export const CACHE_FILE = Bun.file(".git/info/forgejo-cache.json.gz");

// Formats a duration in seconds as a short human string, e.g. "45s" or "3m 12s".
function formatDuration(seconds) {
    if (!isFinite(seconds) || seconds < 0) return "?";
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// Returns a report(current, detail) function for loops that shell out to git
// a lot and would otherwise sit silent (and look hung) for as long as a full
// rebuild on a large repo/branch count takes. Fires whenever EITHER ~5% of
// items have passed OR `minIntervalMs` has elapsed since the last line,
// whichever comes first - so slow-but-steady work still prints regularly
// instead of going quiet for a whole 5% block. Each line includes elapsed
// time, throughput, and ETA so it's possible to tell "slow" from "stuck",
// plus an optional `detail` (e.g. the item just finished) to know exactly
// where it is.
function createProgressReporter(total, label, { minIntervalMs = 5000 } = {}) {
    const start = Date.now();
    let lastPrintTime = start;
    let lastPrintCount = 0;
    const countStep = Math.max(1, Math.ceil(total / 20));
    return (current, detail) => {
        if (total <= 0) return;
        const now = Date.now();
        const isLast = current === total;
        if (!isLast && now - lastPrintTime < minIntervalMs && current - lastPrintCount < countStep) return;

        const elapsedSec = (now - start) / 1000;
        const rate = current / Math.max(elapsedSec, 0.001);
        const etaSec = rate > 0 ? (total - current) / rate : Infinity;
        const detailStr = detail ? ` (${detail})` : "";
        console.log(
            `${label}: ${current}/${total}${detailStr} - ${formatDuration(elapsedSec)} elapsed, ${rate.toFixed(2)}/s, ETA ${formatDuration(etaSec)}`
        );
        lastPrintTime = now;
        lastPrintCount = current;
    };
}

// Returns a heartbeat(current, total) function for a SINGLE slow operation
// (e.g. one branch's O(n) candidate scan in computeSingleBranchBase) that
// would otherwise be invisible to createProgressReporter, which only prints
// between items, not during one. Silent unless the operation is still
// running past `afterMs`, so fast/typical cases stay quiet.
function createHeartbeat(label, afterMs = 5000) {
    const start = Date.now();
    let last = start;
    return (current, total) => {
        const now = Date.now();
        if (now - start < afterMs || now - last < afterMs) return;
        last = now;
        console.log(`   ⏱  still working - ${label}: ${current}/${total} (${formatDuration((now - start) / 1000)} elapsed)`);
    };
}

// Returns an async checkpoint() function that persists the (in-progress,
// partially-resolved) cache to disk at most once per `intervalMs`. Long
// syncs (syncPatchIds/resolveDuplicateBranches/resolveBranchBases) call this
// after every item so that killing/restarting the process - expected on
// multi-hour first-time builds - resumes from the last checkpoint instead of
// redoing everything, since all three are already incremental (they skip
// whatever's already recorded in the cache).
function createCheckpointer(cache, intervalMs = 30_000) {
    let last = Date.now();
    return async () => {
        if (Date.now() - last < intervalMs) return;
        await saveCache(cache);
        last = Date.now();
        console.log("💾 Checkpoint saved.");
    };
}

function emptyCache() {
    return {
        patch: { patchMap: {}, emptyCommits: [] },
        pr: { lastUpdatedClosedPrNumber: 0, prs: {}, commitToPr: {} },
        branch: { relations: {}, bases: {} }
    };
}

export async function loadCache() {
    if (await CACHE_FILE.exists()) {
        try {
            const compressed = new Uint8Array(await CACHE_FILE.arrayBuffer());
            const raw = JSON.parse(Buffer.from(Bun.gunzipSync(compressed)).toString("utf8"));
            return {
                patch: {
                    patchMap: raw.patch?.patchMap || {},
                    emptyCommits: raw.patch?.emptyCommits || []
                },
                pr: {
                    lastUpdatedClosedPrNumber: raw.pr?.lastUpdatedClosedPrNumber || 0,
                    prs: raw.pr?.prs || {},
                    commitToPr: raw.pr?.commitToPr || {}
                },
                branch: {
                    relations: raw.branch?.relations || {},
                    bases: raw.branch?.bases || {}
                }
            };
        } catch (e) {
            console.log("⚠️ Cache file was corrupted or empty. Starting a fresh build.");
        }
    }
    return emptyCache();
}

export async function saveCache(cache) {
    const compressed = Bun.gzipSync(JSON.stringify(cache));
    await Bun.write(CACHE_FILE, compressed);
}

// ────────────────────────────────────────────────────────────────────────────
// Local patch-id / branch tracking (pure git, no network)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Rebuilds branch pointers and generates patch-ids for any commit reachable
 * from any local ref that hasn't been indexed yet. Author/committer identity
 * and timestamps are captured for every commit in the same `git log` pass -
 * they're free here, and having them cached means later "how/when did this
 * enter" lookups never need a per-commit `git show` call.
 * @returns {{newCommitsCount:number, branchUpdatesCount:number, totalHashes:number}}
 */
export async function syncPatchIds(cache) {
    const knownHashes = new Set();
    for (const patchId in cache.patch.patchMap) {
        cache.patch.patchMap[patchId].forEach(commit => knownHashes.add(commit.fullHash));
    }
    cache.patch.emptyCommits.forEach(hash => knownHashes.add(hash));

    const logProcess = spawnSync(["git", "log", "--all", "--format=%H|%D|%an|%ai|%cn|%ci|%s"]);
    if (logProcess.exitCode !== 0) {
        throw new Error(`git log failed: ${logProcess.stderr.toString()}`);
    }
    const lines = logProcess.stdout.toString().trim().split("\n").filter(Boolean);

    const commitMeta = {};
    lines.forEach(line => {
        const [hash, refs, authorName, authorDate, committerName, committerDate, ...rest] = line.split("|");
        commitMeta[hash] = {
            branches: refs
                ? refs.split(",").map(ref => ref.replace("HEAD ->", "").trim()).filter(ref => ref && !ref.startsWith("tag:"))
                : [],
            authorName, authorDate, committerName, committerDate,
            subject: rest.join("|")
        };
    });

    // Fast-update branch pointers + backfill dates for commits we already know
    // about. Commits with accurate `branchesResolved` data (from
    // resolveDuplicateBranches()) are left untouched - this cheap decoration
    // snapshot is less accurate and would only regress them.
    let branchUpdatesCount = 0;
    for (const patchId in cache.patch.patchMap) {
        cache.patch.patchMap[patchId].forEach(commit => {
            const meta = commitMeta[commit.fullHash];
            if (!meta) return;

            if (!commit.branchesResolved) {
                if (JSON.stringify(commit.branches) !== JSON.stringify(meta.branches)) {
                    commit.branches = meta.branches;
                    branchUpdatesCount++;
                }
            }
            if (!commit.authorDate) {
                commit.authorName = meta.authorName;
                commit.authorDate = meta.authorDate;
                commit.committerName = meta.committerName;
                commit.committerDate = meta.committerDate;
            }
        });
    }

    // Bulk generate patch-ids only for newly-seen commits, in safe chunks
    const unindexedHashes = lines
        .map(line => line.split("|")[0])
        .filter(hash => hash && !knownHashes.has(hash));

    let newCommitsCount = 0;
    const chunkSize = 100;
    const checkpoint = createCheckpointer(cache);
    const reportChunkProgress = createProgressReporter(unindexedHashes.length, "📇 Generating patch-ids");

    for (let i = 0; i < unindexedHashes.length; i += chunkSize) {
        const chunk = unindexedHashes.slice(i, i + chunkSize);

        const bulkPatchProcess = spawnSync(
            ["sh", "-c", `git show ${chunk.join(" ")} | git patch-id --stable`],
            { maxBuffer: 1024 * 1024 * 50 }
        );

        reportChunkProgress(Math.min(i + chunkSize, unindexedHashes.length));

        if (bulkPatchProcess.exitCode !== 0) {
            console.error(`❌ Bulk patch-id generation failed for chunk starting at index ${i}.`);
            continue;
        }

        const patchLines = bulkPatchProcess.stdout.toString().trim().split("\n");
        const processedInThisChunk = new Set();

        patchLines.forEach(pLine => {
            if (!pLine) return;
            const [patchId, fullHash] = pLine.trim().split(/\s+/);
            if (!patchId || !fullHash) return;

            processedInThisChunk.add(fullHash);
            const meta = commitMeta[fullHash] || {};

            if (!cache.patch.patchMap[patchId]) cache.patch.patchMap[patchId] = [];
            cache.patch.patchMap[patchId].push({
                hash: fullHash.substring(0, 7),
                fullHash,
                subject: meta.subject || "",
                authorName: meta.authorName,
                authorDate: meta.authorDate,
                committerName: meta.committerName,
                committerDate: meta.committerDate,
                branches: meta.branches || [],
                branchesResolved: false
            });
            newCommitsCount++;
        });

        // Hashes with no patch-id output are merges/empty-diff commits
        chunk.forEach(hash => {
            if (!processedInThisChunk.has(hash)) {
                cache.patch.emptyCommits.push(hash);
            }
        });

        await checkpoint();
    }

    return { newCommitsCount, branchUpdatesCount, totalHashes: lines.length };
}

/** Computes the (stable) patch-id for a single commit not yet indexed. */
export function computePatchId(hashOrRef) {
    const proc = spawnSync(["sh", "-c", `git show ${hashOrRef} | git patch-id --stable`]);
    if (proc.exitCode !== 0) return null;
    const out = proc.stdout.toString().trim();
    if (!out) return null;
    return out.split(/\s+/)[0];
}

/**
 * Accurately resolves every branch (local + remote-tracking) that contains a
 * given commit, via `git branch -a --contains`. This is authoritative, unlike
 * the `%D` ref-decoration used by syncPatchIds() during bulk indexing, which
 * only sees refs that point EXACTLY at a commit and misses every ancestor
 * commit further down a branch's history (the common case for older/cherry-
 * picked commits). Only use this for a handful of commits at lookup time -
 * it's too slow to run for every commit during a full repo sync.
 */
export function resolveContainingBranches(fullHash) {
    const proc = spawnSync(["git", "branch", "-a", "--contains", fullHash]);
    if (proc.exitCode !== 0) return [];
    return proc.stdout.toString().split("\n")
        .map(b => b.trim().replace(/^\*\s*/, ""))
        .filter(Boolean)
        .filter(b => !b.includes(" -> ")) // drop "origin/HEAD -> origin/main" pointer lines
        .map(b => b.replace(/^remotes\//, ""));
}

/**
 * For every patch-id group with more than one member (i.e. an actual
 * cherry-pick/rebase duplicate - the only case where "which branch" is
 * interesting), resolves ACCURATE branch containment via `git branch -a
 * --contains` plus first-parent-path membership, and caches both on the
 * commit entry. Bounded to duplicate groups only, so it stays cheap even on
 * large repos, and it's incremental: commits already marked
 * `branchesResolved` are skipped. Use `cherry-cache.js --rebuild` to force a
 * full re-resolve (e.g. after deleting/renaming branches).
 * @returns {{resolvedCount:number, duplicateGroupCount:number}}
 */
export async function resolveDuplicateBranches(cache) {
    const duplicateGroups = Object.values(cache.patch.patchMap).filter(group => group.length > 1);

    // Cache the first-parent commit set per branch within this run so multiple
    // commits on the same branch don't each re-run `git log --first-parent`.
    const firstParentSets = new Map();
    function firstParentSet(branchRef) {
        if (firstParentSets.has(branchRef)) return firstParentSets.get(branchRef);
        const proc = spawnSync(["git", "log", "--first-parent", "--format=%H", branchRef]);
        const set = proc.exitCode === 0
            ? new Set(proc.stdout.toString().split("\n").filter(Boolean))
            : new Set();
        firstParentSets.set(branchRef, set);
        return set;
    }

    const unresolvedCommits = duplicateGroups.flatMap(group => group.filter(commit => !commit.branchesResolved));

    let resolvedCount = 0;
    const checkpoint = createCheckpointer(cache);
    const reportCommitProgress = createProgressReporter(unresolvedCommits.length, "🔁 Resolving cherry-pick branches");
    for (const commit of unresolvedCommits) {
        const branches = resolveContainingBranches(commit.fullHash);
        commit.branches = branches;
        commit.firstParentBranches = branches.filter(b => firstParentSet(b).has(commit.fullHash));
        commit.branchesResolved = true;
        resolvedCount++;
        reportCommitProgress(resolvedCount, commit.hash);
        await checkpoint();
    }

    return { resolvedCount, duplicateGroupCount: duplicateGroups.length };
}

/**
 * Traces HOW and WHEN a specific commit entered a specific branch's history:
 *  - authored vs committed timestamps. A cherry-pick preserves the original
 *    author date but sets the committer date to whenever it was actually
 *    applied, so the gap between the two is exactly "when it entered".
 *  - whether the commit sits on the branch's first-parent path (it was
 *    committed/cherry-picked directly onto that branch) or was only pulled in
 *    via a merge commit (some other branch already had it - e.g. that branch
 *    was forked off a base which already contained the cherry-pick, and only
 *    later got merged into the branch being inspected).
 *
 * Prefers data already cached by syncPatchIds()/resolveDuplicateBranches() -
 * author/committer identity+dates and first-parent membership - falling back
 * to live git calls only for whatever isn't cached yet (e.g. singleton
 * patch-id groups, which resolveDuplicateBranches() intentionally skips).
 * The merge-commit lookup (only needed when NOT on the first-parent path) is
 * always done live since it's specific to this one (commit, branch) pair and
 * too rare/narrow to be worth precomputing for every group member.
 */
export function traceEntryPath(commitEntry, branchRef) {
    const fullHash = commitEntry.fullHash;

    let { authorName, authorDate, committerName, committerDate } = commitEntry;
    if (!authorDate) {
        const showProc = spawnSync(["git", "show", "-s", "--format=%an|%ai|%cn|%ci", fullHash]);
        if (showProc.exitCode !== 0) return null;
        [authorName, authorDate, committerName, committerDate] = showProc.stdout.toString().trim().split("|");
    }

    let isAncestor = true;
    let onFirstParentPath;
    if (commitEntry.branchesResolved) {
        onFirstParentPath = (commitEntry.firstParentBranches || []).includes(branchRef);
    } else {
        const ancestorProc = spawnSync(["git", "merge-base", "--is-ancestor", fullHash, branchRef]);
        isAncestor = ancestorProc.exitCode === 0;
        if (isAncestor) {
            const fpProc = spawnSync(["git", "log", "--first-parent", "--format=%H", branchRef]);
            onFirstParentPath = fpProc.exitCode === 0 && fpProc.stdout.toString().split("\n").includes(fullHash);
        }
    }

    let mergeCommit = null;
    if (isAncestor && !onFirstParentPath) {
        const mergeProc = spawnSync([
            "git", "log", `${fullHash}..${branchRef}`, "--merges", "--ancestry-path",
            "--format=%H|%ai|%s", "--reverse"
        ]);
        if (mergeProc.exitCode === 0) {
            const line = mergeProc.stdout.toString().trim().split("\n").filter(Boolean)[0];
            if (line) {
                const [mHash, mDate, mSubject] = line.split("|");
                mergeCommit = { hash: mHash, date: mDate, subject: mSubject };
            }
        }
    }

    return {
        hash: fullHash, authorName, authorDate, committerName, committerDate,
        isAncestor, onFirstParentPath, mergeCommit
    };
}

/** Looks up cached PR metadata for an exact commit sha, if any is known. */
export function lookupPrForSha(cache, sha) {
    const prNumber = cache.pr.commitToPr[sha];
    if (!prNumber) return null;
    const pr = cache.pr.prs[prNumber];
    const commitMeta = pr.commits.find(c => c.sha === sha) || {};
    return { ...pr, matchedSha: sha, ...commitMeta };
}

/**
 * Resolves (and caches) whether two branches share direct ancestry - i.e.
 * one was forked from / fully merged into the other - as opposed to having
 * only diverged from some much older common ancestor. This is what lets
 * tooling tell "this branch was forked from that one, so the shared commit
 * is inherited history" apart from "this is a genuine independent
 * cherry-pick that happens to have the same patch-id".
 *
 * Cached indefinitely per (branchA, branchB) pair since git never rewrites
 * merge-base history for existing commits - only re-resolved if the pair
 * hasn't been asked about before.
 * @returns {{branchA:string, branchB:string, aIsAncestorOfB:boolean, bIsAncestorOfA:boolean, mergeBase:string|null, mergeBaseDate:string|null}}
 */
export function getBranchRelation(cache, branchA, branchB) {
    if (!cache.branch) cache.branch = { relations: {} };

    const [a, b] = [branchA, branchB].sort();
    const key = `${a}|${b}`;
    if (a === b) {
        return { branchA: a, branchB: b, aIsAncestorOfB: true, bIsAncestorOfA: true, mergeBase: null, mergeBaseDate: null };
    }
    if (cache.branch.relations[key]) return cache.branch.relations[key];

    const aIsAncestorOfB = spawnSync(["git", "merge-base", "--is-ancestor", a, b]).exitCode === 0;
    const bIsAncestorOfA = spawnSync(["git", "merge-base", "--is-ancestor", b, a]).exitCode === 0;

    let mergeBase = null;
    let mergeBaseDate = null;
    const mergeBaseProc = spawnSync(["git", "merge-base", a, b]);
    if (mergeBaseProc.exitCode === 0) {
        mergeBase = mergeBaseProc.stdout.toString().trim();
        const dateProc = spawnSync(["git", "log", "-1", "--format=%ci", mergeBase]);
        if (dateProc.exitCode === 0) mergeBaseDate = dateProc.stdout.toString().trim();
    }

    const relation = { branchA: a, branchB: b, aIsAncestorOfB, bIsAncestorOfA, mergeBase, mergeBaseDate };
    cache.branch.relations[key] = relation;
    return relation;
}

/**
 * Lists all known branches via `git branch -a`, filtering out the synthetic
 * HEAD ref. Shared by resolveBranchBases/resolveBranchBase.
 */
function listAllBranches() {
    const branchProc = spawnSync(["git", "branch", "-a", "--format=%(refname:short)"]);
    if (branchProc.exitCode !== 0) {
        throw new Error(`git branch failed: ${branchProc.stderr.toString()}`);
    }
    return branchProc.stdout.toString().trim().split("\n")
        .filter(Boolean)
        .filter(b => !b.includes("HEAD"));
}

// Treats "origin/X" and "X" as the same branch (single-remote assumption
// used throughout this codebase, e.g. cherry.js's branchMatches) - needed
// because git ref names carry the "origin/" prefix but Forgejo/Gitea PR
// sourceBranch/targetBranch fields never do.
function branchNamesEquivalent(a, b) {
    return a === b || a === `origin/${b}` || b === `origin/${a}`;
}

/**
 * Looks up a branch's base via Forgejo/Gitea PR metadata (cache.pr.prs) -
 * the AUTHORITATIVE source when available, since a PR's sourceBranch and
 * targetBranch directly record what the branch was opened against, with
 * none of the ambiguity git-history-only inference has (multiple candidate
 * ancestor branches, same-commit local/remote-tracking aliases, etc).
 *
 * Prefers a merged PR (the strongest possible signal - an actual merge into
 * that target happened); falls back to the most recently updated PR from
 * this branch if none are merged yet. Returns null if no PR at all was ever
 * opened from this branch, so the caller can fall back to the git-based
 * heuristic (computeSingleBranchBase).
 */
function resolveBranchBaseFromPr(cache, branch) {
    const prs = Object.values(cache.pr?.prs || {}).filter(pr => branchNamesEquivalent(pr.sourceBranch, branch));
    if (prs.length === 0) return null;

    const merged = prs.filter(pr => pr.merged).sort((a, b) => (b.mergedAt || "").localeCompare(a.mergedAt || ""));
    const best = merged[0] || prs.slice().sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))[0];

    return {
        base: best.targetBranch,
        aheadCount: null,
        forkPoint: best.mergeCommitSha || null,
        forkDate: best.mergedAt || best.updatedAt || null,
        source: "pr",
        prNumber: best.prNumber
    };
}

/**
 * Computes the nearest-ancestor base for a single branch against a known
 * list of candidate branches - O(n) git calls, not O(n²). Pure, no cache
 * mutation. FALLBACK ONLY - used when resolveBranchBaseFromPr found no PR
 * to answer the question authoritatively; git history alone can't always
 * disambiguate (e.g. multiple candidate ancestor branches at the same
 * distance), so PR metadata is always preferred when it exists.
 */
function computeSingleBranchBase(branch, branches) {
    let bestBase = null;
    let bestAheadCount = Infinity;
    const heartbeat = createHeartbeat(`checking candidates for ${branch}`);

    let checked = 0;
    for (const candidate of branches) {
        checked++;
        heartbeat(checked, branches.length);
        if (candidate === branch) continue;
        const isAncestor = spawnSync(["git", "merge-base", "--is-ancestor", candidate, branch]).exitCode === 0;
        if (!isAncestor) continue;

        const countProc = spawnSync(["git", "rev-list", "--count", `${candidate}..${branch}`]);
        const aheadCount = countProc.exitCode === 0 ? parseInt(countProc.stdout.toString().trim(), 10) : Infinity;
        // aheadCount === 0 means candidate points at the exact same commit as
        // branch (e.g. a local branch and its own origin/* remote-tracking
        // ref) - that's an alias, not a fork parent, so it must never win a
        // "nearest base" comparison (it would otherwise always beat a real
        // ancestor like DEV, since 0 < any positive distance).
        if (aheadCount > 0 && aheadCount < bestAheadCount) {
            bestAheadCount = aheadCount;
            bestBase = candidate;
        }
    }

    let forkPoint = null;
    let forkDate = null;
    if (bestBase) {
        const mbProc = spawnSync(["git", "merge-base", bestBase, branch]);
        if (mbProc.exitCode === 0) {
            forkPoint = mbProc.stdout.toString().trim();
            const dateProc = spawnSync(["git", "log", "-1", "--format=%ci", forkPoint]);
            if (dateProc.exitCode === 0) forkDate = dateProc.stdout.toString().trim();
        }
    }

    return {
        base: bestBase,
        aheadCount: bestBase ? bestAheadCount : null,
        forkPoint,
        forkDate,
        source: "git"
    };
}

/**
 * Precomputes, for every known branch, which other branch it was most likely
 * forked from - its "base" - so lookups (cherry.js et al.) never need a live
 * git call just to answer "what's this branch's base?". Part of the regular
 * cherry-cache.js sync, not just resolved on demand.
 *
 * Forgejo/Gitea PR metadata (cache.pr.prs) is the PRIMARY source: if a PR
 * was ever opened from this branch, its sourceBranch/targetBranch is used
 * directly (see resolveBranchBaseFromPr) - no ambiguity, no git history
 * needed. Only when no PR exists for a branch does this fall back to the
 * git merge-base heuristic (computeSingleBranchBase): every other branch
 * that's a strict ancestor of it is a candidate base, and the candidate with
 * the fewest commits between it and the branch's tip is the nearest one -
 * i.e. the actual fork point, not some more distant grand-ancestor (e.g. for
 * main -> DEV -> PROD, DEV is picked over main as PROD's base).
 *
 * Only branches not yet in `cache.branch.bases` are (re-)resolved, since a
 * branch's fork point relative to its base doesn't change once established -
 * only truly new branches need this work on a given run.
 *
 * NOTE: the git fallback is O(n²) git calls across all branches - fine for
 * a background batch sync (cherry-cache.js) but too slow to call just to
 * answer one branch's question. For that, use resolveBranchBase() instead.
 * @returns {{resolvedCount:number, totalBranches:number}}
 */
export async function resolveBranchBases(cache) {
    if (!cache.branch) cache.branch = { relations: {}, bases: {} };
    if (!cache.branch.bases) cache.branch.bases = {};

    const branches = listAllBranches();
    const unresolvedBranches = branches.filter(branch => !cache.branch.bases[branch]);

    let resolvedCount = 0;
    const checkpoint = createCheckpointer(cache);
    const reportBranchProgress = createProgressReporter(unresolvedBranches.length, "🌳 Resolving branch bases");
    for (const branch of unresolvedBranches) {
        cache.branch.bases[branch] = resolveBranchBaseFromPr(cache, branch) || computeSingleBranchBase(branch, branches);
        resolvedCount++;
        reportBranchProgress(resolvedCount, branch);
        await checkpoint();
    }

    return { resolvedCount, totalBranches: branches.length };
}

/**
 * Resolves the base for a single branch only - O(n) git calls against the
 * known branch list, not O(n²) across every branch (and no git calls at all
 * if a PR already answers it). Use this (not resolveBranchBases) for
 * on-demand/single-branch lookups such as fg-branch-parents.js, where
 * resolving the ENTIRE repo's branches just to answer one branch's question
 * would be needlessly slow.
 * @returns {{info: {base:string|null, aheadCount:number|null, forkPoint:string|null, forkDate:string|null, source:string}|null, totalBranches:number, found:boolean}}
 */
export function resolveBranchBase(cache, branch) {
    if (!cache.branch) cache.branch = { relations: {}, bases: {} };
    if (!cache.branch.bases) cache.branch.bases = {};

    const branches = listAllBranches();
    if (!branches.includes(branch)) {
        return { info: null, totalBranches: branches.length, found: false };
    }

    if (!cache.branch.bases[branch]) {
        cache.branch.bases[branch] = resolveBranchBaseFromPr(cache, branch) || computeSingleBranchBase(branch, branches);
    }

    return { info: cache.branch.bases[branch], totalBranches: branches.length, found: true };
}

// ────────────────────────────────────────────────────────────────────────────
// Remote PR / commit-origin tracking (Forgejo/Gitea API)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Syncs PR metadata. Open PRs are always re-listed (they mutate: new commits
 * pushed, retargeted base, etc), but each PR's detail is only re-fetched
 * (the extra /commits API call) when its `updated_at` differs from what's
 * cached - unchanged PRs are skipped. Closed/merged PRs are immutable once
 * closed, so they're fetched incrementally past lastUpdatedClosedPrNumber.
 */
export async function syncPrCache(cache, forceRebuild = false) {
    const { baseUrl, owner, repo } = getRepoContext();

    if (forceRebuild) {
        cache.pr = { lastUpdatedClosedPrNumber: 0, prs: {}, commitToPr: {} };
    }

    console.log("⏳ Syncing PR & commit metadata from Forgejo server...");

    const openPrs = await fetchAllPages(`${baseUrl}/repos/${owner}/${repo}/pulls?state=open`);

    // Closed/merged PRs are immutable, and the list endpoint returns them
    // newest-first by default, so once we reach a PR number we've already
    // indexed we can stop paginating entirely instead of re-listing the
    // repo's full closed-PR history on every run.
    const closedPrs = forceRebuild || cache.pr.lastUpdatedClosedPrNumber === 0
        ? await fetchAllPages(`${baseUrl}/repos/${owner}/${repo}/pulls?state=closed`)
        : await fetchPagesUntil(
            `${baseUrl}/repos/${owner}/${repo}/pulls?state=closed`,
            pr => pr.number <= cache.pr.lastUpdatedClosedPrNumber
        );
    closedPrs.sort((a, b) => a.number - b.number);
    const newClosedPrs = forceRebuild
        ? closedPrs
        : closedPrs.filter(pr => pr.number > cache.pr.lastUpdatedClosedPrNumber);

    // Returns true if the PR was (re-)indexed, false if it was skipped because
    // nothing changed since the last sync.
    async function indexPr(pr, { skipIfUnchanged = false } = {}) {
        const existing = cache.pr.prs[pr.number];
        if (skipIfUnchanged && existing && existing.updatedAt === pr.updated_at) {
            return false;
        }

        const meta = {
            prNumber: pr.number,
            title: pr.title,
            sourceBranch: pr.head.ref,
            targetBranch: pr.base.ref,
            htmlUrl: pr.html_url,
            state: pr.state,
            merged: pr.merged || pr.has_merged || false,
            mergedAt: pr.merged_at || null,
            mergeCommitSha: pr.merge_commit_sha || null,
            updatedAt: pr.updated_at,
            commits: []
        };

        if (pr.merge_commit_sha) {
            cache.pr.commitToPr[pr.merge_commit_sha] = pr.number;
        }

        const commitsRes = await fetch(`${baseUrl}/repos/${owner}/${repo}/pulls/${pr.number}/commits`, { headers: getHeaders() });
        if (commitsRes.ok) {
            const innerCommits = await commitsRes.json();
            innerCommits.forEach(c => {
                meta.commits.push({
                    sha: c.sha,
                    author: c.commit.author.name,
                    message: c.commit.message.split("\n")[0]
                });
                cache.pr.commitToPr[c.sha] = pr.number;
            });
        }

        cache.pr.prs[pr.number] = meta;
        return true;
    }

    let openIndexedCount = 0;
    await mapWithConcurrency(openPrs, 8, async pr => {
        const changed = await indexPr(pr, { skipIfUnchanged: !forceRebuild });
        if (changed) {
            console.log(`⚙️  Indexing open PR #${pr.number}...`);
            openIndexedCount++;
        }
    });
    await mapWithConcurrency(newClosedPrs, 8, async pr => {
        console.log(`⚙️  Indexing closed PR #${pr.number}...`);
        await indexPr(pr);
        cache.pr.lastUpdatedClosedPrNumber = Math.max(cache.pr.lastUpdatedClosedPrNumber, pr.number);
    });

    console.log(
        `💾 Indexed ${openIndexedCount}/${openPrs.length} open PR(s) (${openPrs.length - openIndexedCount} unchanged, skipped) + ${newClosedPrs.length} newly-closed PR(s).`
    );
    return cache;
}

// ────────────────────────────────────────────────────────────────────────────
// Unified cache build/refresh - the single entry point cherry-cache.js calls
// ────────────────────────────────────────────────────────────────────────────

/**
 * The one function that fully updates the cache: local patch-ids + branch
 * decoration, accurate branch/first-parent resolution for cherry-pick
 * duplicate groups, and (optionally) Forgejo PR metadata. cherry-cache.js is
 * the only script that should call this - every other tool just reads what
 * it produces.
 */
export async function updateCache(cache, { withPrs = true, forceRebuildPrs = false } = {}) {
    const patchStats = await syncPatchIds(cache);
    const branchStats = await resolveDuplicateBranches(cache);
    if (withPrs) {
        await syncPrCache(cache, forceRebuildPrs);
    }
    return { patchStats, branchStats };
}

// ────────────────────────────────────────────────────────────────────────────
// Unified lookup: branch(es) AND PR(s) for a commit, including patch-id siblings
// ────────────────────────────────────────────────────────────────────────────

/**
 * Resolves everything known about a commit hash (full or short prefix):
 *  - directPr: PR whose own commit list literally contains this sha (if any)
 *  - localBranches: local branch(es) pointing at commits sharing the same patch-id
 *  - cherryPicks: every other commit (local or from any PR) sharing the same patch-id,
 *    each annotated with its branch(es) and originating PR (if known)
 */
export function findOrigin(cache, targetHash) {
    const result = { targetHash, patchId: null, directPr: null, localBranches: [], cherryPicks: [] };

    const directSha = Object.keys(cache.pr.commitToPr).find(
        sha => sha.startsWith(targetHash) || targetHash.startsWith(sha)
    );
    if (directSha) {
        result.directPr = lookupPrForSha(cache, directSha);
    }

    const patchId = computePatchId(targetHash);
    result.patchId = patchId;
    if (!patchId) return result;

    const siblings = cache.patch.patchMap[patchId] || [];
    for (const sib of siblings) {
        const isTarget = sib.fullHash.startsWith(targetHash) || targetHash.startsWith(sib.fullHash);

        // Prefer the accurate branches cached by resolveDuplicateBranches(); if
        // this sibling hasn't been resolved yet (e.g. it just became part of a
        // duplicate group), resolve it now and persist it back onto the cache
        // object so the caller can saveCache() and skip this work next time.
        if (!sib.branchesResolved) {
            sib.branches = resolveContainingBranches(sib.fullHash);
            sib.branchesResolved = true;
        }
        const branches = sib.branches;
        const pr = lookupPrForSha(cache, sib.fullHash);

        if (isTarget) {
            if (branches.length) result.localBranches.push(...branches);
            continue;
        }

        result.cherryPicks.push({
            sha: sib.fullHash,
            hash: sib.hash,
            subject: sib.subject,
            branches,
            pr
        });
    }

    return result;
}
