#!/usr/bin/env bun
// rebase-stack.js
import { spawnSync } from "bun";
import { getRepoContext, fetchAllPages } from "./forgejo-utils.js";

// 1. Safe Git Command Execution Helper
function runGit(args) {
    const result = spawnSync(["git", ...args]);
    if (result.exitCode !== 0) {
        console.error(`\n❌ Git command failed: git ${args.join(" ")}`);
        console.error(result.stderr.toString().trim());
        process.exit(1);
    }
    return result.stdout.toString().trim();
}

async function rebaseStack() {
    // Determine current active working branch
    const initialBranch = runGit(["branch", "--show-current"]);
    if (!initialBranch) {
        console.error("❌ Could not determine current local git branch.");
        return;
    }

    console.log(`🌿 Identified starting branch context: [${initialBranch}]`);
    const { baseUrl, owner, repo } = getRepoContext();

    try {
        console.log(`🔍 Fetching remote repository state to build stack map...`);
        const prs = await fetchAllPages(`${baseUrl}/repos/${owner}/${repo}/pulls?state=open`);

        // 2. Map structural dependencies
        // Key: Parent Branch Name -> Value: Array of PRs targeting it
        const parentToChildrenMap = {};
        prs.forEach(pr => {
            const base = pr.base.ref;
            if (!parentToChildrenMap[base]) {
                parentToChildrenMap[base] = [];
            }
            parentToChildrenMap[base].push(pr);
        });

        // 3. Trace the stack up from the current branch
        const executionStack = [];

        function traceUp(currentParent) {
            const children = parentToChildrenMap[currentParent] || [];
            for (const childPr of children) {
                const childBranch = childPr.head.ref;
                executionStack.push({
                    branch: childBranch,
                    parent: currentParent,
                    prNumber: childPr.number,
                    title: childPr.title
                });
                // Recursively check for branches stacked on top of this child
                traceUp(childBranch);
            }
        }

        traceUp(initialBranch);

        if (executionStack.length === 0) {
            console.log(`✅ No stacked child PRs depend on [${initialBranch}]. Your stack is clean.`);
            return;
        }

        console.log(`\n📋 Found ${executionStack.length} dependent stacked branch layers to rebase:`);
        executionStack.forEach((layer, idx) => {
            console.log(`   ${idx + 1}. [${layer.branch}] ➔ targets [${layer.parent}] (PR #${layer.prNumber})`);
        });

        // Ensure local status is clean before bouncing across branches
        const status = runGit(["status", "--porcelain"]);
        if (status.length > 0) {
            console.error("\n❌ Working directory has uncommitted changes. Stash or commit before running.");
            return;
        }

        console.log(`\n🚀 Starting stack rebase execution...`);

        // 4. Sequentially move up the chain executing updates
        for (const layer of executionStack) {
            console.log(`\n--------------------------------------------------`);
            console.log(`🔄 Processing Layer: PR #${layer.prNumber} ("${layer.title}")`);

            console.log(`   📥 Checking out ${layer.branch}...`);
            runGit(["checkout", layer.branch]);

            console.log(`   🔀 Rebasing onto updated parent branch [${layer.parent}]...`);
            runGit(["rebase", layer.parent]);

            console.log(`   📤 Force-pushing optimized history to origin...`);
            // force-with-lease prevents overwriting unexpected remote work
            runGit(["push", "origin", layer.branch, "--force-with-lease"]);

            console.log(`   🎉 Layer [${layer.branch}] successfully synchronized!`);
        }

        // Return user safely back to where they started
        console.log(`\n--------------------------------------------------`);
        console.log(`↩️ Returning to initial starting branch...`);
        runGit(["checkout", initialBranch]);
        console.log(`🏁 Done! Entire branch stack above [${initialBranch}] has been rebased and synced.`);

    } catch (err) {
        console.error("❌ Error running script:", err.message);
        // Fallback attempt to return home if mid-run crash occurs
        runGit(["checkout", initialBranch]);
    }
}

rebaseStack();