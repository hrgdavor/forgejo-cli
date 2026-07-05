#!/usr/bin/env bun
// create-stack.js
import { spawnSync } from "bun";
import { getRepoContext, headers } from "./forgejo-utils.js";

// 1. Safe Git Helper
function runGit(args) {
    const result = spawnSync(["git", ...args]);
    if (result.exitCode !== 0) {
        console.error(`\n❌ Git command failed: git ${args.join(" ")}`);
        console.error(result.stderr.toString().trim());
        process.exit(1);
    }
    return result.stdout.toString().trim();
}

// 2. Parse CLI Arguments for PR Title
const args = Bun.argv.slice(2);
let prTitle = "";
const titleIdx = args.findIndex(arg => arg === "--title" || arg === "-t");
if (titleIdx !== -1 && args[titleIdx + 1]) {
    prTitle = args[titleIdx + 1];
}

async function createStackPR() {
    const currentBranch = runGit(["branch", "--show-current"]);
    if (!currentBranch || currentBranch === "main" || currentBranch === "master" || currentBranch === "develop") {
        console.error(`❌ Error: You are on an main/protected branch ([${currentBranch || "unknown"}]).`);
        console.error("   Please check out your stack feature branch before running this script.");
        return;
    }

    // Fallback to last commit message if no title parameter was supplied
    if (!prTitle) {
        prTitle = runGit(["log", "-1", "--pretty=%B"]).split("\n")[0].trim();
        console.log(`ℹ️ No title provided. Defaulting to last commit message: "${prTitle}"`);
    }

    console.log(`🌿 Current stack branch: [${currentBranch}]`);
    const { baseUrl, owner, repo } = getRepoContext();

    // 3. Intelligently deduce the parent branch using git merge-base
    console.log("🔍 Finding the parent branch layer...");

    // Find all local branches except the current one
    const branches = runGit(["branch", "--format=%(refname:short)"])
        .split("\n")
        .map(b => b.trim())
        .filter(b => b !== currentBranch && b.length > 0);

    let parentBranch = "";
    let closestCommitCount = Infinity;

    // Evaluate which branch shares the closest structural common ancestor commit
    for (const branch of branches) {
        const mergeBase = runGit(["merge-base", currentBranch, branch]);
        if (!mergeBase) continue;

        // Count how many commits exist between the merge base and the current branch
        const commitCountStr = runGit(["rev-list", "--count", `${mergeBase}..${currentBranch}`]);
        const commitCount = parseInt(commitCountStr, 10);

        // The branch with the fewest unique tracking commits ahead of it is the immediate parent stack layer
        if (commitCount < closestCommitCount && commitCount > 0) {
            closestCommitCount = commitCount;
            parentBranch = branch;
        }
    }

    // Default fallback if no local history matches cleanly
    if (!parentBranch) {
        parentBranch = branches.includes("main") ? "main" : (branches.includes("master") ? "master" : "develop");
        console.log(`⚠️ Could not perfectly guess parent stack. Defaulting base to: [${parentBranch}]`);
    } else {
        console.log(`🌿 Detected Parent Layer Base: [${parentBranch}] (Your branch is ${closestCommitCount} commit(s) ahead)`);
    }

    // 4. Push branch to remote server
    console.log(`\n📤 Pushing local branch [${currentBranch}] up to origin...`);
    runGit(["push", "-u", "origin", currentBranch]);

    // 5. Submit the structured Stacked PR to Forgejo/Gitea API
    console.log(`🚀 Creating Stacked PR on server matching schema: [${currentBranch}] ➔ [${parentBranch}]...`);

    const response = await fetch(`${baseUrl}/repos/${owner}/${repo}/pulls`, {
        method: "POST",
        headers,
        body: JSON.stringify({
            base: parentBranch,
            head: currentBranch,
            title: prTitle,
            body: `Automated Stacked PR layer branching off of environment parent \`${parentBranch}\`.`
        })
    });

    if (response.ok) {
        const pr = await response.json();
        console.log(`\n🎉 Success! Stacked Pull Request successfully opened:`);
        console.log(`   🔗 PR #${pr.number}: ${pr.html_url}`);
        console.log(`   🛠️ Target Direction: [${currentBranch}] ➔ [${parentBranch}]`);
    } else {
        const errDetails = await response.json().catch(() => ({}));
        console.error(`\n❌ API Error creating Pull Request:`, errDetails.message || response.statusText);
    }
}

createStackPR().catch(console.error);