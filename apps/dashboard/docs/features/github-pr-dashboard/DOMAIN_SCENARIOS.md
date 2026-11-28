# GitHub PR Dashboard — domain scenarios

- Status: active
- Type: feature behavior scenarios
- Owner: dashboard
- Created: 2026-11-24
- Canonical contract: [SPEC.md](SPEC.md)
- Tracking: [Implementation Issue #1821](https://github.com/45s/coinzilla/issues/1821); specification [Issue #1816](https://github.com/45s/coinzilla/issues/1816)

## Purpose

These scenarios define observable behavior for the GitHub PR Dashboard. They are intended to become deterministic automated tests when the feature is implemented.

Each scenario identifies initial conditions, an action and an exact expected outcome. The specification is authoritative for the complete contract; this file makes important behavior concrete.

## Scenario 01 — Display every open PR

**Purpose:** The page must show the complete current open-PR set.

### Given

GitHub returns three open PRs for `45s/coinzilla`:

| Number | Title | Head SHA |
| --- | --- | --- |
| 1824 | Fix Bitunix order execution | `a` repeated 40 times |
| 1823 | Add broker tests | `b` repeated 40 times |
| 1820 | Improve recovery scenarios | `c` repeated 40 times |

The head commit metadata requests succeed.

### When

The user opens the GitHub PR Dashboard page.

### Then

- All three PRs appear.
- Each row displays its original number and title.
- Each row links to its canonical GitHub PR URL.
- Each row shows the timestamp for its own current head commit.
- Rows are ordered #1824, #1823, #1820.
- No PR is omitted because it has no local labels.

## Scenario 02 — Include draft PRs

**Purpose:** Draft is a display state, not an exclusion filter.

### Given

GitHub returns PR #1824 as open and ready, and PR #1823 as open and draft.

### When

The Dashboard loads open PRs.

### Then

Both PRs appear. PR #1823 has a visible Draft indicator. Its commit time and labels work exactly like any other open PR.

## Scenario 03 — Use the current head commit's committer date

**Purpose:** Display the same kind of commit-relative time users see on the PR Commits page.

### Given

The PR response contains `head.sha = abc123...`.

The commit lookup for that exact SHA returns:

```json
{
  "sha": "abc123...",
  "commit": {
    "author": {
      "date": "2026-11-24T10:00:00Z"
    },
    "committer": {
      "date": "2026-11-24T11:30:00Z"
    }
  }
}
```

The controlled current time is 2026-11-24T12:00:00Z.

### When

The Dashboard renders Last commit.

### Then

- It uses `commit.committer.date`.
- It displays approximately `30 min ago`.
- It makes 11:30 UTC available as the exact timestamp.
- It does not use the different author date.

## Scenario 04 — PR metadata update is not a new commit

**Purpose:** Comments, reviews and label changes must not make a PR appear recently committed.

### Given

The current head commit's committer date is 10:00 UTC.

A review comment is added at 11:50 UTC and GitHub updates the PR's `updated_at` to 11:50 UTC. The head SHA is unchanged.

### When

The user refreshes the Dashboard.

### Then

Last commit still represents 10:00 UTC. It must not show 10 minutes ago based on `updated_at`.

## Scenario 05 — New head commit changes displayed time

**Purpose:** Refresh must follow a new head SHA.

### Given

The previous snapshot contains head SHA `old-sha` with committer date 10:00 UTC.

A new PR response contains head SHA `new-sha`; its commit metadata has committer date 11:45 UTC.

### When

The user clicks Refresh.

### Then

- The new head SHA is used for commit lookup.
- Last commit becomes 11:45 UTC.
- The previous timestamp is not retained for the new SHA.
- All existing local label assignments remain unchanged.

## Scenario 06 — Commit lookup fails for one PR

**Purpose:** A single missing commit record must not hide a valid PR.

### Given

The PR list request returns five valid open PRs. Four commit lookups succeed. The fifth returns HTTP 404.

### When

The Dashboard completes the refresh.

### Then

All five PRs remain visible. Four show their correct commit time. The fifth displays `Unavailable`. Its title, link and labels remain available.

## Scenario 07 — Commit timestamp is missing or invalid

**Purpose:** Never invent a timestamp.

### Given

The commit response is missing `commit.committer.date`, or the value cannot be parsed as a valid timestamp.

### When

The Dashboard normalizes the commit response.

### Then

That PR's Last commit displays `Unavailable`. The application does not fall back to `author.date`, PR `updated_at` or PR creation time.

## Scenario 08 — Future-dated commit

**Purpose:** Clock skew must not produce a negative relative duration.

### Given

The current local clock is 12:00 UTC and the commit committer date is 12:05 UTC.

### When

The Dashboard formats Last commit.

### Then

It displays a clear future/clock-skew indication, such as `in the future`, and exposes the exact timestamp. It does not display a negative number of minutes.

## Scenario 09 — Create and assign a custom label

**Purpose:** The user can mark who is working on a PR.

### Given

PR #1824 has no local labels. The user creates label `Morty` with ID `label-morty` and color `blue`.

### When

The user assigns `Morty` to PR #1824.

### Then

- `Morty` appears in the PR row.
- The assignment is persisted under `45s/coinzilla#1824`.
- No GitHub write request is made.
- The UI reports success only after local persistence succeeds.

## Scenario 10 — Assign multiple labels to one PR

**Purpose:** A PR can have multiple work/ownership markers.

### Given

PR #1824 has `Morty`. The reusable label `Codex` exists.

### When

The user assigns `Codex` to PR #1824.

### Then

Both `Morty` and `Codex` are displayed. The new assignment does not replace the existing one.

## Scenario 11 — Reuse one label across PRs

**Purpose:** Label definitions are reusable and assignments are independent.

### Given

The label `Testing` exists. PRs #1824 and #1819 are open.

### When

The user assigns `Testing` to both PRs, then removes it from #1824.

### Then

- Both rows initially show `Testing`.
- After removal, #1824 no longer shows it.
- #1819 still shows it.
- One label definition is shared by two independent assignments.

## Scenario 12 — Rename or recolor a label

**Purpose:** Editing a label definition must preserve assignments.

### Given

Label ID `label-codex` is named `Codex` and is assigned to PRs #1824 and #1819.

### When

The user renames it to `AI Agent` and changes its color.

### Then

Both PR rows show the new name and color. The assignments still reference `label-codex`. No GitHub request is made.

## Scenario 13 — Reject invalid or duplicate label names

**Purpose:** Label names remain usable and unambiguous.

### Given

A label named `Morty` already exists.

### When

The user attempts to create `  morty  `, an empty string or a whitespace-only string.

### Then

The new label is rejected. Existing definitions and assignments remain unchanged. Comparison trims whitespace and is case-insensitive.

## Scenario 14 — Delete a reusable label

**Purpose:** Deleting a definition removes all references to it.

### Given

Label `Blocked` is assigned to PRs #1824 and #1819. Both PRs also have other labels.

### When

The user deletes `Blocked`.

### Then

- The label definition is removed.
- Every assignment referencing its ID is removed.
- Other labels and assignments remain unchanged.
- The updated store is persisted.

## Scenario 15 — Labels survive reload and GitHub refresh

**Purpose:** Local organization metadata is independent of remote PR refresh.

### Given

PR #1824 has labels `Morty` and `Codex`, and local storage contains the corresponding definitions and assignments.

### When

The user reloads the page and then performs a successful GitHub refresh.

### Then

Both labels remain assigned to #1824. A changed PR title does not break the assignment because the key is repository plus PR number, not title.

## Scenario 16 — Closed or temporarily absent PR retains assignments

**Purpose:** A current open-PR response must not erase historical local metadata.

### Given

PR #1824 has local labels `Morty` and `Codex`.

### When

PR #1824 is merged and is no longer returned by the open-PR endpoint.

### Then

- #1824 disappears from the active table.
- Its local assignments remain stored.
- Reusable label definitions remain stored.
- If #1824 is later returned as open, the assignments are restored.

## Scenario 17 — No open PRs

**Purpose:** A legitimate empty result is distinct from failure.

### Given

GitHub returns HTTP 200 and an empty array for the open-PR list.

### When

The page loads.

### Then

The page displays `No open Pull Requests found.` It does not display fake data or an API error.

## Scenario 18 — Initial PR-list request fails

**Purpose:** An unavailable GitHub API must be visible.

### Given

The initial PR-list request fails and there is no previously successful snapshot in the current page session.

### When

The user opens the page.

### Then

A clear error and retry action are displayed. The error is not represented as an empty successful list. No sample/demo PRs are shown.

## Scenario 19 — Refresh fails after a successful snapshot

**Purpose:** Previously retrieved data remains useful but must be marked stale.

### Given

A complete PR snapshot was successfully loaded at 11:00 UTC. A later manual refresh fails.

### When

The refresh completes with an error.

### Then

- The previous snapshot remains visible.
- The page visibly marks it as stale.
- The last successful refresh time remains 11:00 UTC.
- The page does not claim the data was refreshed successfully.

## Scenario 20 — Pagination fails

**Purpose:** A subset of PR pages must not be presented as the complete repository result.

### Given

The first open-PR page succeeds and a subsequent required page fails.

### When

The Dashboard refreshes.

### Then

The refresh is reported as incomplete. A previous complete snapshot is retained if available. Without a previous complete snapshot, the partial subset is not presented as a successful complete list.

## Scenario 21 — GitHub rate limit is reached

**Purpose:** Avoid request storms and preserve the last useful view.

### Given

GitHub responds with a rate-limit response and provides reset metadata.

### When

The Dashboard attempts to retrieve PR or commit data.

### Then

- A clear rate-limit message is displayed.
- The reset time is shown when available.
- The Dashboard does not retry in a tight loop.
- A previous successful snapshot remains visible and marked stale if applicable.

## Scenario 22 — Browser storage is unavailable or corrupted

**Purpose:** Local metadata failure must not disable GitHub PR viewing or destroy user data.

### Given

Access to localStorage throws, stored JSON is malformed, or the stored schema version is unsupported.

### When

The page initializes or the user edits a label.

### Then

- GitHub PR retrieval remains usable.
- The metadata problem is visible.
- The application does not silently overwrite the invalid stored value.
- The UI does not claim that an unsuccessful label write was saved.
- Any recovery/reset action is explicit.

## Scenario 23 — Relative time advances without network activity

**Purpose:** Relative time is presentation state, not a polling trigger.

### Given

A commit timestamp is 12:00 UTC and the controlled current time at initial render is 12:04 UTC.

### When

One minute passes while the page remains open.

### Then

The visible value advances from approximately `4 min ago` to `5 min ago`. No GitHub HTTP request is made solely to update relative text.

## Scenario 24 — Repeated refresh is guarded

**Purpose:** Prevent overlapping refreshes and mixed snapshots.

### Given

A refresh is already in progress.

### When

The user activates Refresh again.

### Then

A second refresh is not started. The active operation completes and applies one consistent snapshot. The UI indicates that refresh is in progress.

## Scenario 25 — All open PR pages are retrieved

**Purpose:** The table must not silently stop at the first page.

### Given

GitHub returns more than 100 open PRs.

### When

The Dashboard retrieves the open-PR list.

### Then

- It follows every pagination link/page until complete.
- It deduplicates by repository identity and PR number.
- The final complete result contains every returned open PR.
- A page failure is handled by Scenario 20.

## Cross-scenario invariants

These rules apply to every scenario:

1. GitHub owns PR metadata, current head SHA and commit metadata.
2. The latest commit time comes from the current head commit's `commit.committer.date`.
3. PR `updated_at` is never used as a commit-time substitute.
4. The committer date is not represented as an exact push-event time.
5. Dashboard-local labels are never written to GitHub.
6. GitHub refresh never clears local label definitions or assignments.
7. A PR identity includes owner, repository and PR number.
8. One optional commit lookup failure never hides an otherwise valid PR.
9. A failed or incomplete list request is never represented as a complete successful result.
10. No credentials, fake live data or unapproved side effects are introduced.

## Test mapping guidance

The implementation is in [PR #1822](https://github.com/45s/coinzilla/pull/1822). Current deterministic test mapping:

| Test file | Scenario IDs | Verified behavior represented |
| --- | --- | --- |
| `model.spec.ts` | 01–04, 07–08, 23, 25 | PR normalization, malformed head SHA rejection, bounded concurrency, relative time, future clock skew and invalid timestamps |
| `api.spec.ts` | 01–07, 20–21, 25 | Pagination, draft inclusion, current-head committer date, same-SHA cache, changed-head refresh, isolated commit failure, invalid timestamp, incomplete-page failure, rate limit and four-request concurrency |
| `label-store.spec.ts` | 09–16, 22 | Create/rename/recolor/delete, duplicate-name rejection, multi-assignment, reuse across PRs, persistence, assignment retention, corrupt/unsupported data and storage failures |
| `page.spec.ts` | 01–03, 09–11, 15, 17–19, 21–24 | PR rendering, local labels, empty/initial-error/stale/rate-limit states, local relative-time update, refresh guard and corrupt-storage preservation |
| `app.spec.ts` | Navigation integration | Dashboard navigation to GitHub PRs and public GitHub data loading |

The test mapping is intentionally limited to behaviors asserted by those tests; remaining scenarios still require additional automated coverage before the feature can be considered fully verified. Default tests do not call GitHub or require credentials.

## Scenario 26 — Compact PR workspace and merged history

- Page heading and summary metadata strip are removed.
- Refresh is anchored bottom-right inside the labels panel.
- All label definitions render inline without dropdowns.
- Open and merged tables display number, title, branch and last commit; open rows also show work labels.
- Merged rows are subdued; latest five merged PRs are displayed.
- PR number links out; title and branch clicks copy text.
- No GitHub write operations are added.
