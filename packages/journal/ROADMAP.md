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

- [~] Document the current journal record schema and public API. Versioned schema-v1 envelopes are now written; legacy raw event records are read as schema v1. See [README](./README.md).
- [~] Verify append/read ordering and behavior after partial write failures. Read/replay is deterministic and bounded; a write failure poisons the active session and incomplete tails fail closed. Runtime tests still need execution.
- [~] Define and test duplicate/replay handling and stable record identity. Record IDs are required and duplicates fail recovery; replay is ordered and consumers must remain idempotent.
- [~] Define serialization compatibility and schema evolution policy. Unknown versions fail explicitly; legacy records remain readable.
- [~] Verify recovery behavior after process interruption and malformed records. Incomplete, empty, malformed, invalid-encoding, and unsupported records return explicit errors; no automatic truncation is performed.
- [~] Verify resource cleanup and bounded memory/disk behavior where applicable. Recovery has configurable record, total-byte, and per-record limits.

## Current contract

- `record({ event })` resolves after the JSONL write completes, but its `durable` field is `false`; it does not claim an fsync.
- `flush()` waits for event-bus delivery and queued writes, then calls file sync. Only a successful result reports `durable: true`.
- `close()` drains and syncs the final writes before closing. A failed write/sync returns an error.
- `read({ maxRecords, maxBytes, maxRecordBytes })` validates all session files in filename and line order before returning records. Defaults are 100,000 records, 64 MiB total, and 1 MiB per record.
- `replay({ handler, ...limits })` validates the entire journal before calling the handler sequentially. A handler failure stops replay and reports the number already applied. Replay is at-least-once across crashes; consumers must use stable record IDs idempotently.
- A partial final line, malformed record, duplicate ID, unsupported schema version, or limit violation fails the entire read/replay. Journal never silently truncates or discards historical facts.
- Only one writer may own a journal directory at a time. Read/replay is available while the Journal instance is stopped, before start or after close.

## Completion policy

A journal capability is complete only when its behavior is documented, failure/recovery paths are tested, and the change is merged into `develop`.
