// getLastCommitMessage.js - Get the last commit message
import { spawnSync } from "bun";

export function getLastCommitMessage() {
    const result = spawnSync(["git", "log", "-1", "--pretty=%B"]);
    if (result.exitCode !== 0) {
        console.error(`❌ Failed to get last commit message: ${result.stderr.toString().trim()}`);
        process.exit(1);
    }
    const msg = result.stdout.toString().trim();
    if (!msg) {
        console.error("❌ No commit message found (empty repository?).");
        process.exit(1);
    }
    return msg;
}