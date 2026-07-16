// red-utils.js - Redmine API utility functions
//
// Exports helpers for Redmine API calls and Forgejo PR creation.
// Shared utilities (logging, git, package.json, sanitize) live in utils.js.

import { fail, info, ok, readPackageJson, sanitizeBranchName, git } from "./utils.js";
import { getRepoContext, getHeaders } from "./forgejo-utils.js";
import { getSecret } from "./get-secret.js";

// ── Redmine API helpers ────────────────────────────────────────────────────

export function getRedmineConfig(gitGuiFriendly = false) {
    const baseUrl = getSecret("redmine-url", "REDMINE_URL", true, gitGuiFriendly);
    const apiKey  = getSecret("redmine-api-token", "REDMINE_API_KEY", true, gitGuiFriendly);
    return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}

/**
 * Fetch a Redmine issue by its numeric ID.
 * Returns the issue object (or fails).
 */
export async function fetchRedmineIssue(ticketNumber, gitGuiFriendly = false) {
    const { baseUrl, apiKey } = getRedmineConfig(gitGuiFriendly);
    const url = `${baseUrl}/issues/${ticketNumber}.json?include=journals`;

    const res = await fetch(url, {
        headers: {
            "X-Redmine-API-Key": apiKey,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    });

    if (!res.ok) {
        fail(`Redmine API returned ${res.status} for issue #${ticketNumber}: ${res.statusText}`);
    }

    const data = await res.json();
    return data.issue;
}

/**
 * Get the current value of a custom field on a Redmine issue.
 * Returns the value string, or null if the field is not found or empty.
 */
export async function getRedmineField(ticketNumber, fieldId, gitGuiFriendly = false) {
    const { baseUrl, apiKey } = getRedmineConfig(gitGuiFriendly);
    const url = `${baseUrl}/issues/${ticketNumber}.json?include=custom_fields`;

    const res = await fetch(url, {
        headers: {
            "X-Redmine-API-Key": apiKey,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    });

    if (!res.ok) {
        fail(`Redmine API returned ${res.status} for issue #${ticketNumber}: ${res.statusText}`);
    }

    const data = await res.json();
    const fields = data.issue.custom_fields || [];
    const field = fields.find(f => f.id == fieldId);
    return field ? field.value : null;
}

/**
 * Update a custom field on a Redmine issue.
 */
export async function updateRedmineField(ticketNumber, fieldId, value, gitGuiFriendly = false) {
    const { baseUrl, apiKey } = getRedmineConfig(gitGuiFriendly);
    const url = `${baseUrl}/issues/${ticketNumber}.json`;

    const body = {
        issue: {
            custom_fields: [
                { id: fieldId, value },
            ],
        },
    };

    const res = await fetch(url, {
        method: "PUT",
        headers: {
            "X-Redmine-API-Key": apiKey,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const text = await res.text();
        console.error(`⚠️  Failed to update Redmine field #${fieldId}: ${res.status} ${text}`);
        return false;
    }
    return true;
}

// - Forgejo PR helper ──────────────────────────────────────────────────────

/**
 * Create a Pull Request on Forgejo/Gitea.
 * Uses getRepoContext() + getHeaders() from forgejo-utils.js.
 */
export async function createPullRequest(head, title, base = "main", body = "") {
    const { baseUrl, owner, repo } = getRepoContext();
    const url = `${baseUrl}/repos/${owner}/${repo}/pulls`;
    const res = await fetch(url, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
            title,
            head,
            base,
            body,
        }),
    });

    if (!res.ok) {
        const text = await res.text();
        fail(`Failed to create PR: ${res.status} ${text}`);
    }

    return await res.json();
}

/**
 * Post a note (comment) to a Redmine issue via the REST API.
 * Uses REDMINE_URL and REDMINE_API_KEY env vars.
 */
export async function addRedmineNote(issueId, note, gitGuiFriendly = false) {
    const { baseUrl, apiKey } = getRedmineConfig(gitGuiFriendly);
    const url = `${baseUrl}/issues/${issueId}.json`;

    const res = await fetch(url, {
        method: "PUT",
        headers: {
            "X-Redmine-API-Key": apiKey,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        body: JSON.stringify({
            issue: { notes: note },
        }),
    });

    if (!res.ok) {
        const text = await res.text();
        console.error(`⚠️  Failed to add note to Redmine issue #${issueId}: ${res.status} ${text}`);
        return false;
    }
    return true;
}


/**
 * Extract the Redmine ticket number from a branch name.
 * Returns the number as a string, or null if the branch doesn't start with a number.
 *
 * Examples:
 *   12345-fix-bug     → "12345"
 *   42                → "42"
 *   main              → null
 *   feature/xyz       → null
 */
export function extractTicketFromBranch(branchName) {
    const match = branchName.match(/^(\d+)/);
    return match ? match[1] : null;
}

/**
 * Extract the Redmine ticket number from a commit message.
 * Looks for patterns like #12345 or 12345 at the start.
 * Returns the number as a string, or null.
 *
 * Examples:
 *   "#12345 fix bug"      → "12345"
 *   "12345 fix bug"       → "12345"
 *   "fix bug #12345"      → "12345"
 *   "fix bug"             → null
 */
export function extractTicketFromMessage(message) {
    // Try #number pattern anywhere in the message
    const hashMatch = message.match(/#(\d+)/);
    if (hashMatch) return hashMatch[1];
    // Try leading number pattern
    const leadMatch = message.match(/^(\d+)\b/);
    if (leadMatch) return leadMatch[1];
    return null;
}

export function computeBranchConfig() {
    const pkg = readPackageJson();
    const defaultBaseBranch = pkg.redmine_pr_default_base_branch || "main";
    return { pkg, defaultBaseBranch };
}

export function computeBranchName(ticketNumber, title) {
    return `${ticketNumber}-${sanitizeBranchName(title)}`;
}

// - Shared helpers (moved from red-pr.js) ──────────────────────────────────

export function validateTicketNumber(ticketNumber) {
    if (!/^\d+$/.test(ticketNumber)) {
        fail(`"${ticketNumber}" is not a valid numeric ticket number.`);
    }
}

export function getCurrentBranch() {
    return git(["rev-parse", "--abbrev-ref", "HEAD"]).stdout;
}

/**
 * Prompt the user with a question and return true/false based on the matcher.
 * The matcher receives the trimmed lowercase input and returns true for a "yes".
 */
export function promptChoice(question, matcher) {
    return new Promise(resolve => {
        process.stdout.write(question);
        process.stdin.once("data", data => {
            resolve(matcher(data.toString().trim().toLowerCase()));
        });
    });
}

export function checkExistingBranch(ticketNumber) {
    // Check local branches
    const localBranches = git(["branch", "--list", "--format=%(refname:short)"]);
    const localMatch = localBranches.stdout
        .split("\n")
        .find(b => b.startsWith(ticketNumber + "-") || b === ticketNumber);

    // Check remote branches
    const remoteBranches = git(["branch", "-r", "--list", "--format=%(refname:short)"]);
    const remoteMatch = remoteBranches.stdout
        .split("\n")
        .find(b => {
            const short = b.replace(/^origin\//, "");
            return short.startsWith(ticketNumber + "-") || short === ticketNumber;
        });

    if (localMatch || remoteMatch) {
        const found = localMatch || remoteMatch;
        fail(`Branch "${found}" already exists (ticket #${ticketNumber}). Please handle manually.`);
    }

    ok(`No existing branch found for ticket #${ticketNumber}.`);
}

export function createBranch(branchName) {
    const checkout = git(["checkout", "-b", branchName]);
    if (checkout.exitCode !== 0) {
        fail(`Failed to create branch "${branchName}": ${checkout.stderr}`);
    }
    ok(`Branch "${branchName}" created and checked out.`);
}

export function pushBranch(branchName) {
    const push = git(["push", "-u", "origin", branchName]);
    if (push.exitCode !== 0) {
        fail(`Failed to push branch "${branchName}": ${push.stderr}`);
    }
    ok(`Branch pushed to origin/${branchName}.`);
}

export function retryPushBranch(branchName) {
    // The branch may already be tracked upstream; retry without -u so an
    // "already set up to track" error doesn't abort.
    const push = git(["push", "origin", branchName]);
    if (push.exitCode !== 0) {
        fail(`Failed to push branch "${branchName}": ${push.stderr}`);
    }
    ok(`Branch pushed to origin/${branchName}.`);
}

export function prInfoText(pkg, branchName, pr) {
    return `${pkg.redmine_pr_info_text} branch: ${branchName} | ${pr.html_url}`;
}

/**
 * Append a note to a Redmine custom field (used by red-commit.js).
 * Falls back to adding a regular note if no pr_info_field is configured.
 */
export async function appendRedminePrField(pkg, ticketId, note, gitGuiFriendly = false) {
    const fieldId = pkg.redmine_pr_info_field;
    if (!fieldId) {
        const added = await addRedmineNote(ticketId, note, gitGuiFriendly);
        if (added) {
            ok(`Note added to Redmine issue #${ticketId}.`);
        }
        return;
    }

    let fieldValue = await getRedmineField(ticketId, fieldId, gitGuiFriendly) || '';
    if (!fieldValue.endsWith("\n")) fieldValue += "\n";
    fieldValue += note;

    const updated = await updateRedmineField(ticketId, fieldId, fieldValue, gitGuiFriendly);
    if (updated) {
        ok(`Redmine custom field #${fieldId} updated.`);
    }
}

/**
 * Post the last commit message as a Redmine note.
 */
export async function postLastCommitMessage(pkg, ticketId, label, gitGuiFriendly = false) {
    if (gitGuiFriendly) {
        // When invoked by a GUI Git client the secret may be unavailable (env
        // vars blanked out, OS vault skipped to avoid a hanging auth prompt).
        // Degrade silently instead of crashing or freezing the client.
        const cfg = getRedmineConfig(true);
        if (!cfg.baseUrl || !cfg.apiKey) {
            info(`Running in ${label} mode - Redmine credentials not available in this environment, skipping note.`);
            return;
        }
    }
    info(`Running in ${label} mode - pushing last commit message to Redmine...`);
    const message = getLastCommitMessage();
    info(`Commit message: ${message.split("\n")[0]}`);
    await appendRedminePrField(pkg, ticketId, `Commit: ${message}`, gitGuiFriendly);
}

