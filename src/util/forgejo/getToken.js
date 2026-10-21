// getToken.js - Resolve the Forgejo/Gitea token for the current repository
//
// The domain file's token wins; FORGEJO_TOKEN, ~/.forgejo-cli.env, and the OS
// vault follow. See instanceConfig.js.
import { getInstanceToken } from "./instanceConfig.js";

export function getToken(gitGuiFriendly = false) {
    return getInstanceToken(gitGuiFriendly);
}
