#!/usr/bin/env bun
// fg-prefix.js - Add, change or remove the WIP prefix on one or more pull requests
//
// Usage:
//   bun run src/fg-prefix.js <prefix> <PR> [PR...]
//   bun run src/fg-prefix.js - <PR> [PR...]            remove the prefix
//
// PR numbers may be given comma-delimited (123,456) and/or as separate
// arguments; both forms can be mixed.
//
// Forgejo derives "work in progress" purely from the PR title prefix, so this
// is the only way to flip a PR between draft and ready-for-review. Removing
// the prefix makes the PR mergeable again.

import { getRepoContext, getHeaders, fetchAllPages } from "./forgejo-utils.js";
import { fail, info, ok } from "./utils.js";

const { baseUrl, owner, repo } = getRepoContext();

const REMOVE_ALIASES = new Set(["-", "--remove", "remove", "none", "ready"]);

// A prefix is a run of letters/digits at the very start of the title with a
// colon immediately after it. Anything with a space or punctuation inside is
// not a prefix, so a colon elsewhere in the title is never touched.
const PREFIX_RE = /^([\p{L}\p{N}]+):[ \t]*/u;
// A purely numeric "prefix" is always something else ("10:30 standup"),
// so require at least one letter before treating it as a prefix.
const PREFIX_TOKEN_RE = /^[\p{L}\p{N}]+$/u;
const HAS_LETTER_RE = /\p{L}/u;

function printHelp() {
    console.log("Usage:");
    console.log("  bun run src/fg-prefix.js <prefix> <PR> [PR...]   Add or replace the prefix (e.g. WIP:, W:)");
    console.log("  bun run src/fg-prefix.js - <PR> [PR...]           Remove the prefix (mark ready for review)");
    console.log("  bun run src/fg-prefix.js <prefix> --all           Apply to every open PR");
    console.log("  bun run src/fg-prefix.js --help                   Show this help message");
    console.log("");
    console.log("PR numbers accept both comma-delimited (123,456) and separate-argument forms,");
    console.log("and the two can be mixed:  fg-prefix.js W: 12,34 56");
    console.log("");
    console.log("Flags:");
    console.log("  -n, --dry-run          Print the resulting titles without patching");
    console.log("  --all                  Operate on every open PR");
    console.log("  -h, --help             Show this help");
    console.log("");
    console.log("A prefix is a run of letters/digits at the start of the title followed");
    console.log("immediately by a colon, so 'WIP:', 'W:', 'Draft:' are prefixes while a");
    console.log("colon later in the title is not.");
    console.log("");
    console.log("A prefix given without a trailing colon gets one appended: 'WIP' becomes 'WIP:'.");
    console.log("");
    console.log("Environment variables:");
    console.log("  FORGEJO_TOKEN  - Forgejo/Gitea personal access token");
    process.exit(0);
}

// "WIP" -> "WIP:", "W:" -> "W:", "[WIP]" is rejected (not letters/digits only)
function normalizePrefix(raw) {
    const trimmed = raw.trim();
    const token = trimmed.endsWith(":") ? trimmed.slice(0, -1) : trimmed;
    if (!PREFIX_TOKEN_RE.test(token) || !HAS_LETTER_RE.test(token)) {
        fail(`Invalid prefix "${raw}". Expected letters/digits immediately followed by a colon, e.g. "WIP:" or "W".`);
    }
    return `${token}:`;
}

// Returns the title with a leading prefix and its trailing whitespace removed
function stripPrefix(title) {
    const match = PREFIX_RE.exec(title);
    if (match && HAS_LETTER_RE.test(match[1])) {
        return { rest: title.slice(match[0].length).trim(), prefix: `${match[1]}:` };
    }
    return { rest: title.trimStart(), prefix: null };
}

async function fetchPr(prNumber) {
    const res = await fetch(`${baseUrl}/repos/${owner}/${repo}/pulls/${prNumber}`, {
        headers: getHeaders()
    });
    if (!res.ok) {
        throw new Error(`Failed to fetch PR #${prNumber}: ${res.statusText}`);
    }
    return await res.json();
}

async function updatePrTitle(prNumber, title) {
    const res = await fetch(`${baseUrl}/repos/${owner}/${repo}/pulls/${prNumber}`, {
        method: "PATCH",
        headers: getHeaders(),
        body: JSON.stringify({ title })
    });
    if (!res.ok) {
        const details = await res.json().catch(() => ({}));
        return { ok: false, error: details.message || res.statusText };
    }
    return { ok: true };
}

function parseArgs(rawArgs) {
    let prefixSpec = null;
    let targetAll = false;
    let dryRun = false;
    const prTokens = [];

    for (const arg of rawArgs) {
        if (arg === "--help" || arg === "-h") {
            printHelp();
        } else if (arg === "--dry-run" || arg === "-n") {
            dryRun = true;
        } else if (arg === "--all") {
            targetAll = true;
        } else if (prefixSpec === null) {
            prefixSpec = arg;
        } else {
            prTokens.push(arg);
        }
    }

    const prNumbers = prTokens
        .flatMap(token => token.split(","))
        .map(token => token.trim())
        .filter(token => token.length > 0);

    const bad = prNumbers.filter(token => !/^\d+$/.test(token));
    if (bad.length > 0) {
        fail(`Invalid PR numbers: ${bad.join(", ")}. Expected numeric IDs.`);
    }

    return {
        prefixSpec,
        targetAll,
        dryRun,
        prNumbers: [...new Set(prNumbers.map(Number))]
    };
}

async function main() {
    const { prefixSpec, targetAll, dryRun, prNumbers } = parseArgs(Bun.argv.slice(2));

    if (prefixSpec === null) {
        printHelp();
    }

    const removePrefix = REMOVE_ALIASES.has(prefixSpec.trim().toLowerCase());
    const newPrefix = removePrefix ? null : normalizePrefix(prefixSpec);

    let targets = prNumbers;
    if (targetAll) {
        const prs = await fetchAllPages(`${baseUrl}/repos/${owner}/${repo}/pulls?state=open`);
        const allNumbers = prs.map(pr => pr.number);
        targets = targets.length > 0 ? targets : allNumbers;
        if (targets.length === 0) {
            ok("No open pull requests found.");
            return;
        }
    } else if (targets.length === 0) {
        fail("No PR numbers given. Example: bun run src/fg-prefix.js WIP: 123,456");
    }

    console.log("");
    info(`📍 Repo     : ${owner}/${repo}`);
    info(`🏷️  Action   : ${newPrefix ? `set prefix "${newPrefix}"` : "remove prefix"} on ${targets.length} PR(s)`);
    console.log("");

    const details = await Promise.all(targets.map(n => fetchPr(n).then(
        pr => ({ number: n, pr }),
        err => ({ number: n, error: err.message })
    )));

    let changed = 0;
    let unchanged = 0;
    let failed = 0;

    for (const entry of details) {
        if (entry.error) {
            console.error(`❌ PR #${entry.number}: ${entry.error}`);
            failed++;
            continue;
        }

        const { pr } = entry;
        if (pr.state !== "open") {
            console.log(`⏭️  PR #${pr.number} is ${pr.state} — skipping.`);
            continue;
        }

        const { rest, prefix } = stripPrefix(pr.title);
        if (rest.length === 0) {
            console.log(`⚠️  PR #${pr.number} title is only a prefix — skipping: "${pr.title}"`);
            continue;
        }

        const newTitle = newPrefix ? `${newPrefix} ${rest}` : rest;

        if (newTitle === pr.title) {
            console.log(`➖ PR #${pr.number} already correct: "${pr.title}"`);
            unchanged++;
            continue;
        }

        const change = prefix && prefix !== newPrefix ? ` (was "${prefix}")` : "";
        console.log(`   Old: ${pr.title}`);
        console.log(`   New: ${newTitle}${change}`);

        if (dryRun) {
            changed++;
            continue;
        }

        const result = await updatePrTitle(pr.number, newTitle);
        if (result.ok) {
            ok(`PR #${pr.number} updated → ${newTitle}`);
            changed++;
        } else {
            console.error(`❌ Failed to update PR #${pr.number}: ${result.error}`);
            failed++;
        }
    }

    console.log("");
    if (dryRun) {
        console.log(`🏁 Dry run. Would change ${changed}, already correct ${unchanged}, failed ${failed}.`);
    } else {
        console.log(`🏁 Done. Changed ${changed}, already correct ${unchanged}, failed ${failed}.`);
    }
}

main().catch(err => {
    console.error("❌ Unexpected error:", err.message);
    process.exit(1);
});