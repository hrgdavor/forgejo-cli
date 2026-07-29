// getRepoContext.js - Parse the git remote origin URL into { baseUrl, owner, repo }
import { spawnSync } from "bun";

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