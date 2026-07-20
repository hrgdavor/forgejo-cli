#!/usr/bin/env bun
// red-open.js - CLI: open current Redmine ticket from branch name
//
// Usage:
//   bun run src/red-open.js              - open ticket from current branch
//   bun run src/red-open.js --help       - show help
//
// Reads the current git branch, extracts the ticket number (branch must start with a digit),
// and opens https://<REDMINE_URL>/issues/<ticket> in your default browser.

import { getCurrentBranch, extractTicketFromBranch, getRedmineConfig } from "./red-utils.js";
import { info, fail, openBrowser } from "./utils.js";


// - Help ────────────────────────────────────────────────────────────────────

function printHelp() {
    console.log("Usage:");
    console.log("  bun run src/red-open.js              – open ticket from current branch");
    console.log("  bun run src/red-open.js --help       – show this help message");
    console.log("");
    console.log("Secrets (env var → ~/.forgejo-cli.env → OS vault):");
    console.log("  REDMINE_URL       – Base URL of your Redmine instance (e.g. https://redmine.example.com)");
    console.log("  REDMINE_API_KEY   – Your Redmine API key (used for validation if needed)");
    console.log("");
    console.log("To provide secrets:");
    console.log("  1. Export them as environment variables");
    console.log("  2. Add to ~/.forgejo-cli.env (KEY=VALUE, one per line)");
    console.log("  3. Store in your OS vault:");
    console.log('       Windows: cmdkey /generic:SERVICE_NAME /user:%USERNAME% /pass:YOUR_TOKEN');
    console.log('       macOS:   security add-generic-password -a "$USER" -s SERVICE_NAME -w YOUR_TOKEN');
    console.log('       Linux:   secret-tool store --label="SERVICE_NAME" service SERVICE_NAME username "$USER"');
    console.log('     Service names: redmine-url, redmine-api-token');
    process.exit(0);
}


// - Main ────────────────────────────────────────────────────────────────────

async function main() {
    const args = Bun.argv.slice(2);

    if (args[0] === "--help" || args[0] === "-h") {
        printHelp();
    }

    info("Reading current branch...");
    const branchName = getCurrentBranch();
    const ticketNumber = extractTicketFromBranch(branchName);

    if (!ticketNumber) {
        fail(`Branch "${branchName}" does not start with a ticket number. 
              This script expects branches named like '12345-fix-bug'.`);
        process.exit(0);
    }

    info(`Found ticket #${ticketNumber} in branch "${branchName}".`);

    const { baseUrl } = getRedmineConfig(true); // GUI-friendly mode: no crash if secret missing
    if (!baseUrl) {
        fail(`REDMINE_URL not found. Set it as an environment variable or add to ~/.forgejo-cli.env`);
        process.exit(0);
    }

    const url = `${baseUrl}/issues/${ticketNumber}`;
    info(`Opening ${url} in your default browser...`);

    try {
        openBrowser(url);
    } catch (err) {
        fail(`Failed to open browser: ${err.message}`);
        process.exit(1);
    }
}

main().catch(err => {
    console.error("❌ Unexpected error:", err.message);
    process.exit(1);
});
