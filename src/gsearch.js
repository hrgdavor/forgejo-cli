import { spawnSync } from "bun";

const rawArgs = Bun.argv.slice(2);
const gitHashRegex = /^[0-9a-fA-F]{7,40}$/;

// ── Mode: --contains <sha> ──────────────────────────────────────────────────
// Given a commit SHA, find every local + remote-tracking branch that contains it.
// Usage:  bun run src/gsearch.js --contains <sha>
const containsIdx = rawArgs.findIndex(a => a === "--contains" || a === "-c");

if (containsIdx !== -1) {
    const sha = rawArgs[containsIdx + 1];

    if (!sha || !gitHashRegex.test(sha)) {
        console.error("❌ Please provide a valid commit SHA (7-40 hex characters).");
        console.log("   Usage: bun run src/gsearch.js -c <sha>");
        process.exit(1);
    }

    // Full SHA so git branch --contains accepts it without ambiguity
    const fullProc = spawnSync(["git", "rev-parse", sha]);
    if (fullProc.exitCode !== 0) {
        console.error(`❌ Could not resolve "${sha}" to a commit. Are you inside a Git repository?`);
        process.exit(1);
    }
    const fullHash = fullProc.stdout.toString().trim();
    if (!fullHash || fullHash.includes("fatal")) {
        console.error(`❌ Commit "${sha}" not found in this repository.`);
        process.exit(1);
    }

    const label = fullHash.length === 40 ? fullHash : `${sha} → ${fullHash}`;
    console.log(`\n🔍 Branches containing commit ${label}:`);

    const branchProc = spawnSync(["git", "branch", "-a", `--contains=${fullHash}`]);
    if (branchProc.exitCode !== 0) {
        console.error(`❌ git branch --contains failed.`);
        process.exit(1);
    }

    const branches = branchProc.stdout
        .toString()
        .split("\n")
        .map(b => b.trim())
        .filter(b => b.length > 0)
        .map(b => b.replace(/^\* /, "")) // drop active-branch asterisk
        .filter(b => !b.includes(" -> ")); // drop "origin/HEAD -> origin/main"

    if (branches.length === 0) {
        console.log("   (no branches contain this commit)");
        process.exit(0);
    }

    // Separate local vs remote-tracking for readability
    const local = branches.filter(b => !b.startsWith("remotes/"));
    const remote = branches.filter(b => b.startsWith("remotes/")).map(b => b.replace(/^remotes\//, ""));

    if (local.length > 0) {
        console.log("\n   🌿 Local:");
        local.forEach(b => console.log(`      ${b}`));
    }
    if (remote.length > 0) {
        console.log("\n   🌐 Remote-tracking:");
        remote.forEach(b => console.log(`      ${b}`));
    }

    console.log(`\n   Total: ${branches.length} branch(es)\n`);
    process.exit(0);
}

// ── Mode: search by message or hash ─────────────────────────────────────────

const searchTerm = rawArgs[0];
const targetBranch = rawArgs[1]; // Optional second parameter

if (!searchTerm) {
    console.error("❌ Please provide a commit message search term, or use -c <sha> to find branches containing a commit.");
    console.log("Usage:");
    console.log("  bun run src/gsearch.js \"search term\" [optional_target_branch]");
    console.log("  bun run src/gsearch.js -c <commit-sha>              # find branches containing this commit");
    process.exit(1);
}

console.log(`🔎 Searching all branches for: "${searchTerm}"...`);
if (targetBranch) {
    console.log(`🎯 Will explicitly check for inclusion in branch: "${targetBranch}"`);
}
console.log("\n" + "═".repeat(60) + "\n");

// 2. Find all matching commit SHAs
const srch = gitHashRegex.test(searchTerm) ?
    ['-1', searchTerm]
    : ["--all", `--grep=${searchTerm}`]
const gitLog = spawnSync([
    "git", "log",
        ...srch,
    "--format=%H|%s|%an (%ad)"
]);

if (gitLog.exitCode !== 0) {
    console.error("❌ Git log command failed. Are you inside a Git repository?");
    process.exit(1);
}

const logOutput = gitLog.stdout.toString().trim();

if (!logOutput) {
    console.log("▶ No matching commits found.");
    process.exit(0);
}

const lines = logOutput.split("\n");
let targetBranchMatches = 0;

// 3. Process each found commit
for (const line of lines) {
    const [sha, message, meta] = line.split("|");

    console.log(`📌 \x1b[36mCommit:\x1b[0m ${sha.substring(0, 7)} - ${message}`);
    console.log(`   \x1b[90mBy ${meta}\x1b[0m`);

    // Run `git branch -a --contains <sha>`
    const gitBranch = spawnSync(["git", "branch", "-a", `--contains=${sha}`]);

    if (gitBranch.exitCode === 0) {
        const branches = gitBranch.stdout
            .toString()
            .split("\n")
            .map(b => b.trim())
            .filter(b => b.length > 0)
            .map(b => b.replace(/^\* /, "")); // Clean up active branch asterisk

        console.log("   \x1b[32mBranches containing this commit:\x1b[0m");
        let includesTarget = false;

        branches.forEach(branch => {
            console.log(`     - ${branch}`);

            // Check if this branch matches our target (handles exact match or remote shorthand)
            if (targetBranch && (branch === targetBranch || branch === `remotes/origin/${targetBranch}`)) {
                includesTarget = true;
            }
        });

        // If a target branch was specified, print the specific check result inline
        if (targetBranch) {
            if (includesTarget) {
                targetBranchMatches++;
                console.log(`   ✨ \x1b[42\x1b[30m MATCH \x1b[0m This commit IS inside "${targetBranch}"`);
            } else {
                console.log(`   ❌ \x1b[41\x1b[30m MISSED \x1b[0m This commit is NOT inside "${targetBranch}"`);
            }
        }
    } else {
        console.log("   \x1b[31mBranches:\x1b[0m Could not resolve branches.");
    }

    console.log("\n" + "─".repeat(60) + "\n");
}

// 4. Final summary block at the absolute end
if (targetBranch) {
    console.log("═".repeat(60));
    console.log(`📋 \x1b[1mFINAL TARGET BRANCH REPORT\x1b[0m`);
    console.log(`   Target Branch:  ${targetBranch}`);
    console.log(`   Total Commits matching text: ${lines.length}`);

    if (targetBranchMatches > 0) {
        console.log(`   Status:         \x1b[32mFOUND (${targetBranchMatches} matching commit(s) are in "${targetBranch}")\x1b[0m`);
    } else {
        console.log(`   Status:         \x1b[31mNOT FOUND (None of these commits are in "${targetBranch}")\x1b[0m`);
    }
    console.log("═".repeat(60));
}
