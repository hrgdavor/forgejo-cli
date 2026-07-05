# forgejo-cli

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.3.14. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

## Forgejo/Gitea Stacked PR CLI

The actual CLI toolkit lives in [src/](src/) — stacked PR management, safe merging/retargeting, and commit/patch-id origin tracing against a Forgejo/Gitea server. See [src/README.fg.md](src/README.fg.md) for full usage and the commit-cache/`FORGEJO_TOKEN` setup.
