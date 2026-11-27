---
title: Initialize an empty Operational State Store on startup
status: accepted
type: architecture
owner: harvester
created: 2026-11-22
---

# ADR-0007: Initialize an empty Operational State Store on startup

## Status

**Accepted.** This decision supersedes only the explicit-only genesis initialization rule in [ADR-0001](0001-application-owned-recovery-facts.md). All other ADR-0001 integrity, durability, Journal-boundary, and restart-restoration decisions remain in force.

## Context

Enabled Recovery Seller routes require the process-owned Operational State Store for durable STOP and process-boundary facts, even while Conservative restart recovery and automatic process-restart restoration remain disabled.

Requiring an operator to run a separate genesis command before the first ordinary startup adds a setup dependency without protecting any existing history. The store can safely distinguish a genuinely new installation (missing or empty directory) from an existing or partially initialized ledger.

## Decision

The process-owned store exposes `initializeIfEmpty()` for normal startup. It applies this exact decision table:

| Directory state | Startup behavior |
|---|---|
| Directory does not exist | Create the directory, both streams, and genesis; then verify. |
| Directory exists and is empty | Create both streams and genesis; then verify. |
| Exactly `facts.jsonl` and `manifest.jsonl` exist | Do not initialize; verify the complete streams, permissions, sequence, digests, and manifest linkage. |
| Only one stream exists | Fail startup; do not create the missing stream. |
| Any unexpected entry exists | Fail startup; do not delete or overwrite it. |
| Either stream is missing, malformed, corrupt, or inconsistent | Fail startup; do not repair, truncate, reset, or replace it. |
| Path is a symlink or not a real directory | Fail startup. |

New genesis uses the existing versioned schema, global sequence `0`, canonical digest, and committed-head checkpoint. The directory and stream permissions remain `0700` and `0600` on POSIX systems. When initialization creates missing path components, it fsyncs each parent directory that owns a newly created component, from the nearest existing ancestor down to the ledger directory, after syncing the genesis fact and manifest. Verification then fsyncs the ledger directory before durable acknowledgement. Any required directory-sync failure after genesis writes is an uncertain outcome and fails closed; no file-only fallback is reported.

The explicit `initialize()` operation remains available to the manual initialization CLI and continues to refuse every non-empty directory. Normal process startup uses `initializeIfEmpty()` and then performs the existing full verification before broker-capable runtime startup.

The behavior applies only when the process-owned store is required (Conservative restart recovery enabled or Recovery Seller enabled with at least one enabled market). Telegram-only startup remains independent of the store.

## Safety boundaries

- This is first-start initialization, not recovery or replay.
- A newly created genesis record contains no reconstructed trading state.
- Existing or damaged files are never interpreted as an empty ledger.
- The append-only fact/manifest protocol, fsync ordering, stable identities, and integrity checks are unchanged.
- Journal remains separate and is not replaced by this store.
- Automatic Portfolio, RecoveryLedger, OrderRegistry, reservation, or operator-pause restoration remains disabled.
- No SQLite database is created, reused, or required by this decision.

## Consequences

Normal first startup no longer requires a manual genesis command. Existing deployments with a valid ledger continue after full verification. Partially initialized or damaged deployments remain blocked and require explicit operator investigation; the application does not attempt automatic repair.

## Implementation and verification

Implemented in [PR #1718](https://github.com/45s/coinzilla/pull/1718), tracked under [issue #1713](https://github.com/45s/coinzilla/issues/1713). Offline regression tests cover missing and empty directories, existing valid ledgers, partial files, unexpected entries, and corrupt existing data. No exchange connection, order mutation, or account mutation is part of this change.
