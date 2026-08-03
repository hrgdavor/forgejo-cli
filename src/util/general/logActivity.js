// logActivity.js - Append a timestamped activity line to ~/.forgejo-cli/log
import { appendFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const LOG_DIR = join(homedir(), ".forgejo-cli");
const LOG_FILE = join(LOG_DIR, "log");

function pad(n) {
    return String(n).padStart(2, "0");
}

/**
 * Append a line to ~/.forgejo-cli/log with a YYYY-MM-DD HH:MM:SS prefix.
 * Failures are silently ignored so logging never breaks the calling command.
 *
 * @param {string} message - The activity description to log
 */
export function logActivity(message) {
    try {
        mkdirSync(LOG_DIR, { recursive: true });
        const now = new Date();
        const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
                   `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
        appendFileSync(LOG_FILE, `${ts} ${message}\n`);
    } catch {
        // never break the calling command because logging failed
    }
}