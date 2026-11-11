// checkExistingBranch.js - Find an existing branch for a ticket number
//
// Recognizes the same branch-name shapes as extractTicketFromBranch:
//   "<num>-<title>" or "<PREFIX>-<num>-<title>" (PREFIX optional, any case).
// Returns the matching local/remote branch name, or null if none exists.
import { git } from "./git.js";
import { extractTicketFromBranch } from "../redmine/extractTicketFromBranch.js";

function branchExists(ref) {
    return git(["show-ref", "--verify", "--quiet", ref]).exitCode === 0;
}

export function findExistingBranchForTicket(ticketNumber, branchName = null) {
    const ticket = String(ticketNumber);

    const localBranches = git(["branch", "--list", "--format=%(refname:short)"]).stdout
        .split("\n")
        .map(b => b.trim())
        .filter(Boolean);
    let localMatch = localBranches.find(b => extractTicketFromBranch(b) === ticket) || null;

    const remoteBranches = git(["branch", "-r", "--list", "--format=%(refname:short)"]).stdout
        .split("\n")
        .map(b => b.trim())
        .filter(Boolean);
    let remoteMatch = remoteBranches.find(b => extractTicketFromBranch(b) === ticket) || null;

    if (branchName) {
        if (!localMatch && branchExists(`refs/heads/${branchName}`)) localMatch = branchName;
        if (!remoteMatch && branchExists(`refs/remotes/origin/${branchName}`)) remoteMatch = `origin/${branchName}`;
    }

    return { local: localMatch || null, remote: remoteMatch || null };
}

export function checkExistingBranch(ticketNumber) {
    const { local, remote } = findExistingBranchForTicket(ticketNumber);
    return local || remote || null;
}
