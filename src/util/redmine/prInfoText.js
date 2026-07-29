// prInfoText.js - Build PR info text for Redmine custom field

export function prInfoText(pkg, branchName, pr) {
    return `${pkg.redmine_pr_info_text} branch: ${branchName} | ${pr.html_url}`;
}