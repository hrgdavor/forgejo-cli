import { spawnSync } from "bun";

// 1. Parse command line arguments
const searchTerm = Bun.argv[2];
const targetBranch = Bun.argv[3]; // Optional third parameter
const gitHashRegex = /^[0-9a-fA-F]{7,40}$/

if (!searchTerm) {
    console.error("❌ Please provide a commit message search term.");
    console.log("Usage: bun run search-commits.js \"search term\" [optional_target_branch]");
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