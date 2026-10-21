#!/usr/bin/env bun
// fg-pr-check.js - Verify Forgejo/Gitea auth and show PR title/status
//
// Usage:
//   bun run src/fg-pr-check.js              - PR for the current branch
//   bun run src/fg-pr-check.js <PR-number>  - a specific PR
//   bun run src/fg-pr-check.js --all        - all open PRs
//   bun run src/fg-pr-check.js --auth-only  - only verify token and repo access
//
// Always reports the resolved instance, where the token came from (domain file,
// FORGEJO_TOKEN, ~/.forgejo-cli.env, or the OS vault), and whether the API
// accepts it. Exit code 0 means authentication is working.

import { getInstanceConfig, getInstanceTokenDetails } from "./util/forgejo/instanceConfig.js";
import { buildAuthHeaders, checkForgejoAuth } from "./util/forgejo/authCheck.js";
import { maskSecret, tokenSourceLabel, printForgejoAuth } from "./util/forgejo/authReport.js";
import { findPrForBranch } from "./forgejo-utils.js";
import { git, fail } from "./utils.js";


// - Help ────────────────────────────────────────────────────────────────────

function printHelp() {
    console.log("Usage:");
    console.log("  bun run src/fg-pr-check.js              - PR for the current branch");
    console.log("  bun run src/fg-pr-check.js <PR-number>  - a specific PR");
    console.log("  bun run src/fg-pr-check.js --all        - all open PRs");
    console.log("  bun run src/fg-pr-check.js --auth-only  - verify token and repo access only");
    console.log("  bun run src/fg-pr-check.js --help       - show this help");
    console.log("");
    console.log("Shows the PR title and status, plus where the token came from and");
    console.log("whether the API accepts it. Exit code 0 means auth is working.");
    console.log("");
    console.log("Flags:");
    console.log("  --all          List every open PR instead of one");
    console.log("  --auth-only    Skip the PR lookup");
    console.log("  --as <actor>   Act as a named Gitea actor (e.g. a bot)");
    console.log("  --json         Machine-readable output");
    console.log("");
    console.log("The token is read from ~/.forgejo-cli/<domain>.json, then FORGEJO_TOKEN,");
    console.log("then ~/.forgejo-cli.env, then the OS vault (service forgejo-token).");
    process.exit(0);
}


// - Helpers ─────────────────────────────────────────────────────────────────

function webUrl(config, number) {
    const base = config.baseUrl.replace(/\/api\/v1\/?$/i, "");
    return `${base}/${config.owner}/${config.repo}/pulls/${number}`;
}

function currentBranch() {
    const result = git(["branch", "--show-current"]);
    if (result.exitCode !== 0) {
        fail(`Could not read the current branch: ${result.stderr || result.stdout}`);
    }
    if (!result.stdout) {
        fail("Not on a branch (detached HEAD). Pass a PR number or use --all.");
    }
    return result.stdout;
}

async function fetchJson(url, headers) {
    const res = await fetch(url, { headers });
    if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
    }
    return res.json();
}

function prStatus(pr) {
    const parts = [pr.state || "unknown"];
    if (pr.draft) parts.push("draft");
    if (pr.merged) parts.push("merged");
    return parts.join(", ");
}

function mergeStatus(pr) {
    if (pr.merged) return "merged";
    if (pr.mergeable === true) return "✅ mergeable";
    if (pr.mergeable === false) return "❌ conflicts";
    return "… unknown";
}


// - PR lookup ───────────────────────────────────────────────────────────────

async function fetchPr(config, headers, number) {
    return fetchJson(`${config.baseUrl}/repos/${config.owner}/${config.repo}/pulls/${number}`, headers);
}

async function fetchAllOpenPulls(config, headers) {
    const pulls = [];
    for (let page = 1; ; page++) {
        const url = `${config.baseUrl}/repos/${config.owner}/${config.repo}/pulls?state=open&page=${page}&limit=50`;
        const batch = await fetchJson(url, headers);
        pulls.push(...batch);
        if (batch.length < 50) break;
    }
    return pulls;
}


// - Output ──────────────────────────────────────────────────────────────────

function printPr(config, pr) {
    console.log("");
    console.log(`📋 PR #${pr.number}  [${prStatus(pr)}]`);
    console.log(`  Title  : ${pr.title}`);
    console.log(`  Branch : ${pr.head?.ref || "?"} → ${pr.base?.ref || "?"}`);
    if (pr.user?.login) console.log(`  Author : ${pr.user.login}`);
    console.log(`  Merge  : ${mergeStatus(pr)}`);
    console.log(`  URL    : ${webUrl(config, pr.number)}`);
}

function printPrList(config, pulls) {
    console.log("");
    if (!pulls.length) {
        console.log("📋 No open PRs.");
        return;
    }
    console.log(`📋 Open PRs (${pulls.length})`);
    for (const pr of pulls) {
        console.log(`  #${String(pr.number).padEnd(6)} ${prStatus(pr).padEnd(18)} ${pr.title}`);
    }
}


// - Main ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
    const opts = { prNumber: null, all: false, authOnly: false, json: false };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];

        if (arg === "--help" || arg === "-h") {
            printHelp();
        } else if (arg === "--all") {
            opts.all = true;
        } else if (arg === "--auth-only") {
            opts.authOnly = true;
        } else if (arg === "--json") {
            opts.json = true;
        } else if (/^\d+$/.test(arg)) {
            if (opts.prNumber !== null) {
                fail(`Unexpected extra PR number "${arg}". Pass only one PR number.`);
            }
            opts.prNumber = Number(arg);
        } else {
            fail(`Unknown argument "${arg}". Use --help for usage.`);
        }
    }

    return opts;
}

export async function main(argv = Bun.argv.slice(2)) {
    const opts = parseArgs(argv);

    const config = getInstanceConfig();
    const details = getInstanceTokenDetails();
    const headers = buildAuthHeaders(details.token);

    const auth = await checkForgejoAuth(config, details.token, headers);

    const result = {
        instance: {
            domain: config.domain,
            api: config.baseUrl,
            configFile: config.hasSettings ? config.settingsPath : null,
            repo: `${config.owner}/${config.repo}`,
            actor: config.actor || null,
        },
        token: {
            present: Boolean(details.token),
            masked: details.token ? maskSecret(details.token) : null,
            source: tokenSourceLabel(details.source, config),
        },
        auth,
    };

    let pr = null;
    let pulls = null;
    let lookupError = null;

    if (!opts.authOnly && auth.ok) {
        try {
            if (opts.all) {
                pulls = await fetchAllOpenPulls(config, headers);
            } else if (opts.prNumber !== null) {
                pr = await fetchPr(config, headers, opts.prNumber);
            } else {
                const branch = currentBranch();
                const found = await findPrForBranch(branch);
                if (!found) {
                    lookupError = `No open PR found for branch "${branch}". Pass a PR number or use --all.`;
                } else {
                    pr = await fetchPr(config, headers, found.number);
                }
            }
        } catch (err) {
            lookupError = err.message;
        }
    }

    if (pr) result.pr = pr;
    if (pulls) result.prs = pulls;

    if (opts.json) {
        if (lookupError) result.error = lookupError;
        console.log(JSON.stringify(result, null, 2));
        return auth.ok && !lookupError ? 0 : 1;
    }

    printForgejoAuth(config, details, auth);

    if (lookupError) {
        console.log("");
        console.log(`❌ ${lookupError}`);
    } else if (pr) {
        printPr(config, pr);
    } else if (pulls) {
        printPrList(config, pulls);
    }

    return auth.ok && !lookupError ? 0 : 1;
}

if (import.meta.main) {
    main()
        .then(code => process.exit(code))
        .catch(err => {
            console.error(`❌ Unexpected error: ${err.message}`);
            process.exit(1);
        });
}
