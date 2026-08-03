# Create branch + PR from Redmine ticket - `src/red-pr.js`

Reads a Redmine ticket, creates a local branch named `<number>-<sanitized-title>`, pushes it, opens a Pull Request on Forgejo/Gitea, and optionally writes the branch/PR info back into a Redmine custom field.

## Usage

```bash
bun run src/red-pr.js <ticket-number>
```

Running without arguments displays usage help.

The script will:

1. Fetch the Redmine issue to get its title
2. Check that the Forgejo/Gitea instance is reachable (aborts early if it is not)
3. Compute the branch name: `<ticketNumber>-<sanitized-title>` (e.g. `12345-fix-login-bug`)
4. Show a summary and let you choose the PR target branch (current branch vs. configured default)
5. Check if a branch for this ticket already exists (locally or on remote)
6. Create and checkout the new branch
7. Push the branch to `origin`
8. Create a Pull Request with title `#<ticketNumber> <title>`
9. If configured, update a Redmine custom field with branch/PR info

Every PR creation is logged to `~/.forgejo-cli/log` (viewable with `bun run src/fg-log.js`).

### Existing PR detection

If an open PR already exists for the computed branch, the script offers to simply switch to that branch instead of creating a new PR. If you accept, it checks out the branch and (if no log line for that PR exists today) logs the PR access to `~/.forgejo-cli/log`.

### Resume on failure

If the script crashes after creating the branch but before pushing (e.g. network failure), re-running with the same ticket number will detect that the branch is already checked out and skip straight to push + PR creation.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `REDMINE_URL` | Yes | Base URL of your Redmine instance (e.g. `https://redmine.example.com`) |
| `REDMINE_API_KEY` | Yes | Your Redmine API key |
| `FORGEJO_TOKEN` | Yes | Forgejo/Gitea personal access token |

## Optional `package.json` configuration

| Property | Description |
|----------|-------------|
| `"redmine_pr_info_field"` | Numeric ID of a Redmine custom field to update with branch/PR info |
| `"redmine_pr_info_text"` | Optional text prefix for each new entry (e.g. `"[PR]"`) |
| `"redmine_pr_default_base_branch"` | Default target branch for the PR (default: `"main"`) |