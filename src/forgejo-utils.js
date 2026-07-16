// forgejo-utils.js
import { spawnSync } from "bun";
import { getSecret } from "./get-secret.js";

/**
 * Lazily reads FORGEJO_TOKEN from the environment or OS vault. Only throws
 * when actually called, so scripts that never need the API (e.g. local-only
 * git lookups) can import from this module without triggering a process.exit().
 */
export function getToken(gitGuiFriendly = false) {
    return getSecret("forgejo-token", "FORGEJO_TOKEN", true, gitGuiFriendly);
}

/**
 * Lazily builds the headers object using getToken(), so the token check only
 * fires when a script actually makes an API call.
 */
export function getHeaders(gitGuiFriendly = false) {
    return {
        "Authorization": `token ${getToken(gitGuiFriendly)}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
    };
}

export function getRepoContext() {
    const result = spawnSync(["git", "remote", "get-url", "origin"]);
    if (result.exitCode !== 0) {
        console.error("❌ Error: Run this from a git repository with an 'origin' remote.");
        process.exit(1);
    }

    const remoteUrl = result.stdout.toString().trim();
    let match = remoteUrl.match(/https?:\/\/([^\/]+)\/([^\/]+)\/([^\/\.]+)/);
    if (!match) {
        match = remoteUrl.match(/git@([^:]+):([^\/]+)\/([^\/\.]+)/);
    }

    if (!match) {
        console.error(`❌ Error: Could not parse remote URL: ${remoteUrl}`);
        process.exit(1);
    }

    const [_, host, owner, repo] = match;
    const baseUrl = host.includes("localhost") ? `http://${host}/api/v1` : `https://${host}/api/v1`;

    return { baseUrl, owner, repo };
}

/**
 * Generic helper to exhaustively page through any Forgejo/Gitea list endpoint.
 * @param {string} url - The initial endpoint URL (without page/limit query params)
 * @returns {Promise<Array>} Cumulative results from all pages
 */
export async function fetchAllPages(url) {
    let results = [];
    let page = 1;
    let keepFetching = true;

    // Clean up URL parsing if it already contains some query marks
    const separator = url.includes("?") ? "&" : "?";
    const headers = getHeaders();

    while (keepFetching) {
        const targetUrl = `${url}${separator}page=${page}&limit=50`;
        const res = await fetch(targetUrl, { headers });

        if (!res.ok) {
            throw new Error(`API Request failed on page ${page}: ${res.statusText}`);
        }

        const pageItems = await res.json();
        if (pageItems.length === 0) {
            keepFetching = false;
        } else {
            results = results.concat(pageItems);
            page++;
        }
    }

    return results;
}

/**
 * Like fetchAllPages(), but stops paginating as soon as `shouldStop(item)`
 * returns true for some item on a page (that item is still included in the
 * result). Forgejo/Gitea list endpoints return newest-first by default, so
 * this lets incremental syncs bail out early once they reach an already-known
 * item instead of always paging through the entire list every run.
 * @param {string} url
 * @param {(item: any) => boolean} shouldStop
 * @returns {Promise<Array>}
 */
export async function fetchPagesUntil(url, shouldStop) {
    let results = [];
    let page = 1;
    let keepFetching = true;

    const separator = url.includes("?") ? "&" : "?";
    const headers = getHeaders();

    while (keepFetching) {
        const targetUrl = `${url}${separator}page=${page}&limit=50`;
        const res = await fetch(targetUrl, { headers });

        if (!res.ok) {
            throw new Error(`API Request failed on page ${page}: ${res.statusText}`);
        }

        const pageItems = await res.json();
        if (pageItems.length === 0) break;

        for (const item of pageItems) {
            results.push(item);
            if (shouldStop(item)) {
                keepFetching = false;
                break;
            }
        }
        page++;
    }

    return results;
}

/**
 * Runs `fn` over `items` with at most `limit` calls in flight at once,
 * instead of a plain sequential `for...await` loop. Useful for per-item API
 * detail fetches (e.g. one request per PR) where round-trip latency, not
 * server load, is the bottleneck.
 * @param {Array} items
 * @param {number} limit
 * @param {(item: any, index: number) => Promise<any>} fn
 * @returns {Promise<Array>} Results in the same order as `items`
 */
export async function mapWithConcurrency(items, limit, fn) {
    const results = new Array(items.length);
    let nextIndex = 0;

    async function worker() {
        while (nextIndex < items.length) {
            const current = nextIndex++;
            results[current] = await fn(items[current], current);
        }
    }

    const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
    await Promise.all(workers);

    return results;
}