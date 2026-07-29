// readPackageJson.js - Read package.json from the repo root
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Read package.json from the repo root.
 * Checks process.cwd() first (the directory the user ran the command from),
 * then falls back to walking up from this module's own location.
 */
export function readPackageJson() {
    const cwd = process.cwd();
    const cwdPkg = join(cwd, "package.json");
    if (existsSync(cwdPkg)) {
        return JSON.parse(readFileSync(cwdPkg, "utf-8"));
    }

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