
# Redmine commit helper - `src/red-commit.js`

A Bun script that combines `git commit` with optional Redmine issue notes. It automatically posts the commit message to the corresponding Redmine issue when it can determine the ticket number from the branch name or commit message.

## Usage

```bash
bun run src/red-commit.js <message>     # git commit + Redmine note (if branch starts with a number)
bun run src/red-commit.js --hook         # git post-commit hook
bun run src/red-commit.js -f             # force: push last commit to Redmine
bun run src/red-commit.js --help         # show help
```

| Mode | Description |
|------|-------------|
| **`<message>`** | Runs `git commit -m <message>`, then checks if the current branch starts with a number. If so, it posts the commit message as a note to that Redmine issue. |
| **`--hook`** | Designed as a `post-commit` git hook. Reads the last commit message and posts it to Redmine **only if** the branch starts with a number. |
| **`-f`** | Force mode. Reads the last commit message and looks for a ticket number in the message first (`#12345` or `12345` at the start), then falls back to the branch name. Useful for retroactively pushing commits or when the ticket reference is in the message text. |

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `REDMINE_URL` | Yes | Base URL of your Redmine instance (e.g. `https://redmine.example.com`) |
| `REDMINE_API_KEY` | Yes | Your Redmine API key |

## Git hook setup

### 1. Create the hook file

Place the following in `.git/hooks/post-commit` (no file extension):

```bash
#!/usr/bin/env sh
bun run src/red-commit.js --hook
```

> **Important:** Git always runs hooks using `/bin/sh`, regardless of the OS. On **Linux/macOS** this is handled natively. On **Windows** (Git Bash, WSL, or MSYS2), Git ships with its own POSIX-compatible shell that interprets the shebang (`#!/usr/bin/env sh`) - but only if the file has **LF line endings**.

### 2. Fix line endings for the hook file

Since Windows uses CRLF by default, hook scripts with shebangs will fail with `post-commit: No such file or directory` or a cryptic error. To ensure Git always uses LF for hooks, add this to your `.gitattributes` file (create one in the repo root if it doesn't exist):

```
.git/hooks/post-commit text eol=lf
```

Alternatively, force CRLF → LF conversion manually:

```bash
git add .git/hooks/post-commit --renormalize
```

### 3. Make the hook executable (Linux/macOS)

```bash
chmod +x .git/hooks/post-commit
```

On Windows, Git for Windows assigns executable permissions automatically when the shebang is present and line endings are LF.

### 4. Verify

After setup, any `git commit` will automatically call:

```
bun run src/red-commit.js --hook
```

which reads the just-created commit and posts it to Redmine (if the branch name starts with a ticket number).
