// getCurrentBranch.js - Get the current git branch name
import { git } from "./git.js";

export function getCurrentBranch() {
    return git(["rev-parse", "--abbrev-ref", "HEAD"]).stdout;
}