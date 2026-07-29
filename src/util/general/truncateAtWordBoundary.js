// truncateAtWordBoundary.js - Truncate string at word boundary (space, dot, comma, dash)
//
// Reads max length from package.json redmine_pr_title_max, default 80.

/**
 * Truncate a string to a maximum length, cutting at the last word boundary
 * (space, dot, comma, dash) so no words are broken.
 * If the string is already short enough, returns it as-is.
 *
 * @param {string} str  - The string to truncate
 * @param {number} max  - Maximum allowed length (default 80)
 * @returns {string}    - Truncated string, or original if within limit
 */
export function truncateAtWordBoundary(str, max = 80) {
    if (str.length <= max) return str;
    // Find the last boundary character (space, dot, comma, dash) before max
    const re = /[ .,-]/g;
    let cut = -1;
    let m;
    while ((m = re.exec(str)) !== null && m.index < max) {
        cut = m.index;
    }
    // If no boundary found, hard-cut at max
    if (cut === -1) return str.slice(0, max);
    return str.slice(0, cut);
}