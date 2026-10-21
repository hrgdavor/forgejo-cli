// instanceConfig.js - Resolve the Forgejo/Gitea instance for the current repo
//
// One integration file per domain lives in the user's home folder:
//
//   ~/.forgejo-cli/<domain>.json
//   { "url": "https://gitea.example.com", "token": "..." }
//
// The domain is taken from the `origin` remote (FORGEJO_INSTANCE overrides it),
// so the same tools work against several Forgejo/Gitea instances.
//
// Token precedence: the domain file's `token`, then FORGEJO_TOKEN, then
// ~/.forgejo-cli.env, then the OS vault (service `forgejo-token`).
// URL precedence: the domain file's `url`, then a value derived from the remote.

import { spawnSync } from "bun";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { getSecretInfo } from "../general/getSecret.js";

const DEFAULT_CONFIG_DIR = join(homedir(), ".forgejo-cli");

/** Directory holding per-domain integration files. Override with FORGEJO_CONFIG_DIR. */
export function configDir() {
    return process.env.FORGEJO_CONFIG_DIR || DEFAULT_CONFIG_DIR;
}

/**
 * Parse a git remote URL (https, ssh, scp-like, git://) into its parts.
 * @returns {{scheme: string, host: string, owner: string, repo: string}|null}
 */
export function parseRemoteUrl(remoteUrl) {
    const raw = String(remoteUrl || "").trim();
    if (!raw) return null;

    const stripGit = value => value.replace(/\.git$/, "");

    let match = raw.match(/^(https?):\/\/([^/]+)\/([^/]+)\/(.+?)\/?$/);
    if (match) {
        return { scheme: match[1], host: match[2], owner: match[3], repo: stripGit(match[4]) };
    }

    match = raw.match(/^ssh:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/([^/]+)\/(.+?)\/?$/);
    if (match) {
        return { scheme: "ssh", host: match[1], owner: match[2], repo: stripGit(match[3]) };
    }

    match = raw.match(/^git@([^:]+):([^/]+)\/(.+?)\/?$/);
    if (match) {
        return { scheme: "ssh", host: match[1], owner: match[2], repo: stripGit(match[3]) };
    }

    match = raw.match(/^git:\/\/([^/]+)\/([^/]+)\/(.+?)\/?$/);
    if (match) {
        return { scheme: "git", host: match[1], owner: match[2], repo: stripGit(match[3]) };
    }

    return null;
}

/** Turn a domain (which may include a port) into a safe file name. */
export function domainFileName(domain) {
    return domain.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
}

/** Normalize an instance URL (or the domain alone) into an API base URL. */
export function normalizeApiBase(rawUrl, domain) {
    let url = String(rawUrl || "").trim().replace(/\/+$/, "");
    if (!url) {
        const scheme = isLocalHost(domain) ? "http" : "https";
        url = `${scheme}://${domain}`;
    }
    if (!/\/api\/v1$/i.test(url)) url += "/api/v1";
    return url;
}

function isLocalHost(domain) {
    const host = String(domain || "").toLowerCase();
    return host === "localhost" ||
        host.startsWith("localhost:") ||
        host.startsWith("127.") ||
        host.startsWith("[::1]");
}

let cache = null;

/**
 * Consume a global `--as <actor>` / `--actor <actor>` argument from Bun.argv.
 *
 * Every Forgejo command imports this module before it parses arguments, so the
 * flag is removed here once and works the same for all of them. Scanning stops
 * at `--` so arguments meant for a child process are left alone.
 */
function extractActorArg() {
    const argv = Bun.argv;

    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--") break;

        if (arg === "--as" || arg === "--actor") {
            const value = argv[i + 1];
            if (!value || value.startsWith("--")) {
                console.error(`❌ Missing value for ${arg}.`);
                process.exit(1);
            }
            argv.splice(i, 2);
            return value;
        }

        if (arg.startsWith("--as=") || arg.startsWith("--actor=")) {
            const value = arg.slice(arg.indexOf("=") + 1);
            if (!value) {
                console.error(`❌ Missing value for ${arg}.`);
                process.exit(1);
            }
            argv.splice(i, 1);
            return value;
        }
    }

    return null;
}

const ACTOR_FROM_ARGV = extractActorArg();

/** The selected Gitea actor, from `--as` or FORGEJO_ACTOR. */
export function selectedActor() {
    return (ACTOR_FROM_ARGV || process.env.FORGEJO_ACTOR || "").trim() || null;
}

/** Clear the memoized instance context (used by tests). */
export function resetInstanceCache() {
    cache = null;
}

/**
 * Resolve the instance for the current repository, memoized per process.
 * Exits with a clear message when there is no parsable `origin` remote.
 */
export function getInstanceConfig() {
    if (cache) return cache;

    const remote = spawnSync(["git", "remote", "get-url", "origin"]);
    if (remote.exitCode !== 0) {
        console.error("❌ Error: Run this from a git repository with an 'origin' remote.");
        process.exit(1);
    }

    const remoteUrl = remote.stdout.toString().trim();
    const parsed = parseRemoteUrl(remoteUrl);
    if (!parsed) {
        console.error(`❌ Error: Could not parse remote URL: ${remoteUrl}`);
        process.exit(1);
    }

    const domain = (process.env.FORGEJO_INSTANCE || parsed.host).trim().toLowerCase();
    const settingsPath = join(configDir(), `${domainFileName(domain)}.json`);

    let settings = {};
    let hasSettings = false;
    if (existsSync(settingsPath)) {
        hasSettings = true;
        try {
            settings = JSON.parse(readFileSync(settingsPath, "utf-8")) || {};
        } catch (err) {
            console.error(`❌ Could not parse ${settingsPath}: ${err.message}`);
            process.exit(1);
        }
    }

    const actor = selectedActor();
    let effective = settings;

    if (actor) {
        const actors = settings.actors && typeof settings.actors === "object" ? settings.actors : {};
        if (!Object.prototype.hasOwnProperty.call(actors, actor)) {
            const available = Object.keys(actors);
            console.error(`❌ Gitea actor "${actor}" is not defined in ${settingsPath}.`);
            console.error(available.length
                ? `   Available actors: ${available.join(", ")}`
                : `   No actors are defined yet.`);
            console.error(`   Add:  "actors": { "${actor}": { "token": "..." } }`);
            process.exit(1);
        }

        const actorSettings = actors[actor] || {};
        if (!actorSettings.token) {
            console.error(`❌ Actor "${actor}" has no "token" in ${settingsPath}.`);
            console.error("   Add one so the tools never fall back to the default identity.");
            process.exit(1);
        }

        effective = { ...settings, ...actorSettings };
        delete effective.actors;
    }

    cache = {
        domain,
        baseUrl: normalizeApiBase(effective.url, domain),
        owner: parsed.owner,
        repo: parsed.repo,
        settingsPath,
        hasSettings,
        settings: effective,
        actor,
    };
    return cache;
}

/**
 * Resolve the token together with its origin, without exiting when none is
 * configured (used by diagnostics such as `fg-pr-check.js`).
 * @returns {{token: string|null, source: string|null}}
 */
export function getInstanceTokenDetails({ gitGuiFriendly = false } = {}) {
    const config = getInstanceConfig();

    if (config.settings.token) {
        return { token: config.settings.token, source: config.settingsPath };
    }

    const info = getSecretInfo("forgejo-token", "FORGEJO_TOKEN", { required: false, gitGuiFriendly });
    return info ? { token: info.value, source: info.source } : { token: null, source: null };
}

/**
 * Resolve the Forgejo/Gitea token for the current repository.
 * The domain file wins; environment, ~/.forgejo-cli.env, and the vault follow.
 * With gitGuiFriendly, returns null instead of exiting when no token is found.
 */
export function getInstanceToken(gitGuiFriendly = false) {
    const config = getInstanceConfig();
    const details = getInstanceTokenDetails({ gitGuiFriendly });

    if (details.token) return details.token;
    if (gitGuiFriendly) return null;

    console.error(`❌ No Forgejo/Gitea token for ${config.domain}.`);
    console.error(`   Options to provide it:`);
    console.error(`     1. Add "token" to ${config.settingsPath}`);
    console.error(`     2. Export FORGEJO_TOKEN as an environment variable`);
    console.error(`     3. Add FORGEJO_TOKEN to ~/.forgejo-cli.env`);
    console.error(`     4. Store it in your OS vault (service: forgejo-token)`);
    process.exit(1);
}
