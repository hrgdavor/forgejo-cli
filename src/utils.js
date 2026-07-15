// utils.js - Shared utility functions used by both forgejo-utils and red-utils
//
// Logging helpers, git command runner, package.json reader, branch name sanitizer.

import { spawnSync } from "bun";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// ── logging ────────────────────────────────────────────────────────────────

export function fail(msg) {
    console.error(`❌ ${msg}`);
    process.exit(1);
}

export function info(msg) {
    console.log(`ℹ️ ${msg}`);
}

export function ok(msg) {
    console.log(`✅ ${msg}`);
}

// ── package.json reader ────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Read package.json from the repo root.
 * Checks process.cwd() first (the directory the user ran the command from),
 * then falls back to walking up from this module's own location.
 */
export function readPackageJson() {
    // Check the working directory first - most likely where the user's project lives
    const cwd = process.cwd();
    const cwdPkg = join(cwd, "package.json");
    if (existsSync(cwdPkg)) {
        return JSON.parse(readFileSync(cwdPkg, "utf-8"));
    }

    // Fallback: walk up from this module's own directory
    let dir = __dirname;
    for (let i = 0; i < 10; i++) {
        const candidate = join(dir, "package.json");
        if (existsSync(candidate)) {
            return JSON.parse(readFileSync(candidate, "utf-8"));
        }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return {};
}

// ── branch name sanitizer ──────────────────────────────────────────────────

/**
 * Sanitize a string so it can be used as a git branch name:
 *  - lowercase
 *  - replace non-alphanumeric (except hyphens/underscores) with hyphens
 *  - collapse multiple hyphens
 *  - trim leading/trailing hyphens
 */
export function sanitizeBranchName(str) {
    return str
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "");
}

// ── git command runner ─────────────────────────────────────────────────────

/**
 * Run a git command and return { exitCode, stdout, stderr }.
 */
export function git(args) {
    const result = spawnSync(["git", ...args]);
    return {
        exitCode: result.exitCode,
        stdout: result.stdout.toString().trim(),
        stderr: result.stderr.toString().trim(),
    };
}