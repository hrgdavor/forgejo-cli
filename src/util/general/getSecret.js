// getSecret.js - Read secrets from env var, ~/.forgejo-cli.env file, or OS vault
//
// Lookup order:
//   1. process.env[envVarName]
//   2. ~/.forgejo-cli.env file (key=value format)
//   3. OS credential vault (macOS Keychain, Windows Credential Manager, Linux libsecret)

import { spawnSync } from "bun";
import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const ENV_FILE = join(homedir(), ".forgejo-cli.env");

/**
 * Read a secret from env var, ~/.forgejo-cli.env, or the OS credential vault.
 *
 * @param {string} serviceName  - The service name used when storing the secret
 * @param {string} envVarName   - The env var name
 * @param {boolean} [required=true] - If true, exits with an error when not found
 * @param {boolean} [gitGuiFriendly=false] - When true, never calls process.exit() and skips vault
 * @returns {string|null} The secret value, or null if not found
 */
export function getSecret(serviceName, envVarName, required = true, gitGuiFriendly = false) {
    const fromEnv = process.env[envVarName];
    if (fromEnv) return fromEnv;

    const fromFile = readFromEnvFile(envVarName);
    if (fromFile) return fromFile;

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
    const timeoutMs = 5000;

    if (platform === "darwin") {
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