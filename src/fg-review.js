#!/usr/bin/env bun
// fg-review.js - CLI: run Alibaba open-code-review (ocr) on a Forgejo/Gitea PR
//
// Usage:
//   bun run src/fg-review.js [<PR-number>] [flags]
//
// Without a PR number, the tool uses the open PR whose head is the current
// branch. It fetches the PR base branch and head ref into the local repository,
// then runs:
//
//   ocr review --from origin/<base> --to origin/pr/<number>
//
// Model access is passed to OCR through its native environment variables
// (OCR_LLM_URL / OCR_LLM_TOKEN / OCR_LLM_MODEL / OCR_LLM_PROTOCOL), so an
// existing OCR or Claude Code environment works unchanged.

import { writeFileSync, unlinkSync, existsSync, readFileSync } from "fs";
import { tmpdir, homedir } from "os";
import { join } from "path";
import { getRepoContext, getHeaders, findPrForBranch } from "./forgejo-utils.js";
import { getSecret, readEnvFile } from "./util/general/getSecret.js";
import { fail, info, ok, git } from "./utils.js";

const OCR_INSTALL_HINT = "Install it with: npm install -g @alibaba-group/open-code-review";


// - Help ────────────────────────────────────────────────────────────────────

function printHelp() {
    console.log("Usage:");
    console.log("  bun run src/fg-review.js               - review the open PR for the current branch");
    console.log("  bun run src/fg-review.js <PR-number>   - review a specific PR");
    console.log("  bun run src/fg-review.js --help        - show this help message");
    console.log("");
    console.log("Runs Alibaba open-code-review (`ocr`) on the PR diff:");
    console.log("  ocr review --from origin/<base> --to origin/pr/<number>");
    console.log("");
    console.log("Flags:");
    console.log("  --json             Emit OCR JSON (--format json --audience agent)");
    console.log("  --effort <level>   low | medium | high (passed to ocr review)");
    console.log("  --model <name>     Override the model for this run");
    console.log("  --url <endpoint>   Model endpoint for this run (alias: --endpoint)");
    console.log("  --token <key>      Model API key for this run (alias: --api-key)");
    console.log("  --token-stdin      Read the model API key from stdin (use instead of --token)");
    console.log("  --protocol <name>  anthropic | openai | openai-responses");
    console.log("  --no-fetch         Use existing origin/<base> and origin/pr/<n> refs");
    console.log("  --dry-run          Print the OCR command and env, then exit");
    console.log("  --                 Pass the remaining arguments to `ocr review`");
    console.log("");
    console.log("The model flags override OCR_LLM_* from the environment, ~/.forgejo-cli.env,");
    console.log("and the OS vault for this run only. Prefer --token-stdin, the environment, or");
    console.log("the vault over --token: command-line arguments are visible in shell history");
    console.log("and process listings.");
    console.log("");
    console.log("Environment variables:");
    console.log("  FORGEJO_TOKEN       - Forgejo/Gitea personal access token");
    console.log("  OCR_LLM_URL         - Model endpoint (e.g. https://gateway.example.com/v1)");
    console.log("  OCR_LLM_TOKEN       - Model API key");
    console.log("  OCR_LLM_MODEL       - Model name");
    console.log("  OCR_LLM_PROTOCOL    - anthropic | openai | openai-responses");
    console.log("                        (inferred from OCR_LLM_URL when unset)");
    console.log("");
    console.log("OCR_LLM_URL/TOKEN/MODEL can also be stored in ~/.forgejo-cli.env.");
    console.log("URL and token additionally support the OS vault (services:");
    console.log("ocr-llm-url and ocr-llm-token). If no OCR_LLM_* endpoint is set, ocr");
    console.log("uses its own ~/.opencodereview/config.json.");
    process.exit(0);
}


// - OCR configuration ───────────────────────────────────────────────────────

/**
 * Infer the OCR protocol from the endpoint URL. OCR defaults to `anthropic`
 * when OCR_LLM_PROTOCOL is unset, which is rarely what an OpenAI-compatible
 * gateway wants, so infer a sensible value for the injected env.
 */
export function inferProtocol(url) {
    const normalized = String(url || "").toLowerCase().replace(/\/+$/, "");
    if (normalized.endsWith("/responses")) return "openai-responses";
    if (normalized.endsWith("/messages") || normalized.includes("anthropic")) return "anthropic";
    return "openai";
}

/**
 * Merge OCR model credentials into a copy of `baseEnv`.
 *
 * - No URL and no token: leave the environment untouched so OCR can use its
 *   own config file (or Claude Code's ANTHROPIC_* variables).
 * - URL and token but no model: OCR's env strategy would be incomplete and
 *   silently fall back to the config file, ignoring the endpoint. Fail loudly.
 * - An explicit `protocol` (from --protocol) overrides OCR_LLM_PROTOCOL.
 */
export function buildOcrEnv(baseEnv, { url, token, model, protocol } = {}) {
    const env = { ...baseEnv };

    if (!url && !token) return env;
    if (!url) {
        throw new Error(
            "OCR_LLM_TOKEN is set but OCR_LLM_URL is missing. " +
            "Set both, or unset OCR_LLM_TOKEN to use OCR's own config file."
        );
    }
    if (!token) {
        throw new Error(
            "OCR_LLM_URL is set but OCR_LLM_TOKEN is missing. " +
            "Set both, or unset OCR_LLM_URL to use OCR's own config file."
        );
    }
    if (!model) {
        throw new Error(
            "OCR_LLM_MODEL is required when OCR_LLM_URL and OCR_LLM_TOKEN are set. " +
            "OCR only uses the environment when all three are present."
        );
    }

    env.OCR_LLM_URL = url;
    env.OCR_LLM_TOKEN = token;
    env.OCR_LLM_MODEL = model;
    if (protocol) env.OCR_LLM_PROTOCOL = protocol;
    if (!env.OCR_LLM_PROTOCOL) {
        env.OCR_LLM_PROTOCOL = inferProtocol(url);
    }
    return env;
}

/** Build the PR context passed to OCR as review background. */
export function buildBackground(pr, maxLength = 4000) {
    const title = String(pr.title || "").trim();
    const body = String(pr.body || "").trim();
    let text = `PR #${pr.number}: ${title}`;
    if (body) text += `\n\n${body}`;
    if (text.length > maxLength) {
        text = `${text.slice(0, maxLength).trimEnd()}\n\n[truncated]`;
    }
    return text;
}

/**
 * Write the PR context to a temporary Markdown file.
 *
 * OCR supports --background-file, and a file avoids passing a multiline
 * argument through cmd.exe when `ocr` is an npm .cmd shim on Windows.
 */
function writeBackgroundFile(pr) {
    const path = join(tmpdir(), `fg-review-${process.pid}-${Date.now()}.md`);
    try {
        writeFileSync(path, buildBackground(pr), "utf-8");
    } catch (err) {
        fail(`Could not write the review background file: ${err.message}`);
    }
    return path;
}

/** Build the `ocr review` argument list. */
export function buildOcrArgs({ baseRef, headRef, opts, backgroundFile, extra = [] }) {
    const args = ["review", "--from", baseRef, "--to", headRef];
    if (backgroundFile) args.push("--background-file", backgroundFile);
    if (opts.effort) args.push("--effort", opts.effort);
    if (opts.model) args.push("--model", opts.model);

    const extraHasFormat = extra.some(a => a === "--format" || a.startsWith("--format="));
    if (opts.json && !extraHasFormat) {
        args.push("--format", "json", "--audience", "agent");
    }
    if (extra.length) args.push(...extra);
    return args;
}


// - Git / Forgejo helpers ───────────────────────────────────────────────────

function currentBranch() {
    const result = git(["branch", "--show-current"]);
    if (result.exitCode !== 0) {
        fail(`Could not read the current branch: ${result.stderr || result.stdout}`);
    }
    if (!result.stdout) {
        fail("Not on a branch (detached HEAD). Check out a branch or pass a PR number.");
    }
    return result.stdout;
}

function refExists(ref) {
    return git(["rev-parse", "--verify", "--quiet", ref]).exitCode === 0;
}

function shortSha(ref) {
    const result = git(["rev-parse", "--short", ref]);
    return result.exitCode === 0 ? result.stdout : "?";
}

async function fetchPrDetails(number) {
    const { baseUrl, owner, repo } = getRepoContext();
    const res = await fetch(`${baseUrl}/repos/${owner}/${repo}/pulls/${number}`, {
        headers: getHeaders(),
    });
    if (!res.ok) {
        const detail = await res.text().catch(() => "");
        fail(
            `Could not fetch PR #${number} (HTTP ${res.status})` +
            (detail ? `: ${detail.slice(0, 300)}` : "")
        );
    }
    return res.json();
}

async function resolvePr(opts) {
    if (opts.prNumber !== null) {
        return fetchPrDetails(opts.prNumber);
    }

    const branch = currentBranch();
    info(`No PR number given; looking for an open PR for "${branch}"...`);
    const pr = await findPrForBranch(branch);
    if (!pr) {
        fail(
            `No open PR found for branch "${branch}" (or the Forgejo API is unreachable).\n` +
            `   Pass a PR number: bun run src/fg-review.js <PR-number>`
        );
    }
    return fetchPrDetails(pr.number);
}

/**
 * Make `origin/<base>` and either `origin/pr/<n>` or `origin/<head>` available.
 */
function ensureRefs(pr, noFetch) {
    const baseRef = `origin/${pr.base.ref}`;
    const prRef = `origin/pr/${pr.number}`;
    const headBranchRef = `origin/${pr.head.ref}`;

    if (!noFetch) {
        info(`Fetching base branch "${pr.base.ref}"...`);
        const baseFetch = git([
            "fetch", "origin",
            `+refs/heads/${pr.base.ref}:refs/remotes/${baseRef}`,
        ]);
        if (baseFetch.exitCode !== 0) {
            fail(`Could not fetch base branch "${pr.base.ref}": ${baseFetch.stderr || baseFetch.stdout}`);
        }
    }
    if (!refExists(baseRef)) {
        fail(
            `Base ref "${baseRef}" not found.\n` +
            `   Run without --no-fetch, or fetch "${pr.base.ref}" manually.`
        );
    }

    if (!noFetch) {
        info(`Fetching PR #${pr.number} head...`);
        const prFetch = git([
            "fetch", "origin",
            `+refs/pull/${pr.number}/head:refs/remotes/${prRef}`,
        ]);
        if (prFetch.exitCode !== 0) {
            info(`PR ref not available; trying head branch "${pr.head.ref}"...`);
            const headFetch = git([
                "fetch", "origin",
                `+refs/heads/${pr.head.ref}:refs/remotes/${headBranchRef}`,
            ]);
            if (headFetch.exitCode !== 0) {
                fail(
                    `Could not fetch the PR head.\n` +
                    `   refs/pull/${pr.number}/head: ${prFetch.stderr || prFetch.stdout}\n` +
                    `   refs/heads/${pr.head.ref}: ${headFetch.stderr || headFetch.stdout}`
                );
            }
        }
    }

    let headRef = null;
    if (refExists(prRef)) headRef = prRef;
    else if (refExists(headBranchRef)) headRef = headBranchRef;
    else {
        fail(
            `PR head ref not found. Tried "${prRef}" and "${headBranchRef}".\n` +
            `   Run without --no-fetch, or fetch the PR head manually.`
        );
    }

    if (pr.head?.sha) {
        const localSha = git(["rev-parse", headRef]).stdout;
        if (localSha && localSha !== pr.head.sha) {
            info(
                `⚠️  Local ${headRef} is ${shortSha(headRef)}, but the PR head is ` +
                `${pr.head.sha.slice(0, 7)}. Re-run without --no-fetch to refresh.`
            );
        }
    }

    return { baseRef, headRef };
}

/**
 * Resolve model credentials, most specific source first:
 *   --url / --token / --model / --protocol flags
 *   > OCR_LLM_* environment variables
 *   > ~/.forgejo-cli.env
 *   > OS vault (URL and token only)
 */
function loadOcrCredentials(opts) {
    return {
        url: opts.url || getSecret("ocr-llm-url", "OCR_LLM_URL", false),
        token: opts.token || getSecret("ocr-llm-token", "OCR_LLM_TOKEN", false),
        model: opts.model || process.env.OCR_LLM_MODEL || readEnvFile("OCR_LLM_MODEL"),
        protocol: opts.protocol || process.env.OCR_LLM_PROTOCOL || readEnvFile("OCR_LLM_PROTOCOL"),
    };
}

/** Read the model API key from stdin, so it never appears in a command line. */
function readTokenFromStdin() {
    try {
        const raw = readFileSync(0, "utf-8").trim();
        if (!raw) fail("No model API key was provided on stdin.");
        return raw;
    } catch (err) {
        fail(`Could not read the model API key from stdin: ${err.message}`);
    }
}

/**
 * OCR resolves a saved ~/.opencodereview/config.json before its environment
 * variables, so an active saved provider would silently win over OCR_LLM_*.
 * Detect that case for a warning.
 */
function ocrSavedConfigWins() {
    const path = join(homedir(), ".opencodereview", "config.json");
    if (!existsSync(path)) return false;
    try {
        const cfg = JSON.parse(readFileSync(path, "utf-8"));
        if (typeof cfg.provider === "string" && cfg.provider.trim()) return true;
        const llm = cfg.llm || {};
        return Boolean(llm.url && llm.model && (llm.auth_token || llm.auth_token_cmd));
    } catch {
        return false;
    }
}


// - Main ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
    const opts = {
        prNumber: null,
        json: false,
        noFetch: false,
        dryRun: false,
        effort: null,
        model: null,
        url: null,
        token: null,
        tokenStdin: false,
        protocol: null,
        extra: [],
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];

        if (arg === "--help" || arg === "-h") {
            printHelp();
        } else if (arg === "--json") {
            opts.json = true;
        } else if (arg === "--no-fetch") {
            opts.noFetch = true;
        } else if (arg === "--dry-run") {
            opts.dryRun = true;
        } else if (arg === "--effort") {
            opts.effort = requireValue(argv, ++i, "--effort");
            if (!["low", "medium", "high"].includes(opts.effort)) {
                fail(`Invalid --effort "${opts.effort}". Use low, medium, or high.`);
            }
        } else if (arg === "--model") {
            opts.model = requireValue(argv, ++i, "--model");
        } else if (arg === "--url" || arg === "--endpoint") {
            opts.url = requireValue(argv, ++i, arg);
        } else if (arg === "--token" || arg === "--api-key") {
            const value = requireValue(argv, ++i, arg);
            if (value === "-") opts.tokenStdin = true;
            else opts.token = value;
        } else if (arg === "--token-stdin") {
            opts.tokenStdin = true;
        } else if (arg === "--protocol") {
            opts.protocol = requireValue(argv, ++i, "--protocol");
            if (!["anthropic", "openai", "openai-responses"].includes(opts.protocol)) {
                fail(`Invalid --protocol "${opts.protocol}". Use anthropic, openai, or openai-responses.`);
            }
        } else if (arg === "--") {
            opts.extra = argv.slice(i + 1);
            break;
        } else if (/^\d+$/.test(arg)) {
            if (opts.prNumber !== null) {
                fail(`Unexpected extra PR number "${arg}". Pass only one PR number.`);
            }
            opts.prNumber = Number(arg);
        } else {
            fail(`Unknown argument "${arg}". Use --help for usage.`);
        }
    }

    if (opts.tokenStdin && opts.token) {
        fail("Use either --token or --token-stdin, not both.");
    }

    return opts;
}

function requireValue(argv, index, flag) {
    const value = argv[index];
    if (!value || value.startsWith("--")) {
        fail(`Missing value for ${flag}.`);
    }
    return value;
}

function shellQuote(value) {
    if (/^[A-Za-z0-9_./:=@%+-]+$/.test(value)) return value;
    return `"${value.replace(/"/g, '\\"')}"`;
}

function mask(value) {
    if (!value) return "";
    if (value.length <= 8) return "********";
    return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function printOcrConfig(args, env) {
    info(`  ocr ${args.map(shellQuote).join(" ")}`);
    info("");
    info("OCR model environment:");
    if (!env.OCR_LLM_URL) {
        info("  OCR_LLM_URL not set — ocr will use ~/.opencodereview/config.json");
        return;
    }
    for (const key of ["OCR_LLM_URL", "OCR_LLM_MODEL", "OCR_LLM_PROTOCOL", "OCR_LLM_AUTH_HEADER"]) {
        if (env[key]) info(`  ${key}=${env[key]}`);
    }
    if (env.OCR_LLM_TOKEN) info(`  OCR_LLM_TOKEN=${mask(env.OCR_LLM_TOKEN)}`);
}

export async function main(argv = Bun.argv.slice(2)) {
    const opts = parseArgs(argv);
    if (opts.tokenStdin) opts.token = readTokenFromStdin();

    info("Reading repository context...");
    getRepoContext(); // fail early with a clear message when there is no origin

    const pr = await resolvePr(opts);
    if (!pr.base?.ref || !pr.head?.ref) {
        fail(`PR #${pr.number} is missing base/head branch information.`);
    }
    info(`PR #${pr.number}: ${pr.title}`);
    info(`  ${pr.head.ref} → ${pr.base.ref}`);
    if (pr.state && pr.state !== "open") {
        info(`⚠️  PR #${pr.number} is ${pr.state}; reviewing its diff anyway.`);
    }

    const { baseRef, headRef } = ensureRefs(pr, opts.noFetch);

    const status = git(["status", "--porcelain"]);
    if (status.exitCode === 0 && status.stdout) {
        info(
            "⚠️  Working tree has uncommitted changes. The diff is taken from the " +
            "fetched refs, but OCR may read modified files as review context."
        );
    }

    let env;
    try {
        env = buildOcrEnv(process.env, loadOcrCredentials(opts));
    } catch (err) {
        fail(err.message);
    }

    if (env.OCR_LLM_URL && ocrSavedConfigWins()) {
        const usedFlags = Boolean(opts.url || opts.token || opts.model);
        info(
            "⚠️  ~/.opencodereview/config.json contains an active LLM configuration; " +
            "ocr checks that file before OCR_LLM_* environment variables" +
            (usedFlags ? ", so --url/--token/--model may be ignored." : ".")
        );
        info("   Clear the saved provider (or the legacy llm block) to use the environment instead.");
    }

    const ocrBin = opts.dryRun ? null : Bun.which("ocr");
    if (!opts.dryRun && !ocrBin) {
        fail(`open-code-review CLI "ocr" was not found on PATH. ${OCR_INSTALL_HINT}`);
    }

    const backgroundFile = writeBackgroundFile(pr);
    const args = buildOcrArgs({
        baseRef,
        headRef,
        opts,
        backgroundFile,
        extra: opts.extra,
    });

    try {
        if (opts.dryRun) {
            info("Dry run — no review will be executed.");
            printOcrConfig(args, env);
            return 0;
        }

        info(`Reviewing ${baseRef}..${headRef} with open-code-review...`);
        printOcrConfig(args, env);

        const proc = Bun.spawn([ocrBin, ...args], {
            cwd: process.cwd(),
            env,
            stdin: "inherit",
            stdout: "inherit",
            stderr: "inherit",
        });

        const exitCode = await proc.exited;
        if (exitCode === 0) {
            ok("open-code-review finished.");
        } else {
            console.error(`❌ ocr review exited with code ${exitCode}.`);
        }
        return exitCode;
    } finally {
        try {
            unlinkSync(backgroundFile);
        } catch {
            // Best-effort cleanup; the file is in the OS temp directory.
        }
    }
}

if (import.meta.main) {
    main()
        .then(code => process.exit(code))
        .catch(err => {
            console.error(`❌ Unexpected error: ${err.message}`);
            process.exit(1);
        });
}
