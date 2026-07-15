# Branch diff - `src/fg-branch-diff.js`

Which commits are actually missing between two branches? Compares two branches by **patch content**, not just commit hash - the classic trap is a commit that was cherry-picked onto a base branch, with the newer branch forked from that base *later*: by sha alone it looks "missing" from the newer branch, but the patch is already there.

Wraps `git cherry` (which already does patch-id equivalence checking internally), then enriches genuinely-missing commits with cached PR info for context.

## Usage

```bash
bun run src/fg-branch-diff.js <older-branch> <newer-branch>
```

Reports two groups: commits with **no equivalent patch anywhere** in the newer branch (flagged `❌ MISSING` - these need attention), and commits already carried over via cherry-pick/rebase (`♻️`, informational only).

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FORGEJO_TOKEN` | Yes | Forgejo/Gitea personal access token |