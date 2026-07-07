#!/usr/bin/env bun
// cherry.js — local-only lookup: which branch(es) contain this commit or a
// cherry-picked copy of it (same patch-id, different sha)? No network calls
// are made, but any PR metadata already present in the cache (from a prior
// `cherry-cache.js` run) is shown too.
//
// Pure READ-ONLY consumer of the cache (see cherry-cache.js for how it's
// built) — branch membership for cherry-pick duplicates is normally already
// cached and accurate; this tool only falls back to live git calls for
// commits that haven't been resolved yet, and persists the result so the
// next run (and cherry-cache.js) don't have to redo the work.
import { loadCache, saveCache, computePatchId, resolveContainingBranches, lookupPrForSha, traceEntryPath, getBranchRelation } from "./commit-cache.js";

const targetHash = Bun.argv[2];
// One branch: keeps the full deep-dive (trace, siblings, other locations).
// Multiple branches: concise side-by-side summary — what hash (if any) is in
// each, original vs cherry-pick, and its known base — for comparing several
// branches at once (e.g. a chain of forks) without repeating the deep-dive.
const rawExtraArgs = Bun.argv.slice(3);
const verbose = rawExtraArgs.includes("--verbose") || rawExtraArgs.includes("-v");
const targetBranches = rawExtraArgs.filter(a => a !== "--verbose" && a !== "-v").filter(Boolean);
const targetBranch = targetBranches.length === 1 ? targetBranches[0] : null;

if (!targetHash) {
    console.error("❌ Error: Please provide a git commit hash.");
    console.log("Usage: bun cherry.js <commit-hash> [branch...] [--verbose|-v]");
    process.exit(1);
}

const cache = await loadCache();
if (Object.keys(cache.patch.patchMap).length === 0) {
    console.error("❌ Error: Cache is empty. Please run 'bun cherry-cache.js' first.");
    process.exit(1);
}
const hasPrCache = Object.keys(cache.pr.prs).length > 0;
let mutated = false;

// Prefer the accurate branches already cached (resolveDuplicateBranches());
// only fall back to a live git call when a commit hasn't been resolved yet,
// and persist the result so it's cached for next time.
function getBranches(commitEntry) {
    if (!commitEntry.branchesResolved) {
        commitEntry.branches = resolveContainingBranches(commitEntry.fullHash);
        commitEntry.branchesResolved = true;
        mutated = true;
    }
    return commitEntry.branches;
}

console.log(`🔎 Looking up patch-ID for target: ${targetHash}...`);
const targetPatchId = computePatchId(targetHash);
if (!targetPatchId) {
    console.error(`❌ Error: Could not find target commit ${targetHash} in Git.`);
    process.exit(1);
}

const matches = cache.patch.patchMap[targetPatchId] || [];

console.log(`🎯 Target Patch ID: ${targetPatchId.substring(0, 10)}...`);
console.log("=".repeat(50));

// Separate the target commit from the cherry-picks
const originalCommits = matches.filter(
    item => item.fullHash.startsWith(targetHash) || targetHash.startsWith(item.fullHash)
);

const cherryPicks = matches.filter(
    item => !item.fullHash.startsWith(targetHash) && !targetHash.startsWith(item.fullHash)
);

function printPr(pr) {
    const stateIcon = pr.merged ? "🎉 Merged" : (pr.state === "open" ? "🟢 Open" : "❌ Closed (Unmerged)");
    console.log(`\n   Origin PR:   #${pr.prNumber} - "${pr.title}" [${stateIcon}]`);
    console.log(`                ${pr.sourceBranch} ➔ ${pr.targetBranch} — ${pr.htmlUrl}`);
}

// Does a resolved branch name match what the user asked for? Handles both
// bare local names ("feature-x") and remote-tracking names ("origin/feature-x").
function branchMatches(branch, target) {
    return branch === target || branch === `origin/${target}` || target === `origin/${branch}`;
}

// Every commit we resolve branches/PR for gets recorded here so the optional
// --target-branch summary at the end doesn't need to re-run git a second time.
const allResolved = [];

if (originalCommits.length > 0) {
    console.log("📍 TARGET COMMIT DETAILS:");
    originalCommits.forEach(c => {
        const branches = getBranches(c);
        const pr = lookupPrForSha(cache, c.fullHash);
        allResolved.push({ label: "target", hash: c.hash, fullHash: c.fullHash, branches, committerDate: c.committerDate, authorDate: c.authorDate });

        console.log(`   Hash:        ${c.hash}`);
        console.log(`   Subject:     ${c.subject}`);
        if (verbose) {
            const branchDisplay = branches.length > 0 ? branches.join(", ") : "Detached HEAD / No active branch";
            console.log(`   Branch(es):  [ ${branchDisplay} ]`);
        } else {
            console.log(`   Branch(es):  ${branches.length} branch(es) (use --verbose to list)`);
        }
        if (pr) printPr(pr);
    });
} else {
    console.log("📍 TARGET COMMIT DETAILS: Not indexed in cache. (Try rebuilding the cache)");
}

console.log("=".repeat(50));

if (cherryPicks.length === 0) {
    console.log("ℹ️ No duplicate cherry-picked instances found in the cache.");
} else {
    console.log(`✅ Found ${cherryPicks.length} matching cherry-picked commit(s):\n`);

    cherryPicks.forEach((commit) => {
        const branches = getBranches(commit);
        const pr = lookupPrForSha(cache, commit.fullHash);
        allResolved.push({ label: "cherry-pick", hash: commit.hash, fullHash: commit.fullHash, branches, committerDate: commit.committerDate, authorDate: commit.authorDate });

        console.log(`📌 Cherry-Pick Hash: ${commit.hash}`);
        console.log(`   Subject:           ${commit.subject}`);
        if (verbose) {
            const branchDisplay = branches.length > 0 ? branches.join(", ") : "Detached HEAD / Historic commit";
            console.log(`   Branch(es):        [ ${branchDisplay} ]`);
        } else {
            console.log(`   Branch(es):        ${branches.length} branch(es) (use --verbose to list)`);
        }
        if (pr) {
            printPr(pr);
        } else if (branches.length === 0 && !hasPrCache) {
            console.log(`   ℹ️ No branch contains this commit anymore (likely deleted after merge/rebase).`);
            console.log(`      Run 'bun fg-find-commit-origin.js ${commit.hash}' to check its originating PR.`);
        }
        console.log("-".repeat(50));
    });
}

// Prints HOW and WHEN a commit entered a branch: author vs committer date,
// and whether it landed directly on that branch or arrived via a merge
// (e.g. some other branch already had the cherry-pick and got merged in later,
// or the branch was forked from a base that already contained it).
function printEntryTrace(trace, branchLabel, isCherryPick) {
    if (!trace) {
        console.log(`   ⚠️ Could not determine entry path (git call failed).`);
        return;
    }

    console.log(`   Commit:      ${trace.hash.substring(0, 7)}`);
    console.log(`   Authored:    ${trace.authorDate} by ${trace.authorName}`);
    console.log(`   Committed:   ${trace.committerDate} by ${trace.committerName}`);
    if (trace.authorDate !== trace.committerDate) {
        console.log(`   ⏱️  Author/committer dates differ — this commit was applied (cherry-picked/rebased) after it was originally authored.`);
    }
    if (isCherryPick) {
        console.log(`   ♻️  This is a CHERRY-PICKED COPY — a different commit hash than the original, carrying the same patch. It was NOT authored on "${branchLabel}"; someone applied it there (cherry-pick/rebase) from wherever the original commit lives (see "other locations" below).`);
    }

    if (!trace.isAncestor) {
        console.log(`   ⚠️ Not actually an ancestor of "${branchLabel}" (branch may have moved since the cache was built — try 'bun cherry-cache.js').`);
    } else if (trace.onFirstParentPath) {
        const landedVerb = isCherryPick
            ? `cherry-picked directly onto "${branchLabel}" as a new commit there (not merged in from another branch)`
            : `committed directly onto "${branchLabel}" (on its first-parent history)`;
        console.log(`   🛤️  Path: ${landedVerb}.`);
    } else if (trace.mergeCommit) {
        console.log(`   🛤️  Path: NOT directly on "${branchLabel}" — pulled in via merge commit ${trace.mergeCommit.hash.substring(0, 7)}`);
        console.log(`             ("${trace.mergeCommit.subject}") on ${trace.mergeCommit.date}.`);
        console.log(`             → Likely: another branch already had this patch and was merged into "${branchLabel}" at that point,`);
        console.log(`               or "${branchLabel}" was forked from a base that already contained it.`);
    } else {
        console.log(`   🛤️  Path: ancestor of "${branchLabel}", but the exact merge point could not be isolated.`);
    }
}

// Describes how two branches relate via git ancestry (merge-base), so tools
// can tell "this branch was forked from / merged from that one" (shared
// history) apart from "these just happen to share an unrelated old ancestor".
function describeBranchRelation(rel) {
    const short = rel.mergeBase ? rel.mergeBase.substring(0, 7) : "unknown";
    if (rel.aIsAncestorOfB && rel.bIsAncestorOfA) {
        return `"${rel.branchA}" and "${rel.branchB}" point to the exact same commit right now.`;
    }
    if (rel.aIsAncestorOfB) {
        return `"${rel.branchB}" contains all of "${rel.branchA}"'s history — i.e. it was forked from (or has since merged) "${rel.branchA}" at ${short} (${rel.mergeBaseDate}).`;
    }
    if (rel.bIsAncestorOfA) {
        return `"${rel.branchA}" contains all of "${rel.branchB}"'s history — i.e. it was forked from (or has since merged) "${rel.branchB}" at ${short} (${rel.mergeBaseDate}).`;
    }
    return `"${rel.branchA}" and "${rel.branchB}" diverged independently — no direct fork relationship; common ancestor is ${short} (${rel.mergeBaseDate}).`;
}

// Given more than one branch argument, resolves which (if any) copy of the
// patch is reachable from that branch, and whether it's the original commit
// or a cherry-picked copy.
function resolveBranchMatch(target) {
    const found = allResolved.find(r => r.branches.some(b => branchMatches(b, target)));
    if (!found) return { target, found: false };
    const branchRef = found.branches.find(b => branchMatches(b, target));
    return { target, found: true, branchRef, hash: found.hash, fullHash: found.fullHash, isOriginal: found.label === "target", committerDate: found.committerDate, authorDate: found.authorDate };
}

function printBranchSummaryLine(result) {
    const label = result.target.padEnd(28);
    if (!result.found) {
        console.log(`   ❌ ${label} not found`);
        return;
    }
    const kind = result.isOriginal ? "ORIGINAL" : "cherry-pick";
    const baseInfo = cache.branch.bases?.[result.branchRef];
    const baseStr = baseInfo?.base ? ` (base: ${baseInfo.base}${baseInfo.source === "pr" ? " via PR" : ""})` : "";
    const dateStr = result.committerDate ? `  [${result.committerDate}]` : "";
    console.log(`   ✅ ${label} ${result.hash}${dateStr}  ${kind}${baseStr}`);
}

// Three or more args: multiple branches given — print a concise side-by-side
// summary instead of the full single-branch deep-dive (which would be too
// repetitive/verbose across several branches).
if (targetBranches.length > 1) {
    console.log("=".repeat(50));
    console.log(`🎯 Branch Check Summary (${targetBranches.length} branches):`);
    targetBranches.forEach(tb => printBranchSummaryLine(resolveBranchMatch(tb)));
    console.log("=".repeat(50));
}

// Exactly one target branch: quick pass/fail check against that specific
// branch, plus a full how/when trace, so you don't have to scan a long
// branch list by eye or manually dig through git log when there are many matches.
if (targetBranch) {
    console.log("=".repeat(50));
    console.log(`🎯 Target Branch Check: "${targetBranch}"`);

    const found = allResolved.find(r => r.branches.some(b => branchMatches(b, targetBranch)));
    if (found) {
        const branchRef = found.branches.find(b => branchMatches(b, targetBranch));
        console.log(`   ✅ MATCH — Same patch found in "${targetBranch}" via ${found.label} commit ${found.hash}`);

        const baseInfo = cache.branch.bases?.[branchRef];
        if (baseInfo?.base) {
            if (baseInfo.source === "pr") {
                console.log(`   🌳 Base branch:  "${baseInfo.base}" (via PR #${baseInfo.prNumber}, ${baseInfo.forkDate})`);
            } else {
                console.log(`   🌳 Base branch:  "${baseInfo.base}" (forked at ${baseInfo.forkPoint?.substring(0, 7)}, ${baseInfo.forkDate})`);
            }
        }

        console.log("-".repeat(50));
        const commitEntry = [...originalCommits, ...cherryPicks].find(c => c.fullHash === found.fullHash);
        const trace = traceEntryPath(commitEntry, branchRef);
        printEntryTrace(trace, branchRef, found.label === "cherry-pick");

        // Same commit, reachable from more than one branch: that's plain
        // shared ancestry (a fork/merge relationship), never an independent
        // cherry-pick — confirm which branch forked from which via merge-base.
        // Only branches DIRECTLY related to branchRef are worth detailing;
        // e.g. many sibling branches forked off the same base as branchRef
        // but unrelated to it are just noise — collapsed into a single count.
        const siblingBranches = found.branches.filter(b => b !== branchRef);
        if (siblingBranches.length > 0) {
            const related = [];
            let unrelatedCount = 0;
            siblingBranches.forEach(sib => {
                const rel = getBranchRelation(cache, branchRef, sib);
                mutated = true;
                if (rel.aIsAncestorOfB || rel.bIsAncestorOfA) {
                    related.push(rel);
                } else {
                    unrelatedCount++;
                }
            });
            if (related.length > 0) {
                console.log(`   🔗 This exact commit is also reachable from (directly related to "${branchRef}"):`);
                related.forEach(rel => console.log(`      → ${describeBranchRelation(rel)}`));
            }
            if (unrelatedCount > 0) {
                console.log(`   ℹ️  Also reachable from ${unrelatedCount} other branch(es) with no direct ancestry to "${branchRef}" (unrelated forks) — omitted for brevity.`);
            }
        }

        const otherLocations = allResolved.filter(r => r.fullHash !== found.fullHash);
        if (otherLocations.length > 0) {
            const relatedLocations = [];
            let unrelatedLocationCount = 0;
            otherLocations.forEach(o => {
                const otherBranch = o.branches[0];
                const rel = otherBranch ? getBranchRelation(cache, branchRef, otherBranch) : null;
                if (rel) mutated = true;
                if (rel && (rel.aIsAncestorOfB || rel.bIsAncestorOfA)) {
                    relatedLocations.push({ o, rel });
                } else {
                    unrelatedLocationCount++;
                }
            });
            if (relatedLocations.length > 0) {
                console.log(`   🌱 Other location(s) of this same patch under a DIFFERENT commit hash (on a related branch):`);
                relatedLocations.forEach(({ o, rel }) => {
                    const branchList = o.branches.length > 0 ? o.branches.join(", ") : "no active branch (deleted/historic)";
                    console.log(`      - ${o.label} commit ${o.hash} on [ ${branchList} ]`);
                    console.log(`        → ${describeBranchRelation(rel)}`);
                    console.log(`        ⚠️ Branches are directly related, yet this is a DIFFERENT commit hash — a real independent cherry-pick/rebase, not inherited history.`);
                });
            }
            if (unrelatedLocationCount > 0) {
                console.log(`   ℹ️  Same patch also exists on ${unrelatedLocationCount} other unrelated branch/commit combination(s) — omitted for brevity.`);
            }
        }
    } else {
        console.log(`   ❌ NOT FOUND — No commit with this patch-id exists in "${targetBranch}"`);
    }
    console.log("=".repeat(50));
}

// Self-heal: persist any branches we had to resolve live (not yet cached by
// `bun cherry-cache.js`) so future lookups reuse them instead of re-shelling git.
if (mutated) {
    await saveCache(cache);
}