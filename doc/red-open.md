# Open Redmine ticket in browser - `src/red-open.js`

Opens the current Redmine ticket (extracted from the branch name) in your default browser.
You can also open a specific ticket by number.

## Usage

```bash
bun run src/red-open.js                # open ticket from current branch
bun run src/red-open.js <ticket-number> # open a specific Redmine ticket
bun run src/red-open.js --help          # show help
```

## How it works

1. Reads the current git branch via `getCurrentBranch()`.
2. Extracts the ticket number from the branch name (branch must start with a digit, e.g. `12345-fix-bug`).
   - When a numeric argument is passed, that number is used directly instead of parsing the branch.
3. Reads the Redmine base URL from `getRedmineConfig()`.
4. Opens `https://<REDMINE_URL>/issues/<ticket>` in the default browser.

## Branch naming

Branches must start with a ticket number, e.g. `12345-fix-bug`. The script uses
`extractTicketFromBranch()` to pull the leading digits.

## Secrets

| Variable | Description |
|----------|-------------|
| `REDMINE_URL` | Base URL of your Redmine instance (e.g. `https://redmine.example.com`) |

Secrets are resolved in order: environment variable → `~/.forgejo-cli.env` → OS credential vault.
See the [Secrets Setup](../README.md#secrets-setup) section in the README for details.