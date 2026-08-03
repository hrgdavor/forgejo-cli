// checkForgejoAvailability.js - Check if the Forgejo/Gitea instance is reachable
import { getRepoContext } from "./getRepoContext.js";
import { getHeaders } from "./getHeaders.js";

/**
 * Check whether the Forgejo/Gitea API is reachable.
 *
 * Makes a lightweight authenticated request to the repo endpoint and resolves
 * true only when the instance responds successfully. Any network error, timeout,
 * or non-2xx status resolves false so callers can decide how to proceed.
 *
 * @returns {Promise<boolean>}
 */
export async function checkForgejoAvailability() {
    const { baseUrl, owner, repo } = getRepoContext();
    const url = `${baseUrl}/repos/${owner}/${repo}`;

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const res = await fetch(url, {
            headers: getHeaders(),
            signal: controller.signal,
        });
        clearTimeout(timeout);

        return res.ok;
    } catch {
        return false;
    }
}