// findPrForBranch.js - Find an existing open PR whose head branch matches
import { getRepoContext } from "./getRepoContext.js";
import { getHeaders } from "./getHeaders.js";

/**
 * Search Forgejo/Gitea for an open PR whose head branch equals `branchName`.
 *
 * @param {string} branchName
 * @returns {Promise<object|null>} The PR object, or null if not found/unreachable
 */
export async function findPrForBranch(branchName) {
    const { baseUrl, owner, repo } = getRepoContext();
    const url = `${baseUrl}/repos/${owner}/${repo}/pulls?state=open&sort=recentupdate&limit=100`;

    try {
        const res = await fetch(url, { headers: getHeaders() });
        if (!res.ok) return null;
        const prs = await res.json();
        const match = prs.find(pr => pr.head && (pr.head.ref === branchName || pr.head.label === branchName));
        return match || null;
    } catch {
        return null;
    }
}