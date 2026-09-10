// computeBranchName.js - Compute branch name from ticket number and title
import { sanitizeBranchName } from "../git/sanitizeBranchName.js";

// When provided, `ticketType` (e.g. "BUG", "FEATURE") is prepended as a
// prefix:  "<TYPE>-<ticketNumber>-<sanitized-title>".
// When omitted the legacy "<ticketNumber>-<title>" shape is preserved.
export function computeBranchName(ticketNumber, title, ticketType = "") {
    const typePrefix = ticketType ? `${ticketType}-` : "";
    return `${typePrefix}${ticketNumber}-${sanitizeBranchName(title)}`;
}
