// sanitizeBranchName.js - Sanitize a string for use as a git branch name
//
//  - lowercase
//  - replace non-alphanumeric (except hyphens/underscores) with hyphens
//  - collapse multiple hyphens
//  - trim leading/trailing hyphens

export function sanitizeBranchName(str) {
    return str
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "");
}