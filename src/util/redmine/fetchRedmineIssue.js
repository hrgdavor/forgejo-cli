// fetchRedmineIssue.js - Fetch a Redmine issue by its numeric ID
import { getRedmineConfig } from "./getRedmineConfig.js";
import { fail } from "../general/fail.js";

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