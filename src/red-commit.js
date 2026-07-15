#!/usr/bin/env bun
// red-commit.js - CLI: commit with optional Redmine note
//
// Usage:
//   bun run src/red-commit.js <message>         - git commit + add Redmine note if branch starts with number
//   bun run src/red-commit.js --hook            - git hook: push last commit message as Redmine note
//   bun run src/red-commit.js -f                - force push last commit message to Redmine (looks for ticket #
//                                                 in commit message first, falls back to branch name)
//
// Environment variables:
//   REDMINE_URL       – Base URL of your Redmine instance (e.g. https://redmine.example.com)
//   REDMINE_API_KEY   – Your Redmine API key

import { fail, info, ok, git } from "./utils.js";

// ── Redmine note helper ──────────────────────────────────────────────────────

/**
 * Post a note (comment) to a Redmine issue via the REST API.
 * Uses REDMINE_URL and REDMINE_API_KEY env vars.
 */
async function addRedmineNote(issueId, note) {
    const baseUrl = process.env.REDMINE_URL;
    const apiKey  = process.env.REDMINE_API_KEY;

    if (!baseUrl) fail("REDMINE_URL environment variable is missing.");
    if (!apiKey)  fail("REDMINE_API_KEY environment variable is missing.");

    const url = `${baseUrl.replace(/\/+$/, "")}/issues/${issueId}.json`;

    const res = await fetch(url, {
        method: "PUT",
        headers: {
            "X-Redmine-API-Key": apiKey,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        body: JSON.stringify({
            issue: { notes: note },
        }),
    });

    if (!res.ok) {
        const text = await res.text();
        console.error(`⚠️  Failed to add note to Redmine issue #${issueId}: ${res.status} ${text}`);
        return false;
    }
    return true;
}

// ── Help ─────────────────────────────────────────────────────────────────────

function printHelp() {
    console.log("Usage:");
    console.log("  bun run src/red-commit.js <message>  – git commit + add Redmine note if branch starts with #");
    console.log("  bun run src/red-commit.js --hook     – git hook: push last commit message as Redmine note");
    console.log("  bun run src/red-commit.js -f         – force: push last commit message to Redmine (looks for");
    console.log("                                          ticket # in commit message first, falls back to branch)");
    console.log("");
    console.log("Environment variables:");
    console.log("  REDMINE_URL       – Base URL of your Redmine instance (e.g. https://redmine.example.com)");
    console.log("  REDMINE_API_KEY   – Your Redmine API key");
    process.exit(0);
}

// ── Ticket number extraction ──────────────────────────────────────────────────

/**
 * Extract the Redmine ticket number from a branch name.
 * Returns the number as a string, or null if the branch doesn't start with a number.
 *
 * Examples:
 *   12345-fix-bug     → "12345"
 *   42                → "42"
 *   main              → null
 *   feature/xyz       → null
 */
function extractTicketFromBranch(branchName) {
    const match = branchName.match(/^(\d+)/);
    return match ? match[1] : null;
}

/**
 * Extract the Redmine ticket number from a commit message.
 * Looks for patterns like #12345 or 12345 at the start.
 * Returns the number as a string, or null.
 *
 * Examples:
 *   "#12345 fix bug"      → "12345"
 *   "12345 fix bug"       → "12345"
 *   "fix bug #12345"      → "12345"
 *   "fix bug"             → null
 */
function extractTicketFromMessage(message) {
    // Try #number pattern anywhere in the message
    const hashMatch = message.match(/#(\d+)/);
    if (hashMatch) return hashMatch[1];
    // Try leading number pattern
    const leadMatch = message.match(/^(\d+)\b/);
    if (leadMatch) return leadMatch[1];
    return null;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const args = Bun.argv.slice(2);

    if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
        printHelp();
    }

    // ── Hook mode (git post-commit hook) ──────────────────────────────
    if (args[0] === "--hook") {
        info("Running in hook mode - pushing last commit message to Redmine...");

        // Get the last commit message
        const logResult = git(["log", "-1", "--pretty=%B"]);
        if (logResult.exitCode !== 0) {
            fail(`Failed to get last commit message: ${logResult.stderr}`);
        }
        const message = logResult.stdout;
        if (!message) {
            fail("No commit message found (empty repository?).");
        }

        // Get current branch name
        const branchResult = git(["rev-parse", "--abbrev-ref", "HEAD"]);
        if (branchResult.exitCode !== 0) {
            fail(`Failed to get current branch: ${branchResult.stderr}`);
        }
        const branch = branchResult.stdout;

        // Check if branch starts with a number → Redmine ticket
        const ticketId = extractTicketFromBranch(branch);
        if (!ticketId) {
            info(`Branch "${branch}" does not start with a ticket number - skipping Redmine note.`);
            process.exit(0);
        }

        info(`Branch "${branch}" → Redmine issue #${ticketId}`);
        info(`Commit message: ${message.split("\n")[0]}`);

        const note = `Commit: ${message}`;
        const added = await addRedmineNote(ticketId, note);
        if (added) {
            ok(`Note added to Redmine issue #${ticketId}.`);
        }
        process.exit(0);
    }

    // ── Force mode (-f) ───────────────────────────────────────────────
    if (args[0] === "-f") {
        info("Running in force mode - pushing last commit message to Redmine...");

        // Get the last commit message
        const logResult = git(["log", "-1", "--pretty=%B"]);
        if (logResult.exitCode !== 0) {
            fail(`Failed to get last commit message: ${logResult.stderr}`);
        }
        const message = logResult.stdout;
        if (!message) {
            fail("No commit message found (empty repository?).");
        }

        // Get current branch name
        const branchResult = git(["rev-parse", "--abbrev-ref", "HEAD"]);
        if (branchResult.exitCode !== 0) {
            fail(`Failed to get current branch: ${branchResult.stderr}`);
        }
        const branch = branchResult.stdout;

        // Try to find ticket number: commit message first, then branch name
        let ticketId = extractTicketFromMessage(message);
        if (ticketId) {
            info(`Found ticket #${ticketId} in commit message.`);
        } else {
            ticketId = extractTicketFromBranch(branch);
            if (ticketId) {
                info(`Found ticket #${ticketId} in branch name "${branch}".`);
            }
        }

        if (!ticketId) {
            fail(`Could not find a ticket number in the commit message or branch name.`);
        }

        info(`Commit message: ${message.split("\n")[0]}`);

        const note = `Commit: ${message}`;
        const added = await addRedmineNote(ticketId, note);
        if (added) {
            ok(`Note added to Redmine issue #${ticketId}.`);
        }
        process.exit(0);
    }

    // ── Normal mode: commit + optional Redmine note ───────────────────
    const message = args.join(" ");

    // Get current branch name
    const branchResult = git(["rev-parse", "--abbrev-ref", "HEAD"]);
    if (branchResult.exitCode !== 0) {
        fail(`Failed to get current branch: ${branchResult.stderr}`);
    }
    const branch = branchResult.stdout;

    // Check if branch starts with a number → Redmine ticket
    const ticketId = extractTicketFromBranch(branch);

    if (ticketId) {
        info(`Branch "${branch}" → Redmine issue #${ticketId}`);
    }

    // ── Perform git commit ─────────────────────────────────────────────
    info(`Committing: ${message}`);

    const commitResult = git(["commit", "-m", message]);
    if (commitResult.exitCode !== 0) {
        // Check if it's just "nothing to commit" - that's not a failure
        if (commitResult.stderr.includes("nothing to commit")) {
            info("Nothing to commit - working tree clean.");
        } else {
            fail(`Git commit failed: ${commitResult.stderr}`);
        }
    } else {
        ok("Commit created.");
    }

    // ── Add Redmine note if applicable ─────────────────────────────────
    if (ticketId) {
        const note = `Commit: ${message}`;
        const added = await addRedmineNote(ticketId, note);
        if (added) {
            ok(`Note added to Redmine issue #${ticketId}.`);
        }
    } else {
        info(`Branch "${branch}" does not start with a ticket number - skipping Redmine note.`);
    }

    process.exit(0);
}

main().catch(err => {
    console.error("❌ Unexpected error:", err.message);
    process.exit(1);
});