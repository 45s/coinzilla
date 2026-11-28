# Harvester error vocabulary

- Status: active
- Type: Operational reference
- Owner: harvester
- Scope: stable operator-facing diagnostic identifiers emitted by Harvester

This document maps machine-readable error codes to symptoms, likely causes, and safe recovery procedures. The error code does not replace the original error or cause.

These operator-facing diagnostic codes are distinct from JavaScript error class names. Error classes, stable internal codes, wrapping and cause preservation follow the repository-wide [Structured Error Handling Standard](../../../docs/engineering/structured-error-handling.md); this vocabulary remains the Harvester-specific reference for operator symptoms and safe recovery.

## Journal errors

### Journal directory is locked

**Underlying error code:** `JOURNAL_DIRECTORY_LOCKED`

**Meaning:** Journal could not acquire exclusive writer ownership because `<journal-directory>/.coinzilla-journal.lock` already exists. The default Harvester path is `apps/harvester/logs/sessions/<timestamp>-<runtime-session-id>/`; use the exact directory reported by the error because custom Journal directories are supported. The existing lock is deliberately preserved; Journal does not automatically decide whether its owner is stale. This Journal writer lock is separate from Harvester process-ownership locks under `~/.coinzilla/harvester/process-locks/`.

**Possible cause:** A previous Harvester/Journal process was terminated before its normal close completed, leaving the lock file behind. An active second writer using the same directory is another possibility.

**Safe recovery on Windows from Git Bash:**

1. Do not delete the lock while any process may still be writing to that Journal directory.
2. Read the recorded PID from the lock file:

   ```bash
   cat -- "<journal-directory>/.coinzilla-journal.lock"
   ```

3. Check whether the recorded PID currently exists. This command reads the PID from the lock file automatically:

   ```bash
   powershell.exe -NoProfile -Command '$journalDirectory = "<journal-directory-from-error>"; $lockPath = Join-Path $journalDirectory ".coinzilla-journal.lock"; $lock = Get-Content $lockPath -Raw | ConvertFrom-Json; Get-Process -Id $lock.pid -ErrorAction SilentlyContinue | Select-Object Id,ProcessName'
   ```

4. If the process exists, do not remove the lock. Identify whether it owns this Journal directory and allow it to shut down normally. If process inspection is inconclusive, stop and investigate rather than deleting the lock.
5. If the recorded PID is absent, independently confirm that no other Harvester/Journal process is using this directory. The PID and timestamp in the lock are diagnostic hints, not proof by themselves; PIDs can be reused.
6. Only after confirming there is no active writer, remove the lock from the repository root:

   ```bash
   rm -- "<journal-directory>/.coinzilla-journal.lock"
   ```

7. Retry startup:

   ```bash
   cd apps/harvester && pnpm run dev
   ```

**Do not remove:** Journal `.jsonl` session files or diagnostic log files as part of this recovery. The lock is `.coinzilla-journal.lock`; it is not `.coinzilla.log`.

**Safety invariant:** The lock is acquired using exclusive file creation. Normal Journal close releases the lock after the session is synced and closed. Abrupt process termination can leave it behind. Automatic stale-lock takeover is intentionally not supported because a contender cannot safely distinguish a crashed owner from a live writer. See the [Journal package locking contract](../../../packages/journal/README.md) for the package-owned behavior.

**If the error persists:** Preserve the lock and original error details. Check the actual Journal directory reported in the error; do not assume every caller uses `apps/harvester/logs/`. Confirm all writers of that exact directory have stopped before considering manual lock removal.

## Emergency BUY pause diagnostics

| Code | Symptom | Likely cause | Safe recovery |
| --- | --- | --- | --- |
| `OPERATOR_BUY_CANCELLATION_INCOMPLETE` | `/pauseallbuys` or `/pausebuys SYMBOL` reports that the BUY pause is active but cancellation is unresolved | A current-process-owned BUY remains active/UNKNOWN, or the broker/cancellation reconciliation workflow could not confirm its terminal state | The BUY gate remains active. Inspect `/orders`, broker order identity and cancellation/fill reconciliation diagnostics. Do not assume all owned BUYs are gone. Recovery SELLs remain enabled by the BUY gate itself, but existing order-integrity blockers may defer conflicting same-market activity until reconciliation. |
| `INVALID_OPERATOR_SCOPE` | A global emergency BUY command is rejected | A market symbol was supplied to a global command | Retry `/pauseallbuys` or `/resumeallbuys` without a symbol. Use `/pausebuys SYMBOL` or `/resumebuys SYMBOL` for one market. |

## Conservative strategy safety-pause diagnostics

| Code | Symptom | Likely cause | Safe recovery |
| --- | --- | --- | --- |
| `STRATEGY_SAFETY_PAUSE_INCOMPLETE` | A Conservative market remains safety-paused and its snapshot reports incomplete owned-BUY cancellation or pause evidence | A current-process-owned BUY remains UNKNOWN/active, cancellation-racing fill reconciliation is incomplete, or the pause fact/lifecycle event could not be recorded | The market BUY gate remains active. Inspect `safetyPauseCancellation`, blocker evidence and canonical order/fill identity. Do not manually cancel startup-snapshot, external, manual or prior-process orders. Do not treat restart as resolution. Recovery Seller evaluation continues, but only a purpose-tagged `RECOVERY_SELL` may pass this strategy-safety gate. Re-enable normal strategy activity only after authoritative reconciliation and a separately reviewed operator decision. |

## Operator query diagnostics

The Telegram Command Center uses the feature-owned `OperatorQueryError` for failures while building read-only status and market snapshots. The application preserves the original cause and attaches only bounded component/operation/symbol context. Telegram replies remain generic; detailed errors are written to the structured Harvester logger.

| Code | Symptom | Likely cause | Safe recovery |
| --- | --- | --- | --- |
| `HARVESTER_OPERATOR_RUNTIME_SNAPSHOT_READ_FAILED` | `/status` or `/markets` reports that the runtime snapshot is unavailable | The bootstrap-owned runtime snapshot provider failed | Inspect the structured error and cause in Harvester logs; verify runtime lifecycle state. No trading state was changed. |
| `HARVESTER_OPERATOR_RUNTIME_SNAPSHOT_INVALID` | The runtime query fails closed instead of returning status | The runtime provider returned an incomplete or malformed snapshot | Inspect the provider contract and runtime/user-data state; do not treat the failed query as READY. |
| `HARVESTER_OPERATOR_MARKET_SNAPSHOT_READ_FAILED` | `/markets` or `/status` cannot collect engine market state | The serialized engine snapshot failed or returned an unclassified failure | Inspect the preserved cause and engine diagnostics; retry the read-only command after the engine is healthy. |
| `HARVESTER_OPERATOR_MARKET_SNAPSHOT_INVALID` | Market status is unavailable for a malformed engine snapshot | A market DTO is missing its symbol, enabled flag, blocker list, or market collection | Inspect the affected symbol and engine snapshot producer; do not return partial market state. |
| `HARVESTER_OPERATOR_QUERY_FAILED` | An unexpected operator read query failure is returned | An unclassified exception crossed the application query boundary | Inspect the preserved cause and operation context in Harvester logs. No trading action is performed. |

## Exchange history synchronization

**Stable operation error code:** `HARVESTER_ACCOUNT_HISTORY_SYNC_FAILED`

| Symptom | Likely cause | Safe recovery |
| --- | --- | --- |
| Startup logs an incomplete exchange-history synchronization result | One or more configured markets failed while reading, validating, persisting, or advancing an order/trade-history page | Inspect the correlated `runtime_errors` row and `details_json.historyDiagnostics.failures`. Use `market`, `historyType`, `failureStage`, `pageCursor`, `recordIndex`, exchange IDs, and last-persisted IDs to locate the failure. The failed page cursor is not advanced and partial writes are replayable on the next normal startup. Do not manually advance a cursor, fabricate a fill, or change an order to hide a history gap. |
| An order-history failure is recorded for one market | The market's order page could not be completed | Its fill scan is deliberately skipped because safe fill-to-order identity may depend on the order scan. Other configured markets continue. Resolve the underlying failure before relying on that market's history. |
| A trade-history failure is recorded for one market | The trade page could not be completed after order history succeeded | The completed order history remains persisted; the trade cursor remains unchanged. Other configured markets continue. The trade page is replayed on the next normal startup. |

The operation error aggregates the original failures as causes. The relational `runtime_errors` projection stores only bounded, allowlisted and redacted context; inspect the session DEBUG/TRACE JSONL logs for complete stack/cause evidence. This diagnostic failure does not itself change trading readiness, order ownership, or exchange state. History coverage remains incomplete until the failed page is successfully synchronized.

## Live order-history projection

**Stable validation error code:** `HARVESTER_ORDER_HISTORY_RECORD_INVALID`

This code means a canonical order lifecycle event could not be mapped into the best-effort relational order-history projection. It is distinct from `HARVESTER_ACCOUNT_HISTORY_SYNC_FAILED`, which describes paginated startup synchronization from the exchange.

The structured observer diagnostic includes:

- `component`: `order-history-observer`
- `operation` and `persistenceStage` (for example `mapping` or `write`)
- stable `errorCode`, `errorName`, and a bounded safe `field` when available
- affected `symbol`, `eventId`, `eventName`, `eventSource`, and `sourceEventTimestamp`
- safe provider/account/client-order identities

The validation field is limited to an ASCII dotted identifier no longer than 128 characters. Raw order payloads and arbitrary exception messages are not logged. A projection failure is a history gap; it does not reverse a successful fill, mutate trading accounting, or authorize an exchange action.

**Safe recovery:** inspect the reported field and event/market identity, compare the canonical order event with the owning order state, and fix the mapping/contract defect. Do not fabricate missing identity fields, edit exchange orders, or infer an invalid field from a historical log entry that did not preserve it. The 28 archived 2026-11-22 occurrences remain unattributed; the database dump has not been inspected.


## Central Harvester failure catalog

The following entries are defined in `src/infrastructure/logging/harvester-error-catalog.js`. The catalog completeness test validates that every registered code appears in this operator reference; the console contract test verifies one-line output for every entry.

| Code | Subsystem / stage | Severity and behavior | Meaning | Required action |
| --- | --- | --- | --- | --- |
| `HARVESTER_STARTUP_FAILED` | process / `PROCESS_STARTUP` | ERROR; process stops | A required startup operation failed and no more specific registered code was available. | Inspect the originating error and full cause chain in session DEBUG; do not retry blindly. |
| `HARVESTER_MARKET_UNVALIDATED_EXCHANGE_CONSTRAINTS` | market-readiness / `MARKET_READINESS_VALIDATION` | ERROR; affected market is blocked | One or more applicable exchange constraints have no validated domain evaluator. | Implement and test evaluators before enabling the market. |
| `HARVESTER_ORDER_HISTORY_PERSISTENCE_FAILED` | persistence / exact relational preparation stage | WARN; trading continues with legacy history | Optional relational trading-history preparation failed; the native SQLite error code and cause remain separately visible. | Do not reset the database; inspect the concrete migration cause and session DEBUG details. |

The catalog's stable identifier is distinct from a native lower-level `errorCode`. For relational persistence, `harvesterErrorCode` carries the Harvester classification while `errorCode` retains the native SQLite code. The console line shows the Harvester identifier, exact stage, concrete cause and action; structured DEBUG/TRACE logs retain the original error and cause chain.
