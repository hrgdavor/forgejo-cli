#!/usr/bin/env bun
// merge-safe-prs.js
import { getRepoContext, getHeaders, fetchAllPages } from "./forgejo-utils.js";

const { baseUrl, owner, repo } = getRepoContext();

async function mergeSafePRs() {
    console.log(`🚀 Scanning and merging conflict-free PRs for ${owner}/${repo}...`);
    try {
        const prs = await fetchAllPages(`${baseUrl}/repos/${owner}/${repo}/pulls?state=open`);

        if (prs.length === 0) return console.log("✅ No open pull requests found.");

        let mergedCount = 0;

        for (const pr of prs) {
            const detailsRes = await fetch(`${baseUrl}/repos/${owner}/${repo}/pulls/${pr.number}`, { headers: getHeaders() });
            const details = await detailsRes.json();

            if (!details.mergeable) {
                console.log(`室 Skipping PR #${pr.number} due to conflicts.`);
                continue;
            }

            console.log(`🚀 Merging PR #${pr.number}: "${pr.title}"...`);
            const mergeRes = await fetch(`${baseUrl}/repos/${owner}/${repo}/pulls/${pr.number}/merge`, {
                method: "POST",
                headers: getHeaders(),
                body: JSON.stringify({
                    Do: "merge",
                    MergeMessageField: `Automated CLI merge of PR #${pr.number}`
                })
            });

            if (mergeRes.ok) {
                console.log(`🎉 PR #${pr.number} successfully merged!`);
                mergedCount++;
            } else {
                console.error(`❌ Failed to merge PR #${pr.number}.`);
            }
        }

        console.log(`\n🏁 Done! Successfully automated the merge of ${mergedCount} clean PRs.`);
    } catch (err) {
        console.error("❌ Error running script:", err.message);
    }
}

mergeSafePRs();