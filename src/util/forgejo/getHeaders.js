// getHeaders.js - Build the Authorization headers object for Forgejo/Gitea API
import { getToken } from "./getToken.js";

export function getHeaders(gitGuiFriendly = false) {
    return {
        "Authorization": `token ${getToken(gitGuiFriendly)}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
    };
}