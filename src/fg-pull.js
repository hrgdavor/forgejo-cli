#!/usr/bin/env bun
// fg-pull.js
// Batch-pull commits from the upstream/remote tracking branch into the current branch.
// Skips commits already present locally (same patch-id) and shows live progress.
// Usage: bun run src/fg-pull.js [batch-size]
import { spawnSync } from "bun";

const rawArg = Bun.argv[2];
const batchSize = rawArg ? parseInt(rawArg, 10) : 1;

if (!rawArg && Bun.argv[2] !== undefined) {
    console.error("❌ Error: Batch size must be a positive integer.");
    process.exit(1);
}

if (isNaN(batchSize) || batchSize < 1) {
    console.error("❌ Error: Batch size must be at least 1.");
    process.exit(1);
}

function runGit(args) {
    const result = spawnSync(["git", ...args]);
    if (result.exitCode !== 0) {
        console.error(`❌ Git command failed: git ${args.join(" ")}`);
        console.error(result.stderr.toString().trim());
        process.exit(1);
    }
    return result.stdout.toString().trim();
}

async function runGitAsync(args, retries = 3, backoffMs = 2000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        const proc = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "pipe" });
        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        await proc.exited;

        if (proc.exitCode === 0) {
            return stdout.trim();
        }

        const isTransient = /HTTP \d{3}|504|502|503|curl \d+|RPC failed|expected 'acknowledgments'/.test(stderr);

        if (isTransient && attempt < retries) {
            const wait = backoffMs * attempt;
            console.log(`⚠️  Transient fetch error (attempt ${attempt}/${retries}). Retrying in ${wait}ms...`);
            await Bun.sleep(wait);
            continue;
        }

        throw new Error(stderr.trim() || `git ${args.join(" ")} failed`);
    }
}

function shortSha(sha) {
    return sha.length > 7 ? sha.substring(0, 7) : sha;
}

async function main() {
    const startTime = Date.now();
    const currentBranch = runGit(["branch", "--show-current"]);

    if (!currentBranch) {
        console.error("❌ Error: Could not determine current branch (detached HEAD?).");
        process.exit(1);
    }

    console.log(`🌿 Current branch: ${currentBranch}`);

    let upstream;
    try {
        upstream = await runGitAsync(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
    } catch {
        upstream = `origin/${currentBranch}`;
        const verify = spawnSync(["git", "rev-parse", "--verify", "--quiet", upstream]);
        if (verify.exitCode !== 0) {
            console.error(`❌ No upstream configured for '${currentBranch}' and 'origin/${currentBranch}' does not exist.`);
            console.error("   Set an upstream with: git branch --set-upstream-to=origin/<branch> " + currentBranch);
            process.exit(1);
        }
    }

    console.log(`📍 Upstream: ${upstream}`);

    const upstreamRemote = upstream.split("/")[0];
    const upstreamRef = upstream.slice(upstreamRemote.length + 1);
    console.log(`🔄 Fetching ${upstreamRemote}/${upstreamRef}...`);
    await runGitAsync(["fetch", upstreamRemote, upstreamRef]);

    const localSha = runGit(["rev-parse", currentBranch]);
    const upstreamSha = runGit(["rev-parse", upstream]);

    if (localSha === upstreamSha) {
        console.log("✅ Already up to date with upstream.");
        return;
    }

    const localOnlyCount = parseInt(runGit(["rev-list", "--count", `${upstreamSha}..${localSha}`]), 10);
    const remoteOnlyCount = parseInt(runGit(["rev-list", "--count", `${localSha}..${upstreamSha}`]), 10);

    if (localOnlyCount > 0) {
        console.log(`ℹ️  Local has ${localOnlyCount} commit(s) not on remote. They will stay on ${currentBranch}.`);
        const localOnlyCommits = runGit(["log", `${upstreamSha}..${localSha}`, "--oneline", "--format=%h %s"]);
        if (localOnlyCount <= 10) {
            localOnlyCommits.split("\n").forEach(line => console.log(`   ${line}`));
        } else {
            localOnlyCommits.split("\n").slice(0, 10).forEach(line => console.log(`   ${line}`));
            console.log(`   ... and ${localOnlyCount - 10} more`);
        }
    }

    if (remoteOnlyCount === 0) {
        console.log("✅ No new commits to pull from upstream.");
        return;
    }

    const logFormat = "%h %s";
    const cherryOutput = runGit(["cherry", "-v", currentBranch, upstream, "--abbrev=7"]);
    const cherryLines = cherryOutput.split("\n").filter(Boolean);

    const commits = [];
    const skipped = [];

    for (const line of cherryLines) {
        const marker = line[0];
        const rest = line.slice(2);
        const sha = rest.split(" ")[0];
        const msg = rest.slice(sha.length + 1);
        if (marker === "+") {
            commits.push({ sha, msg });
        } else if (marker === "-") {
            skipped.push({ sha, msg });
        }
    }

    commits.reverse();
    skipped.reverse();

    if (skipped.length > 0) {
        console.log(`♻️  Skipping ${skipped.length} commit(s) already present locally (same patch-id):`);
        const shown = skipped.slice(0, 20);
        shown.forEach(c => console.log(`   ${c.sha} ${c.msg}`));
        if (skipped.length > 20) {
            console.log(`   ... and ${skipped.length - 20} more`);
        }
    }

    if (commits.length === 0) {
        console.log("✅ All upstream commits are already present locally.");
        return;
    }

    const totalBatches = Math.ceil(commits.length / batchSize);
    console.log(`📦 ${commits.length} commit(s) to pull (batch size: ${batchSize}, ${totalBatches} batch(es))\n`);

    let picked = 0;
    for (let i = 0; i < commits.length; i += batchSize) {
        const batch = commits.slice(i, i + batchSize);
        const batchNum = Math.floor(i / batchSize) + 1;

        console.log(`\n🔽 Batch ${batchNum}/${totalBatches} [${i + 1}-${Math.min(i + batchSize, commits.length)}/${commits.length}]`);

        for (const commit of batch) {
            const s = shortSha(commit.sha);
            console.log(`   Picking ${s} - ${commit.msg}`);

            const pick = Bun.spawn(["git", "cherry-pick", commit.sha], { stdout: "pipe", stderr: "pipe" });
            const pickOut = await new Response(pick.stdout).text();
            const pickErr = await new Response(pick.stderr).text();
            await pick.exited;

            if (pick.exitCode !== 0) {
                console.error(`\n❌ Conflict on ${s}. Aborting.`);
                console.error(`   ${pickErr.trim()}`);
                console.error("   Resolve conflicts, commit, then run again.");
                process.exit(1);
            }

            picked++;
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`   ✅ ${s}  (${picked}/${commits.length}, ${elapsed}s)`);
        }
    }

    const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n🎉 ${commits.length} commit(s) pulled successfully in ${totalElapsed}s!`);
}

main();
