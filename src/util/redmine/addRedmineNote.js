// addRedmineNote.js - Post a note (comment) to a Redmine issue via the REST API
import { getRedmineConfig } from "./getRedmineConfig.js";
import { logActivity } from "../general/logActivity.js";
import { fetchRedmineIssue } from "./fetchRedmineIssue.js";

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
    logActivity(note.split("\n")[0], issueId);

    // Also log a header line with the ticket title so fg-log.js can display
    // the title alongside the ticket number in the daily work log.
    try {
        const issue = await fetchRedmineIssue(issueId, gitGuiFriendly);
        const title = issue.subject;
        if (title) {
            logActivity(`#${issueId} ${title}`, issueId);
        }
    } catch {
        // Title fetch failure is non-critical; the note was still logged.
    }

    return true;
}
