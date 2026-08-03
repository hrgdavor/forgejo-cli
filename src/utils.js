// utils.js - Re-export barrel for backward compatibility
// All functions have been moved to src/util/{general,git}/
export { fail } from "./util/general/fail.js";
export { info } from "./util/general/info.js";
export { ok } from "./util/general/ok.js";
export { readPackageJson } from "./util/general/readPackageJson.js";
export { openBrowser } from "./util/general/openBrowser.js";
export { sanitizeBranchName } from "./util/git/sanitizeBranchName.js";
export { getLastCommitMessage } from "./util/git/getLastCommitMessage.js";
export { git } from "./util/git/git.js";
export { logActivity } from "./util/general/logActivity.js";
