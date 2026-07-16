#!/usr/bin/env bun
// red-pr.js - CLI: create a branch + PR from a Redmine ticket
//
// Usage:  bun run src/red-pr.js <ticket-number>
//
// Reads a Redmine ticket, creates a local branch named <number>-<sanitized-title>,
// pushes it, opens a Pull Request, and optionally writes the branch/PR info back
// into a Redmine custom field configured via package.json → "redmine_pr_info_field".

import { fail, info, ok } from "./utils.js";
import {
    fetchRedmineIssue, createPullRequest, computeBranchConfig, computeBranchName,
    validateTicketNumber, getCurrentBranch, promptChoice,
    checkExistingBranch, createBranch, pushBranch, retryPushBranch,
    prInfoText, appendRedminePrField, getRedmineConfig
} from "./red-utils.js";


// - Help ────────────────────────────────────────────────────────────────────

function printHelp() {
    console.log("Usage: bun run src/red-pr.js <ticket-number>");
    console.log("");
    console.log("Secrets (env var → ~/.forgejo-cli.env → OS vault):");
    console.log("  REDMINE_URL       – Base URL of your Redmine instance (e.g. https://redmine.example.com)");
    console.log("  REDMINE_API_KEY   – Your Redmine API key");
    console.log("  FORGEJO_TOKEN     – Forgejo/Gitea personal access token");
    console.log("");
    console.log("To provide secrets:");
    console.log("  1. Export them as environment variables");
    console.log("  2. Add to ~/.forgejo-cli.env (KEY=VALUE, one per line)");
    console.log("  3. Store in your OS vault:");
    console.log('       Windows: cmdkey /generic:SERVICE_NAME /user:%USERNAME% /pass:YOUR_TOKEN');
    console.log('       macOS:   security add-generic-password -a "$USER" -s SERVICE_NAME -w YOUR_TOKEN');
    console.log('       Linux:   secret-tool store --label="SERVICE_NAME" service SERVICE_NAME username "$USER"');
    console.log('     Service names: redmine-url, redmine-api-token, forgejo-token');
    console.log("");
    console.log("Optional package.json properties:");
    console.log('  "redmine_pr_info_field"              – numeric ID of a Redmine custom field to update with branch/PR info');
    console.log('  "redmine_pr_info_text"               – optional text prefix for each new entry (e.g. "[PR]")');
    console.log('  "redmine_pr_default_base_branch"     – default target branch for the PR (default: "main")');
    process.exit(0);
}


// - Main ────────────────────────────────────────────────────────────────────

async function main() {
    const args = Bun.argv.slice(2);
    if (args.length === 0) {
        printHelp();
    }

    const ticketNumber = args[0];
    validateTicketNumber(ticketNumber);

    info(`Fetching Redmine issue #${ticketNumber}...`);
    const issue = await fetchRedmineIssue(ticketNumber);
    const title = issue.subject;

    const branchName = computeBranchName(ticketNumber, title);
    const { pkg, defaultBaseBranch } = computeBranchConfig();

    const currentBranch = getCurrentBranch();

    console.log("");
    console.log(`📍 Current branch : ${currentBranch}`);
    console.log(`🎫 Ticket         : #${ticketNumber} - ${title}`);
    console.log(`🌿 New branch     : ${branchName}`);
    console.log("");

    let prTarget = defaultBaseBranch;

    if (currentBranch === branchName) { // resuming
        info(
            `Branch "${branchName}" is already checked out - resuming after a failed push. ` +
            `Skipping prompts and branch creation; using default base "${defaultBaseBranch}".`
        );
        ok(`Resuming on existing branch "${branchName}".`);
        retryPushBranch(branchName);
    } else {
        if (currentBranch !== defaultBaseBranch) {
            const targetChoice = await promptChoice(
                `🎯 Target PR at "${currentBranch}" (current) or "${defaultBaseBranch}"? [c/d] (default: d) `,
                choice => choice === "c" || choice === "current"
            );
            if (targetChoice) {
                console.log(`   → Targeting "${currentBranch}"`);
                prTarget = currentBranch;
            } else {
                console.log(`   → Targeting "${defaultBaseBranch}"`);
            }
        } else {
            console.log(`🎯 PR will target "${defaultBaseBranch}"`);
        }

        const proceed = await promptChoice(
            "Proceed with creating branch and PR? (y/N) ",
            input => input === "y" || input === "yes"
        );
        if (!proceed) {
            console.log("Aborted.");
            process.exit(0);
        }
        console.log("");

        checkExistingBranch(ticketNumber);
        createBranch(branchName);
        pushBranch(branchName);
    }
    
    const prTitle = `${ticketNumber} ${title}`;
    const ticketUrl = `${getRedmineConfig().baseUrl}/issues/${ticketNumber}`;
    const prBody = `Closes #${ticketNumber}\n\n${ticketUrl}`;
    const pr = await createPullRequest(branchName, prTitle, prTarget, prBody);
    ok(`PR #${pr.number} created: ${pr.html_url}`);

    const fieldId = pkg.redmine_pr_info_field;
    await appendRedminePrField(pkg, ticketNumber, prInfoText(pkg, branchName, pr));

    console.log("");
    console.log("All done! 🎉");
    console.log(`   Branch : ${branchName}`);
    console.log(`   PR     : ${pr.html_url}`);
    if (fieldId) {
        console.log(`   Redmine field #${fieldId} updated.`);
    }

    // Explicitly exit so the process doesn't hang waiting on stdin
    // (the "data" listeners registered above keep the event loop alive).
    process.exit(0);
}

main().catch(err => {
    console.error("❌ Unexpected error:", err.message);
    process.exit(1);
});