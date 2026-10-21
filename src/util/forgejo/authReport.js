// authReport.js - Shared console report for Forgejo/Gitea auth diagnostics
//
// Used by `fg-pr-check.js`, `fg-review.js --auth-only`, and
// `fg-align.js --auth-only` so every command explains auth the same way.

import { homedir } from "os";
import { getInstanceConfig, getInstanceTokenDetails } from "./instanceConfig.js";
import { checkForgejoAuth } from "./authCheck.js";

export function maskSecret(value) {
    if (!value) return "";
    if (value.length <= 8) return "********";
    return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function shortenHome(path) {
    const home = homedir();
    if (!path) return path;
    return path.toLowerCase().startsWith(home.toLowerCase()) ? `~${path.slice(home.length)}` : path;
}

export function tokenSourceLabel(source, config) {
    if (!source) return "unknown";
    if (source === config.settingsPath) {
        return config.actor
            ? `domain file ${shortenHome(source)} (actor ${config.actor})`
            : `domain file ${shortenHome(source)}`;
    }
    return source;
}

/** Print the resolved instance, token source, and auth result. */
export function printForgejoAuth(config, details, auth) {
    console.log("");
    console.log("🔐 Forgejo");
    console.log(`  Instance : ${config.domain}`);
    console.log(`  API      : ${config.baseUrl}`);
    console.log(`  Config   : ${config.hasSettings ? shortenHome(config.settingsPath) : "(none — using env/vault fallback)"}`);
    if (config.actor) console.log(`  Actor    : ${config.actor}`);
    console.log(`  Token    : ${details.token ? `${maskSecret(details.token)} from ${tokenSourceLabel(details.source, config)}` : "not found"}`);

    if (auth.ok) {
        console.log(`  Result   : ✅ PR access — ${auth.repo}`);
        return;
    }

    if (auth.stage === "network") {
        console.log(`  Result   : ❌ could not reach ${config.baseUrl}`);
        console.log(`             ${auth.error}`);
        return;
    }

    if (auth.stage === "token" && (auth.status === 401 || auth.status === 403)) {
        console.log(`  Result   : ❌ token rejected (HTTP ${auth.status})`);
        console.log(`             Fix the token in ${tokenSourceLabel(details.source, config)}.`);
        return;
    }

    if (auth.stage === "repo") {
        console.log(`  Result   : ❌ cannot access ${config.owner}/${config.repo} (HTTP ${auth.status})`);
        if (auth.status === 403) {
            console.log("             The token may lack repository scope, or this repository forbids access.");
        } else if (auth.status === 404) {
            console.log("             The repository is not visible with this token (wrong owner/repo or no access).");
        } else {
            console.log("             The token is valid but the repository request failed.");
        }
        return;
    }

    console.log("  Result   : ❌ no token configured");
    console.log(`             Add "token" to ${shortenHome(config.settingsPath)}, or export FORGEJO_TOKEN.`);
}

/** Run the Forgejo-only check and return 0 on success, 1 on failure. */
export async function runForgejoAuthOnly() {
    const config = getInstanceConfig();
    const details = getInstanceTokenDetails();
    const auth = await checkForgejoAuth(config, details.token);

    printForgejoAuth(config, details, auth);
    console.log("");

    if (auth.ok) {
        console.log("✅ Forgejo auth check passed.");
        return 0;
    }

    console.log("❌ Forgejo auth check failed.");
    return 1;
}
