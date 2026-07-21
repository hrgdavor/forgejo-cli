#!/usr/bin/env bun
// fg-align.js
import { getRepoContext, getHeaders, fetchAllPages } from "./forgejo-utils.js";
import { spawnSync } from "bun";
import { fail, info, ok } from "./utils.js";

const { baseUrl, owner, repo } = getRepoContext();

function printHelp() {
    console.log("Usage:");
    console.log("  bun run src/fg-align.js              – list open PRs with mergeable status");
    console.log("  bun run src/fg-align.js all          – merge base into all mergeable PR branches and push");
    console.log("  bun run src/fg-align.js <PR-number>  – merge base into a specific PR branch and push");
    console.log("  bun run src/fg-align.js --help       – show this help message");
    console.log("");
    console.log("Alignment means merging the base branch into the PR branch");
    console.log("so the PR is no longer behind. It does NOT merge the PR into base.");
    console.log("");
    console.log("Flags:");
    console.log("  all             Merge base into every open PR that is mergeable and push");
    console.log("  <PR-number>     Numeric PR ID to merge base into if mergeable and push");
    console.log("  --help, -h      Show this help");
    console.log("");
    console.log("Environment variables:");
    console.log("  FORGEJO_TOKEN  – Forgejo/Gitea personal access token");
    process.exit(0);
}

function isMergeable(details) {
    return details.mergeable === true;
}

function statusIcon(details) {
    if (details.mergeable) return "✅";
    const state = details.mergeable_state || "blocked";
    return "❌";
}

function fetchRefs(baseRef, headRef) {
    spawnSync(["git", "fetch", "origin", baseRef, headRef], { stdio: ["pipe", "pipe", "pipe"] });
}

function getBehindCount(baseRef, headRef) {
    fetchRefs(baseRef, headRef);
    const result = spawnSync(["git", "rev-list", "--count", `${headRef}..${baseRef}`]);
    if (result.exitCode === 0) {
        return parseInt(result.stdout.toString().trim(), 10);
    }
    return null;
}

async function fetchPrDetails(prNumber) {
    const res = await fetch(`${baseUrl}/repos/${owner}/${repo}/pulls/${prNumber}`, { headers: getHeaders() });
    if (!res.ok) throw new Error(`Failed to fetch PR #${prNumber}: ${res.statusText}`);
    return await res.json();
}

function runGit(args, label) {
    const result = spawnSync(["git", ...args]);
    if (result.exitCode !== 0) {
        const msg = result.stderr.toString().trim() || result.stdout.toString().trim();
        throw new Error(`${label}: ${msg}`);
    }
    return result.stdout.toString().trim();
}

async function alignPr(prNumber) {
    const details = await fetchPrDetails(prNumber);
    const headRef = details.head.ref;
    const baseRef = details.base.ref;

    const behindCount = getBehindCount(baseRef, headRef);
    if (behindCount === 0) {
        console.log(`✅ PR #${prNumber} is already up to date with ${baseRef}. Nothing to do.`);
        return true;
    }

    const currentBranch = runGit(["branch", "--show-current"], "get current branch");

    const statusResult = spawnSync(["git", "status", "--porcelain"], { stdio: ["pipe", "pipe", "pipe"] });
    if (statusResult.exitCode === 0 && statusResult.stdout.toString().trim()) {
        fail(`Working tree is not clean on "${currentBranch}". Stash or commit changes before aligning.`);
    }

    const headBranch = runGit(["branch", "--list", headRef], "branch check");
    if (!headBranch) {
        const remoteHead = runGit(["branch", "-r", "--list", `origin/${headRef}`], "remote branch check");
        if (!remoteHead) {
            fail(`Branch "${headRef}" not found locally or on origin. Cannot merge.`);
        }
        runGit(["branch", headRef, `origin/${headRef}`], "create local branch");
    }

    info(`Checking out ${headRef}...`);
    const checkout = spawnSync(["git", "checkout", headRef], { stdio: ["pipe", "pipe", "pipe"] });
    if (checkout.exitCode !== 0) {
        fail(`Failed to checkout ${headRef}: ${checkout.stderr.toString().trim()}`);
    }

    info(`Merging ${baseRef} into ${headRef}...`);
    const merge = spawnSync([
        "git", "merge", `origin/${baseRef}`,
        "--no-ff",
        "-m", `Merge branch '${baseRef}' into ${headRef}`
    ], { stdio: ["pipe", "pipe", "pipe"] });

    if (merge.exitCode !== 0) {
        const mergeErr = merge.stderr.toString().trim();
        if (/already up to date/i.test(mergeErr)) {
            console.log(`✅ PR #${prNumber} is already up to date with ${baseRef}.`);
            return true;
        }
        console.error(`❌ Merge of PR #${prNumber} failed. Resolve conflicts, then run:`);
        console.error(`   git checkout ${headRef} && git commit && git push origin ${headRef}`);
        console.error(`   ${mergeErr}`);
        return false;
    }

    info(`Force-pushing ${headRef}...`);
    const push = spawnSync(["git", "push", "--force-with-lease", "origin", headRef], { stdio: ["pipe", "pipe", "pipe"] });
    if (push.exitCode !== 0) {
        const pushErr = push.stderr.toString().trim();
        if (/permission|protected|fork/i.test(pushErr)) {
            console.error(`⚠️  Cannot push to "${headRef}" — this PR is from a fork or branch is protected.`);
            console.error(`   Please merge and push locally:`);
            console.error(`   git checkout ${headRef} && git merge ${baseRef} --no-ff -m "Merge branch '${baseRef}' into ${headRef}" && git push --force-with-lease origin ${headRef}`);
        } else {
            console.error(`❌ Force-push failed for PR #${prNumber}: ${pushErr}`);
        }
        return false;
    }

    return true;
}

async function main() {
    const args = Bun.argv.slice(2);

    if (args.includes("--help") || args.includes("-h")) {
        printHelp();
    }

    const mode = args[0] || "list";
    const targetPrId = mode === "all" ? null : (mode === "list" ? null : mode);

    if (targetPrId !== null && !/^\d+$/.test(targetPrId)) {
        fail(`Invalid PR ID: "${mode}". Expected a numeric PR ID or "all".`);
    }

    const listOnly = mode === "list";

    let prs = [];
    if (listOnly) {
        info(`Fetching open PRs for ${owner}/${repo}...`);
        prs = await fetchAllPages(`${baseUrl}/repos/${owner}/${repo}/pulls?state=open`);
    }

    if (listOnly) {
        if (prs.length === 0) {
            console.log("✅ No open pull requests found.");
            process.exit(0);
        }

        const prDetailsMap = new Map();
        for (const pr of prs) {
            prDetailsMap.set(pr.number, await fetchPrDetails(pr.number));
        }

        console.log(`📊 Open PRs for ${owner}/${repo}:\n`);
        prs.forEach(pr => {
            const details = prDetailsMap.get(pr.number);
            const icon = statusIcon(details);
            const state = details.mergeable_state || (details.mergeable ? "clean" : "blocked");
            const behindCount = getBehindCount(details.base.ref, details.head.ref);
            const behindInfo = behindCount !== null && behindCount > 0 ? `, behind: ${behindCount}` : "";
            console.log(`${icon} #${pr.number}  ${pr.head.ref} : ${pr.title}  [${state}${behindInfo}]`);
        });
        process.exit(0);
    }

    const shouldAlignAll = mode === "all";

    let prsToProcess = [];
    if (shouldAlignAll) {
        info(`Fetching open PRs for ${owner}/${repo}...`);
        prs = await fetchAllPages(`${baseUrl}/repos/${owner}/${repo}/pulls?state=open`);
        if (prs.length === 0) {
            console.log("✅ No open pull requests found.");
            process.exit(0);
        }
        prsToProcess = prs;
    } else {
        const details = await fetchPrDetails(parseInt(targetPrId, 10));
        const isOpen = details.state === "open";
        if (!isOpen) {
            fail(`PR #${targetPrId} is not open (state: ${details.state}).`);
        }
        prsToProcess = [{ number: details.number, title: details.title, head: { ref: details.head.ref }, base: { ref: details.base.ref } }];
    }

    const prDetailsMap = new Map();
    for (const pr of prsToProcess) {
        prDetailsMap.set(pr.number, await fetchPrDetails(pr.number));
    }

    let alignedCount = 0;

    for (const pr of prsToProcess) {
        const details = prDetailsMap.get(pr.number);
        const state = details.mergeable_state || (details.mergeable ? "clean" : "blocked");
        const behindCount = getBehindCount(details.base.ref, details.head.ref);

        if (!isMergeable(details)) {
            console.log(`🚫 Skipping PR #${pr.number} (state: ${state}): ${pr.title}`);
            continue;
        }

        if (behindCount === 0) {
            if (shouldAlignAll) {
                continue;
            }
            console.log(`✅ PR #${pr.number} is already up to date with ${details.base.ref}. Nothing to do.`);
            continue;
        }

        console.log(`🔄 Aligning PR #${pr.number}: "${pr.title}"...`);
        const success = await alignPr(pr.number);
        if (success) {
            ok(`PR #${pr.number} successfully aligned with base and pushed!`);
            alignedCount++;
        }
    }

    console.log(`\n🏁 Done! Successfully aligned ${alignedCount} PR(s).`);
}

main().catch(err => {
    console.error("❌ Error running script:", err.message);
    process.exit(1);
});



















