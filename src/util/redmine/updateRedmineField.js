// updateRedmineField.js - Update a custom field on a Redmine issue
import { getRedmineConfig } from "./getRedmineConfig.js";

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