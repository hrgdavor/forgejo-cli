// checkExistingBranch.js - Check if a branch exists for a ticket number
//
// Recognizes the same branch-name shapes as extractTicketFromBranch:
//   "<num>-<title>" or "<PREFIX>-<num>-<title>" (PREFIX optional, any case).
// If either a local or remote branch for that ticket is found, fail() halts
// the caller so duplicate branches don't get created.
import { git } from "./git.js";
import { fail } from "../general/fail.js";
import { ok } from "../general/ok.js";
import { extractTicketFromBranch } from "../redmine/extractTicketFromBranch.js";

export function checkExistingBranch(ticketNumber) {
    const localBranches = git(["branch", "--list", "--format=%(refname:short)"]);
    const localMatch = localBranches.stdout
        .split("\n")
        .find(b => extractTicketFromBranch(b) === ticketNumber);

    const remoteBranches = git(["branch", "-r", "--list", "--format=%(refname:short)"]);
    const remoteMatch = remoteBranches.stdout
        .split("\n")
        .find(b => extractTicketFromBranch(b) === ticketNumber);

    if (localMatch || remoteMatch) {
        const found = localMatch || remoteMatch;
        fail(`Branch "${found}" already exists (ticket #${ticketNumber}). Please handle manually.`);
    }

    ok(`No existing branch found for ticket #${ticketNumber}.`);
}
