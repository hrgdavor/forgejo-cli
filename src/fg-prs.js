#!/usr/bin/env bun
// list-prs.js
import { getRepoContext, getHeaders, fetchAllPages } from "./forgejo-utils.js";

const { baseUrl, owner, repo } = getRepoContext();

// Check if the user passed an argument to run status verification
const args = Bun.argv.slice(2);
const shouldCheckConflicts = args.includes("--check") || args.includes("-c");

if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage:");
    console.log("  bun run src/fg-prs.js              – list open PRs in branch hierarchy tree");
    console.log("  bun run src/fg-prs.js --check      – append ✅ mergeable / ❌ conflict status");
    console.log("  bun run src/fg-prs.js --help       – show this help message");
    console.log("");
    console.log("Flags:");
    console.log("  --check, -c    Check mergeable state via API (slower, hits each PR endpoint)");
    console.log("");
    console.log("Environment variables:");
    console.log("  FORGEJO_TOKEN  – Forgejo/Gitea personal access token");
    process.exit(0);
}

async function listPRsTree() {
    console.log(`🔍 Fetching open PRs for ${owner}/${repo}...`);
    try {
        const prs = await fetchAllPages(`${baseUrl}/repos/${owner}/${repo}/pulls?state=open`);

        if (prs.length === 0) {
            console.log("✅ No open pull requests.");
            return;
        }

        if (shouldCheckConflicts) {
            console.log(`📊 Found ${prs.length} open PRs. Auditing conflict states...\n`);
        } else {
            console.log(`📊 Found ${prs.length} open PRs. Building branch hierarchy tree...\n`);
        }

        // 1. Group PRs by their destination (base) branch
        const baseToPrsMap = {};
        const childBranches = new Set();
        const allBaseBranches = new Set();

        prs.forEach(pr => {
            const base = pr.base.ref;
            const head = pr.head.ref;

            if (!baseToPrsMap[base]) {
                baseToPrsMap[base] = [];
            }
            baseToPrsMap[base].push(pr);

            childBranches.add(head);
            allBaseBranches.add(base);
        });

        // 2. Identify "Root" branches
        const rootBranches = Array.from(allBaseBranches).filter(base => !childBranches.has(base));
        const finalRoots = rootBranches.length > 0 ? rootBranches : Array.from(allBaseBranches);

        let ok = 0, bad = 0;

        // 3. Recursive tree printer function
        async function printBranchNode(branchName, prefix = "") {
            const associatedPrs = baseToPrsMap[branchName] || [];

            for (let i = 0; i < associatedPrs.length; i++) {
                const pr = associatedPrs[i];
                const isLast = i === associatedPrs.length - 1;
                const pointer = isLast ? "└──" : "├──";

                let statusIcon = "";

                // Only touch individual PR endpoints if the user asked for it
                if (shouldCheckConflicts) {
                    const detailsRes = await fetch(`${baseUrl}/repos/${owner}/${repo}/pulls/${pr.number}`, { headers: getHeaders() });
                    const details = await detailsRes.json();

                    if (details.mergeable) {
                        statusIcon = "✅ ";
                        ok++;
                    } else {
                        statusIcon = "❌ ";
                        bad++;
                    }
                }

                // Render the clean visual output matching your format
                console.log(`${prefix}${pointer} ${statusIcon}#${pr.number}  ${pr.head.ref} : ${pr.title}`);

                // If this PR's source branch is also a base branch for other PRs, recurse down
                if (baseToPrsMap[pr.head.ref]) {
                    const nextPrefix = prefix + (isLast ? "        " : "│       ");
                    await printBranchNode(pr.head.ref, nextPrefix);
                }
            }
        }

        // 4. Execute rendering loop over recognized roots
        for (const root of finalRoots) {
            console.log(`🌿 ${root}`);
            await printBranchNode(root);
            console.log("");
        }

        // Summary footer prints out only when validating conflict status
        if (shouldCheckConflicts) {
            console.log(`--------------------------------------------------`);
            console.log(`🏁 Total Checked: ${ok + bad} | ❌ Conflicts: ${bad} | ✅ Clear: ${ok}`);
        }

    } catch (err) {
        console.error("❌ Error running script:", err.message);
    }
}

listPRsTree();