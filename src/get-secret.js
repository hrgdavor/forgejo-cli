// get-secret.js - Read secrets from env var, ~/.forgejo-cli.env file, or OS vault
//
// Lookup order:
//   1. process.env[envVarName]
//   2. ~/.forgejo-cli.env file (key=value format)
//   3. OS credential vault (macOS Keychain, Windows Credential Manager, Linux libsecret)
//
// Supports vault backends:
//   macOS:   security find-generic-password
//   Windows: cmdkey /list + credential manager
//   Linux:   secret-tool (libsecret)

import { spawnSync } from "bun";
import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const ENV_FILE = join(homedir(), ".forgejo-cli.env");

/**
 * Read a secret from env var, ~/.forgejo-cli.env, or the OS credential vault.
 *
 * @param {string} serviceName  - The service name used when storing the secret (e.g. "redmine-api-token")
 * @param {string} envVarName   - The env var name (e.g. "REDMINE_API_KEY")
 * @param {boolean} [required=true] - If true, exits with an error when not found.
 *                                    If false, returns null instead.
 * @param {boolean} [gitGuiFriendly=false] - When true, never calls process.exit()/console.error and
 *                                    skips the OS credential vault entirely. GUI Git clients (VS Code,
 *                                    GitKraken, Sourcetree, GitHub Desktop, "git gui") spawn hooks as
 *                                    background processes that can't surface macOS Keychain / Windows
 *                                    Credential Manager authorization dialogs, which freezes the client.
 *                                    They also don't inherit shell env vars. So in this mode we only
 *                                    read env vars and ~/.forgejo-cli.env, and silently return null on
 *                                    miss instead of crashing or hanging the client.
 * @returns {string|null} The secret value, or null if not found and not required/gitGuiFriendly.
 */
export function getSecret(serviceName, envVarName, required = true, gitGuiFriendly = false) {
    // 1. Try env var first (fast path, also useful for CI/containers)
    const fromEnv = process.env[envVarName];
    if (fromEnv) return fromEnv;

    // 2. Try ~/.forgejo-cli.env file
    const fromFile = readFromEnvFile(envVarName);
    if (fromFile) return fromFile;

    // 3. Try OS vault (skipped for GUI clients: see gitGuiFriendly)
    if (!gitGuiFriendly) {
        const fromVault = readFromVault(serviceName);
        if (fromVault) return fromVault;
    }

    if (!required || gitGuiFriendly) return null;

    console.error(`❌ ${envVarName} not found.`);
    console.error(`   Options to provide it:`);
    console.error(`     1. Export it as an environment variable`);
    console.error(`     2. Add it to ~/.forgejo-cli.env (key=value format, one per line)`);
    console.error(`     3. Store it in your OS vault:`);
    console.error(`        macOS:   security add-generic-password -a "$USER" -s "${serviceName}" -w "YOUR_SECRET"`);
    console.error(`        Windows: cmdkey /generic:${serviceName} /user:%USERNAME% /pass:YOUR_SECRET`);
    console.error(`        Linux:   secret-tool store --label="${serviceName}" service ${serviceName} username "$USER"`);
    process.exit(1);
}

/**
 * Read a value from ~/.forgejo-cli.env (key=value format, one per line).
 * Returns null if the file doesn't exist or the key is not found.
 */
function readFromEnvFile(key) {
    if (!existsSync(ENV_FILE)) return null;
    try {
        const content = readFileSync(ENV_FILE, "utf-8");
        for (const line of content.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;
            const eqIdx = trimmed.indexOf("=");
            if (eqIdx === -1) continue;
            const fileKey = trimmed.slice(0, eqIdx).trim();
            if (fileKey === key) {
                return trimmed.slice(eqIdx + 1).trim();
            }
        }
    } catch {
        // If the file can't be read, silently continue
    }
    return null;
}

function readFromVault(serviceName) {
    const platform = process.platform;

    // A hard timeout guards against a vault backend that pops an interactive
    // authorization dialog (e.g. macOS Keychain "always allow" prompt) and then
    // hangs waiting for input it can never receive. We never want a secret
    // lookup to block indefinitely.
    const timeoutMs = 5000;

    if (platform === "darwin") {
        // macOS: security find-generic-password (no -T, so it won't prompt to
        // grant a new app access; it just fails if access isn't already allowed)
        const result = spawnSync([
            "security", "find-generic-password",
            "-s", serviceName,
            "-w"
        ], { timeout: timeoutMs });
        if (result.exitCode === 0) {
            return result.stdout.toString().trim();
        }
        return null;
    }

    if (platform === "win32") {
        // Windows: use PowerShell to read from Credential Manager
        const result = spawnSync([
            "powershell", "-NoProfile", "-Command",
            `(Get-StoredCredential -Target "${serviceName}").Password`
        ], { timeout: timeoutMs });
        if (result.exitCode === 0) {
            const pw = result.stdout.toString().trim();
            if (pw) return pw;
        }
        return null;
    }

    if (platform === "linux") {
        // Linux: secret-tool (libsecret)
        const result = spawnSync([
            "secret-tool", "lookup",
            "service", serviceName
        ], { timeout: timeoutMs });
        if (result.exitCode === 0) {
            return result.stdout.toString().trim();
        }
        return null;
    }

    return null;
}