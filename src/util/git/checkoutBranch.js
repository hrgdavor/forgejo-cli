// checkoutBranch.js - Switch to an existing local branch
import { git } from "./git.js";
import { fail } from "../general/fail.js";
import { ok } from "../general/ok.js";

export function checkoutBranch(branchName) {
    const checkout = git(["checkout", branchName]);
    if (checkout.exitCode !== 0) {
        fail(`Failed to checkout branch "${branchName}": ${checkout.stderr}`);
    }
    ok(`Switched to branch "${branchName}".`);
}