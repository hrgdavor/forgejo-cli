#!/usr/bin/env bun
// fg-align.js
import { getRepoContext, getHeaders, fetchAllPages } from "./forgejo-utils.js";
import { spawnSync } from "bun";
import { fail, info, ok } from "./utils.js";

const { baseUrl, owner, repo } = getRepoContext();

function printHelp() {
    console.log("Usage:");
    console.log("  bun run src/fg-align.js                – list open PRs with mergeable status");
    console.log("  bun run src/fg-align.js all            – merge base into all mergeable PR branches and push");
    console.log("  bun run src/fg-align.js <PR-numbers>   – merge base into specific PR branches and push");
    console.log("  bun run src/fg-align.js --help         – show this help message");
    console.log("");
    console.log("Alignment means merging the base branch into the PR branch");
    console.log("so the PR is no longer behind. It does NOT merge the PR into base.");
    console.log("");
    console.log("Flags:");
    console.log("  all                    Merge base into every open PR that is mergeable and push");
    console.log("  <PR-numbers>           Numeric PR IDs, comma-separated (e.g. 123,456,789)");
    console.log("  --help, -h             Show this help");
    console.log("");
    console.log("Environment variables:");
    console.log("  FORGEJO_TOKEN  – Forgejo/Gitea personal access token");
    process.exit(0);
}

function isMergeable(details) {
    return details.mergeable === true;
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

    info(`Fetching ${baseRef} from origin...`);
    spawnSync(["git", "fetch", "origin", baseRef], { stdio: ["pipe", "pipe", "pipe"] });

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

    const allArgs = args.flatMap(a => a.split(","));
    const firstArg = allArgs[0] || "list";

    if (firstArg === "--help" || firstArg === "-h") {
        printHelp();
    }

    const listOnly = firstArg === "list";
    const shouldAlignAll = firstArg === "all";

    let targetPrIds = [];
    if (!listOnly && !shouldAlignAll) {
        targetPrIds = allArgs.filter(a => /^\d+$/.test(a));
        if (targetPrIds.length === 0) {
            fail(`Invalid PR IDs. Expected numeric PR IDs, comma-separated list, or "all".`);
        }
    }

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

        prs.sort((a, b) => (a.user?.login || "").localeCompare(b.user?.login || ""));

        console.log(`  found ${prs.length} PRs, fetching details...`);

        const t0 = performance.now();
        const prDetails = await Promise.all(prs.map(pr => fetchPrDetails(pr.number)));
        const t1 = performance.now();
        console.log(`  fetched all PR details in ${(t1 - t0).toFixed(0)}ms`);

        const prDetailsMap = new Map();
        for (const [idx, pr] of prs.entries()) {
            prDetailsMap.set(pr.number, prDetails[idx]);
        }

        console.log(`📊 Open PRs for ${owner}/${repo}:\n`);
        const behindPrs = [];
        prs.forEach(pr => {
            const details = prDetailsMap.get(pr.number);
            const hasConflict = details.mergeable === false;
            const isBehind = details.merge_base && details.base?.sha && details.merge_base !== details.base.sha;
            if (isBehind && !hasConflict) behindPrs.push(pr.number);
            const icon = hasConflict ? "❌" : isBehind ? "📉" : "✅";
            const state = hasConflict ? "blocked" : isBehind ? "behind" : "clean";
            const author = details.user ? details.user.login : "unknown";
            const updated = details.updated_at ? new Date(details.updated_at).toLocaleString() : "";
            console.log(`${icon} ${(state || "").padEnd(10, " ")} | ${(pr.number+'').padStart(5,' ')} | ${(author||'').padEnd(12,' ')} | ${updated} | ${pr.title}`);
        });
        if (behindPrs.length > 0) {
            console.log(`\nBehind PRs: ${behindPrs.join(",")}`);
        }
        process.exit(0);
    }

    let prsToProcess = [];
    if (shouldAlignAll) {
        info(`Fetching open PRs for ${owner}/${repo}...`);
        prs = await fetchAllPages(`${baseUrl}/repos/${owner}/${repo}/pulls?state=open`);
        if (prs.length === 0) {
            console.log("✅ No open pull requests found.");
            process.exit(0);
        }
        prsToProcess = prs;
        prsToProcess.sort((a, b) => (a.user?.login || "").localeCompare(b.user?.login || ""));
    } else {
        for (const prId of targetPrIds) {
            const details = await fetchPrDetails(parseInt(prId, 10));
            if (details.state !== "open") {
                console.error(`⚠️  PR #${prId} is not open (state: ${details.state}). Skipping.`);
                continue;
            }
            prsToProcess.push({ number: details.number, title: details.title, head: { ref: details.head.ref }, base: { ref: details.base.ref } });
        }
        if (prsToProcess.length === 0) {
            fail("No open PRs to process.");
        }
    }

    const prDetails = await Promise.all(prsToProcess.map(pr => fetchPrDetails(pr.number)));
    const prDetailsMap = new Map();
    for (const [idx, pr] of prsToProcess.entries()) {
        prDetailsMap.set(pr.number, prDetails[idx]);
    }

    let alignedCount = 0;

    for (const pr of prsToProcess) {
        const details = prDetailsMap.get(pr.number);
        const hasConflict = details.mergeable === false;
        const isBehind = details.merge_base && details.base?.sha && details.merge_base !== details.base.sha;
        const state = hasConflict ? "blocked" : isBehind ? "behind" : "clean";

        if (!isMergeable(details)) {
            console.log(`🚫 Skipping PR #${pr.number} (state: ${state}): ${pr.title}`);
            continue;
        }

        if (!isBehind) {
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

















