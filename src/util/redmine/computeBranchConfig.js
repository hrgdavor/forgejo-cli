// computeBranchConfig.js - Read branch config from package.json
import { readPackageJson } from "../general/readPackageJson.js";

export function computeBranchConfig() {
    const pkg = readPackageJson();
    const defaultBaseBranch = pkg.redmine_pr_default_base_branch || "main";
    return { pkg, defaultBaseBranch };
}