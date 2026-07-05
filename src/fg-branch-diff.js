#!/usr/bin/env bun
// fg-branch-diff.js
//
// Compares two branches by PATCH CONTENT, not just commit hash: which commits
// on <older-branch> are genuinely MISSING from <newer-branch> — as opposed to
// already present there via a cherry-pick or rebase (different sha, same diff)?
//
// This is exactly the classic trap: a commit was cherry-picked onto a base
// branch, and <newer-branch> was forked from that base *later* — so by sha
// alone it looks "missing", but the patch is already there.
//
// Wraps `git cherry`, which already performs this patch-id equivalence check
// internally (and handles it correctly/efficiently), then enriches the
// result with cached PR info (read-only — see README.cache.md) for context.
import { spawnSync } from "bun";
import { loadCache, lookupPrForSha } from "./commit-cache.js";

const olderBranch = Bun.argv[2];
const newerBranch = Bun.argv[3];

if (!olderBranch || !newerBranch) {
    console.error("❌ Error: Please provide two branch names.");
    console.log("Usage: bun fg-branch-diff.js <older-branch> <newer-branch>");
    console.log("\nReports commits on <older-branch> that have no equivalent patch anywhere");
    console.log("in <newer-branch>'s history — cherry-picks/rebases (same diff, different sha)");
    console.log("are correctly recognized as already present, not flagged as missing.");
    process.exit(1);
}

function resolveRef(branch) {
    if (spawnSync(["git", "rev-parse", "--verify", "--quiet", branch]).exitCode === 0) return branch;
    if (spawnSync(["git", "rev-parse", "--verify", "--quiet", `origin/${branch}`]).exitCode === 0) return `origin/${branch}`;
    return null;
}

const olderRef = resolveRef(olderBranch);
const newerRef = resolveRef(newerBranch);

if (!olderRef) {
    console.error(`❌ Error: Branch not found: "${olderBranch}" (checked local and origin/).`);
    process.exit(1);
}
if (!newerRef) {
    console.error(`❌ Error: Branch not found: "${newerBranch}" (checked local and origin/).`);
    process.exit(1);
}

console.log(`🔎 Comparing by patch-id: "${olderRef}" (older) → "${newerRef}" (newer)...`);
console.log("=".repeat(60));

// `git cherry -v <upstream> <head>` lists every commit reachable from <head>
// but not <upstream> (by sha), each marked "+" (no equivalent patch found in
// <upstream>) or "-" (an equivalent patch already exists in <upstream>).
const cherryProc = spawnSync(["git", "cherry", "-v", newerRef, olderRef]);
if (cherryProc.exitCode !== 0) {
    console.error(`❌ git cherry failed: ${cherryProc.stderr.toString()}`);
    process.exit(1);
}

const lines = cherryProc.stdout.toString().split("\n").filter(Boolean);

if (lines.length === 0) {
    console.log(`✅ Nothing unique to "${olderRef}" — every commit there is also reachable (by sha) from "${newerRef}".`);
    process.exit(0);
}

const missing = [];
const carried = [];

for (const line of lines) {
    // Format: "<+ or -> <sha> <subject...>"
    const marker = line[0];
    const rest = line.slice(2);
    const sha = rest.split(" ")[0];
    const subject = rest.slice(sha.length + 1);
    (marker === "+" ? missing : carried).push({ sha, subject });
}

const cache = await loadCache();

console.log(`📊 Summary: ${missing.length} missing, ${carried.length} already carried over (via cherry-pick/rebase)`);
console.log("=".repeat(60));

if (missing.length > 0) {
    console.log(`\n❌ MISSING from "${newerRef}" (${missing.length}) — no equivalent patch found there:\n`);
    missing.forEach(c => {
        console.log(`   ${c.sha}  ${c.subject}`);
        const pr = lookupPrForSha(cache, c.sha);
        if (pr) {
            const stateIcon = pr.merged ? "🎉 Merged" : (pr.state === "open" ? "🟢 Open" : "❌ Closed (Unmerged)");
            console.log(`\n             Origin PR: #${pr.prNumber} "${pr.title}" [${stateIcon}] ${pr.sourceBranch} ➔ ${pr.targetBranch}`);
        }
    });
    console.log(`\n   💡 Tip: run 'bun cherry.js <hash> ${newerRef}' on any of these for a full branch/PR + entry-path trace.`);
} else {
    console.log(`\n✅ Nothing missing — every commit unique to "${olderRef}" already has an equivalent patch in "${newerRef}".`);
}

if (carried.length > 0) {
    console.log(`\n♻️  Already present in "${newerRef}" via cherry-pick/rebase (${carried.length}):\n`);
    carried.forEach(c => {
        console.log(`   ${c.sha}  ${c.subject}`);
    });
}

console.log("\n" + "=".repeat(60));
