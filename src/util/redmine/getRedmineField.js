// getRedmineField.js - Get the current value of a custom field on a Redmine issue
import { getRedmineConfig } from "./getRedmineConfig.js";
import { fail } from "../general/fail.js";

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