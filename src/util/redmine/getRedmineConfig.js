// getRedmineConfig.js - Get Redmine credentials and base URL
import { getSecret } from "../general/getSecret.js";

export function getRedmineConfig(gitGuiFriendly = false) {
    const baseUrl = getSecret("redmine-url", "REDMINE_URL", true, gitGuiFriendly);
    const apiKey  = getSecret("redmine-api-token", "REDMINE_API_KEY", true, gitGuiFriendly);
    return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}