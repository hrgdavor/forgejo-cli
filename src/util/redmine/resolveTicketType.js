// resolveTicketType.js - Resolve the ticket-type prefix (e.g. "BUG") used in
// branch names from the Redmine issue's tracker, using an OPTIONAL
// package.json key:
//
//   "redmine_ticket_types": {
//     "Bug":    "BUG",
//     "Feature": "FEATURE",
//     "Task":   "TASK"
//   }
//
// - If the issue has no tracker, or the tracker name is absent from the map,
//   an empty string is returned (no prefix), preserving the legacy
//   "<ticketNumber>-<title>" branch shape.
// - Tracker name matching against the map is **case-insensitive**, so a
//   tracker reported as "bug", "BUG" or "Bug" all resolve to the prefix
//   under whichever casing you use in the map.
// - When a map entry matches, its value is used verbatim as the prefix.
//   Keep values branch-name-safe (alphanumeric, uppercase preferred).
// - If the tracker name matches multiple keys case-insensitively, the first
//   case-insensitive hit wins.
import { readPackageJson } from "../general/readPackageJson.js";

export function resolveTicketType(issue) {
    const trackerName = issue && issue.tracker && issue.tracker.name;
    if (!trackerName) return "";

    const pkg = readPackageJson();
    const typeMap = pkg && pkg.redmine_ticket_types;
    if (!typeMap || typeof typeMap !== "object") return "";

    const lower = trackerName.toLowerCase();
    for (const key of Object.keys(typeMap)) {
        if (key.toLowerCase() === lower) {
            const prefix = typeMap[key];
            return typeof prefix === "string" && prefix.length > 0 ? prefix : "";
        }
    }

    return "";
}
