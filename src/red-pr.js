#!/usr/bin/env bun
// red-pr.js — CLI: create a branch + PR from a Redmine ticket
//
// Usage:  bun run src/red-pr.js <ticket-number>
//
// Reads a Redmine ticket, creates a local branch named <number>-<sanitized-title>,
// pushes it, opens a Pull Request, and optionally writes the branch/PR info back
// into a Redmine custom field configured via package.json → "redmine_pr_info_field".

import { fail, info, ok, readPackageJson, sanitizeBranchName, git } from "./utils.js";
import { fetchRedmineIssue, updateRedmineField, getRedmineField, createPullRequest } from "./red-utils.js";

// ── 1. Validate ─────────────────────────────────────────────────────────────

function validateTicketNumber(ticketNumber) {
    if (!/^\d+$/.test(ticketNumber)) {
        fail(`"${ticketNumber}" is not a valid numeric ticket number.`);
    }
}

// ── 2. Fetch issue ──────────────────────────────────────────────────────────

async function fetchIssue(ticketNumber) {
    info(`Fetching Redmine issue #${ticketNumber}...`);
    const issue = await fetchRedmineIssue(ticketNumber);
    return { title: issue.subject };
}

// ── 3. Compute branch name & config ─────────────────────────────────────────

function computeBranchConfig(ticketNumber, title) {
    const branchName = `${ticketNumber}-${sanitizeBranchName(title)}`;
    const pkg = readPackageJson();
    const defaultBaseBranch = pkg.redmine_pr_default_base_branch || "main";
    return { branchName, pkg, defaultBaseBranch };
}

// ── 4. Resolve PR target + confirmation ─────────────────────────────────────

function getCurrentBranch() {
    return git(["rev-parse", "--abbrev-ref", "HEAD"]).stdout;
}

function printSummary(ticketNumber, title, branchName, currentBranch) {
    console.log("");
    console.log(`📍 Current branch : ${currentBranch}`);
    console.log(`🎫 Ticket         : #${ticketNumber} — ${title}`);
    console.log(`🌿 New branch     : ${branchName}`);
    console.log("");
}

/**
 * Let the user pick between targeting the current branch or the default base.
 * In resume mode the prompt is skipped and the default is used.
 */
async function resolvePrTarget(currentBranch, defaultBaseBranch, resuming, branchName) {
    if (resuming) {
        info(
            `Branch "${branchName}" is already checked out — resuming after a failed push. ` +
            `Skipping prompts and branch creation; using default base "${defaultBaseBranch}".`
        );
        return defaultBaseBranch;
    }

    if (currentBranch !== defaultBaseBranch) {
        const targetChoice = await promptChoice(
            `🎯 Target PR at "${currentBranch}" (current) or "${defaultBaseBranch}"? [c/d] (default: d) `,
            choice => choice === "c" || choice === "current"
        );
        if (targetChoice) {
            console.log(`   → Targeting "${currentBranch}"`);
            return currentBranch;
        } else {
            console.log(`   → Targeting "${defaultBaseBranch}"`);
            return defaultBaseBranch;
        }
    }

    console.log(`🎯 PR will target "${defaultBaseBranch}"`);
    return defaultBaseBranch;
}

async function confirmProceed(resuming) {
    if (resuming) return;
    const ok = await promptChoice(
        "Proceed with creating branch and PR? (y/N) ",
        input => input === "y" || input === "yes"
    );
    if (!ok) {
        console.log("Aborted.");
        process.exit(0);
    }
    console.log("");
}

/**
 * Prompt the user with a question and return true/false based on the matcher.
 * The matcher receives the trimmed lowercase input and returns true for a "yes".
 */
function promptChoice(question, matcher) {
    return new Promise(resolve => {
        process.stdout.write(question);
        process.stdin.once("data", data => {
            resolve(matcher(data.toString().trim().toLowerCase()));
        });
    });
}

// ── 5. Check for existing branch ────────────────────────────────────────────

function checkExistingBranch(ticketNumber) {
    // Check local branches
    const localBranches = git(["branch", "--list", "--format=%(refname:short)"]);
    const localMatch = localBranches.stdout
        .split("\n")
        .find(b => b.startsWith(ticketNumber + "-") || b === ticketNumber);

    // Check remote branches
    const remoteBranches = git(["branch", "-r", "--list", "--format=%(refname:short)"]);
    const remoteMatch = remoteBranches.stdout
        .split("\n")
        .find(b => {
            const short = b.replace(/^origin\//, "");
            return short.startsWith(ticketNumber + "-") || short === ticketNumber;
        });

    if (localMatch || remoteMatch) {
        const found = localMatch || remoteMatch;
        fail(`Branch "${found}" already exists (ticket #${ticketNumber}). Please handle manually.`);
    }

    ok(`No existing branch found for ticket #${ticketNumber}.`);
}

// ── 6. Create branch ────────────────────────────────────────────────────────

function createBranch(branchName) {
    const checkout = git(["checkout", "-b", branchName]);
    if (checkout.exitCode !== 0) {
        fail(`Failed to create branch "${branchName}": ${checkout.stderr}`);
    }
    ok(`Branch "${branchName}" created and checked out.`);
}

// ── 7. Push branch + create PR ──────────────────────────────────────────────

function pushBranch(branchName) {
    const push = git(["push", "-u", "origin", branchName]);
    if (push.exitCode !== 0) {
        fail(`Failed to push branch "${branchName}": ${push.stderr}`);
    }
    ok(`Branch pushed to origin/${branchName}.`);
}

function retryPushBranch(branchName) {
    // The branch may already be tracked upstream; retry without -u so an
    // "already set up to track" error doesn't abort.
    const push = git(["push", "origin", branchName]);
    if (push.exitCode !== 0) {
        fail(`Failed to push branch "${branchName}": ${push.stderr}`);
    }
    ok(`Branch pushed to origin/${branchName}.`);
}

async function createPullRequestForTicket(branchName, ticketNumber, title, prTarget) {
    const prTitle = `#${ticketNumber} ${title}`;
    const pr = await createPullRequest(branchName, prTitle, prTarget);
    ok(`PR #${pr.number} created: ${pr.html_url}`);
    return pr;
}

// ── 8. Update Redmine custom field ──────────────────────────────────────────

async function updateRedminePrField(pkg, ticketNumber, branchName, pr) {
    const fieldId = pkg.redmine_pr_info_field;
    if (!fieldId) {
        info('No "redmine_pr_info_field" found in package.json — skipping Redmine field update.');
        return;
    }

    const prLink = pr.html_url;
    const newEntry = `${branchName} | ${prLink}`;

    // Read existing value to append
    const existingValue = await getRedmineField(ticketNumber, fieldId);
    let fieldValue;

    if (existingValue) {
        // If existing text doesn't end with newline, add a newline separator
        const separator = existingValue.endsWith("\n") ? "" : "\n";
        // If redmine_pr_info_text is configured, prepend it to the new entry
        const prefix = pkg.redmine_pr_info_text || "";
        const appended = prefix ? `${prefix} ${newEntry}` : newEntry;
        fieldValue = `${existingValue}${separator}${appended}`;
    } else {
        // First entry — just use the new content (with optional prefix)
        fieldValue = pkg.redmine_pr_info_text
            ? `${pkg.redmine_pr_info_text} ${newEntry}`
            : newEntry;
    }

    const updated = await updateRedmineField(ticketNumber, fieldId, fieldValue);
    if (updated) {
        ok(`Redmine custom field #${fieldId} updated.`);
    }
}

// ── Help ────────────────────────────────────────────────────────────────────

function printHelp() {
    console.log("Usage: bun run src/red-pr.js <ticket-number>");
    console.log("");
    console.log("Environment variables:");
    console.log("  REDMINE_URL       – Base URL of your Redmine instance (e.g. https://redmine.example.com)");
    console.log("  REDMINE_API_KEY   – Your Redmine API key");
    console.log("  FORGEJO_TOKEN     – Forgejo/Gitea personal access token");
    console.log("");
    console.log("Optional package.json properties:");
    console.log('  "redmine_pr_info_field"              – numeric ID of a Redmine custom field to update with branch/PR info');
    console.log('  "redmine_pr_info_text"               – optional text prefix for each new entry (e.g. "[PR]")');
    console.log('  "redmine_pr_default_base_branch"     – default target branch for the PR (default: "main")');
    process.exit(0);
}

// ── Print final summary ─────────────────────────────────────────────────────

function printDone(branchName, pr, fieldId) {
    console.log("");
    console.log("🎉 All done!");
    console.log(`   Branch : ${branchName}`);
    console.log(`   PR     : ${pr.html_url}`);
    if (fieldId) {
        console.log(`   Redmine field #${fieldId} updated.`);
    }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
    const args = Bun.argv.slice(2);
    if (args.length === 0) {
        printHelp();
    }

    const ticketNumber = args[0];

    validateTicketNumber(ticketNumber);

    const { title } = await fetchIssue(ticketNumber);

    const { branchName, pkg, defaultBaseBranch } = computeBranchConfig(ticketNumber, title);

    const currentBranch = getCurrentBranch();
    printSummary(ticketNumber, title, branchName, currentBranch);

    const resuming = currentBranch === branchName;
    const prTarget = await resolvePrTarget(currentBranch, defaultBaseBranch, resuming, branchName);
    await confirmProceed(resuming);

    if (!resuming) {
        checkExistingBranch(ticketNumber);
    }

    if (!resuming) {
        createBranch(branchName);
    } else {
        ok(`Resuming on existing branch "${branchName}".`);
    }

    if (!resuming) {
        pushBranch(branchName);
    } else {
        retryPushBranch(branchName);
    }
    const pr = await createPullRequestForTicket(branchName, ticketNumber, title, prTarget);

    const fieldId = pkg.redmine_pr_info_field;
    await updateRedminePrField(pkg, ticketNumber, branchName, pr);

    printDone(branchName, pr, fieldId);

    // Explicitly exit so the process doesn't hang waiting on stdin
    // (the "data" listeners registered above keep the event loop alive).
    process.exit(0);
}

main().catch(err => {
    console.error("❌ Unexpected error:", err.message);
    process.exit(1);
});