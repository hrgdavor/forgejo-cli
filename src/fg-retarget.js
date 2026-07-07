#!/usr/bin/env bun
// auto-retarget-stack.js
import { getRepoContext, getHeaders, fetchAllPages } from "./forgejo-utils.js";

const { baseUrl, owner, repo } = getRepoContext();

async function autoRetargetStack() {
    console.log(`🔍 Scanning stacked PR configurations for ${owner}/${repo}...`);
    try {
        // 1. Fetch both open and closed PRs to analyze histories
        const openPrs = await fetchAllPages(`${baseUrl}/repos/${owner}/${repo}/pulls?state=open`);
        const closedPrs = await fetchAllPages(`${baseUrl}/repos/${owner}/${repo}/pulls?state=closed`);

        if (openPrs.length === 0) {
            console.log("✅ No open pull requests found.");
            return;
        }

        // 2. Map closed/merged head branches to see what went missing
        // Key: closed branch name, Value: where that closed branch was merged into
        const closedBranchesMap = {};
        closedPrs.forEach(pr => {
            if (pr.has_merged || pr.merged) {
                closedBranchesMap[pr.head.ref] = pr.base.ref;
            }
        });

        console.log(`📊 Found ${openPrs.length} open PRs. Checking for dead stack links...`);
        let retargetCount = 0;

        // 3. Look for open PRs that target a recently merged branch
        for (const pr of openPrs) {
            const currentBase = pr.base.ref;

            if (closedBranchesMap[currentBase]) {
                const structuralTarget = closedBranchesMap[currentBase];

                console.log(`\n⚠️  Detected broken stack on PR #${pr.number} ("${pr.title}"):`);
                console.log(`   Current Base [${currentBase}] was already merged!`);
                console.log(`   🚀 Retargeting PR #${pr.number} to point to [${structuralTarget}]...`);

                // 4. Update the base branch via Forgejo PATCH endpoint
                const patchRes = await fetch(`${baseUrl}/repos/${owner}/${repo}/pulls/${pr.number}`, {
                    method: "PATCH",
                    headers: getHeaders(),
                    body: JSON.stringify({
                        base: structuralTarget
                    })
                });

                if (patchRes.ok) {
                    console.log(`   🎉 Successfully updated PR #${pr.number} target to: ${structuralTarget}`);
                    retargetCount++;
                } else {
                    const errDetails = await patchRes.json().catch(() => ({}));
                    console.error(`   ❌ Failed to update PR #${pr.number}:`, errDetails.message || patchRes.statusText);
                }
            }
        }

        console.log(`\n--------------------------------------------------`);
        console.log(`🏁 Complete. Automatically re-aligned ${retargetCount} stacked pull requests.`);

    } catch (err) {
        console.error("❌ Error running script:", err.message);
    }
}

autoRetargetStack();
