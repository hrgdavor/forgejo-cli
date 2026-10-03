// hasUncommittedChanges.js - True when the worktree has staged, unstaged or untracked changes
import { git } from "./git.js";

export function hasUncommittedChanges() {
    const status = git(["status", "--porcelain"]);
    if (status.exitCode !== 0) {
        return false;
    }
    return status.stdout.length > 0;
}
