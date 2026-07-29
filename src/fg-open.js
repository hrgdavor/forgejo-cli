#!/usr/bin/env bun
// fg-open.js - CLI: open current branch or its PR in the browser
//
// Usage:
//   bun run src/fg-open.js              - open PR if branch has one, else open branch
//   bun run src/fg-open.js --help       - show help
//
// Reads the current git branch, checks if there's an open PR for it,
// and opens the appropriate URL in your default browser.

import { spawnSync } from "bun";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getRepoContext, getHeaders } from "./forgejo-utils.js";
import { info, fail, openBrowser } from "./utils.js";


// - Help ────────────────────────────────────────────────────────────────────

function printHelp() {
    console.log("Usage:");
    console.log("  bun run src/fg-open.js              – open PR for current branch, or branch if no PR");
    console.log("  bun run src/fg-open.js --help       – show this help message");
    console.log("");
    console.log("Environment variables:");
    console.log("  FORGEJO_TOKEN  – Forgejo/Gitea personal access token");
    process.exit(0);
}


// - Git helpers ─────────────────────────────────────────────────────────────

function getCurrentBranch() {
    const result = spawnSync(["git", "branch", "--show-current"]);
    if (result.exitCode !== 0) {
        fail("Not a git repository or unable to read current branch.");
    }
    const branch = result.stdout.toString().trim();
    if (!branch) {
        fail("Not on any branch (detached HEAD). Check out a branch first.");
    }
    return branch;
}


// - Main ────────────────────────────────────────────────────────────────────

async function main() {
    const args = Bun.argv.slice(2);

    if (args[0] === "--help" || args[0] === "-h") {
        printHelp();
    }

    info("Reading current branch...");
    const branchName = getCurrentBranch();

    info(`Current branch: "${branchName}".`);

    const { baseUrl, owner, repo } = getRepoContext();

    let prUrl = null;

    // Fast path: if this is the default base branch, it's definitely not a PR
    const pkgPath = join(process.cwd(), "package.json");
    let defaultBaseBranch = null;
    if (existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
            defaultBaseBranch = pkg.redmine_pr_default_base_branch || null;
        } catch (_) {}
    }
    if (defaultBaseBranch && branchName === defaultBaseBranch) {
        info(`Branch "${branchName}" is the default base branch — opening directly.`);
    } else {
        info(`Searching for PR on branch "${branchName}"...`);
        const ticketMatch = branchName.match(/^(\d+)/);
        const ticketNumber = ticketMatch ? ticketMatch[1] : null;

        const headers = getHeaders(true);
        const apiUrl = (path) => `${baseUrl}${path}`;

        try {
            // Fast path: search open PRs (single request, large limit)
            let start = Date.now();
            let res = await fetch(apiUrl(`/repos/${owner}/${repo}/pulls?state=open&sort=recentupdate&limit=100`), { headers });
            let prs = res.ok ? await res.json() : [];
            info(`Found ${prs.length} open PR(s) in ${Date.now() - start}ms.`);

            let matchingPr = prs.find(pr => pr.head && (pr.head.ref === branchName || pr.head.label === branchName));
            let matchMethod = matchingPr ? "exact" : null;

            if (!matchingPr) {
                // Check closed PRs (single request, head label filter is precise)
                start = Date.now();
                info(`No match in open PRs, checking closed PRs...`);
                res = await fetch(apiUrl(`/repos/${owner}/${repo}/pulls?state=closed&head=${encodeURIComponent(branchName)}&sort=recentupdate&limit=100`), { headers });
                prs = res.ok ? await res.json() : [];
                info(`  Fetched ${prs.length} closed PR(s) in ${Date.now() - start}ms.`);

                matchingPr = prs.find(pr => pr.head && (pr.head.label === branchName || pr.head.ref === branchName));
                if (matchingPr) {
                    matchMethod = "head.label (closed)";
                }
            }

            if (matchingPr) {
                const host = baseUrl.replace("/api/v1", "");
                const stateLabel = matchingPr.state === "closed" ? " (closed)" : "";
                prUrl = `${host}/${owner}/${repo}/pulls/${matchingPr.number}`;
                info(`Found PR #${matchingPr.number}${stateLabel}: ${matchingPr.title} (match: ${matchMethod})`);
            } else {
                info(`No PR found with head branch "${branchName}".`);
            }
        } catch (err) {
            info(`Could not check for PR (${err.message}), opening branch directly.`);
        }
    }


    // Build the branch URL on the remote host
    const host = baseUrl.replace("/api/v1", "");
    const url = prUrl || `${host}/${owner}/${repo}/src/branch/${encodeURIComponent(branchName)}`;

    info(`Opening ${url} in your default browser...`);

    try {
        openBrowser(url);
    } catch (err) {
        fail(`Failed to open browser: ${err.message}`);
    }
}

main().catch(err => {
    console.error("❌ Unexpected error:", err.message);
    process.exit(1);
});