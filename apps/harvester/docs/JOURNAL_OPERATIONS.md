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
| `harvester.process_started` | `application`, `version`, `runtimeSessionId`, `processId`, original `startedAt`, and allowlisted Git `source` metadata (branch, full/short commit, subject/date, working-tree state, metadata source) |
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

The `harvester.process_started` event records the process attempt, including its original UTC entry timestamp, even when optional Journal initialization delays publication. It is distinct from `harvester.started`, which records successful runtime startup. The process event is allowlisted and best-effort: for broker-connected startup, it is admitted before the existing PREFLIGHT flush can persist it; it does not add a separate durability barrier. Configuration-only/no-broker startup does not await optional Journal readiness, and logger context remains the immediate fallback when Journal is delayed or unavailable. When optional readiness is delayed, the event may appear after `harvester.started` in append order; its payload `startedAt` remains the process-entry time. Missing build metadata is recorded as null/unknown rather than inferred.

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

The sequence below is the implemented trading-enabled shutdown path. It is verified against
`src/bootstrap/shutdown/create-shutdown-handler.js`, the Conservative engine's
`cancelOwnedBuyOrdersForShutdown()` and `reconcileOwnedOrders()` workflows,
`create-account-snapshot-manager.js`, and the process/lock cleanup in
`src/index.js`. The diagram describes orchestration; the source remains authoritative.

```mermaid
sequenceDiagram
    autonumber
    actor Signal as SIGINT or SIGTERM
    participant Main as Process main
    participant Stop as Shutdown handler
    participant Market as Price and book streams
    participant Engine as Trading engine
    participant User as User-data stream and queue
    participant Broker as Broker REST API
    participant Journal
    participant Bus as EventBus
    participant Telegram as Optional Telegram subscriber
    participant Locks as Host and Journal locks

    Signal->>Main: shutdown(reason)
    Main->>Stop: runtime.stop()
    Stop->>Stop: stopped=true; ready=false; status=STOPPING
    Stop->>Market: unsubscribe price and book subscriptions
    Market-->>Stop: settle all unsubscribe attempts
    Stop->>Stop: await accepted market-price tasks
    Stop->>User: await current accepted event queue
    Note over Stop,User: User-data intake remains connected through BUY cancellation and final owned-order reconciliation.

    alt Trading enabled
        Stop->>Engine: reconcileOwnedOrders() before cancellation
        Engine->>Broker: resolve pending client IDs; read owned open orders, order history and fills
        Broker-->>Engine: canonical owned-order snapshots
        Engine-->>Stop: initial reconciliation result
        alt Initial reconciliation fails
            Stop->>Stop: add OWNED_ORDER_RECONCILIATION_FAILED
        end

        Stop->>Engine: cancelOwnedBuyOrdersForShutdown()
        loop Each acknowledged owned OPEN or PARTIALLY_FILLED BUY
            Engine->>Bus: publish order.cancel_requested
            Bus->>Journal: deliver cancellation intent
            Engine->>Journal: durable flush
            alt Durable cancellation intent succeeds
                Engine->>Broker: cancel BUY
                Broker-->>Engine: canonical cancellation response
                Engine->>Broker: getFills(orderId)
                Broker-->>Engine: canonical execution history
                Engine->>Engine: validate fill identity, deduplicate and verify executed-quantity parity
                Engine->>Engine: apply cancellation-racing fills through normal accounting
            else Intent, cancellation or fill reconciliation fails
                Engine->>Engine: mark outcome unsafe and pause affected market
            end
        end
        Note over Engine,User: Execution reports may arrive during REST cancellation; the stream remains active so accepted reports can be applied before the audit.
        Stop->>User: await queued cancellation and execution-report work
        Stop->>Engine: reconcileOwnedOrders() final verification
        Engine->>Broker: reconcile registered owned orders against canonical REST state
        Broker-->>Engine: final canonical order and fill state
        Engine-->>Stop: final reconciliation result
        Note over Stop,Engine: This final pass verifies state; the handler does not call BUY cancellation a second time. A still-open BUY is unresolved and fails shutdown.
    else Read-only or no trading
        Note over Stop,Engine: No owned-order cancellation and no trading CLOSING audit.
    end

    Stop->>User: disconnect user-data subscription
    User-->>Stop: intake-stop result
    Stop->>Stop: intakeStopped=true; await final accepted event queue

    alt Trading enabled
        Stop->>Engine: inspect owned order statuses and accounting flags
        Note over Stop,Engine: FILLED, CANCELED, REJECTED, EXPIRED and EXPIRED_IN_MATCH are terminal. OPEN or PARTIALLY_FILLED SELLs are intentionally exempt.
        alt Unresolved owned order or unsafe accounting/reconciliation
            Stop->>Stop: add CLOSING audit reasons; classify audit INCOMPLETE
        else Only terminal orders and known open SELLs
            Stop->>Stop: classify audit COMPLETE
        end
        Stop->>Broker: getAccountSnapshot()
        Broker-->>Stop: account balances
        Stop->>Bus: publish account.snapshot_captured with phase CLOSING
        Bus->>Journal: deliver CLOSING snapshot
        Stop->>Journal: flush queued writes and filesystem sync
        alt Durable flush confirmed
            Journal-->>Stop: durable=true
        else Snapshot query, publish or flush fails
            Journal-->>Stop: error
            Stop->>Stop: record shutdown failure; do not claim a durable CLOSING audit
        end
    end

    Stop->>Stop: status=STOPPED
    Stop->>Broker: disconnect()
    Broker-->>Stop: disconnect result
    Stop-->>Main: resolve or reject runtime.stop()
    Main->>Bus: publish harvester.stopped; flush accepted events
    opt Telegram notifications enabled
        Main->>Telegram: close and drain accepted notifications
        Telegram-->>Main: cleanup result
    end
    Main->>Journal: close and drain writes; sync and close session file
    Main->>Bus: close with 5000 ms timeout
    alt Runtime stop and Journal close both confirmed
        Main->>Locks: release Journal lock, then broker-wide host lock
        Locks-->>Main: release result
    else Runtime stop or Journal close not confirmed
        Note over Main,Locks: Retain the trading-process locks and exit non-zero.
    end
    Main->>Main: close logger transports
```

### Ordering and safety invariants

- The handler marks the runtime stopped and not ready before unsubscribing market streams. It unsubscribes both market-price and book-ticker subscriptions, waits for already accepted market-price tasks, and waits for the current user-data queue before touching owned orders. No new strategy decisions should be started by later market callbacks.
- For trading-enabled runs, the first owned-order reconciliation resolves pending client-order identities and reads canonical order state before cancellation selection. The cancellation workflow selects only registered, acknowledged BUY orders in OPEN or PARTIALLY_FILLED state. Each broker cancellation is preceded by a durably flushed `order.cancel_requested` event. The canonical response must match the owned order and be terminal; canonical fills are then checked for identity, duplicates and cumulative executed-quantity parity before normal accounting applies them.
- User-data intake remains active through cancellation and the final owned-order reconciliation. After cancellation, the handler awaits queued user-data work, performs its final REST/stream owned-order reconciliation, disconnects user-data intake, marks intake stopped, and awaits the final accepted queue. The final reconciliation is verification, not another cancellation pass. If it leaves an owned BUY non-terminal, shutdown fails closed.
- Shutdown never cancels SELL orders. An owned SELL in OPEN or PARTIALLY_FILLED state is explicitly excluded from the unresolved-order check and remains resting at the broker. Other non-terminal/unknown owned-order states are unresolved.
- Only trading-enabled runs capture a CLOSING account audit. The snapshot is fetched while broker REST is connected, filtered to configured market assets, checked for required asset coverage, published as `account.snapshot_captured` with `phase: "CLOSING"`, and accepted only after the event publisher confirms a durable flush. An audit reason produces `auditStatus: "INCOMPLETE"`; a query, publish or flush failure means no durable CLOSING audit can be claimed. The CLOSING event is a balance snapshot, not an open-orders audit or a Portfolio import.
- Broker disconnect is attempted after the CLOSING audit attempt, even when earlier shutdown stages recorded errors. The process then publishes `harvester.stopped`, flushes EventBus work, closes the optional Telegram subscriber, closes Journal, closes EventBus, and finally evaluates lock release.

### Failure and process-lock behavior

For trading-enabled runs, any owned-BUY cancellation failure, initial/final owned-order reconciliation failure, unresolved non-terminal/unknown owned order, or unsafe user-data/accounting state makes the CLOSING audit INCOMPLETE and rejects runtime shutdown. Market-intake unsubscribe errors, user-data-intake stop errors, CLOSING snapshot query/publish/flush errors, and broker-disconnect errors also make runtime shutdown fail. The process sets a non-zero exit status, still attempts later cleanup, and retains the trading-process locks because `runtime.stop()` was not confirmed.

The process owns two locks: a broker-wide host lock and a Journal-directory lock. Lock release is allowed only when runtime shutdown was confirmed and Journal close returned a successful result. If runtime shutdown is uncertain, or Journal close/drain/sync is not confirmed, both locks are retained. The lock-release function removes the Journal lock first and only then the host lock; if Journal-lock release is uncertain, the host lock is deliberately retained. A failed lock release is reported and leaves the remaining lock in place.

An EventBus close timeout (bounded at five seconds) still causes a non-zero process exit, but it does not by itself retain the trading lock when runtime shutdown and Journal close were both confirmed. Telegram/log-transport cleanup failures are also reported separately from the runtime-stop and Journal-close lock-release gates. This distinction prevents an ancillary delivery failure from being described as an unresolved trading state.

The handler's shutdown ordering and basic success/error aggregation are covered by
`create-shutdown-handler.test.js`. Process tests in `src/index.test.js` verify
that runtime-stop failure and unconfirmed Journal close retain the process lock.
The tests do not establish an additional post-reconciliation BUY-cancellation
pass; the sequence above intentionally documents the implementation that exists.

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

## Process-restart recovery status — 2026-11-09

**Process-restart state restoration is not implemented in the current Harvester startup composition.** Do not interpret the PREFLIGHT audit or the Journal's standalone read/replay API as proof that prior trading state has been restored.

Current source behavior:

- `prepareOptionalJournal()` starts the Journal writer and exposes readiness, flush and close. It does not read or replay prior sessions.
- `src/index.js` passes an event publisher into `startHarvester()`; it does not pass restored Portfolio, RecoveryLedger, OrderRegistry or fill projection state.
- `start-harvester.js` creates fresh in-memory Portfolio, RecoveryLedger and OrderRegistry state and explicitly disables Journal replay.
- PREFLIGHT captures and durably records account balances and account-wide open orders. An unmatched order is classified as unowned and is not adopted. The current startup test explicitly permits runtime startup with an unowned open order; the `BLOCKED` audit classification is not itself a trading-readiness gate.
- `reconcileOwnedOrders()` reconciles the orders already in the in-memory ownership registry. When that registry is empty, it returns without discovering historical order IDs or querying their fill history.

The shared Journal package supports bounded read/replay, but replay is at-least-once and requires an idempotent consumer. That capability is not wired into Harvester startup. The previous statement that Harvester reads all prior sessions and blocks trading startup when historical trading events exist was inaccurate for the inspected current source and is removed.

**Operational restriction:** do not enable unattended process restarts until [#654](https://github.com/45s/coinzilla/issues/654) has a separately implemented and exact-head-tested restoration/reconciliation workflow. Keep trading fail-closed on missing or incomplete history, unknown ownership, duplicate/conflicting execution identities, unsupported commissions, or account/order discrepancies. Do not claim exactly-once transport delivery.

This is an investigation status, not an implementation proposal to be applied in the current phase. See [AUDIT.md](../AUDIT.md), [AUDIT_FINDINGS.md](../AUDIT_FINDINGS.md) F-011, and [ROADMAP.md](../ROADMAP.md).

## Single-writer trading process lock

- Trading-enabled startup creates `.harvester-trading.lock` with exclusive-create semantics in the configured Journal directory before reading Journal history or creating a Journal writer.
- A second local process using that same directory fails before Journal startup and before broker connection.
- The lock is released only after runtime shutdown and Journal writer closure are confirmed. If runtime stop or Journal close is not confirmed, the lock is retained. If Journal shutdown cannot be confirmed, the lock is retained to prevent another writer from trading concurrently.
- If runtime startup has been attempted and then fails, the lock is retained because broker resources may have been partially activated even when no runtime handle was returned. Verify the process and broker state before manually removing that stale lock.
- Stale locks are not automatically reclaimed. After an unclean process termination, inspect the stored PID, hostname, and start time; remove the file manually only after confirming the owner is no longer running.
- Different Journal directories do not share a lock. All local Harvester processes trading the same account must use the same directory.
