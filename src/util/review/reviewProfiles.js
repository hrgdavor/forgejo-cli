// reviewProfiles.js - Global named model profiles for open-code-review
//
// Profiles live in the user's home folder and are shared by every repository:
//
//   ~/.forgejo-cli/review/<name>.json
//   {
//     "url": "https://gateway.example.com/v1",
//     "model": "gpt-5",
//     "protocol": "openai",
//     "token": "sk-..."
//   }
//
// `url` and `model` are required; `protocol` is inferred from `url` when unset
// and `token` falls back to OCR_LLM_TOKEN, ~/.forgejo-cli.env, or the OS vault.

import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { configDir } from "../forgejo/instanceConfig.js";
import { getSecret, readEnvFile } from "../general/getSecret.js";

const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Directory holding review profiles. */
export function reviewProfilesDir() {
    return join(configDir(), "review");
}

/** List profile names found in the profiles directory (sorted, may be empty). */
export function listReviewProfiles() {
    const dir = reviewProfilesDir();
    if (!existsSync(dir)) return [];
    try {
        return readdirSync(dir)
            .filter(file => file.toLowerCase().endsWith(".json"))
            .map(file => file.slice(0, -5))
            .filter(name => PROFILE_NAME.test(name))
            .sort();
    } catch {
        return [];
    }
}

/** Load one profile by name; throws a helpful error when it is missing or invalid. */
export function loadReviewProfile(name) {
    const clean = String(name || "").replace(/\.json$/i, "");
    if (!PROFILE_NAME.test(clean)) {
        throw new Error(`Invalid review profile name "${name}".`);
    }

    const path = join(reviewProfilesDir(), `${clean}.json`);
    if (!existsSync(path)) {
        const available = listReviewProfiles();
        throw new Error(
            `Review profile "${clean}" not found (${path}).` +
            (available.length
                ? ` Available profiles: ${available.join(", ")}.`
                : " No review profiles are defined yet.")
        );
    }

    let data;
    try {
        data = JSON.parse(readFileSync(path, "utf-8"));
    } catch (err) {
        throw new Error(`Could not parse review profile ${path}: ${err.message}`);
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error(`Review profile ${path} must contain a JSON object.`);
    }

    return { ...data, path };
}

/**
 * Resolve the model configuration for a review run.
 *
 * Precedence: CLI flags > selected profile > OCR_LLM_* environment >
 * ~/.forgejo-cli.env > OS vault. The `default` profile is used implicitly when
 * no profile is named.
 */
export function resolveReviewConfig({ profileName = null, flags = {}, env = process.env } = {}) {
    let name = profileName || null;
    if (name) name = name.replace(/\.json$/i, "");
    if (!name && listReviewProfiles().includes("default")) name = "default";

    const profile = name ? loadReviewProfile(name) : null;

    const url = flags.url || (profile && profile.url) ||
        getSecret("ocr-llm-url", "OCR_LLM_URL", false);
    const model = flags.model || (profile && profile.model) ||
        env.OCR_LLM_MODEL || readEnvFile("OCR_LLM_MODEL");
    const protocol = flags.protocol || (profile && profile.protocol) ||
        env.OCR_LLM_PROTOCOL || readEnvFile("OCR_LLM_PROTOCOL");

    let token = flags.token || (profile && profile.token) || null;
    if (!token && name) {
        token = getSecret(`ocr-llm-token-${name}`, null, false);
    }
    if (!token) {
        token = getSecret("ocr-llm-token", "OCR_LLM_TOKEN", false);
    }

    if (profile) {
        if (!url) throw new Error(`Review profile "${name}" is missing "url".`);
        if (!model) throw new Error(`Review profile "${name}" is missing "model".`);
    }

    return {
        url,
        token,
        model,
        protocol,
        profileName: name,
        profilePath: profile ? profile.path : null,
    };
}
