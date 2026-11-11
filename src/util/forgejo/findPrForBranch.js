// findPrForBranch.js - Find existing open PRs by head branch or ticket
import { getRepoContext } from "./getRepoContext.js";
import { getHeaders } from "./getHeaders.js";
import { fetchAllPages } from "./fetchAllPages.js";
import { extractTicketFromBranch } from "../redmine/extractTicketFromBranch.js";

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

/**
 * Search all open PRs for one whose head branch belongs to `ticketNumber`.
 * Matches by ticket number extracted from the branch name, so it finds PRs
 * even when the computed branch name differs (title/type/prefix changes).
 *
 * @param {string|number} ticketNumber
 * @returns {Promise<object|null>} The PR object, or null if not found/unreachable
 */
export async function findOpenPrForTicket(ticketNumber) {
    const { baseUrl, owner, repo } = getRepoContext();
    const ticket = String(ticketNumber);

    try {
        const prs = await fetchAllPages(`${baseUrl}/repos/${owner}/${repo}/pulls?state=open`);
        return prs.find(pr => extractTicketFromBranch(pr.head?.ref || "") === ticket) || null;
    } catch {
        return null;
    }
}