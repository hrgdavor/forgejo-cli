// authCheck.js - Verify a Forgejo/Gitea token against what the tools actually use
//
// Every command here reads repositories and pull requests, so the check asks for
// exactly that: GET /repos/{owner}/{repo}/pulls. Endpoints no command touches
// (notably GET /user) are not probed, so a repository-scoped token is never
// reported as broken for a request the tools would never make.

/** Build JSON API headers, adding the token when one is available. */
export function buildAuthHeaders(token) {
    const headers = { "Content-Type": "application/json", "Accept": "application/json" };
    if (token) headers.Authorization = `token ${token}`;
    return headers;
}

/**
 * @param {{baseUrl: string, owner: string, repo: string}} config
 * @param {string|null} token
 * @param {Record<string, string>} [headers]
 * @returns {Promise<{ok: boolean, stage?: string, status?: number, error?: string, repo?: string}>}
 */
export async function checkForgejoAuth(config, token, headers = buildAuthHeaders(token)) {
    if (!token) return { ok: false, stage: "token", status: 0 };

    try {
        const url = `${config.baseUrl}/repos/${config.owner}/${config.repo}/pulls?state=all&limit=1`;
        const res = await fetch(url, { headers });

        if (res.status === 401) {
            return { ok: false, stage: "token", status: 401 };
        }
        if (!res.ok) {
            return { ok: false, stage: "repo", status: res.status };
        }

        return { ok: true, repo: `${config.owner}/${config.repo}` };
    } catch (err) {
        return { ok: false, stage: "network", error: err.message };
    }
}
