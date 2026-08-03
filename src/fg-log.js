#!/usr/bin/env bun
// fg-log.js - CLI: list activity logged to ~/.forgejo-cli/log
//
// Usage:
//   bun run src/fg-log.js          - show log lines from today
//   bun run src/fg-log.js <N>      - show log lines from the last N days (default: 1)
//   bun run src/fg-log.js -1       - show all log lines
//   bun run src/fg-log.js --help   - show help
//
// The log is written by other forgejo-cli commands (e.g. red-pr, red-commit),
// each line prefixed with "YYYY-MM-DD HH:MM:SS ".

import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const LOG_FILE = join(homedir(), ".forgejo-cli", "log");

function printHelp() {
    console.log("Usage:");
    console.log("  bun run src/fg-log.js        – show log lines from today");
    console.log("  bun run src/fg-log.js <N>    – show log lines from the last N days (default: 1)");
    console.log("  bun run src/fg-log.js -1     – show all log lines");
    console.log("  bun run src/fg-log.js --help – show this help message");
    console.log("");
    console.log("The log lives at ~/.forgejo-cli/log and is written by");
    console.log("forgejo-cli commands like red-pr and red-commit.");
    process.exit(0);
}

function parseTimestamp(line) {
    // Expected prefix: "YYYY-MM-DD HH:MM:SS "
    const match = line.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) /);
    if (!match) return null;
    const [, y, mo, d, h, mi, s] = match.map(Number);
    return new Date(y, mo - 1, d, h, mi, s);
}

function startOfToday() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function main() {
    const args = Bun.argv.slice(2);

    if (args[0] === "--help" || args[0] === "-h") {
        printHelp();
    }

    // Determine the day filter
    let days = null; // null = all
    const firstArg = args[0];
    if (firstArg !== undefined) {
        const parsed = Number(firstArg);
        if (Number.isNaN(parsed)) {
            console.error(`❌ Invalid days parameter: "${firstArg}"`);
            process.exit(1);
        }
        days = parsed === -1 ? null : parsed;
        if (days !== null && days < 1) {
            console.error("❌ Days must be a positive number, or -1 for all log lines.");
            process.exit(1);
        }
    }

    if (!existsSync(LOG_FILE)) {
        console.log("No log file found yet at ~/.forgejo-cli/log.");
        process.exit(0);
    }

    const lines = readFileSync(LOG_FILE, "utf-8").split("\n").filter(Boolean);

    const today = startOfToday();
    const cutoff = days === null ? null : new Date(today.getTime() - (days - 1) * 86400000);

    const filtered = lines.filter(line => {
        const ts = parseTimestamp(line);
        if (!ts) return days === null; // keep unparseable lines only in "all" mode
        if (cutoff === null) return true; // -1 mode: everything
        return ts >= cutoff;
    });

    if (filtered.length === 0) {
        const label = days === null ? "ever" : `the last ${days} day(s)`;
        console.log(`No log entries found for ${label}.`);
        process.exit(0);
    }

    filtered.forEach(line => console.log(line));
}

main();