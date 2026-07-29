// getToken.js - Lazily reads FORGEJO_TOKEN from the environment or OS vault
import { getSecret } from "../general/getSecret.js";

export function getToken(gitGuiFriendly = false) {
    return getSecret("forgejo-token", "FORGEJO_TOKEN", true, gitGuiFriendly);
}