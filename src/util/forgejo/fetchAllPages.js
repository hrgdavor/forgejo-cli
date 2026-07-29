// fetchAllPages.js - Exhaustively page through any Forgejo/Gitea list endpoint
import { getHeaders } from "./getHeaders.js";

export async function fetchAllPages(url) {
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
        if (pageItems.length === 0) {
            keepFetching = false;
        } else {
            results = results.concat(pageItems);
            page++;
        }
    }

    return results;
}