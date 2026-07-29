// extractTicketFromBranch.js - Extract a Redmine ticket number from a branch name
//
// Examples:
//   12345-fix-bug     → "12345"
//   42                → "42"
//   main              → null
//   feature/xyz       → null

export function extractTicketFromBranch(branchName) {
    const match = branchName.match(/^(\d+)/);
    return match ? match[1] : null;
}