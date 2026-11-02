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
- [x] Verify append/read ordering and behavior after partial write failures. Deterministic ordering, incomplete-tail rejection, write-failure poisoning, and explicit file-sync acknowledgement are covered by tests. Read/replay is deterministic and bounded; a write failure poisons the active session and incomplete tails fail closed. Runtime tests still need execution.
- [x] Define and test duplicate/replay handling and stable record identity. Stable IDs are required, duplicates fail recovery, and replay is sequential/idempotency-aware. Record IDs are required and duplicates fail recovery; replay is ordered and consumers must remain idempotent.
- [x] Define serialization compatibility and schema evolution policy. Schema v1 is written additively; legacy raw records are supported; unknown versions fail explicitly. Unknown versions fail explicitly; legacy records remain readable.
- [x] Verify recovery behavior after process interruption and malformed records. Restart read/replay, invalid UTF-8, malformed/incomplete data, unsupported versions, and missing-directory failures are covered. Incomplete, empty, malformed, invalid-encoding, and unsupported records return explicit errors; no automatic truncation is performed.
- [x] Verify resource cleanup and bounded memory/disk behavior where applicable. Recovery enforces session, record, total-byte, and per-record limits. Recovery has configurable session-count, record-count, total-byte, and per-record limits.

## Current contract

- `record({ event })` resolves after the JSONL write completes, but its `durable` field is `false`; it does not claim an fsync.
- `flush()` waits for event-bus delivery and queued writes, then calls file sync. Only a successful result reports `durable: true`; repeated close calls preserve an earlier failed durability outcome.
- `close()` drains and syncs the final writes before closing. A failed write/sync returns an error.
- `read({ maxRecords, maxBytes, maxRecordBytes })` validates all session files in filename and line order before returning records. Defaults are 100,000 records, 64 MiB total, and 1 MiB per record.
- `replay({ handler, ...limits })` validates the entire journal before calling the handler sequentially. A handler failure stops replay and reports the number already applied. Replay is at-least-once across crashes; consumers must use stable record IDs idempotently.
- A partial final line, malformed record, duplicate ID, unsupported schema version, or limit violation fails the entire read/replay. Journal never silently truncates or discards historical facts.
- Only one writer may own a journal directory at a time (not enforced by an inter-process lock yet). Read/replay is available while the Journal instance is stopped, before start or after close. A missing directory is an explicit failure, not an empty-history success.

## Delivered implementation

The bounded read/replay capability was merged into `develop` in [PR #430](https://github.com/45s/coinzilla/pull/430), merge commit `46ac949a4f1b32e887e39bebbff299a7e97fb5ed`. Required CI passed on the PR head, including 42/42 Journal tests on Node 22.23.4 and Node 24.x.

Operational limitation: the package documents a single-writer-per-directory requirement but does not yet acquire an inter-process lock. File-content fsync is acknowledged; directory-entry fsync is not part of the current contract.

## Completion policy

A journal capability is complete only when its behavior is documented, failure/recovery paths are tested, and the change is merged into `develop`.
