// createPullRequest.js - Create a Pull Request on Forgejo/Gitea
import { getRepoContext } from "./getRepoContext.js";
import { getHeaders } from "./getHeaders.js";
import { fail } from "../general/fail.js";
import { logActivity } from "../general/logActivity.js";

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

    const pr = await res.json();
    logActivity(`PR #${pr.number} created: ${pr.html_url} (${title})`);
    return pr;
}
