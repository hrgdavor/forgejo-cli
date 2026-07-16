#!/usr/bin/env bun
// red-commit.js - CLI: commit with optional Redmine note
//
// Usage:
//   bun run src/red-commit.js <message>         - git commit + add Redmine note if branch starts with number
//   bun run src/red-commit.js --hook            - git hook: push last commit message as Redmine note
//   bun run src/red-commit.js -f                - force push last commit message as Redmine note for current branch
//
// Environment variables:
//   REDMINE_URL       – Base URL of your Redmine instance (e.g. https://redmine.example.com)
//   REDMINE_API_KEY   – Your Redmine API key

import { appendRedminePrField, extractTicketFromBranch, getCurrentBranch, computeBranchConfig, postLastCommitMessage, promptChoice } from "./red-utils.js";
import { fail, info, ok, getLastCommitMessage, git } from "./utils.js";


// - Help ─────────────────────────────────────────────────────────────────────

function printHelp() {
    console.log("Usage:");
    console.log("  bun run src/red-commit.js <message>  – git commit + add Redmine note if branch starts with #");
    console.log("  bun run src/red-commit.js --hook     – git hook: push last commit message as Redmine note");
    console.log("  bun run src/red-commit.js -f         – force: push last commit message to Redmine for current branch");
    console.log("");
    console.log("Environment variables:");
    console.log("  REDMINE_URL       – Base URL of your Redmine instance (e.g. https://redmine.example.com)");
    console.log("  REDMINE_API_KEY   – Your Redmine API key");
    process.exit(0);
}

// - Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const args = Bun.argv.slice(2);

    if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
        printHelp();
    }

    const branchName = getCurrentBranch();
    const ticketFromBranch = extractTicketFromBranch(branchName);
    const { pkg } = computeBranchConfig();

    if (!ticketFromBranch) {
        info(`Branch "${branchName}" does not start with a ticket number - skipping Redmine note.`);
        process.exit(0);
    }

    // - Hook mode (git post-commit hook) ──────────────────────────────
    if (args[0] === "--hook") {
        info(`Branch "${branchName}" → Redmine issue #${ticketFromBranch}`);
        await postLastCommitMessage(pkg, ticketFromBranch, "hook");
        process.exit(0);
    }

    // - Append mode (-a) ───────────────────────────────────────────────
    if (args[0] === "-a") {
        await appendRedminePrField(pkg, ticketFromBranch, args.slice(1).join(" "));
        process.exit(0);
    }


    // - Force mode (-f) ───────────────────────────────────────────────
    if (args[0] === "-f") {
        await postLastCommitMessage(pkg, ticketFromBranch, "force");
        process.exit(0);
    }

    // - Normal mode: commit + Redmine note ───────────────────
    const message = args.join(" ");

    // Colors for terminal output
    const C_GREEN = "\x1b[32m";
    const C_YELLOW = "\x1b[33m";
    const C_RED = "\x1b[31m";
    const C_RESET = "\x1b[0m";

    // Show current status with git-style prefixes and colors
    const porcelainLines = git(["status", "--porcelain"]).stdout;
    if (porcelainLines) {
        const lines = porcelainLines.split("\n").filter(Boolean);
        console.log("\nChanges:");
        lines.forEach(line => {
            const prefix = line.slice(0, 2);
            const file = line.slice(3);
            // staged: M A D R C (first char not space)
            // unstaged: same but first char is space
            if (prefix[0] !== " " && prefix[0] !== "?" && prefix[0] !== "!") {
                console.log(`   ${C_GREEN}${prefix}${C_RESET} ${file}`);
            } else if (prefix[0] === "?" || prefix[0] === "!") {
                console.log(`   ${C_RED}${prefix}${C_RESET} ${file}`);
            } else {
                const second = prefix[1];
                const color = (second === "M" || second === "A") ? C_YELLOW : C_RED;
                console.log(`   ${color}${prefix}${C_RESET} ${file}`);
            }
        });
        console.log("");

        // Check for unstaged changes (first char is space → not staged)
        const unstaged = lines.filter(line => line.startsWith(" "));
        if (unstaged.length > 0) {
            const stageAll = await promptChoice(
                "Stage all changes before committing? (Y/n) ",
                input => input === "" || input === "y" || input === "yes"
            );
            if (stageAll) {
                const addResult = git(["add", "-A"]);
                if (addResult.exitCode !== 0) {
                    fail(`Failed to stage changes: ${addResult.stderr}`);
                }
                ok("All changes staged.");
            }
        }

        // Always ask for confirmation so the user can review what will be committed
        const confirm = await promptChoice(
            "Proceed with commit? (Y/n) ",
            input => input === "" || input === "y" || input === "yes"
        );
        if (!confirm) {
            info("Commit cancelled.");
            process.exit(0);
        }
    }

    // - Perform git commit ─────────────────────────────────────────────
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

    await appendRedminePrField(pkg, ticketFromBranch, `${pkg.redmine_pr_info_text} Commit: ${message}`);

    process.exit(0);
}

main().catch(err => {
    console.error("❌ Unexpected error:", err.message);
    process.exit(1);
});