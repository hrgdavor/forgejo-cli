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

async function main() {
    const args = Bun.argv.slice(2);
    if (args.length === 0) {
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

    const ticketNumber = args[0];

    // ── 1. Validate ticket number ──────────────────────────────────────
    if (!/^\d+$/.test(ticketNumber)) {
        fail(`"${ticketNumber}" is not a valid numeric ticket number.`);
    }

    // ── 2. Fetch ticket from Redmine to get title ──────────────────────
    info(`Fetching Redmine issue #${ticketNumber}...`);
    const issue = await fetchRedmineIssue(ticketNumber);
    const title = issue.subject;

    // ── 3. Compute branch name and check config ────────────────────────
    const branchName = `${ticketNumber}-${sanitizeBranchName(title)}`;
    const pkg = readPackageJson();
    const defaultBaseBranch = pkg.redmine_pr_default_base_branch || "main";

    // ── 4. Show summary and decide whether we're resuming ─────────────
    const currentBranch = git(["rev-parse", "--abbrev-ref", "HEAD"]).stdout;

    // If the current branch is exactly the branch this script planned to
    // create, the previous run most likely created it but failed to push it
    // (e.g. a transient network error). Treat this as a "resume": skip the
    // interactive prompts and branch creation, and jump straight to pushing
    // the branch to the remote and finishing the rest (PR + Redmine).
    const resuming = currentBranch === branchName;

    console.log("");
    console.log(`📍 Current branch : ${currentBranch}`);
    console.log(`🎫 Ticket         : #${ticketNumber} — ${title}`);
    console.log(`🌿 New branch     : ${branchName}`);
    console.log("");

    // Determine PR target: let user pick between current branch and configured default
    let prTarget = defaultBaseBranch;

    if (resuming) {
        info(
            `Branch "${branchName}" is already checked out — resuming after a failed push. ` +
            `Skipping prompts and branch creation; using default base "${defaultBaseBranch}".`
        );
    } else if (currentBranch !== defaultBaseBranch) {
        const targetChoice = await new Promise(resolve => {
            process.stdout.write(
                `🎯 Target PR at "${currentBranch}" (current) or "${defaultBaseBranch}"? [c/d] (default: d) `
            );
            process.stdin.once("data", data => {
                resolve(data.toString().trim().toLowerCase());
            });
        });

        if (targetChoice === "c" || targetChoice === "current") {
            prTarget = currentBranch;
            console.log(`   → Targeting "${currentBranch}"`);
        } else {
            console.log(`   → Targeting "${defaultBaseBranch}"`);
        }
    } else {
        console.log(`🎯 PR will target "${defaultBaseBranch}"`);
    }

    if (!resuming) {
        const confirm = await new Promise(resolve => {
            process.stdout.write("Proceed with creating branch and PR? (y/N) ");
            process.stdin.once("data", data => {
                const input = data.toString().trim().toLowerCase();
                resolve(input === "y" || input === "yes");
            });
        });

        if (!confirm) {
            console.log("Aborted.");
            process.exit(0);
        }
        console.log("");
    }

    // ── 5. Check if a branch with this ticket number already exists ────
    // (Skipped when resuming — the local branch already exists by definition.)
    if (!resuming) {
        info(`Checking for existing branches matching ticket #${ticketNumber}...`);

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

        // ── 6. Create branch ──────────────────────────────────────────
        info(`Creating branch: ${branchName} from current HEAD...`);

        // Create and switch to new branch
        const checkout = git(["checkout", "-b", branchName]);
        if (checkout.exitCode !== 0) {
            fail(`Failed to create branch "${branchName}": ${checkout.stderr}`);
        }
        ok(`Branch "${branchName}" created and checked out.`);
    } else {
        ok(`Resuming on existing branch "${branchName}".`);
    }

    // ── 7. Push branch and create PR ───────────────────────────────────
    const push = git(["push", "-u", "origin", branchName]);
    if (push.exitCode !== 0 && !resuming) {
        fail(`Failed to push branch "${branchName}": ${push.stderr}`);
    } else if (push.exitCode !== 0 && resuming) {
        // When resuming, the branch may already be tracked upstream; retry
        // without -u so an "already set up to track" error doesn't abort.
        const push2 = git(["push", "origin", branchName]);
        if (push2.exitCode !== 0) {
            fail(`Failed to push branch "${branchName}": ${push2.stderr}`);
        }
    }
    ok(`Branch pushed to origin/${branchName}.`);

    const prTitle = `#${ticketNumber} ${title}`;

    info(`Creating Pull Request: "${prTitle}"...`);
    const pr = await createPullRequest(branchName, prTitle, prTarget);
    ok(`PR #${pr.number} created: ${pr.html_url}`);

    // ── 8. Update Redmine custom field (if configured) ─────────────────
    const fieldId = pkg.redmine_pr_info_field;

    if (fieldId) {
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
    } else {
        info('No "redmine_pr_info_field" found in package.json — skipping Redmine field update.');
    }

    // ── Done ───────────────────────────────────────────────────────────
    console.log("");
    console.log("🎉 All done!");
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
