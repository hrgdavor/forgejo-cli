// checkExistingBranch.js - Check if a branch exists for a ticket number
//
// Recognizes both the legacy "<num>-<title>" shape and the
// ticket-type-prefixed "<PREFIX>-<num>-<title>" shape produced by
// resolveTicketType / computeBranchName. If either a local or remote
// branch for that ticket is found, fail() halts the caller so duplicate
// branches don't get created.
import { git } from "./git.js";
import { fail } from "../general/fail.js";
import { ok } from "../general/ok.js";

// Returns the ticket number that a branch belongs to, or null.
// Accepts an optional uppercase type prefix like "BUG-".
function ticketNumberOf(branch) {
    const short = branch.replace(/^origin\//, "").replace(/^[A-Z]+-/, "");
    const match = short.match(/^(\d+)/);
    return match ? match[1] : null;
}

export function checkExistingBranch(ticketNumber) {
    const localBranches = git(["branch", "--list", "--format=%(refname:short)"]);
    const localMatch = localBranches.stdout
        .split("\n")
        .find(b => ticketNumberOf(b) === ticketNumber);

    const remoteBranches = git(["branch", "-r", "--list", "--format=%(refname:short)"]);
    const remoteMatch = remoteBranches.stdout
        .split("\n")
        .find(b => ticketNumberOf(b) === ticketNumber);

    if (localMatch || remoteMatch) {
        const found = localMatch || remoteMatch;
        fail(`Branch "${found}" already exists (ticket #${ticketNumber}). Please handle manually.`);
    }

    ok(`No existing branch found for ticket #${ticketNumber}.`);
}
