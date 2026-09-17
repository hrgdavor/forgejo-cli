// extractTicketFromBranch.js - Extract a Redmine ticket number from a branch name
//
// Supports three shapes:
//   1. "<num>-<title>"                    – number is the first word
//   2. "<PREFIX>-<num>-<title>"           – number is the second word after an uppercase prefix (e.g. "BUG")
//   3. "<word>-<num>-<title>"             – number is the second word after any case word (e.g. "followup")
//
// Examples:
//   12345-fix-bug        → "12345"
//   BUG-12345-fix-bug    → "12345"
//   followup-9715-foo    → "9715"
//   FEATURE-42           → "42"
//   42                   → "42"
//   main                 → null
//   feature/xyz          → null
//
export function extractTicketFromBranch(branchName) {
    const short = branchName.replace(/^origin\//, "");
    const match = short.match(/^(?:[A-Za-z]+-)?(\d+)/);
    return match ? match[1] : null;
}
