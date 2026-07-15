#!/usr/bin/env bun
// fg-find-commit-origin.js
//
// Answers "where does this commit live?" using BOTH signals at once:
//   1. Direct match: is this sha (or a prefix of it) literally a commit inside a known PR?
//   2. Patch-id match: does this commit's diff match another commit (same patch-id,
//      different sha) that sits on a local branch and/or came from a PR?
// This covers cherry-picks and rebases where the sha changes but the diff doesn't.
//
// Pure READ-ONLY consumer of the cache - it never syncs. Run `bun cherry-cache.js`
// first (and whenever you want fresher results); this tool just queries it.
import { loadCache, saveCache, findOrigin } from "./commit-cache.js";

const args = Bun.argv.slice(2);
const targetInput = args.find(arg => !arg.startsWith("-"))?.trim();

async function run() {
    const cache = await loadCache();

    const isEmpty = Object.keys(cache.pr.prs).length === 0 && Object.keys(cache.patch.patchMap).length === 0;
    if (isEmpty) {
        console.error("❌ Cache is empty. Build it first:");
        console.error("   bun cherry-cache.js            # local patch-id + branch info + PR sync");
        console.error("   bun cherry-cache.js --no-prs   # local-only, no Forgejo token needed");
        process.exit(1);
    }

    if (!targetInput) {
        console.log(`\n📂 Usage: bun ./fg-find-commit-origin.js <commit-hash>`);
        console.log(`ℹ️  This tool only reads the cache. To refresh it, run: bun cherry-cache.js`);
        return;
    }

    console.log(`🔎 Cross-referencing branch & PR history for target: [${targetInput}]`);

    const result = findOrigin(cache, targetInput);
    // findOrigin() may have lazily resolved accurate branches for a sibling
    // that wasn't marked `branchesResolved` yet - persist that so future runs
    // (and cherry-cache.js) reuse it instead of re-shelling out to git.
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

