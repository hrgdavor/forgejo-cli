// fetchPagesUntil.js - Page through a list endpoint, stopping when `shouldStop` returns true
import { getHeaders } from "./getHeaders.js";

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