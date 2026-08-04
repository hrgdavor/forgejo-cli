#!/usr/bin/env bun
// fg-log.js - CLI: list activity logged to ~/.forgejo-cli/log
//
// Usage:
//   bun run src/fg-log.js              - show today's log, grouped by ticket (no dates)
//   bun run src/fg-log.js <N>          - show the last N days, day by day, grouped by ticket
//   bun run src/fg-log.js <N> raw      - show raw log lines for the last N days (+ log file path)
//   bun run src/fg-log.js -1           - show all log days, day by day, grouped by ticket
//   bun run src/fg-log.js -1 raw       - show all raw log lines (+ log file path)
//   bun run src/fg-log.js --help       - show help
//
// The log is written by other forgejo-cli commands (e.g. red-pr, red-commit)
// as JSON lines: { "ts": "<ISO timestamp>", "msg": "...", "ticket": "<n>"? }

import { readLogEntries, LOG_FILE } from "./util/general/logActivity.js";

function printHelp() {
    console.log("Usage:");
    console.log("  bun run src/fg-log.js              – show today's log, grouped by ticket (no dates)");
    console.log("  bun run src/fg-log.js <N>          – show the last N days, day by day, grouped by ticket");
    console.log("  bun run src/fg-log.js <N> raw      – show raw log lines for the last N days (+ log file path)");
    console.log("  bun run src/fg-log.js -1           – show all log days, day by day, grouped by ticket");
    console.log("  bun run src/fg-log.js -1 raw       – show all raw log lines (+ log file path)");
    console.log("  bun run src/fg-log.js --help       – show this help message");
    console.log("");
    console.log("The log lives at ~/.forgejo-cli/log and is written by");
    console.log("forgejo-cli commands like red-pr and red-commit.");
    process.exit(0);
}

function startOfToday() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function isToday(ts) {
    return ts && ts.slice(0, 10) === new Date().toISOString().slice(0, 10);
}

// Group entries by ticket number. Returns a Map keyed by ticket (or "" for no ticket).
function groupByTicket(entries) {
    const groups = new Map();
    for (const e of entries) {
        const key = e.ticket || "";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(e);
    }
    return groups;
}

function printGrouped(entries) {
    const groups = groupByTicket(entries);
    const keys = [...groups.keys()].sort((a, b) => {
        // tickets first (numeric), then no-ticket entries
        if (a === "") return 1;
        if (b === "") return -1;
        return Number(a) - Number(b);
    });

    for (const key of keys) {
        const items = groups.get(key);
        if (key === "") {
            // No ticket: just print lines as-is
            items.forEach(i => console.log(i.msg));
            continue;
        }
        // Prefer a PR line as the header; fall back to a checkout line
        // ("#<ticket> <title>") if present; otherwise use "#<ticket>".
        const prIdx = items.findIndex(i => /^PR #\d+/.test(i.msg));
        const checkoutIdx = prIdx < 0 ? items.findIndex(i => new RegExp(`^#${key}\\s`).test(i.msg)) : -1;
        const headerIdx = prIdx >= 0 ? prIdx : checkoutIdx;
        const header = headerIdx >= 0 ? items[headerIdx].msg : `#${key}`;
        console.log(header);
        // Print other lines (commit messages) indented under the header
        items.forEach((i, idx) => {
            if (idx !== headerIdx) console.log(`   ${i.msg}`);
        });
    }
}

function printRaw(entries) {
    entries.forEach(e => {
        if (e.ts) {
            console.log(`${e.ts} ${e.msg}`);
        } else {
            console.log(e.msg);
        }
    });
}

// Print the given entries grouped by day (newest first), each day using the
// same grouped-by-ticket format as the default today view.
function printDaysGrouped(filtered) {
    const dayMap = new Map();
    for (const e of filtered) {
        const day = e.ts ? e.ts.slice(0, 10) : "other";
        if (!dayMap.has(day)) dayMap.set(day, []);
        dayMap.get(day).push(e);
    }

    const dayKeys = [...dayMap.keys()].sort((a, b) => {
        if (a === "other") return 1;
        if (b === "other") return -1;
        return b.localeCompare(a); // newest day first
    });

    for (const day of dayKeys) {
        console.log(`\n=== ${day} ===`);
        const dayEntries = dayMap.get(day);
        if (day === "other") {
            printRaw(dayEntries); // unparseable lines: just raw
        } else {
            printGrouped(dayEntries);
        }
    }
}

function main() {
    const args = Bun.argv.slice(2);

    if (args[0] === "--help" || args[0] === "-h") {
        printHelp();
    }

    const firstArg = args[0];
    const secondArg = args[1];
    const raw = secondArg === "raw";

    // Determine the day filter
    let days = null; // null = all (-1)
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

    const entries = readLogEntries();
    if (entries.length === 0) {
        console.log("No log file found yet at ~/.forgejo-cli/log.");
        process.exit(0);
    }

    const today = startOfToday();
    const cutoff = days === null ? null : new Date(today.getTime() - (days - 1) * 86400000);

    const filtered = entries.filter(e => {
        if (!e.ts) return days === null; // keep unparseable lines only in "all" mode
        if (cutoff === null) return true; // -1 mode: everything
        const d = new Date(e.ts);
        return d >= cutoff;
    });

    if (filtered.length === 0) {
        const label = days === null ? "ever" : `the last ${days} day(s)`;
        console.log(`No log entries found for ${label}.`);
        process.exit(0);
    }

    // Default (no args): today, grouped, no day header
    if (firstArg === undefined) {
        const todayEntries = filtered.filter(e => isToday(e.ts));
        if (todayEntries.length === 0) {
            console.log("No log entries found for today.");
            process.exit(0);
        }
        printGrouped(todayEntries);
        process.exit(0);
    }

    // Raw mode: print log file path at the top, then raw lines
    if (raw) {
        console.log(`Log file: ${LOG_FILE}`);
        printRaw(filtered);
        process.exit(0);
    }

    // Multi-day / all: show each day (newest first) with the grouped format
    printDaysGrouped(filtered);
}

main();