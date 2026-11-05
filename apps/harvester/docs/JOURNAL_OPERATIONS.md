# Harvester Journal Operations

## Purpose and limits

Harvester uses one in-process EventBus to publish selected operational and trading-lifecycle facts. The Journal subscribes to that bus and appends event records to local JSONL files. Journal persistence is optional in configuration-only/no-broker mode; it is a required startup dependency for every broker-connected mode because the account PREFLIGHT audit must be durably recorded before market subscriptions.

The Journal is an operational observer, not trading-state authority. Portfolio and RecoveryLedger remain in-memory application state. Journal replay is not used to reconstruct trading state. There is no database, outbox, exactly-once delivery, or per-market-price capture.

## Configuration

The Journal is enabled by default.

| Setting | Behavior |
|---|---|
| `HARVESTER_JOURNAL_ENABLED=false` | Disable the Journal writer. Matching is case-insensitive after trimming. |
| `HARVESTER_JOURNAL_DIRECTORY` | Override the session directory. Relative paths resolve from `apps/harvester`; absolute paths are accepted. |
| Unset directory | Defaults to `apps/harvester/logs/`. |

The `dev` script loads `.env.development`; the `start` script uses the process environment. The Harvester `.gitignore` excludes its `/logs/` directory. Keep custom Journal directories outside source control as well.

## Session files and JSONL format

- One new session file is created for each Journal start.
- Filenames use a UTC timestamp: `YYYY-MM-DD_HH-MM-SS.jsonl`. A numeric suffix is added if a file with that name already exists.
- Files are opened exclusively; an existing session file is never overwritten.
- Each line is one JSON object containing the EventBus event fields (`id`, `timestamp`, `source`, `name`, and `data`) plus `__coinzillaJournal` metadata with `schemaVersion: 1` and the same event ID.
- Writes are serialized in arrival order for that Journal subscription.
- Directory and file permissions use the operating system defaults and process umask; the Journal does not apply a custom permission mode.

There is no automatic file rotation, retention, compression, or deletion. Session files accumulate until an operator archives or removes them. Protect the directory with appropriate OS permissions because event records include market, order, and error identifiers.

## Event inventory

All events use source `harvester`. Payloads are created by Harvester-owned allowlist mappers; fields not listed below are not copied into the event DTO.

| Event | Allowlisted payload facts |
|---|---|
| `harvester.started` | `broker`, `strategyMode`, `enabledMarkets`, `tradingEnabled` |
| `harvester.startup_failed` | `stage`, sanitized `error` name/message |
| `harvester.stopped` | `reason`, `outcome`, optional sanitized `error` |
| `config.validated` | `enabledMarkets`, `strategyMode`, `tradingEnabled` |
| `broker.connected` | `broker` |
| `broker.connection_failed` | `broker`, sanitized `error` |
| `broker.disconnected` | `broker`, `outcome`, optional sanitized `error` |
| `broker.status_changed` | `broker`, `stream`, `status`, `recoveryRequired`, optional `attempt`, `code`, `error` |
| `broker.subscription_established` | `broker`, `stream`, optional `market` |
| `broker.subscription_failed` | `broker`, `stream`, optional `market`, sanitized `error` |
| `strategy.decision` | `strategy`, `symbol`, `referencePrice`, actionable `actions` (side/type/price/quantity/optional reason) |
| `order.submission_requested` | client order ID, symbol, side, type, exact price/quantity, status; durably flushed before the broker placement call |
| `order.submitted` | submission facts plus broker order ID and acknowledged status |
| `order.submission_failed` | client order ID, symbol, side, outcome, optional sanitized error |
| `strategy.paused` | `symbol`, `reason`, optional sanitized `error` |
| `order.cancel_requested` | full owned order intent, broker order ID, executed quantity, current status, cancellation reason; durably flushed before the broker cancellation call |
| `order.cancelled` | order facts, broker order ID, executed quantity, canceled status |
| `order.cancel_failed` | client order ID, symbol, side, optional broker order ID, current order status (including UNKNOWN), outcome, optional sanitized error |
| `execution.fill_applied` | fill/trade/order IDs, symbol, side, exact price/quantity/quote quantity, liquidity role, optional execution time, exact commission amounts and asset IDs/codes, commission status |
| `execution.unowned_order` | client/broker order IDs, symbol, side, order status, reason |
| `execution.invalid_fill` | order facts, reason, optional Fill identity facts, sanitized error |
| `execution.accounting_failed` | order and Fill identity facts, sanitized error |
| `execution.duplicate_fill` | Fill facts plus `duplicate: true` |
| `recovery.cycle_completed` | `symbol`, `marketId`, allocated base `freeQuantity`, quote-asset `realizedNetProfit` |
| `account.snapshot_captured` | PREFLIGHT/OPENING/CLOSING phase, audit status, exchange source timestamp, every returned asset with exact free/locked/total quantities, audit reasons |
| `account.open_orders_captured` | PREFLIGHT/OPENING phase, observation time, READY/BLOCKED decision, complete account-wide open-order list (client/broker IDs, symbol, side, type, exact price/original/executed quantities, status), block reasons |

A `strategy.decision` event is emitted only when the strategy produces at least one actionable order. NO_ACTION evaluations are not journaled. No event is emitted for every market-price update.

The broker status `recovered` means the remote user-data subscription has returned; it does not mean Harvester has reconciled account state or reopened order placement.

## Startup and capture gaps

A standalone read-only audit can be run while Harvester remains stopped with `pnpm run testnet:audit`. It creates its own Journal session and writes both account events with phase `PREFLIGHT`; it does not start trading or alter exchange state. Exit code 2 means the audit was persisted successfully but open orders were found.

For every broker-connected startup, including read-only mode, bootstrap fetches the full account balance snapshot and account-wide open orders, publishes `account.snapshot_captured` and `account.open_orders_captured` with `phase: PREFLIGHT`, and durably flushes each event before market subscriptions or trading-engine activation. `main()` explicitly awaits Journal readiness before connecting when trading is enabled; in read-only mode the first required durable flush awaits readiness and fails startup if the Journal is unavailable. If either query fails, event mapping/publication fails, or either flush is not durable, startup fails closed. A pre-existing order is recorded as external/unowned; read-only startup may continue with a BLOCKED audit, while trading-enabled startup stops before market subscriptions. Harvester never adopts or cancels an existing order. Programmatic callers of `main()` can inspect `journalService.ready` and `journalService.status`.

## Write failures and durability

- After the startup PREFLIGHT gate succeeds, ordinary event delivery to the Journal is asynchronous. Market-price evaluation, strategy policy, and fill accounting do not await Journal subscriber or filesystem writes.
- Before any broker order-placement or cancellation call, Harvester publishes the corresponding order intent (`order.submission_requested` or `order.cancel_requested`) and awaits a successful durable Journal flush. If publication or durability fails, the broker write is not attempted and the affected pair is paused.
- The explicit startup PREFLIGHT audit and trading-enabled CLOSING balance audit are lifecycle exceptions: each awaits a durable flush. A failure in either gate fails startup or reports incomplete shutdown; this is distinct from ordinary per-event observation.
- Journal writes are serialized. A write failure marks the session `writeFailed`; later writes in that session are rejected rather than silently retried.
- The status becomes `degraded` and exposes `writeFailed` and `writeErrorCount` to programmatic callers.
- A successful `record()` means the write completed; it does not mean the data was fsynced.
- `flush()` and normal `close()` wait for pending EventBus deliveries and queued writes, then call filesystem sync.
- A successful close reports `durable: true`. A failed write/sync/close reports errors and does not claim durability.
- Disk-full, permission, or filesystem errors can therefore leave a session incomplete. The Journal does not automatically recover writes in that session; resolve the filesystem issue and start a new process session.

## Normal shutdown

The implemented order is:

1. Stop market-price and user-data intake; ignore late callbacks.
2. Drain already accepted serialized user-data work.
3. Reconcile Harvester-owned orders and determine CLOSING audit completeness.
4. For trading-enabled runs, capture and durably flush the CLOSING account snapshot while broker access is still available. Mark it INCOMPLETE when reconciliation, intake, or accounting state is unsafe.
5. Disconnect broker resources.
6. Publish `harvester.stopped` while EventBus and Journal are still available.
7. Close Journal. It unsubscribes, flushes accepted EventBus deliveries, drains writes, syncs, and closes the session file.
8. Close EventBus with its 5-second timeout.

Cleanup failures are isolated so later cleanup still runs. An EventBus close timeout or Journal close failure is reported and causes a non-zero process exit status. The Journal close API has no timeout option; only EventBus close is bounded.

A process kill, machine crash, power loss, or failed filesystem sync can still lose recent records. The Journal is not an unconditional durability guarantee.

## Diagnosing a missing or incomplete session

1. Confirm `HARVESTER_JOURNAL_ENABLED` is not `false`.
2. Confirm `HARVESTER_JOURNAL_DIRECTORY` resolves to the expected writable directory.
3. Check startup logs for `Journal started` or `Optional Harvester Journal setup failed`.
4. Check the latest UTC-named `.jsonl` file and verify that each line parses as JSON and includes `__coinzillaJournal.schemaVersion = 1`.
5. Check the process logs for `Failed to write journal event`, `Journal closed with errors`, or `Harvester observability shutdown incomplete`.
6. If a programmatic caller is available, inspect `journalService.status`: `state`, `enabled`, `started`, `writeFailed`, `writeErrorCount`, and `closed`.

An absent first startup event can be the documented asynchronous-subscription gap. A `writeFailed` session will not resume writing automatically. A missing final stopped event or a failed close can indicate interrupted shutdown or failed durability confirmation.

## Security

Event DTOs do not include credentials, raw exchange messages, or SDK objects. The two explicit account-audit events intentionally include the full exchange-returned balance list and complete open-order set using allowlisted exact-decimal fields. Applied-fill events persist each actual commission as an exact decimal amount plus asset ID and code; they do not persist Commission class instances or raw broker payloads. This preserves the fee facts needed for a future deterministic recovery projection, but does not itself implement replay or restore Portfolio/RecoveryLedger state. Error DTOs contain only a bounded name/message and redact common credential assignment patterns, bearer tokens, and credential-bearing URLs. This is not a substitute for protecting the log directory: event names, market/order identifiers, and error text remain operationally sensitive.