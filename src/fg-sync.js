import { join } from "path";
import { existsSync } from "fs";

// 1. Parse command line arguments
const [sourceDir, targetDir] = Bun.argv.slice(2);

if (!sourceDir || !targetDir) {
  console.error("❌ Usage: bun run sync-repos.js <source-folder> <target-folder>");
  process.exit(1);
}

// 2. Validate folders
const srcPath = join(process.cwd(), sourceDir);
const tgtPath = join(process.cwd(), targetDir);

if (!existsSync(join(srcPath, ".git")) || !existsSync(join(tgtPath, ".git"))) {
  console.error("❌ Both folders must be valid Git repositories (containing a .git folder).");
  process.exit(1);
}

// Helper to run shell commands in a specific folder
async function runCmd(cmd, cwd) {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;
  return { success: proc.exitCode === 0, stdout: stdout.trim(), stderr: stderr.trim() };
}

async function main() {
  console.log(`\n🔍 Scanning for missing commits...`);
  console.log(`Source: ${srcPath}`);
  console.log(`Target: ${tgtPath}\n`);

  const remoteName = "temp_sync_source";

  // Remove if it accidentally exists from a previous crashed run
  await runCmd(["git", "remote", "remove", remoteName], tgtPath);

  // Add local folder as a remote and fetch
  await runCmd(["git", "remote", "add", remoteName, srcPath], tgtPath);
  await runCmd(["git", "fetch", remoteName], tgtPath);

  // Get current active branches
  const { stdout: srcBranch } = await runCmd(["git", "branch", "--show-current"], srcPath);
  const { stdout: tgtBranch } = await runCmd(["git", "branch", "--show-current"], tgtPath);

  // Identify missing commits (ignores matching patches even if hashes differ)
  const logFormat = "%H||%s";
  const { success, stdout, stderr } = await runCmd(
    ["git", "log", `${tgtBranch}...${remoteName}/${srcBranch}`, `--right-only`, `--cherry-pick`, `--oneline`, `--format=${logFormat}`],
    tgtPath
  );

  if (!success) {
    console.error("❌ Error comparing repositories:", stderr);
    await runCmd(["git", "remote", "remove", remoteName], tgtPath);
    process.exit(1);
  }

  const missingCommits = stdout ? stdout.split("\n").map(line => {
    const [hash, msg] = line.split("||");
    return { hash, msg };
  }).reverse() : []; // Reverse to apply oldest first

  if (missingCommits.length === 0) {
    console.log("✅ Target folder is completely up to date! No missing commits found.");
    await runCmd(["git", "remote", "remove", remoteName], tgtPath);
    return;
  }

  console.log(`Found ${missingCommits.length} commit(s) missing in the target folder:\n`);
  missingCommits.forEach((c, idx) => {
    console.log(`  [${idx + 1}] \x1b[33m${c.hash.substring(0, 7)}\x1b[0m - ${c.msg}`);
  });

  // Interactive prompt using Bun's native stdin stream reader
  console.write("\nDo you want to copy these commits to the target folder? (y/n): ");
  for await (const line of Bun.stdin.stream()) {
    const input = new TextDecoder().decode(line).trim().toLowerCase();

    if (input === "y" || input === "yes") {
      console.log("\n🚀 Starting cherry-pick transfer...");

      for (const commit of missingCommits) {
        console.write(`Applying \x1b[33m${commit.hash.substring(0, 7)}\x1b[0m... `);
        const pick = await runCmd(["git", "cherry-pick", commit.hash], tgtPath);

        if (pick.success) {
          console.log("\x1b[32mSuccess\x1b[0m");
        } else {
          console.log("\x1b[31mConflict/Failed\x1b[0m");
          console.error(`\n❌ Cherry-pick stopped due to conflicts on commit ${commit.hash.substring(0, 7)}.`);
          console.error("Please open your target folder, resolve conflicts, commit, and then clean up the temporary remote.");
          process.exit(1);
        }
      }
      console.log("\n🎉 All missing commits successfully copied!");
      break;
    } else {
      console.log("\nSkipping transfer.");
      break;
    }
  }

  // Cleanup remote attachment
  await runCmd(["git", "remote", "remove", remoteName], tgtPath);
}

main();
