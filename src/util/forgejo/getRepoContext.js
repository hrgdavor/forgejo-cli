// getRepoContext.js - Resolve { baseUrl, owner, repo } for the current repository
//
// The domain, URL, and token come from instanceConfig.js, which reads
// ~/.forgejo-cli/<domain>.json before falling back to the git remote and the
// legacy environment/vault lookups.
import { getInstanceConfig } from "./instanceConfig.js";

export function getRepoContext() {
    const { baseUrl, owner, repo } = getInstanceConfig();
    return { baseUrl, owner, repo };
}
