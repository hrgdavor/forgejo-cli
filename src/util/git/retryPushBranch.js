// retryPushBranch.js - Push a branch to origin without setting upstream
import { git } from "./git.js";
import { fail } from "../general/fail.js";
import { ok } from "../general/ok.js";

export function retryPushBranch(branchName) {
    const push = git(["push", "origin", branchName]);
    if (push.exitCode !== 0) {
        fail(`Failed to push branch "${branchName}": ${push.stderr}`);
    }
    ok(`Branch pushed to origin/${branchName}.`);
}