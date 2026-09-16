import { resolve, join } from "path";
import { existsSync } from "fs";
import { spawnSync } from "bun";

// 1. Parse command line arguments
const args = Bun.argv.slice(2);
let mode = "default";
let startCommit = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "-s" && args[i + 1]) {
    startCommit = args[++i];
  } else if (args[i] === "commit") {
    mode = "commit";
  }
}

const sourceDir = args[0];
const targetDir = args[1];

if (sourceDir === "-h" || sourceDir === "--help") {
  console.log(`
${"fg-sync".bold} — sync branches between two local git repositories

USAGE
  bun run src/fg-sync.js <source-folder> <target-folder> [commit] [-s <hash>]

MODES
  (default)   Only list missing commits found in source but not in target.
  commit      Cherry-pick the missing commits from source into target.

OPTIONS
  -s <hash>   Starting commit hash to skip (initial fill basis for sync).

EXAMPLES
  bun run src/fg-sync.js ../repoA ../repoB
  bun run src/fg-sync.js ../repoA ../repoB commit
  bun run src/fg-sync.js ../repoA ../repoB -s ae49ed5
  bun run src/fg-sync.js ../repoA ../repoB -s ae49ed5 commit
`);
  process.exit(0);
}



if (!sourceDir || !targetDir) {
  console.error("❌ Usage: bun run src/fg-sync.js <source-folder> <target-folder> [commit] [-s <hash>]");
  process.exit(1);
}

// 2. Resolve paths
const srcPath = resolve(sourceDir);
const tgtPath = resolve(targetDir);

if (!existsSync(join(srcPath, ".git")) || !existsSync(join(tgtPath, ".git"))) {
  console.error("❌ Both folders must be valid Git repositories (containing a .git folder).");
  process.exit(1);
}

// Helper — run git in a specific repo directory
function gitDir(repoPath) {
  return (args) => {
    const result = spawnSync(["git", ...args], { cwd: repoPath });
    return {
      exitCode: result.exitCode,
      stdout: result.stdout.toString().trim(),
      stderr: result.stderr.toString().trim(),
    };
  };
}

async function main() {
  console.log(`\n🔍 Scanning for missing commits...`);
  console.log(`Source: ${srcPath}`);
  console.log(`Target: ${tgtPath}\n`);

  const srcGit = gitDir(srcPath);
  const tgtGit = gitDir(tgtPath);

  // Get current active branch names
  const srcBrResult = srcGit(["branch", "--show-current"]);
  const tgtBrResult = tgtGit(["branch", "--show-current"]);

  const srcBranch = srcBrResult.stdout || "HEAD";
  const tgtBranch = tgtBrResult.stdout || "HEAD";

  console.log(`Source: ${srcBranch}`);
  console.log(`Target: ${tgtBranch}\n`);

  const remoteName = "temp_sync_source";

  // Clean up any stale remote
  tgtGit(["remote", "remove", remoteName]);

  // Add source as local remote (use forward slashes for git on Windows)
  const srcPathGit = srcPath.replace(/\\/g, "/");
  const remoteAdd = tgtGit(["remote", "add", remoteName, srcPathGit]);
  if (remoteAdd.exitCode !== 0) {
    console.error("❌ Error adding remote:", remoteAdd.stderr);
    process.exit(1);
  }

  // Fetch everything from the source remote
  console.log(`Fetching from ${srcPathGit}...`);
  const fetchResult = tgtGit(["fetch", remoteName]);
  if (fetchResult.exitCode !== 0) {
    console.error("❌ Error fetching from source:", fetchResult.stderr);
    tgtGit(["remote", "remove", remoteName]);
    process.exit(1);
  }

  // Resolve source tip from the fetched remote tracking ref
  const srcRev = tgtGit(["rev-parse", `${remoteName}/${srcBranch}`]);
  if (srcRev.exitCode !== 0) {
    console.error("❌ Cannot resolve source branch after fetch.");
    tgtGit(["remote", "remove", remoteName]);
    process.exit(1);
  }
  const srcTip = srcRev.stdout;

  // Resolve target tip (may fail if branch has no commits yet)
  const tgtRev = tgtGit(["rev-parse", tgtBranch]);
  const tgtTip = tgtRev.exitCode === 0 ? tgtRev.stdout : null;

  console.log(`Source tip: ${srcTip.substring(0, 7)}`);
  console.log(`Target tip: ${tgtTip ? tgtTip.substring(0, 7) : "(no commits)"}\n`);

  // List missing commits: commits in source that are NOT in target
  // Use hashes, not branch names, to avoid ambiguous argument errors
  let logResult;
  if (startCommit) {
    // Skip commits from startCommit onwards - use it as basis for sync
    const skipRange = `${tgtTip}...${srcTip}`;
    
    // Compare from startCommit directly to source tip
    logResult = tgtGit([
      "log", 
      `${startCommit}...${srcTip}`, 
      "--right-only", 
      "--cherry-pick", 
      "--oneline", 
      "--format=%H||%s"
    ]);
  } else if (tgtTip) {
    // Both sides have commits — use cherry-pick to skip equivalent patches
    logResult = tgtGit(
      ["log", `${tgtTip}...${srcTip}`, "--right-only", "--cherry-pick", "--oneline", "--format=%H||%s"]
    );
  } else {
    // Target branch has no commits — all source commits are missing
    logResult = tgtGit(
      ["log", srcTip, "--oneline", "--format=%H||%s"]
    );
  }

  if (logResult.exitCode !== 0) {
    console.error("❌ Error comparing repositories:", logResult.stderr);
    tgtGit(["remote", "remove", remoteName]);
    process.exit(1);
  }

  const missingCommits = logResult.stdout
    ? logResult.stdout.split("\n").map(line => {
        const [hash, msg] = line.split("||");
        return { hash, msg };
      }).reverse()
    : [];

  if (missingCommits.length === 0) {
    console.log("✅ Target folder is completely up to date! No missing commits found.");
    tgtGit(["remote", "remove", remoteName]);
    return;
  }

  console.log(`Found ${missingCommits.length} commit(s) missing in the target folder:\n`);
  missingCommits.forEach((c, idx) => {
    console.log(`  [${idx + 1}] \x1b[33m${c.hash.substring(0, 7)}\x1b[0m - ${c.msg}`);
  });

  if (mode === "commit") {
    console.log("\n🚀 Starting cherry-pick transfer...");

    for (const commit of missingCommits) {
      process.stdout.write(`Applying \x1b[33m${commit.hash.substring(0, 7)}\x1b[0m... `);
      const pick = tgtGit(["cherry-pick", commit.hash]);

      if (pick.exitCode === 0) {
        console.log("\x1b[32mSuccess\x1b[0m");
      } else {
        console.log("\x1b[31mConflict/Failed\x1b[0m");
        console.error(`\n❌ Cherry-pick stopped due to conflicts on commit ${commit.hash.substring(0, 7)}.`);
        console.error("Please open your target folder, resolve conflicts, commit, and then clean up the temporary remote.");
        process.exit(1);
      }
    }
    console.log("\n🎉 All missing commits successfully copied!");
  }

  // Cleanup remote
  tgtGit(["remote", "remove", remoteName]);
}

main();