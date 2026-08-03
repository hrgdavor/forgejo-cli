// logActivity.js - Append a JSON activity line to ~/.forgejo-cli/log
import { appendFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const LOG_DIR = join(homedir(), ".forgejo-cli");
export const LOG_FILE = join(LOG_DIR, "log");

/**
 * Append a JSON line to ~/.forgejo-cli/log.
 * Failures are silently ignored so logging never breaks the calling command.
 *
 * @param {string} msg    - The activity description
 * @param {string|number} [ticket] - Optional Redmine ticket number
 */
export function logActivity(msg, ticket) {
    try {
        mkdirSync(LOG_DIR, { recursive: true });
        const entry = { ts: new Date().toISOString(), msg };
        if (ticket !== undefined && ticket !== null) entry.ticket = String(ticket);
        appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
    } catch {
        // never break the calling command because logging failed
    }
}

/**
 * Read all log entries as parsed objects: { ts, msg, ticket? }.
 * Lines that are not valid JSON get { ts: null, msg: line }.
 *
 * @returns {Array<{ts: string|null, msg: string, ticket?: string}>}
 */
export function readLogEntries() {
    if (!existsSync(LOG_FILE)) return [];
    try {
        const lines = readFileSync(LOG_FILE, "utf-8").split("\n").filter(Boolean);
        return lines.map(line => {
            try {
                const obj = JSON.parse(line);
                return {
                    ts: typeof obj.ts === "string" ? obj.ts : null,
                    msg: typeof obj.msg === "string" ? obj.msg : line,
                    ticket: obj.ticket !== undefined ? String(obj.ticket) : undefined,
                };
            } catch {
                return { ts: null, msg: line };
            }
        });
    } catch {
        return [];
    }
}

/**
 * Return true if the log already contains an activity line for the given
 * ticket number written today (regardless of created/accessed).
 *
 * @param {number|string} ticket
 * @returns {boolean}
 */
export function hasPrActivityForTicketToday(ticket) {
    const today = new Date().toISOString().slice(0, 10);
    return readLogEntries().some(e => e.ts && e.ts.slice(0, 10) === today && e.ticket === String(ticket));
}
