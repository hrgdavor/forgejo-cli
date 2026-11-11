// checkoutBranch.js - Switch to an existing branch (local or remote-tracking)
import { git } from "./git.js";
import { fail } from "../general/fail.js";
import { ok } from "../general/ok.js";

export function checkoutBranch(branchName) {
    let checkout = git(["checkout", branchName]);
    if (checkout.exitCode !== 0) {
        // If branch exists only as origin/<name>, create/reset a local tracking branch.
        checkout = git(["checkout", "-B", branchName, `origin/${branchName}`]);
    }
    if (checkout.exitCode !== 0) {
        fail(`Failed to checkout branch "${branchName}": ${checkout.stderr}`);
    }
    ok(`Switched to branch "${branchName}".`);
}