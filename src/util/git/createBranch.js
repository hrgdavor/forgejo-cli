// createBranch.js - Create a git branch and check it out
import { git } from "./git.js";
import { fail } from "../general/fail.js";
import { ok } from "../general/ok.js";

export function createBranch(branchName) {
    const checkout = git(["checkout", "-b", branchName]);
    if (checkout.exitCode !== 0) {
        fail(`Failed to create branch "${branchName}": ${checkout.stderr}`);
    }
    ok(`Branch "${branchName}" created and checked out.`);
}