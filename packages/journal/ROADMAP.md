# Journal roadmap

**Owner:** `packages/journal/`  
**Purpose:** provide reliable journal records and persistence behavior for application and operational history.

Read [the journal agent instructions](./AGENTS.md) and [the domain ownership guide](../../docs/engineering/DOMAIN_OWNERSHIP.md).

## Principles
- Preserve historical facts; do not silently rewrite or discard records.
- Make record identity, serialization, schema evolution, and replay behavior explicit.
- Keep persistence I/O at clear boundaries.
- Keep journal contracts independent of strategy-specific decisions.
- Handle partial failures and restart/recovery safely.

## Roadmap

- [x] Document the current journal record schema and public API. Versioned schema-v1 metadata is additive; legacy raw event records remain readable. See [README](./README.md). Schema-v1 metadata is added alongside the original top-level event fields; legacy raw event records remain readable as schema v1. See [README](./README.md).
- [x] Verify append/read ordering and behavior after partial write failures.
- [x] [PR #714](https://github.com/45s/coinzilla/pull/714) merged: a transient file-content sync failure is reported as non-durable; a later flush on the same Journal instance succeeds and durably preserves both the original completed write and the retry record in append order. Journal tests passed 43/43 on exact head `a52630cf4b2db0b5b317db4dd0e103789b64ed90`; all six required offline CI contexts passed. No source change, deduplication, record rewrite, or deletion.
- [~] Characterize retry after a transient file-content sync failure and the resulting at-least-once audit publication. The focused test must prove that a later successful sync makes both the original completed write and the retry record durable without rewriting or deduplicating either record. Deterministic ordering, incomplete-tail rejection, write-failure poisoning, and explicit file-sync acknowledgement are covered by tests. Read/replay is deterministic and bounded; a write failure poisons the active session and incomplete tails fail closed. Runtime tests still need execution.
- [x] Define and test duplicate/replay handling and stable record identity. Stable IDs are required, duplicates fail recovery, and replay is sequential/idempotency-aware. Record IDs are required and duplicates fail recovery; replay is ordered and consumers must remain idempotent.
- [x] Define serialization compatibility and schema evolution policy. Schema v1 is written additively; legacy raw records are supported; unknown versions fail explicitly. Unknown versions fail explicitly; legacy records remain readable.
- [x] Verify recovery behavior after process interruption and malformed records. Restart read/replay, invalid UTF-8, malformed/incomplete data, unsupported versions, and missing-directory failures are covered. Incomplete, empty, malformed, invalid-encoding, and unsupported records return explicit errors; no automatic truncation is performed.
- [x] Verify resource cleanup and bounded memory/disk behavior where applicable. Recovery enforces session, record, total-byte, and per-record limits. Recovery has configurable session-count, record-count, total-byte, and per-record limits.
- [~] Enforce single-writer directory ownership across processes. PR #741 adds an exclusive lock acquired before session creation, fail-closed contention/stale-lock handling, and cleanup on startup rollback and close. Cross-process, stale-lock preservation, and startup-rollback regressions were confirmed RED before implementation; all required CI passed on exact head `8d82e846fda56e9a88860f779b14e4d6dae50b75`. Merge remains pending.

## Current contract

- `record({ event })` resolves after the JSONL write completes, but its `durable` field is `false`; it does not claim an fsync.
- `flush()` waits for event-bus delivery and queued writes, then calls file sync. Only a successful result reports `durable: true`; a transient file-sync failure does not poison the writer, so a later flush may sync previously completed writes. If a caller republishes a logical event, both distinct records may become durable; Journal does not deduplicate by business meaning. A `writeFile()` failure still poisons the active instance. Repeated close calls preserve an earlier failed durability outcome.
- `close()` drains and syncs the final writes before closing. A failed write/sync returns an error.
- `read({ maxRecords, maxBytes, maxRecordBytes })` validates all session files in filename and line order before returning records. Defaults are 100,000 records, 64 MiB total, and 1 MiB per record.
- `replay({ handler, ...limits })` validates the entire journal before calling the handler sequentially. A handler failure stops replay and reports the number already applied. Replay is at-least-once across crashes; consumers must use stable record IDs idempotently.
- A partial final line, malformed record, duplicate ID, unsupported schema version, or limit violation fails the entire read/replay. Journal never silently truncates or discards historical facts.
- Only one writer may own a journal directory at a time. `start()` enforces this with an exclusive `.coinzilla-journal.lock` file acquired before session creation and released after the session file is synchronized and closed. Existing locks fail closed with `JOURNAL_DIRECTORY_LOCKED`; stale locks require operator verification and manual removal. Read/replay does not acquire a lock and must not overlap another process's writer.

## Delivered implementation

The bounded read/replay capability was merged into `develop` in [PR #430](https://github.com/45s/coinzilla/pull/430), merge commit `46ac949a4f1b32e887e39bebbff299a7e97fb5ed`. Required CI passed on the PR head, including 42/42 Journal tests on Node 22.23.4 and Node 24.x.

Operational limitation on the `develop` baseline `240966c03fa6812bc9c77664ff6dbea1555a5223`: the package required one writer per directory but did not enforce it across processes. PR #741 adds that guard; all required CI passed on exact head `8d82e846fda56e9a88860f779b14e4d6dae50b75`, and merge remains pending. File-content fsync is acknowledged; directory-entry fsync is not part of the current contract.

## Completion policy

A journal capability is complete only when its behavior is documented, failure/recovery paths are tested, and the change is merged into `develop`.


## 2026-11-08 transient file-sync retry characterization — complete

PR [#714](https://github.com/45s/coinzilla/pull/714) merged into `develop` as `0638c8bbc51607805bd95299fc8b4e69363c774e`. Exact tested head: `a52630cf4b2db0b5b317db4dd0e103789b64ed90`.

- Journal package tests: 43/43 passed, including the transient sync failure/retry case.
- All six required offline CI contexts passed.
- Workspace coverage passed; Journal coverage execution passed, but package threshold enforcement is not configured.
- The test confirms two distinct event IDs remain in append order and become durable after the later successful sync.
- `writeFile()` failure poisoning remains unchanged. No Journal production source changed.

**Current `develop` checkpoint:** `240966c03fa6812bc9c77664ff6dbea1555a5223` (includes merged PR #740).
