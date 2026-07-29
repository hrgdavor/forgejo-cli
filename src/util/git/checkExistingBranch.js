// checkExistingBranch.js - Check if a branch exists for a ticket number
import { git } from "./git.js";
import { fail } from "../general/fail.js";
import { ok } from "../general/ok.js";

export function checkExistingBranch(ticketNumber) {
    const localBranches = git(["branch", "--list", "--format=%(refname:short)"]);
    const localMatch = localBranches.stdout
        .split("\n")
        .find(b => b.startsWith(ticketNumber + "-") || b === ticketNumber);

    const remoteBranches = git(["branch", "-r", "--list", "--format=%(refname:short)"]);
    const remoteMatch = remoteBranches.stdout
        .split("\n")
        .find(b => {
            const short = b.replace(/^origin\//, "");
            return short.startsWith(ticketNumber + "-") || short === ticketNumber;
        });

    if (localMatch || remoteMatch) {
        const found = localMatch || remoteMatch;
        fail(`Branch "${found}" already exists (ticket #${ticketNumber}). Please handle manually.`);
    }

    ok(`No existing branch found for ticket #${ticketNumber}.`);
}