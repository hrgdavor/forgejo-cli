// computeBranchName.js - Compute branch name from ticket number and title
import { sanitizeBranchName } from "../git/sanitizeBranchName.js";

export function computeBranchName(ticketNumber, title) {
    return `${ticketNumber}-${sanitizeBranchName(title)}`;
}