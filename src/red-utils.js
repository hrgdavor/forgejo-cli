// red-utils.js - Re-export barrel for backward compatibility
// All functions have been moved to src/util/{redmine,forgejo,git}/
export { getRedmineConfig } from "./util/redmine/getRedmineConfig.js";
export { fetchRedmineIssue } from "./util/redmine/fetchRedmineIssue.js";
export { getRedmineField } from "./util/redmine/getRedmineField.js";
export { updateRedmineField } from "./util/redmine/updateRedmineField.js";
export { addRedmineNote } from "./util/redmine/addRedmineNote.js";
export { extractTicketFromBranch } from "./util/redmine/extractTicketFromBranch.js";
export { prepCommitMsg } from "./util/redmine/prepCommitMsg.js";
export { extractTicketFromMessage } from "./util/redmine/extractTicketFromMessage.js";
export { computeBranchConfig } from "./util/redmine/computeBranchConfig.js";
export { computeBranchName } from "./util/redmine/computeBranchName.js";
export { validateTicketNumber } from "./util/redmine/validateTicketNumber.js";
export { prInfoText } from "./util/redmine/prInfoText.js";
export { appendRedminePrField } from "./util/redmine/appendRedminePrField.js";
export { postLastCommitMessage } from "./util/redmine/postLastCommitMessage.js";
export { createPullRequest } from "./util/forgejo/createPullRequest.js";
export { getCurrentBranch } from "./util/git/getCurrentBranch.js";
export { promptChoice } from "./util/git/promptChoice.js";
export { checkExistingBranch } from "./util/git/checkExistingBranch.js";
export { createBranch } from "./util/git/createBranch.js";
export { pushBranch } from "./util/git/pushBranch.js";
export { retryPushBranch } from "./util/git/retryPushBranch.js";