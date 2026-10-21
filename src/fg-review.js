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
import { getInstanceConfig, getInstanceTokenDetails } from "./util/forgejo/instanceConfig.js";
import { checkForgejoAuth } from "./util/forgejo/authCheck.js";
import { printForgejoAuth, maskSecret, shortenHome } from "./util/forgejo/authReport.js";
import {
    resolveReviewConfig,
    listReviewProfiles,
    loadReviewProfile,
    reviewProfilesDir,
} from "./util/review/reviewProfiles.js";
import { fail, info, ok, git } from "./utils.js";

const OCR_INSTALL_HINT = "Install it with: npm install -g @alibaba-group/open-code-review";

// Invisible marker on every review this tool posts, so --delete-last-review can
// remove exactly its own review and never a human reviewer's.
const REVIEW_MARKER = "<!-- fg-review -->";


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
    console.log("  --profile <name>   Use the saved review profile <name>");
    console.log("  --list-profiles    List saved review profiles and exit");
    console.log("  --auth-only        Verify Forgejo and model auth, then exit");
    console.log("  --as <actor>       Act as a named Gitea actor (e.g. a bot) from the domain config");
    console.log("  --base <ref>       Diff against this ref instead of the PR's target branch");
    console.log("  --post             Post the review comments to the PR as a Forgejo review");
    console.log("  --delete-last-review  Delete this tool's last posted review (add --post to replace)");
    console.log("  --url <endpoint>   Model endpoint for this run (alias: --endpoint)");
    console.log("  --token <key>      Model API key for this run (alias: --api-key)");
    console.log("  --token-stdin      Read the model API key from stdin (use instead of --token)");
    console.log("  --protocol <name>  anthropic | openai | openai-responses");
    console.log("  --no-fetch         Use existing origin/<base> and origin/pr/<n> refs");
    console.log("  --dry-run          Print the OCR command and env, then exit");
    console.log("  --                 Pass the remaining arguments to `ocr review`");
    console.log("");
    console.log("Saved profiles live in ~/.forgejo-cli/review/<name>.json and are shared");
    console.log("by every repository; the \"default\" profile is used when one exists.");
    console.log("");
    console.log("The model flags override the selected profile, then OCR_LLM_* from the");
    console.log("environment, ~/.forgejo-cli.env, and the OS vault for this run only.");
    console.log("Prefer --token-stdin, the environment, or the vault over --token:");
    console.log("command-line arguments are visible in shell history and process listings.");
    console.log("");
    console.log("Environment variables:");
    console.log("  FORGEJO_TOKEN       - Forgejo/Gitea token (FORGEJO_TOKEN or domain file)");
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
    if ((opts.json || opts.post) && !extraHasFormat) {
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
function ensureRefs(pr, noFetch, baseOverride) {
    const baseRef = baseOverride || `origin/${pr.base.ref}`;
    const prRef = `origin/pr/${pr.number}`;
    const headBranchRef = `origin/${pr.head.ref}`;

    if (!noFetch && !baseOverride) {
        info(`Fetching base branch "${pr.base.ref}"...`);
        const baseFetch = git([
            "fetch", "origin",
            `+refs/heads/${pr.base.ref}:refs/remotes/${baseRef}`,
        ]);
        if (baseFetch.exitCode !== 0) {
            fail(`Could not fetch base branch "${pr.base.ref}": ${baseFetch.stderr || baseFetch.stdout}`);
        }
    } else if (!noFetch && baseOverride.startsWith("origin/")) {
        const branch = baseOverride.slice("origin/".length);
        info(`Fetching base branch "${branch}"...`);
        const baseFetch = git([
            "fetch", "origin",
            `+refs/heads/${branch}:refs/remotes/${baseRef}`,
        ]);
        if (baseFetch.exitCode !== 0) {
            fail(`Could not fetch base branch "${branch}": ${baseFetch.stderr || baseFetch.stdout}`);
        }
    }
    if (!refExists(baseRef)) {
        fail(
            `Base ref "${baseRef}" not found.\n` +
            (baseOverride
                ? `   Fetch it, or pass a ref that already exists locally.`
                : `   Run without --no-fetch, or fetch "${pr.base.ref}" manually.`)
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
 * Print the resolved range and stop when it contains no changes.
 *
 * OCR reviews `merge-base(base, head)..head`, so when the PR head is already
 * contained in the base there is genuinely nothing to review. Say why, instead
 * of letting OCR report "0 file(s) changed".
 */
function reportRange(baseRef, headRef) {
    const headSha = git(["rev-parse", headRef]).stdout;
    const mergeBaseResult = git(["merge-base", baseRef, headRef]);
    if (mergeBaseResult.exitCode !== 0) {
        info(`⚠️  Could not compute a merge base between ${baseRef} and ${headRef}.`);
        return;
    }
    const mergeBase = mergeBaseResult.stdout;
    const diff = git(["diff", "--name-only", `${mergeBase}..${headRef}`]);
    const files = diff.exitCode === 0 && diff.stdout ? diff.stdout.split("\n").filter(Boolean) : [];

    info(`  merge-base ${mergeBase.slice(0, 7)} · head ${headSha.slice(0, 7)} · ${files.length} changed file(s)`);

    if (files.length > 0) return;

    const reason = mergeBase === headSha
        ? `${headRef} is already contained in ${baseRef} (its head is the merge base)`
        : `${headRef} has the same tree as ${baseRef}`;
    fail(
        `No changes to review: ${reason}.\n` +
        `   The PR's commits are already in the base, or the local "${baseRef}" is not the branch the PR targets.\n` +
        `   Diff against another base:  --base origin/<branch>   (for example --base origin/main)\n` +
        `   Inspect OCR's file filtering:  -- --preview`
    );
}

/**
 * Resolve model credentials, most specific source first:
 *   --url / --token / --model / --protocol flags
 *   > selected profile (~/.forgejo-cli/review/<name>.json, "default" implicitly)
 *   > OCR_LLM_* environment variables
 *   > ~/.forgejo-cli.env
 *   > OS vault
 */
function loadOcrCredentials(opts) {
    return resolveReviewConfig({
        profileName: opts.profile,
        flags: {
            url: opts.url,
            token: opts.token,
            model: opts.model,
            protocol: opts.protocol,
        },
    });
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
        profile: null,
        listProfiles: false,
        authOnly: false,
        base: null,
        post: false,
        deleteLastReview: false,
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
        } else if (arg === "--profile" || arg === "-p") {
            opts.profile = requireValue(argv, ++i, arg);
        } else if (arg === "--list-profiles") {
            opts.listProfiles = true;
        } else if (arg === "--auth-only") {
            opts.authOnly = true;
        } else if (arg === "--check" || arg === "--auth-check") {
            fail("Use --auth-only for the auth check (Forgejo + model).");
        } else if (arg === "--base") {
            opts.base = requireValue(argv, ++i, "--base");
        } else if (arg === "--post") {
            opts.post = true;
        } else if (arg === "--delete-last-review") {
            opts.deleteLastReview = true;
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

function printOcrConfig(args, env, profileName) {
    info(`  ocr ${args.map(shellQuote).join(" ")}`);
    info("");
    if (profileName) info(`  review profile: ${profileName}`);
    info("OCR model environment:");
    if (!env.OCR_LLM_URL) {
        info("  OCR_LLM_URL not set — ocr will use ~/.opencodereview/config.json");
        return;
    }
    for (const key of ["OCR_LLM_URL", "OCR_LLM_MODEL", "OCR_LLM_PROTOCOL", "OCR_LLM_AUTH_HEADER"]) {
        if (env[key]) info(`  ${key}=${env[key]}`);
    }
    if (env.OCR_LLM_TOKEN) info(`  OCR_LLM_TOKEN=${maskSecret(env.OCR_LLM_TOKEN)}`);
}

function printReviewProfiles() {
    const names = listReviewProfiles();
    const dir = reviewProfilesDir();
    if (!names.length) {
        info(`No review profiles found in ${dir}.`);
        info(`Create one, e.g. ${join(dir, "gpt5.json")} with "url", "model", and "token".`);
        return;
    }
    info(`Review profiles in ${dir}:`);
    for (const name of names) {
        try {
            const profile = loadReviewProfile(name);
            const details = [profile.url, profile.model, profile.protocol].filter(Boolean).join("  ");
            info(`  ${name}  ${details}${profile.token ? "  [token: set]" : ""}`);
        } catch (err) {
            info(`  ${name}  (invalid: ${err.message})`);
        }
    }
}

async function checkModel(env, envError) {
    if (envError) return { ok: false, stage: "config", error: envError };

    const ocrBin = Bun.which("ocr");
    if (!ocrBin) return { ok: false, stage: "ocr-missing" };

    let proc;
    try {
        proc = Bun.spawn([ocrBin, "llm", "test"], {
            env,
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
        });
    } catch (err) {
        return { ok: false, stage: "spawn", error: err.message };
    }

    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        try {
            proc.kill();
        } catch {
            // The process already exited.
        }
    }, 45000);

    const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
    ]);
    const code = await proc.exited;
    clearTimeout(timer);

    return { ok: code === 0 && !timedOut, stage: "test", code, stdout, stderr, timedOut };
}

function printOcrTestOutput(text, maxLines = 12) {
    const lines = String(text || "")
        .split("\n")
        .map(line => line.trimEnd())
        .filter(Boolean);
    if (!lines.length) return;
    for (const line of lines.slice(-maxLines)) console.log(`             ${line}`);
}

function printModelCheck(credentials, env, model) {
    const creds = credentials || {};
    console.log("");
    console.log("🤖 Model");
    console.log(`  Source   : ${creds.profilePath ? `profile ${creds.profileName} (${shortenHome(creds.profilePath)})` : "(environment / OCR's own config)"}`);
    console.log(`  Endpoint : ${env.OCR_LLM_URL || "(not set — OCR's own config)"}`);
    if (env.OCR_LLM_MODEL) console.log(`  Model    : ${env.OCR_LLM_MODEL}`);
    if (env.OCR_LLM_PROTOCOL) console.log(`  Protocol : ${env.OCR_LLM_PROTOCOL}`);
    if (env.OCR_LLM_TOKEN) console.log(`  Token    : ${maskSecret(env.OCR_LLM_TOKEN)}`);

    if (env.OCR_LLM_URL && ocrSavedConfigWins()) {
        console.log("  Note     : ~/.opencodereview/config.json is active and may override this profile;");
        console.log("             `ocr llm test` verifies the saved configuration.");
    }

    if (model.stage === "config") {
        console.log(`  Result   : ❌ ${model.error}`);
        console.log("             Set a profile (--profile, --list-profiles) or the OCR_LLM_* variables.");
        return;
    }
    if (model.stage === "ocr-missing") {
        console.log(`  Result   : ❌ ocr was not found on PATH. ${OCR_INSTALL_HINT}`);
        return;
    }
    if (model.stage === "spawn") {
        console.log(`  Result   : ❌ could not start ocr: ${model.error}`);
        return;
    }
    if (model.timedOut) {
        console.log("  Result   : ❌ `ocr llm test` timed out after 45s.");
        return;
    }
    if (model.ok) {
        console.log("  Result   : ✅ `ocr llm test` passed");
        printOcrTestOutput(model.stdout);
        return;
    }

    console.log(`  Result   : ❌ \`ocr llm test\` failed (exit ${model.code})`);
    printOcrTestOutput(`${model.stdout}\n${model.stderr}`.trim());
}

async function runAuthChecks({ credentials, env, envError }) {
    const config = getInstanceConfig();
    const details = getInstanceTokenDetails();
    const forgejo = await checkForgejoAuth(config, details.token);

    printForgejoAuth(config, details, forgejo);

    const model = await checkModel(env, envError);
    printModelCheck(credentials, env, model);

    const ok = forgejo.ok && model.ok;
    console.log("");
    console.log(ok ? "✅ Auth check passed (Forgejo and model)." : "❌ Auth check failed.");
    return ok ? 0 : 1;
}

function commentBody(comment) {
    let body = String(comment.content || "").trim() || "(no description)";
    if (comment.suggestion_code) {
        body += `\n\n\`\`\`suggestion\n${comment.suggestion_code}\n\`\`\``;
    } else if (comment.existing_code) {
        body += `\n\n\`\`\`\n${comment.existing_code}\n\`\`\``;
    }
    return body;
}

function reviewSummary(result, comments) {
    const summary = result.summary || {};
    const lines = [
        REVIEW_MARKER,
        "Automated review by [open-code-review](https://github.com/alibaba/open-code-review).",
        "",
        `${comments.length} comment(s)` +
            (summary.files_reviewed != null ? ` across ${summary.files_reviewed} file(s)` : "") + ".",
    ];
    if (result.session_id) lines.push("", `Session: \`${result.session_id}\``);
    return lines.join("\n");
}

/**
 * Post the review to the PR. Inline comments are attempted first; Forgejo
 * installations that reject the position mapping still get every finding in
 * the review body.
 */
async function postReview(pr, result, comments) {
    const { baseUrl, owner, repo } = getRepoContext();
    const url = `${baseUrl}/repos/${owner}/${repo}/pulls/${pr.number}/reviews`;
    const body = reviewSummary(result, comments);

    const inline = comments.map(comment => ({
        path: comment.path,
        body: commentBody(comment),
        new_position: Number.isInteger(comment.start_line) && comment.start_line > 0 ? comment.start_line : 1,
    }));

    const bodyOnly = () => `${body}\n\n---\n\n${comments
        .map(comment => `### \`${comment.path}:${comment.start_line || "?"}\`\n\n${commentBody(comment)}`)
        .join("\n\n---\n\n")}`;

    const post = payload => fetch(url, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify(payload),
    });

    let res = await post({ event: "COMMENT", body, comments: inline });
    let review = res.ok ? await res.json().catch(() => null) : null;

    // A server may accept the review but silently drop positions it cannot map.
    // Replace that empty review with a body-only one so findings are not lost.
    const dropped = res.ok && inline.length > 0 && review && review.comments_count === 0;
    if (dropped) {
        await fetch(`${url}/${review.id}`, { method: "DELETE", headers: getHeaders() }).catch(() => {});
        res = await post({ event: "COMMENT", body: bodyOnly() });
        review = res.ok ? await res.json().catch(() => null) : null;
        if (res.ok) {
            ok(`Posted review to PR #${pr.number} (inline positions were dropped, so comments are in the review body).`);
            return true;
        }
    } else if (!res.ok && (res.status === 400 || res.status === 422)) {
        res = await post({ event: "COMMENT", body: bodyOnly() });
        review = res.ok ? await res.json().catch(() => null) : null;
        if (res.ok) {
            ok(`Posted review to PR #${pr.number} (inline positions were rejected, so comments are in the review body).`);
            return true;
        }
    }

    if (!res.ok) {
        const detail = await res.text().catch(() => "");
        console.error(`❌ Could not post the review (HTTP ${res.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`);
        return false;
    }

    const link = review?.html_url ? ` — ${review.html_url}` : "";
    ok(`Posted review with ${comments.length} comment(s) to PR #${pr.number}.${link}`);
    return true;
}

/**
 * Delete the newest review this tool posted on the PR.
 * @returns {Promise<"deleted"|"none"|"error">}
 */
async function deleteLastReview(pr) {
    const { baseUrl, owner, repo } = getRepoContext();
    const base = `${baseUrl}/repos/${owner}/${repo}/pulls/${pr.number}/reviews`;

    const res = await fetch(`${base}?limit=100`, { headers: getHeaders() });
    if (!res.ok) {
        console.error(`❌ Could not list reviews (HTTP ${res.status}).`);
        return "error";
    }

    const reviews = await res.json();
    const ours = (Array.isArray(reviews) ? reviews : [])
        .filter(review => String(review.body || "").includes(REVIEW_MARKER))
        .sort((a, b) => (b.id || 0) - (a.id || 0));

    if (ours.length === 0) {
        info(`No review posted by fg-review on PR #${pr.number}; nothing to delete.`);
        return "none";
    }

    const review = ours[0];
    const del = await fetch(`${base}/${review.id}`, { method: "DELETE", headers: getHeaders() });
    if (!del.ok) {
        const detail = await del.text().catch(() => "");
        console.error(`❌ Could not delete review #${review.id} (HTTP ${del.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
        return "error";
    }

    ok(`Deleted review #${review.id} from PR #${pr.number}.`);
    return "deleted";
}

/** Run OCR in JSON mode, then post its comments to the PR. */
async function runAndPost({ ocrBin, args, env, pr, opts }) {
    const proc = Bun.spawn([ocrBin, ...args], {
        cwd: process.cwd(),
        env,
        stdin: "inherit",
        stdout: "pipe",
        stderr: "inherit",
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
        console.error(`❌ ocr review exited with code ${exitCode}; nothing was posted.`);
        return exitCode;
    }

    let result;
    try {
        result = JSON.parse(stdout);
    } catch {
        console.error("❌ Could not parse the OCR JSON output; nothing was posted.");
        if (stdout.trim()) console.error(stdout.trim().slice(0, 500));
        return 1;
    }

    if (opts.json) console.log(JSON.stringify(result, null, 2));

    if (result.status === "skipped") {
        info(result.message || "OCR skipped the review (no supported files changed).");
        return 0;
    }

    const comments = Array.isArray(result.comments) ? result.comments : [];
    if (comments.length === 0) {
        info(result.message || "No review comments to post.");
        return 0;
    }

    if (opts.deleteLastReview) {
        await deleteLastReview(pr);
    }

    info(`Review finished: ${comments.length} comment(s). Posting to PR #${pr.number}...`);
    return (await postReview(pr, result, comments)) ? 0 : 1;
}

export async function main(argv = Bun.argv.slice(2)) {
    const opts = parseArgs(argv);

    if (opts.listProfiles) {
        printReviewProfiles();
        return 0;
    }

    if (opts.tokenStdin) opts.token = readTokenFromStdin();

    info("Reading repository context...");
    getRepoContext(); // fail early with a clear message when there is no origin

    let env;
    let credentials;
    let envError = null;
    try {
        credentials = loadOcrCredentials(opts);
        env = buildOcrEnv(process.env, credentials);
    } catch (err) {
        envError = err.message;
        env = process.env;
    }

    if (opts.authOnly) {
        return runAuthChecks({ credentials, env, envError });
    }

    if (envError) fail(envError);

    if (env.OCR_LLM_URL && ocrSavedConfigWins()) {
        const usedFlags = Boolean(opts.profile || opts.url || opts.token || opts.model);
        info(
            "⚠️  ~/.opencodereview/config.json contains an active LLM configuration; " +
            "ocr checks that file before OCR_LLM_* environment variables" +
            (usedFlags ? ", so the profile and CLI flags may be ignored." : ".")
        );
        info("   Clear the saved provider (or the legacy llm block) to use the environment instead.");
    }

    const pr = await resolvePr(opts);
    if (!pr.base?.ref || !pr.head?.ref) {
        fail(`PR #${pr.number} is missing base/head branch information.`);
    }
    info(`PR #${pr.number}: ${pr.title}`);
    info(`  ${pr.head.ref} → ${opts.base || pr.base.ref}`);
    if (pr.state && pr.state !== "open") {
        info(`⚠️  PR #${pr.number} is ${pr.state}; reviewing its diff anyway.`);
    }

    if (opts.deleteLastReview && !opts.post) {
        const deleted = await deleteLastReview(pr);
        return deleted === "error" ? 1 : 0;
    }

    const { baseRef, headRef } = ensureRefs(pr, opts.noFetch, opts.base);
    reportRange(baseRef, headRef);

    const status = git(["status", "--porcelain"]);
    if (status.exitCode === 0 && status.stdout) {
        info(
            "⚠️  Working tree has uncommitted changes. The diff is taken from the " +
            "fetched refs, but OCR may read modified files as review context."
        );
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
            printOcrConfig(args, env, credentials.profileName);
            return 0;
        }

        info(`Reviewing ${baseRef}..${headRef} with open-code-review...`);
        printOcrConfig(args, env, credentials.profileName);

        if (opts.post) {
            return await runAndPost({ ocrBin, args, env, pr, opts });
        }

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
            info("Tip: add --post to put these comments on the PR.");
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
