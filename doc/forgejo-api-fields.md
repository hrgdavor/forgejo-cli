# Forgejo API Fields Reference

This document describes the Forgejo/Gitea API endpoints and fields used by the `fg-*.js` scripts in this project.

---

## Endpoints

### `GET /repos/{owner}/{repo}/pulls` — List pull requests

**Used by:** `fg-align.js`, `fg-prs.js`, `fg-rebase.js`, `fg-retarget.js`, `fg-open.js`

**Query parameters:**

| Parameter | Values           | Used by      |
| --------- | ---------------- | ------------ |
| `state`   | `open`, `closed` | All          |
| `sort`    | `recentupdate`   | `fg-open.js` |
| `limit`   | `100`            | `fg-open.js` |
| `head`    | branch name      | `fg-open.js` |

**Response fields used:**

| Field        | Type                | Description               | Used by                                                    |
| ------------ | ------------------- | ------------------------- | ---------------------------------------------------------- |
| `number`     | `number`            | PR number                 | All                                                        |
| `title`      | `string`            | PR title                  | All                                                        |
| `state`      | `string`            | `"open"` or `"closed"`    | `fg-retarget.js`, `fg-open.js`                             |
| `user.login` | `string`            | Author username           | `fg-align.js`                                              |
| `head.ref`   | `string`            | Source branch name        | All                                                        |
| `head.label` | `string`            | Source branch label       | `fg-open.js`                                               |
| `base.ref`   | `string`            | Target branch name        | All                                                        |
| `mergeable`  | `boolean            | null`                     | `true` = mergeable, `false` = conflict, `null` = unchecked | `fg-prs.js` (with `--check`) |
| `has_merged` | `boolean`           | Whether the PR was merged | `fg-retarget.js`                                           |
| `merged`     | `boolean`           | Whether the PR was merged | `fg-retarget.js`                                           |
| `updated_at` | `string` (ISO 8601) | Last update timestamp     | `fg-align.js`                                              |
| `created_at` | `string` (ISO 8601) | Creation timestamp        | `fg-align.js`                                              |
| `html_url`   | `string`            | Web URL to the PR         | `fg-open.js`                                               |

---

### `GET /repos/{owner}/{repo}/pulls/{number}` — Get single PR details

**Used by:** `fg-align.js`, `fg-prs.js` (with `--check`)

**Response fields used:**

| Field             | Type                | Description                                                   | Used by                                                    |
| ----------------- | ------------------- | ------------------------------------------------------------- | ---------------------------------------------------------- |
| `number`          | `number`            | PR number                                                     | `fg-align.js`                                              |
| `title`           | `string`            | PR title                                                      | `fg-align.js`                                              |
| `state`           | `string`            | `"open"` or `"closed"`                                        | `fg-align.js`                                              |
| `user.login`      | `string`            | Author username                                               | `fg-align.js`                                              |
| `head.ref`        | `string`            | Source branch name                                            | `fg-align.js`                                              |
| `base.ref`        | `string`            | Target branch name                                            | `fg-align.js`                                              |
| `base.sha`        | `string` (SHA)      | Latest commit SHA of the base branch                          | `fg-align.js`                                              |
| `mergeable`       | `boolean            | null`                                                         | `true` = mergeable, `false` = conflict, `null` = unchecked | `fg-align.js`, `fg-prs.js` |
| `mergeable_state` | `string`            | `"clean"`, `"behind"`, `"blocked"`, `"conflict"`, `"unknown"` | `fg-align.js` *(fallback)*                                 |
| `merge_base`      | `string` (SHA)      | Common ancestor SHA of PR head and base branch                | `fg-align.js`                                              |
| `updated_at`      | `string` (ISO 8601) | Last update timestamp                                         | `fg-align.js`                                              |
| `created_at`      | `string` (ISO 8601) | Creation timestamp                                            | `fg-align.js`                                              |
| `html_url`        | `string`            | Web URL to the PR                                             | `fg-stack.js`                                              |

---

### `POST /repos/{owner}/{repo}/pulls` — Create a pull request

**Used by:** `fg-stack.js`, `createPullRequest.js` (via `red-pr.js`)

**Request body fields:**

| Field   | Type     | Required | Description         |
| ------- | -------- | -------- | ------------------- |
| `base`  | `string` | Yes      | Target branch name  |
| `head`  | `string` | Yes      | Source branch name  |
| `title` | `string` | Yes      | PR title            |
| `body`  | `string` | No       | PR description/body |

**Response fields used:**

| Field      | Type     | Description       |
| ---------- | -------- | ----------------- |
| `number`   | `number` | PR number         |
| `html_url` | `string` | Web URL to the PR |

---

### `PATCH /repos/{owner}/{repo}/pulls/{number}` — Update a pull request

**Used by:** `fg-retarget.js`

**Request body fields:**

| Field  | Type     | Required | Description            |
| ------ | -------- | -------- | ---------------------- |
| `base` | `string` | Yes      | New target branch name |

---

### `GET /repos/{owner}/{repo}/compare/{base}...{head}` — Compare two branches

**Used by:** `fg-align.js` *(previously used, now replaced by `merge_base` comparison)*

**Response fields:**

| Field       | Type     | Description                                        |
| ----------- | -------- | -------------------------------------------------- |
| `behind_by` | `number` | Number of commits the head is behind the base      |
| `ahead_by`  | `number` | Number of commits the head is ahead of the base    |
| `status`    | `string` | `"behind"`, `"ahead"`, `"identical"`, `"diverged"` |

> **Note:** This endpoint can be slow on repos with many commits. `fg-align.js` now uses the `merge_base` field from the PR details endpoint instead, which is instant and requires no extra API calls.

---

## Behind detection logic in `fg-align.js`

The script determines whether a PR is behind its base branch using the `merge_base` and `base.sha` fields from the PR details endpoint:

```
isBehind = (details.merge_base !== details.base.sha)
```

- `merge_base` — the common ancestor commit SHA of the PR head and base branch
- `base.sha` — the latest commit SHA of the base branch

If they differ, the base branch has advanced beyond the merge base, meaning the PR is behind.

**State mapping:**

| Condition                                           | Icon | State     |
| --------------------------------------------------- | ---- | --------- |
| `mergeable === false` (conflict)                    | ❌    | `blocked` |
| `mergeable !== false` and `merge_base !== base.sha` | 📉   | `behind`  |
| `mergeable !== false` and `merge_base === base.sha` | ✅    | `clean`   |

---

## Utility modules

| Module                                      | File                                 | Description                                                      |
| ------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------- |
| `getRepoContext()`                          | `util/forgejo/getRepoContext.js`     | Parses `baseUrl`, `owner`, `repo` from the git remote URL        |
| `getHeaders()`                              | `util/forgejo/getHeaders.js`         | Returns HTTP headers with `Authorization: token {FORGEJO_TOKEN}` |
| `fetchAllPages(url)`                        | `util/forgejo/fetchAllPages.js`      | Fetches all pages of a paginated API response                    |
| `fetchPagesUntil(url, predicate)`           | `util/forgejo/fetchPagesUntil.js`    | Fetches pages until a predicate function returns `true`          |
| `mapWithConcurrency(data, fn, concurrency)` | `util/forgejo/mapWithConcurrency.js` | Maps over data with limited concurrency                          |