#!/usr/bin/env bun
// cherry-cache.js — THE single script that builds/refreshes the whole commit
// cache: local patch-id + branch decoration, accurate branch/first-parent
// membership for cherry-pick duplicate groups, and Forgejo PR metadata.
//
// Every other tool (cherry.js, fg-find-commit-origin.js) is a pure, read-only
// consumer of what this produces — they never sync. Run this whenever you
// want fresher results, or on a schedule/pre-push hook.
//
// Flags:
//   --rebuild, -r   Wipe patch + PR cache sections and rebuild from scratch
//                    (useful after deleting/renaming branches, since accurate
//                    branch membership is otherwise only re-resolved for
//                    commits not yet marked `branchesResolved`).
//   --no-prs        Skip the Forgejo API sync (offline / no token available).
import { loadCache, saveCache, syncPatchIds, resolveDuplicateBranches, resolveBranchBases, syncPrCache } from "./commit-cache.js";

const args = Bun.argv.slice(2);
const forceRebuild = args.includes("--rebuild") || args.includes("-r");
const skipPrs = args.includes("--no-prs");

console.log(forceRebuild ? "⏳ Rebuilding cache from scratch..." : "⏳ Updating cache incrementally...");

const cache = await loadCache();
if (forceRebuild) {
    cache.patch = { patchMap: {}, emptyCommits: [] };
    cache.pr = { lastUpdatedClosedPrNumber: 0, prs: {}, commitToPr: {} };
    cache.branch.bases = {};
}

const knownBefore =
    Object.values(cache.patch.patchMap).reduce((n, arr) => n + arr.length, 0) + cache.patch.emptyCommits.length;
console.log(`📦 Loaded existing cache containing ${knownBefore} handled commits.`);

console.log("🔍 Scanning commits and generating patch-ids...");
const { newCommitsCount, branchUpdatesCount, totalHashes } = await syncPatchIds(cache);

console.log("🔁 Resolving cherry-pick branch containment...");
const { resolvedCount, duplicateGroupCount } = await resolveDuplicateBranches(cache);

// PR metadata must be synced BEFORE resolveBranchBases, since it's the
// primary source resolveBranchBaseFromPr() checks first — resolving bases
// beforehand means every branch falls through to the (much slower) O(n²)
// git fallback for no reason, even on repos with plenty of PR history.
let prSyncFailed = false;
if (!skipPrs) {
    try {
        await syncPrCache(cache, forceRebuild);
    } catch (e) {
        prSyncFailed = true;
        console.log(`⚠️  PR sync failed, continuing with local-only cache: ${e.message}`);
    }
}

console.log("🌳 Resolving branch bases...");
const { resolvedCount: newBaseBranches, totalBranches } = await resolveBranchBases(cache);

await saveCache(cache);

console.log("\n✅ Cache update complete!");
console.log(`✨ New commits indexed:         ${newCommitsCount}`);
console.log(`🚫 Merge/Empty skipped:         ${Math.max(totalHashes - knownBefore - newCommitsCount, 0)}`);
console.log(`🔄 Branch decoration updates:   ${branchUpdatesCount}`);
console.log(`♻️  Cherry-pick groups tracked:  ${duplicateGroupCount} (${resolvedCount} commit(s) newly resolved)`);
console.log(`🌳 Branch bases resolved:       ${newBaseBranches} new (${totalBranches} branch(es) total)`);
if (skipPrs) console.log(`⏭️  Skipped PR sync (--no-prs)`);
if (prSyncFailed) console.log(`⏭️  PR sync did not complete — local cache saved anyway, will retry next run.`);