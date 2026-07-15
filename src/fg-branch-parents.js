#!/usr/bin/env bun
// fg-branch-parents.js - prints the fork-parent chain for a branch
// (branch -> its base -> that base's base -> ... -> root), so the
// `resolveBranchBase()` calculation in commit-cache.js can be sanity-checked
// against actual git history. Also useful standalone: "what was this branch
// forked from, and what was THAT forked from?".
//
// Pure local git, no network. Only resolves the branches actually needed for
// this branch's chain (via resolveBranchBase), NOT the entire repo's branch
// list - use `bun cherry-cache.js` if you want every branch precomputed.
//
// Usage: bun fg-branch-parents.js <branch> [--rebuild]
import { loadCache, saveCache, resolveBranchBase } from "./commit-cache.js";

const branch = Bun.argv[2];
const forceRebuild = Bun.argv.includes("--rebuild") || Bun.argv.includes("-r");

if (!branch) {
    console.error("❌ Error: Please provide a branch name.");
    console.log("Usage: bun fg-branch-parents.js <branch> [--rebuild]");
    process.exit(1);
}

const cache = await loadCache();
if (forceRebuild) cache.branch.bases = {};

let mutated = false;
let totalBranches = 0;

function resolve(b) {
    const { info, totalBranches: total, found } = resolveBranchBase(cache, b);
    totalBranches = total;
    if (!found) return null;
    mutated = true;
    return info;
}

const firstInfo = resolve(branch);
if (firstInfo === null) {
    console.error(`❌ Error: Branch "${branch}" not found among known branches (${totalBranches} total).`);
    console.log(`   Tip: try the exact ref form git uses, e.g. "origin/${branch}".`);
    process.exit(1);
}

console.log(`🌳 Fork-parent chain for "${branch}" (${totalBranches} branch(es) known):\n`);
console.log(branch);

let current = branch;
let info = firstInfo;
const seen = new Set([current]);
while (true) {
    if (!info || !info.base) {
        console.log(`  └─ (root - no known ancestor branch)`);
        break;
    }
    if (seen.has(info.base)) {
        console.log(`  └─ ⚠️ cycle detected - "${info.base}" already visited, stopping.`);
        break;
    }
    if (info.source === "pr") {
        console.log(`  └─ forked from "${info.base}" via PR #${info.prNumber} (${info.forkDate ?? "unknown date"})`);
    } else {
        console.log(`  └─ forked from "${info.base}" at ${info.forkPoint?.substring(0, 7) ?? "?"} (${info.forkDate ?? "unknown date"}), ${info.aheadCount} commit(s) ahead`);
    }
    current = info.base;
    seen.add(current);
    info = resolve(current);
}

if (mutated) await saveCache(cache);
