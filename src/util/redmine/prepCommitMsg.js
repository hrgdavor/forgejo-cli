// prepCommitMsg.js - Add prefix to commit message if configured in package.json redmine_pr_info_text

export function prepCommitMsg(pkg, message){
    const withPrefix = pkg.redmine_pr_info_text ? (pkg.redmine_pr_info_text + ' ' + message) : message
    return 'Commit: ' + withPrefix
}