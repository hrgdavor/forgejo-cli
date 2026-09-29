#!/usr/bin/env bun
// fg-find-commit-origin.js
//
// Answers "where does this commit live?" using BOTH signals at once:
//   1. Direct match: is this sha (or a prefix of it) literally a commit inside a known PR?
//   2. Patch-id match: does this commit's diff match another commit (same patch-id,
//      different sha) that sits on a local branch and/or came from a PR?
// This covers cherry-picks and rebases where the sha changes but the diff doesn't.
//
// By default, ensures the cache is incrementally up-to-date before querying, so no
// separate `fg-cherry-cache.js` run is needed. Use --no-sync to skip and query the
// cache as-is, or --no-prs to skip the (networked) Forgejo PR metadata refresh.
import { loadCache, saveCache, syncPatchIds, resolveDuplicateBranches, syncPrCache, lookupPrForSha, findOrigin } from "./commit-cache.js";

const args = Bun.argv.slice(2);
const noSync = args.includes("--no-sync");
const noPrs = args.includes("--no-prs");
const targetInput = args.find(arg => !arg.startsWith("-"))?.trim();

async function run() {
    const cache = await loadCache();

    if (!noSync) {
        console.log("ℹ️  Use --no-sync to skip auto-sync and run fastest (queries cache as-is).");
        const knownBefore =
            Object.values(cache.patch.patchMap).reduce((n, arr) => n + arr.length, 0) + cache.patch.emptyCommits.length;

        console.log("⏳ Incremental cache sync...");
        const { newCommitsCount, branchUpdatesCount } = await syncPatchIds(cache);
        const { resolvedCount, duplicateGroupCount } = await resolveDuplicateBranches(cache);

        // PR metadata requires network + token; try it but don't block if unavailable.
        let prSyncFailed = false;
        if (!noPrs) {
            try {
                await syncPrCache(cache, false);
            } catch (e) {
                prSyncFailed = true;
                console.log(`⚠️  PR sync skipped (no token/network): ${e.message}`);
            }
        }

        const knownAfter =
            Object.values(cache.patch.patchMap).reduce((n, arr) => n + arr.length, 0) + cache.patch.emptyCommits.length;
        if (knownAfter > knownBefore || branchUpdatesCount > 0 || resolvedCount > 0) {
            await saveCache(cache);
        }

        if (newCommitsCount === 0 && branchUpdatesCount === 0 && resolvedCount === 0) {
            console.log("✅ Cache already up-to-date.");
        } else {
            console.log(`✅ Sync complete: ${newCommitsCount} new commit(s), ${branchUpdatesCount} branch update(s), ${resolvedCount} duplicate(s) resolved.`);
        }
        if (prSyncFailed) {
            console.log("   (local-only results — PR metadata unavailable)");
        }
        console.log("");
    }

    const isEmpty = Object.keys(cache.pr.prs).length === 0 && Object.keys(cache.patch.patchMap).length === 0;
    if (isEmpty) {
        console.error("❌ Cache is empty. Build it first:");
        console.error("   bun run src/fg-cherry-cache.js            # local patch-id + branch info + PR sync");
        console.error("   bun run src/fg-cherry-cache.js --no-prs   # local-only, no Forgejo token needed");
        process.exit(1);
    }

    if (!targetInput) {
        console.log(`\n📂 Usage: bun ./fg-find-commit-origin.js <commit-hash>`);
        console.log(`ℹ️  This tool only reads the cache. To refresh it, run: bun run src/fg-cherry-cache.js`);
        console.log(`ℹ️  Or let it auto-sync (default): just omit --no-sync.`);
        return;
    }

    console.log(`🔎 Cross-referencing branch & PR history for target: [${targetInput}]`);

    const result = findOrigin(cache, targetInput);
    // findOrigin() may have lazily resolved accurate branches for a sibling
    // that wasn't marked `branchesResolved` yet - persist that so future runs
    // (and fg-cherry-cache.js) reuse it instead of re-shelling out to git.
    await saveCache(cache);

    printResult(result);
}

function printPr(pr) {
    const stateIcon = pr.merged ? "🎉 Merged" : (pr.state === "open" ? "🟢 Open" : "❌ Closed (Unmerged)");
    console.log(`   🛠️  PR         : #${pr.prNumber} - "${pr.title}"`);
    console.log(`   🌿 Branch     : ${pr.sourceBranch} ➔ ${pr.targetBranch}`);
    console.log(`   📊 State      : ${stateIcon}`);
    if (pr.mergedAt) console.log(`   📅 Merged On  : ${new Date(pr.mergedAt).toLocaleString()}`);
    console.log(`   🔗 Web Ref    : ${pr.htmlUrl}`);
    if (pr.author) console.log(`   📝 Author/Msg : ${pr.author} - ${pr.message}`);
}

function printResult(result) {
    console.log("=".repeat(60));

    if (!result.patchId && !result.directPr) {
        console.log(`✖️  Could not resolve commit [${result.targetHash}] locally or against known PRs.`);
        console.log("=".repeat(60));
        return;
    }

    if (result.patchId) console.log(`🎯 Patch-ID: ${result.patchId.substring(0, 12)}...`);

    if (result.directPr) {
        console.log(`\n📦 Direct PR Match (this exact sha is inside a PR):`);
        printPr(result.directPr);
    }

    if (result.localBranches.length > 0) {
        console.log(`\n🌿 Local Branch(es) containing this commit/patch:`);
        result.localBranches.forEach(b => console.log(`   - ${b}`));
    }

    if (result.cherryPicks.length > 0) {
        console.log(`\n♻️  Same-patch cherry-pick(s) found elsewhere (${result.cherryPicks.length}):`);
        result.cherryPicks.forEach(cp => {
            console.log("-".repeat(60));
            console.log(`   Hash:       ${cp.hash}`);
            console.log(`   Subject:    ${cp.subject}`);
            console.log(`   Branch(es): [ ${cp.branches.length > 0 ? cp.branches.join(", ") : "none / detached"} ]`);
            if (cp.pr) {
                console.log(`\n   Origin PR:`);
                printPr(cp.pr);
            }
        });
    } else if (!result.directPr) {
        console.log("\nℹ️ No other branch or PR shares this exact patch.");
    }

    console.log("=".repeat(60));
}

run().catch(console.error);
