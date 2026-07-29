// extractTicketFromMessage.js - Extract a Redmine ticket number from a commit message
//
// Examples:
//   "#12345 fix bug"      → "12345"
//   "12345 fix bug"       → "12345"
//   "fix bug #12345"      → "12345"
//   "fix bug"             → null

export function extractTicketFromMessage(message) {
    const hashMatch = message.match(/#(\d+)/);
    if (hashMatch) return hashMatch[1];
    const leadMatch = message.match(/^(\d+)\b/);
    if (leadMatch) return leadMatch[1];
    return null;
}