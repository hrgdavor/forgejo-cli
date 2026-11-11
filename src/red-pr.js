#!/usr/bin/env bun
// red-pr.js - CLI: create a branch + PR from a Redmine ticket
//
// Usage:  bun run src/red-pr.js <ticket-number>
//
// Reads a Redmine ticket, creates a local branch named
//   <TYPE>-<number>-<sanitized-title>  (when a ticket type is mapped)
// or the legacy
//   <number>-<sanitized-title>         (when no type is mapped or tracker is absent)
// , pushes it, opens a Pull Request, and optionally writes the branch/PR info back
// into a Redmine custom field configured via package.json → "redmine_pr_info_field".
//
// The <TYPE> prefix is derived from the issue's tracker via the optional
// package.json key "redmine_ticket_types" (map of Redmine tracker name → prefix).
// Example:
//   "redmine_ticket_types": { "Bug": "BUG", "Feature": "FEATURE", "Task": "TASK" }

import { fail, info, ok } from "./utils.js";
import { truncateAtWordBoundary } from "./util/general/truncateAtWordBoundary.js";
import { logActivity, hasPrActivityForTicketToday } from "./util/general/logActivity.js";
import {
    fetchRedmineIssue, createPullRequest, computeBranchConfig, computeBranchName, resolveTicketType,
    validateTicketNumber, getCurrentBranch, promptChoice,
    findExistingBranchForTicket, createBranch, pushBranch, retryPushBranch,
    prInfoText, appendRedminePrField, getRedmineConfig,
    checkForgejoAvailability, findPrForBranch, findOpenPrForTicket, checkoutBranch, hasUncommittedChanges
} from "./red-utils.js";


// - Help ────────────────────────────────────────────────────────────────────

function printHelp() {
    console.log("Usage: bun run src/red-pr.js <ticket-number>");
    console.log("");
    console.log("Secrets (env var → ~/.forgejo-cli.env → OS vault):");
    console.log("  REDMINE_URL       - Base URL of your Redmine instance (e.g. https://redmine.example.com)");
    console.log("  REDMINE_API_KEY   - Your Redmine API key");
    console.log("  FORGEJO_TOKEN     - Forgejo/Gitea personal access token");
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
    console.log('  "redmine_pr_info_field"              - numeric ID of a Redmine custom field to update with branch/PR info');
    console.log('  "redmine_pr_info_text"               - optional text prefix for each new entry (e.g. "[PR]")');
    console.log('  "redmine_pr_default_base_branch"     - default target branch for the PR (default: "main")');
    console.log('  "redmine_pr_title_max"               - max PR title length, cuts at word boundaries (default: 80)');
    console.log('  "redmine_ticket_types"               - map of Redmine tracker name → branch prefix (e.g. { "Bug": "BUG" })');
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

    const forgejoAvailable = await checkForgejoAvailability();
    if (!forgejoAvailable) {
        fail("Forgejo is not reachable - cannot create a Pull Request. Aborting.");
    }

    const { pkg, defaultBaseBranch } = computeBranchConfig();
    const ticketType = resolveTicketType(issue);
    const branchName = computeBranchName(ticketNumber, title, ticketType);

    const currentBranch = getCurrentBranch();

    console.log("");
    console.log(`📍 Current branch : ${currentBranch}`);
    console.log(`🎫 Ticket         : #${ticketNumber} - ${title}${ticketType ? ` [${ticketType}]` : ""}`);
    console.log(`🌿 New branch     : ${branchName}`);
    console.log("");

    // If an open PR already exists for this ticket/branch, offer to switch to it
    // instead of creating a duplicate branch/PR. Match by computed branch name
    // and by ticket number in head branch (title/type may have changed).
    const existingPr = await findPrForBranch(branchName) || await findOpenPrForTicket(ticketNumber);
    if (existingPr) {
        const existingBranch = existingPr.head?.ref || branchName;
        info(`PR #${existingPr.number} already exists for branch "${existingBranch}".`);
        if (currentBranch === existingBranch) {
            ok(`Already on branch "${existingBranch}".`);
            console.log(`   PR     : ${existingPr.html_url}`);
            process.exit(0);
        }
        if (hasUncommittedChanges()) {
            console.log("⚠️  Uncommitted changes in the working tree - cannot switch branches.");
            console.log("   Commit or stash them, then re-run to switch to the PR branch.");
            process.exit(0);
        }
        const switchToPr = await promptChoice(
            `Switch to branch "${existingBranch}"? (y/N) `,
            input => input === "y" || input === "yes"
        );
        if (switchToPr) {
            checkoutBranch(existingBranch);
            if (!hasPrActivityForTicketToday(ticketNumber)) {
                logActivity(`#${ticketNumber} ${title}`, ticketNumber);
            }
            console.log("");
            console.log("Done! 🎉");
            console.log(`   Branch : ${existingBranch}`);
            console.log(`   PR     : ${existingPr.html_url}`);
            process.exit(0);
        }
        console.log("Aborted (PR already exists).");
        process.exit(0);
    }

    let prTarget = defaultBaseBranch;

    if (currentBranch === branchName) { // resuming
        ok(`Already on branch "${branchName}".`);
        process.exit(0);
    } else {
        const { local, remote } = findExistingBranchForTicket(ticketNumber, branchName);
        const foundBranch = local || remote || null;

        if (foundBranch) {
            const targetBranch = local || remote.replace(/^origin\//, "");
            info(`Branch "${foundBranch}" already exists for ticket #${ticketNumber} (no open PR found).`);
            if (currentBranch === targetBranch) {
                ok(`Already on branch "${targetBranch}".`);
                process.exit(0);
            }
            if (hasUncommittedChanges()) {
                console.log("⚠️  Uncommitted changes in the working tree - cannot switch branches.");
                console.log("   Commit or stash them, then re-run to switch to the branch.");
                process.exit(0);
            }
            const switchToBranch = await promptChoice(
                `Switch to branch "${targetBranch}"? (y/N) `,
                input => input === "y" || input === "yes"
            );
            if (switchToBranch) {
                checkoutBranch(targetBranch);
                console.log("");
                console.log(`Switched to existing branch "${targetBranch}".`);
                console.log("Create a PR manually if needed, or re-run after pushing.");
                process.exit(0);
            }
            console.log("Aborted.");
            process.exit(0);
        }

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

        createBranch(branchName);
        pushBranch(branchName);
    }

    const maxTitleLen = pkg.redmine_pr_title_max || 80;
    // Prefix with the ticket type (e.g. "BUG:") when resolved — the leading
    // "TYPE:" pattern is what many editors/CI highlight as a special commit
    // type (conventional-commit style). Falls back to the legacy
    // "<number> <title>" form when no type is mapped.
    const typePart = ticketType ? `${ticketType}: ` : "";
    const prTitle = truncateAtWordBoundary(`${typePart}${ticketNumber} ${title}`, maxTitleLen);
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