// addRedmineNote.js - Post a note (comment) to a Redmine issue via the REST API
import { getRedmineConfig } from "./getRedmineConfig.js";
import { logActivity } from "../general/logActivity.js";

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
    logActivity(`Redmine note added to issue #${issueId}: ${note.split("\n")[0]}`);
    return true;
}
