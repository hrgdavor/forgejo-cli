// red-utils.js — Redmine API utility functions
//
// Exports helpers for Redmine API calls and Forgejo PR creation.
// Shared utilities (logging, git, package.json, sanitize) live in utils.js.

import { fail } from "./utils.js";
import { getRepoContext, getHeaders } from "./forgejo-utils.js";

// ── Redmine API helpers ────────────────────────────────────────────────────

export function getRedmineConfig() {
    const baseUrl = process.env.REDMINE_URL;
    const apiKey  = process.env.REDMINE_API_KEY;
    if (!baseUrl) fail("REDMINE_URL environment variable is missing.");
    if (!apiKey)  fail("REDMINE_API_KEY environment variable is missing.");
    return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}

/**
 * Fetch a Redmine issue by its numeric ID.
 * Returns the issue object (or fails).
 */
export async function fetchRedmineIssue(ticketNumber) {
    const { baseUrl, apiKey } = getRedmineConfig();
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
export async function getRedmineField(ticketNumber, fieldId) {
    const { baseUrl, apiKey } = getRedmineConfig();
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
    const field = fields.find(f => f.id === fieldId);
    return field ? field.value : null;
}

/**
 * Update a custom field on a Redmine issue.
 */
export async function updateRedmineField(ticketNumber, fieldId, value) {
    const { baseUrl, apiKey } = getRedmineConfig();
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

// ── Forgejo PR helper ──────────────────────────────────────────────────────

/**
 * Create a Pull Request on Forgejo/Gitea.
 * Uses getRepoContext() + getHeaders() from forgejo-utils.js.
 */
export async function createPullRequest(head, title, base = "main") {
    const { baseUrl, owner, repo } = getRepoContext();
    const url = `${baseUrl}/repos/${owner}/${repo}/pulls`;
    const res = await fetch(url, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
            title,
            head,
            base,
        }),
    });

    if (!res.ok) {
        const text = await res.text();
        fail(`Failed to create PR: ${res.status} ${text}`);
    }

    return await res.json();
}