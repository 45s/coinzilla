# GitHub Pull Request Dashboard

- Status: active
- Type: feature specification
- Owner: dashboard
- Created: 2026-11-24
- Tracking: implementation [Issue #1821](https://github.com/45s/coinzilla/issues/1821); specification [Issue #1816](https://github.com/45s/coinzilla/issues/1816)

## 1. Purpose

Add a dedicated page to the Coinzilla Dashboard that lists every currently open Pull Request in `45s/coinzilla` and makes recent development activity visible at a glance.

The page answers:

1. Which PRs are currently open?
2. What is each PR called?
3. When was the latest commit on each PR recorded by GitHub?
4. Who or what is marked as working on each PR, using labels maintained locally in the Dashboard?

This is a read-only GitHub overview with Dashboard-owned organization metadata. It is not a GitHub PR management tool.

## 2. Ownership and context

- Owning application: `apps/dashboard/`.
- Feature documentation: this folder.
- Initial repository: `45s/coinzilla`.
- GitHub is authoritative for PR metadata and commit details.
- The Dashboard is authoritative for its custom label definitions and assignments.
- The feature must respect [Dashboard agent instructions](../../../AGENTS.md): the browser remains a presentation/client layer and must not access database files, Harvester internals, broker APIs or exchange APIs.
- The repository-wide [Feature Specification Standard](../../../../../docs/FEATURE_SPECIFICATION_STANDARD.md) defines how this and future feature specifications are authored and maintained.

## 3. Scope

### 3.1 Included in v1

- Add a dedicated Dashboard navigation item/page named **GitHub PRs**.
- Retrieve all open Pull Requests from `45s/coinzilla`, including draft PRs.
- Display PR number, title, latest commit relative time and custom labels.
- Link each PR to its canonical GitHub web URL.
- Show an accessible exact timestamp for the latest commit.
- Create, rename, recolor, assign, unassign and delete reusable local labels.
- Allow multiple labels per PR and reuse one label across PRs.
- Persist local label definitions and assignments across reloads.
- Fetch data on page entry and through an explicit manual Refresh action.
- Display loading, empty, error, stale-snapshot, partial-result and rate-limit states.
- Keep relative-time text current locally without polling GitHub.

### 3.2 Explicitly excluded from v1

- Creating, editing, closing, reopening or merging PRs.
- Writing GitHub labels, comments, assignees, reviewers or review requests.
- Triggering CI, workflows, deployments or branch operations.
- Displaying closed or merged PRs in the active table.
- Multiple repository selection.
- Private repository authentication or GitHub token management.
- Shared/synchronized custom labels across browsers or devices.
- Automatic background polling or push/webhook delivery.
- Inferring a person/agent label from PR author, assignees, branch name, commit author or other GitHub metadata.
- Displaying CI/check status, review state, PR author, changed-file counts or diff summaries.
- Any application source-code changes as part of this documentation specification task.

Future ideas are not v1 requirements. Scope expansion requires an updated Issue and reviewed specification.

## 4. User interface contract

The page contains a table with these columns:

| Column | Required behavior |
| --- | --- |
| Number | Display `#<number>`; link to the canonical GitHub PR URL. |
| Title | Display the original GitHub PR title without changing the underlying value. |
| Last commit | Display relative time based on the current PR head commit's committer timestamp. |
| Custom labels | Display zero or more locally assigned labels and an action to manage them. |

Illustrative example only:

| Number | Title | Last commit | Custom labels |
| --- | --- | --- | --- |
| #1824 | Fix Bitunix order execution | 4 min ago | Morty, Codex |
| #1819 | Improve recovery seller scenarios | 3 hours ago | Codex, Testing |
| #1802 | Refactor broker interfaces | 2 days ago | Morty |
| #1798 | Add broker regression tests | Unavailable | + Add label |

These rows are not live repository data and must never be shipped as production fallback/demo records.

### 4.1 PR number and link

- Display the numeric PR number prefixed with `#`.
- Use the canonical `html_url` returned by GitHub.
- Open the destination in a new tab with safe external-link behavior.
- Do not construct the URL when GitHub has supplied it.

### 4.2 Title and draft state

- Preserve the original title.
- Long titles may be visually truncated, but the full title must remain accessible.
- Draft PRs are included and have a visible Draft indicator.
- Draft status does not affect timestamp or label behavior.

### 4.3 Last commit: exact meaning

The user wants the relative time shown on GitHub's PR Commits page, for example `4 min ago`.

**The value is the committer timestamp recorded on the current head commit. It is not the PR's `updated_at` timestamp and it is not a guaranteed push-event timestamp.**

For every PR:

1. Read the current `head.sha` from the PR list response.
2. Request the commit object for that exact SHA using GitHub's REST API:
   `GET https://api.github.com/repos/{owner}/{repo}/commits/{ref}`
3. Read `commit.committer.date` from the returned commit object.
4. Parse the ISO-8601 timestamp as an instant, preserving its timezone/UTC offset.
5. Render relative time from that timestamp using the current local clock.
6. Make the exact timestamp available through a tooltip or equivalent accessible secondary text.

The source field is specifically `commit.committer.date`, not `commit.author.date`. The author and committer dates can differ.

For the configured repository, the request is equivalent to:

`GET /repos/45s/coinzilla/commits/{head.sha}`

Do not scrape or parse GitHub HTML. The REST API exposes the commit metadata directly.

The endpoint resolves the exact current head SHA rather than guessing which item is last in a rendered commits list. This also avoids relying on commit-list ordering or a fixed page-size assumption.

#### Timestamp interpretation

- A relative value such as `4 min ago` is presentation derived from the commit timestamp and current clock.
- Relative text updates locally at least once per minute while the page is visible; it must not trigger another GitHub request.
- Future-dated commit timestamps must not produce misleading negative durations. Display a clear clock-skew state such as `in the future` and retain the exact timestamp.
- Missing, invalid or unavailable commit metadata is displayed as `Unavailable`; never substitute PR `updated_at`, creation time or a different commit's timestamp.
- The committer timestamp is commit metadata. GitHub's API does not thereby prove when the commit was pushed. If exact push-event time is required later, that is a separate requirement needing a push-event source such as a webhook and durable event storage.

### 4.4 Custom labels

Custom labels are Dashboard-local metadata. They are not GitHub labels and must never be sent to GitHub.

The user can create labels such as:

- `Morty`
- `Codex`
- `Claude`
- `AI Agent`
- `Testing`
- `Blocked`
- `Needs Review`

These are examples, not a fixed enum.

Each label has:

- Stable unique ID.
- User-visible name.
- Color selected from a predefined palette.

The user can:

- Create a reusable label.
- Rename a label without breaking assignments.
- Change its color.
- Assign multiple labels to one PR.
- Assign one label to multiple PRs.
- Remove an assignment from one PR without affecting other PRs.
- Delete a label definition, which removes all assignments referencing it.

Normalize names by trimming whitespace. Reject empty names and case-insensitive duplicates. Use stable IDs in assignments; never use the label name as the assignment key.

When a PR has no assigned labels, show a neutral `+ Add label` action. Do not infer an owner automatically.

## 5. GitHub API contract

### 5.1 Repository configuration

Initial repository identity:

- Owner: `45s`
- Name: `coinzilla`
- Full name: `45s/coinzilla`

Keep this configuration in one feature-level configuration boundary. Do not scatter owner/repository literals across UI components.

### 5.2 List open PRs

Use GitHub REST:

`GET https://api.github.com/repos/45s/coinzilla/pulls?state=open&per_page=100&page=1`

- Include draft PRs; do not filter by draft status.
- Follow pagination until every page has been retrieved.
- Use the response's canonical PR URL, number, title, draft flag and current `head.sha`.
- Treat each page as part of one logical refresh. If a later page fails, do not present the partial list as a complete successful result.
- Deduplicate by repository identity plus PR number.
- Sort by PR number descending for initial display; do not reorder rows as relative timestamps tick.

### 5.3 Retrieve the current head commit

For each normalized PR, request:

`GET https://api.github.com/repos/45s/coinzilla/commits/{head.sha}`

Use `commit.committer.date` as the authoritative timestamp.

The request is keyed by the SHA returned in the current PR snapshot. Do not request a commit based on stale PR state. If the head SHA changes during refresh, use the SHA from the newly retrieved PR response.

A commit lookup failure is isolated to that PR: retain the PR row and show its commit time as unavailable. Do not substitute another timestamp.

### 5.4 Request scheduling and rate limits

- Fetch the PR list when the page is entered.
- Fetch commit metadata for the returned PR heads with bounded concurrency (maximum four simultaneous commit lookups).
- Provide an explicit Refresh action.
- Prevent overlapping refresh operations.
- Do not run periodic GitHub polling.
- Relative-time updates are local calculations only.
- Respect GitHub rate-limit headers, including `X-RateLimit-Remaining`, `X-RateLimit-Reset` and `Retry-After` where supplied.
- Do not retry rate-limit failures in a tight loop.
- Avoid redundant commit lookups when the same current head SHA is already present in the current successful snapshot; refresh behavior must still detect changed head SHAs.
- Do not claim data is fresh until the PR list and all required page requests for the refresh have completed. Per-PR commit lookup failures remain explicit partial metadata failures.

### 5.5 Authentication and security

The configured repository is public. V1 uses unauthenticated, read-only public GitHub REST API access.

- Do not introduce a Personal Access Token, OAuth token, GitHub App credential or other secret.
- Do not put credentials in browser source, environment values shipped to the browser, local/session storage, query strings or logs.
- Do not issue GitHub write requests.
- If the repository becomes private or public unauthenticated access is insufficient, stop and design an authenticated server-side integration. Do not place a token in browser code as a workaround.
- Treat all GitHub response strings as untrusted display data; render titles and metadata as text, not executable HTML.

## 6. Local metadata persistence

V1 persists custom label definitions and assignments in browser `localStorage`.

Storage key:

`coinzilla.dashboard.github-pr-labels.v1`

This is browser-profile-local storage. It does not synchronize between devices or browser profiles.

The persisted structure is defined by [label-store.schema.json](schemas/label-store.schema.json).

The store contains:

- `schemaVersion`.
- Reusable label definitions (`id`, `name`, `color`).
- Assignments mapping a repository-scoped PR identity to label IDs.

Use the composite PR identity:

`45s/coinzilla#1824`

Do not key assignments by title, branch name or URL.

Persistence invariants:

- A GitHub refresh never overwrites or clears local label metadata.
- A PR missing from the current open-PR response does not cause its assignments to be deleted.
- If a PR later reappears as open, its assignments are restored.
- Renaming/recoloring a label preserves assignments.
- Deleting a label removes every assignment that references its ID.
- Unknown label IDs in assignments are invalid metadata and must be handled safely; do not render fabricated labels.
- Validate stored data before using it. Do not silently replace corrupted or unsupported-version data with an empty store.
- If storage is unavailable or a write fails, keep GitHub PR viewing functional, visibly report that label changes cannot be persisted, and do not claim a save succeeded.
- Avoid destructive recovery. Preserve the original invalid value until the user explicitly chooses a recovery/reset action.

## 7. Architecture and responsibility boundaries

The Dashboard feature owns:

- GitHub public REST read client and request scheduling for this page.
- Normalization of GitHub PR and commit responses into the feature model.
- Relative timestamp presentation.
- Custom label definitions and assignments.
- Local storage validation and persistence.
- Page loading, refresh, stale and partial-error presentation.

Keep API transport, response normalization, local metadata persistence and UI presentation as separate responsibilities within the feature boundary.

Do not:

- Import Harvester-private modules.
- Access SQLite or database files.
- Call broker or exchange APIs.
- Modify GitHub PRs, labels, branches, comments or reviews.
- Introduce global state infrastructure for this isolated page without a demonstrated cross-feature need.

Use the existing Dashboard conventions: standalone Angular components, strict TypeScript/template checking, feature-oriented folders, colocated tests and local reactive state. The implementation is owned by this feature folder and follows the Dashboard's standalone Angular component, strict TypeScript/template, feature-oriented and colocated-test conventions. Source and tests remain the authority for delivered behavior; this specification remains the behavior contract.

## 8. Loading, refresh and failure states

### Initial loading

Show a clear loading state while the initial PR list is retrieved. Do not show fabricated sample PRs.

### Successful load

Display the complete open-PR list, per-PR commit timestamp status and local labels. Show the time of the last successful refresh.

### Empty result

If GitHub returns HTTP 200 and no open PRs, display:

`No open Pull Requests found.`

An empty list is not an API error.

### PR-list failure

If the initial list request fails and no previous snapshot exists, show a clear error and a retry action. Do not render an error as an empty successful list.

### Refresh failure with previous data

Keep the last successfully retrieved PR snapshot visible, mark it stale, explain that refresh failed and show the last successful refresh time. Do not present stale data as freshly retrieved.

### Pagination failure

If any required PR-list page fails, do not silently discard the failure or label the partial page set complete. If a previous complete snapshot exists, preserve it and report the failed refresh. If no complete snapshot exists, show the incomplete-load error and do not claim the returned subset is the full open-PR list.

### Individual commit lookup failure

Keep the corresponding PR visible and show `Unavailable` for its last commit. Other PRs remain usable. Do not discard a whole refresh because one commit lookup failed.

### Rate limit

Show a clear rate-limit state and the reset time when GitHub provides it. Avoid tight retries. Preserve the previous successful snapshot.

### Local storage failure

Keep GitHub data usable. Explain that custom label metadata could not be loaded or saved. Never claim an unsuccessful write was persisted.

## 9. Ordering and refresh semantics

- Initial table order: PR number descending.
- Do not reorder rows when relative-time text changes.
- Manual refresh retrieves a new complete PR-list snapshot and current head metadata.
- Disable or otherwise guard the Refresh action while a refresh is active.
- Apply a completed snapshot consistently; do not mix PR list data from one refresh with commit metadata from a different head SHA.
- Preserve local label state independently of GitHub refresh success.

## 10. Acceptance criteria

### GitHub data

- [ ] Every open PR from `45s/coinzilla` is included, including draft PRs.
- [ ] Pagination retrieves all available open PR pages.
- [ ] PR number, title, canonical URL, draft state and current head SHA are normalized correctly.
- [ ] The last-commit value is derived from the current head commit's `commit.committer.date`.
- [ ] The implementation does not use PR `updated_at` or `commit.author.date` as a substitute.
- [ ] A missing or failed commit lookup is represented as unavailable without hiding the PR.
- [ ] Rate-limit and partial-pagination failures are visible and do not masquerade as complete success.
- [ ] No GitHub write request or credential is introduced.

### UI

- [ ] A dedicated GitHub PR page is reachable from Dashboard navigation.
- [ ] The table displays Number, Title, Last commit and Custom labels.
- [ ] PR links use GitHub's canonical URL.
- [ ] Draft PRs are distinguishable.
- [ ] Relative timestamps update locally without GitHub polling.
- [ ] Exact commit timestamp is accessible.
- [ ] Loading, empty, error, stale, partial and rate-limit states are distinct.\n- [ ] Label definitions use compact inline name/color/delete controls; PR assignments are direct clickable chips without an expandable editor.\n- [ ] A refresh action remains visible while the user scrolls the PR list.

### Custom labels

- [ ] Users can create, rename, recolor and delete reusable labels.
- [ ] Multiple labels can be assigned to one PR.
- [ ] One label can be assigned to multiple PRs.
- [ ] Removing one assignment does not affect other PRs.
- [ ] Labels survive page reloads and GitHub refreshes.
- [ ] Renaming/recoloring preserves assignments.
- [ ] Deleting a label removes its assignments.
- [ ] Closed/temporarily absent PR assignments are retained.
- [ ] Labels are never synchronized to GitHub.

### Quality and boundaries

- [ ] Unit tests cover the domain scenarios and local timestamp behavior with a controlled clock.
- [ ] HTTP tests use deterministic mocked GitHub responses; ordinary tests do not require network access or credentials.
- [ ] Storage tests cover valid, malformed, unsupported-version, unavailable and failed-write cases.
- [ ] The Dashboard's existing pages continue to work.
- [ ] Browser code does not access databases, Harvester internals, brokers or exchange APIs.
- [ ] No source code is included in the specification-only documentation task.

## 11. Deferred capabilities

Possible later work, requiring explicit scope approval:

- Multiple repositories.
- Private repository support through a reviewed server-side authentication design.
- Filters, search, grouping and column sorting.
- Group PRs by custom label.
- Stale-PR highlighting.
- PR author, assignee and reviewer metadata.
- CI/check and review status.
- Shared label synchronization across devices.
- Push-event timestamps backed by a webhook/event store.
- Closed/merged PR history.

## 12. Related documents and tracking

- [Feature specification standard](../../../../../docs/FEATURE_SPECIFICATION_STANDARD.md)
- [Domain scenarios](DOMAIN_SCENARIOS.md)
- [Normalized PR schema](schemas/pull-request.schema.json)
- [Local label-store schema](schemas/label-store.schema.json)
- [Dashboard documentation index](../../README.md)
- [Dashboard agent instructions](../../../AGENTS.md)
- [Dashboard roadmap](../../../ROADMAP.md)
- [Specification Issue #1816](https://github.com/45s/coinzilla/issues/1816)
- [Implementation Issue #1821](https://github.com/45s/coinzilla/issues/1821)
- [Implementation PR #1822](https://github.com/45s/coinzilla/pull/1822)

This specification is active. The documentation standard and feature contract were delivered in [PR #1817](https://github.com/45s/coinzilla/pull/1817). Application implementation is tracked separately by [Issue #1821](https://github.com/45s/coinzilla/issues/1821) and is under review in [PR #1822](https://github.com/45s/coinzilla/pull/1822). The specification remains authoritative for required behavior; delivered and verified implementation status is recorded in the task Issue and PR.
## Layout and interaction update — 2026-11-28

The page removes the title and metadata summary. Active PRs remain the primary list, with a muted latest-five merged history table. A full-height labels panel renders label controls and its Refresh action bottom-right. PR numbers link to GitHub; title and branch click-copy affordances are provided. GitHub remains read-only; label state is local.
