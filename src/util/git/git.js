// git.js - Run a git command and return { exitCode, stdout, stderr }
import { spawnSync } from "bun";

export function git(args) {
    const result = spawnSync(["git", ...args]);
    return {
        exitCode: result.exitCode,
        stdout: result.stdout.toString().trim(),
        stderr: result.stderr.toString().trim(),
    };
}