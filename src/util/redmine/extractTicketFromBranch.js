// extractTicketFromBranch.js - Extract a Redmine ticket number from a branch name
//
// Supports both the legacy "<num>-<title>" shape and the ticket-type-prefixed
// "<PREFIX>-<num>-<title>" shape (PREFIX = run of uppercase letters, e.g. "BUG").
//
// Examples:
//   12345-fix-bug        → "12345"
//   BUG-12345-fix-bug    → "12345"
//   FEATURE-42           → "42"
//   42                   → "42"
//   main                 → null
//   feature/xyz          → null
//
export function extractTicketFromBranch(branchName) {
    const short = branchName.replace(/^origin\//, "");
    const match = short.match(/^(?:[A-Z]+-)?(\d+)/);
    return match ? match[1] : null;
}
