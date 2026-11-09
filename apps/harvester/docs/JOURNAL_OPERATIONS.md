# Harvester Journal Operations

## Purpose and limits

Harvester uses one in-process EventBus to publish selected operational and trading-lifecycle facts. The Journal subscribes to that bus and appends event records to local JSONL files. Journal persistence is optional in configuration-only/no-broker mode; it is a required startup dependency for every broker-connected mode because the account PREFLIGHT audit must be durably recorded before market subscriptions.

The Journal is an operational observer, not trading-state authority. Portfolio and RecoveryLedger remain in-memory application state. Journal replay is not used to reconstruct trading state. There is no database, outbox, exactly-once delivery, or per-market-price capture.

## Configuration

The application enables the Journal by default and writes sessions to
`apps/harvester/logs/`. The application entrypoint does not expose environment
or `trading-config.json` settings to disable the Journal or change its
directory. The lower-level `prepareOptionalJournal()` helper accepts
`enabled` and `directory` options for controlled programmatic composition
and tests; these are not deployment settings.

The `dev` launcher starts Node with `--env-file=.env.development` and sets
`NODE_ENV=development` in the child environment before application and broker
modules load. The `start` launcher loads `.env.production` when that file exists
and preloads an initializer that sets `NODE_ENV=production` before those modules
load.
Environment files and externally injected environment values may provide
standard process settings, credentials, and optional notifier secrets; they do
not provide Journal configuration or broker/trading-policy flags. The default Journal directory is shared with
Harvester diagnostic logs at `apps/harvester/logs/`, but their formats and
lifecycles are independent. See [Logging](./LOGGING.md) for cumulative and
timestamped diagnostic files. The Harvester `.gitignore` excludes its
`/logs/` directory.

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

The `harvester.process_started` event records the process attempt, including its original UTC entry timestamp, even when optional Journal initialization delays publication. It is distinct from `harvester.started`, which records successful runtime startup. The process event is allowlisted and best-effort: for broker-connected startup, it is admitted before the existing PREFLIGHT flush can persist it; it does not add a separate durability barrier.

The process event, structured DEBUG/TRACE session filenames, and logger context share one immutable process identity: the UTC `startedAt` timestamp and `runtimeSessionId`. The development runner creates that identity once and passes it to the child process; its cumulative and timestamped terminal files use the same identity. A standalone `start` process generates its own identity and has no development terminal-capture files. See [Logging](./LOGGING.md) for exact filenames and stream lifecycle. Configuration-only/no-broker startup does not await optional Journal readiness, and logger context remains the immediate fallback when Journal is delayed or unavailable. Startup-failure and shutdown paths do not separately await the process-start publication promise; the existing Journal close lifecycle remains unchanged and may wait for Journal readiness. If the process exits before the Journal subscriber becomes ready, the Journal event is not guaranteed, but DEBUG/TRACE logs retain the process identity. When readiness is delayed, the event may appear after `harvester.started` in append order; its payload `startedAt` remains the process-entry time. Missing build metadata is recorded as null/unknown rather than inferred.

A `strategy.decision` event is emitted only when the strategy produces at least one actionable order. NO_ACTION evaluations are not journaled. No event is emitted for every market-price update.

The broker status `recovered` means the remote user-data subscription has returned; it does not mean Harvester has reconciled account state or reopened order placement.

A broker `rpcError` explicitly marked `recoveryRequired: false` and carrying no contradictory reconciliation flag is diagnostic-only and does not itself invalidate the application recovery generation. Missing or malformed recovery metadata remains fail-closed. An actual `connectionClosed` status, including code `1006`, starts recovery; that abnormal close code does not identify the underlying network cause.

## Startup and capture gaps

A standalone read-only audit can be run while Harvester remains stopped with `pnpm run testnet:audit`. It creates its own Journal session and writes both account events with phase `PREFLIGHT`; it does not start trading or alter exchange state. Exit code 2 means the audit was persisted successfully but open orders were found.

For every broker-connected startup, including read-only mode, bootstrap fetches the full account balance snapshot and account-wide open orders, publishes `account.snapshot_captured` and `account.open_orders_captured` with `phase: PREFLIGHT`, and durably flushes each event before market subscriptions or trading-engine activation. `main()` starts the optional Journal service and invokes Harvester without awaiting `journalService.ready` before broker connection. The first required PREFLIGHT event flush waits for Journal readiness; if the Journal is unavailable or the flush is not durable, startup fails before market subscriptions proceed. If either account query fails, event mapping/publication fails, or either flush is not durable, startup fails closed. A pre-existing order is recorded as external/unowned and is never adopted or cancelled. The `BLOCKED` value is an audit classification, not a trading-readiness gate: `subscribeToUserData()` sets `state.ready = true` after queued events and other safety flags pass, without gating on open-order audit readiness. The current trading-enabled startup test explicitly allows market subscriptions/runtime startup with an unmatched open order. Its fake broker emits no market-price tick, so it does not prove that later strategy activity cannot overlap that unowned order. A prior-process Harvester order can be treated as external after restart; see #654. Programmatic callers of `main()` can inspect `journalService.ready` and `journalService.status`.

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

1. Confirm the application is using its default `apps/harvester/logs/` directory and that the operating-system user can create and write files there.
2. Check startup logs for `Journal started` or the structured `Optional Harvester Journal startup failed` entry. Inspect its `errors` array for the original filesystem error code, message, and path.
3. Check the latest UTC-named `.jsonl` file and verify that each line parses as JSON and includes `__coinzillaJournal.schemaVersion = 1`.
4. Check the process logs for `Failed to write journal event`, `Journal closed with errors`, or `observability shutdown incomplete`.
5. If a programmatic caller is available, inspect `journalService.status`: `state`, `enabled`, `started`, `writeFailed`, `writeErrorCount`, and `closed`.

An absent first startup event can be the documented asynchronous-subscription gap. A `writeFailed` session will not resume writing automatically. A missing final stopped event or a failed close can indicate interrupted shutdown or failed durability confirmation.

## Security

Event DTOs do not include credentials, raw exchange messages, or SDK objects. The two explicit account-audit events intentionally include the full exchange-returned balance list and complete open-order set using allowlisted exact-decimal fields. Applied-fill events persist each actual commission as an exact decimal amount plus asset ID and code; they do not persist Commission class instances or raw broker payloads. This preserves the fee facts needed for a future deterministic recovery projection, but does not itself implement replay or restore Portfolio/RecoveryLedger state. Error DTOs contain only a bounded name/message and redact common credential assignment patterns, bearer tokens, and credential-bearing URLs. This is not a substitute for protecting the log directory: event names, market/order identifiers, and error text remain operationally sensitive.

## Safety-pause state is process-local

The current startup composition initializes `userDataState.accountingFailed=false`, trading-enabled `requiresReconciliation=false`, and empty engine pause/recovery-intent Sets. The engine's `pause()` adds symbols to in-memory `paused` and `durablePausedMarkets` Sets and publishes `STRATEGY_PAUSED`; it does not persist a durable checkpoint or restore that event on startup.

The per-market strategy pause/recovery-intent sets are not guaranteed to survive a process restart. The separate `accountingFailed` process-lifetime latch is tracked by F-023/#769. PREFLIGHT and new live events may detect some unresolved conditions, but they do not reconstruct every previous pause reason or offline terminal fill. Do not treat restart as resolution of an earlier safety halt. Keep trading disabled until the prior cause has been authoritatively reconciled or explicitly acknowledged. See F-029 in [AUDIT.md](../AUDIT.md), F-031/#654 and F-028.

## Applied-fill Journal durability boundary

The Harvester engine publishes `execution.fill_applied` after applying the canonical fill to in-memory accounting. The current applied-fill path does not invoke the durable Journal flush barrier. Publication is synchronous admission only; EventBus subscriber delivery is asynchronous. Journal append reports `durable: false`; explicit `flush()` waits for pending EventBus deliveries and Journal writes, then performs filesystem sync/fsync.

The engine's durable flush barrier protects order submission/cancellation intent before the exchange side effect. It does not immediately protect the post-fill accounting event. Graceful Journal close drains and syncs accepted events; unexpected process termination or power loss has no equivalent guarantee.

Therefore the Journal must not be described as a crash-consistent fill ledger or complete trading-state authority. This is a confirmed missing durability guarantee, not evidence that a particular historical fill was lost. See F-028 in [AUDIT.md](../AUDIT.md) and [#654](https://github.com/45s/coinzilla/issues/654).

## Existing offline recovery helpers — not wired into current runtime

The repository retains tested offline helpers: `projectHarvesterJournalRecovery()`, `restoreHarvesterJournalState()`, `fetchAccountTradeHistory()`, `auditRecoveredTradeHistory()`, and `auditRecoveredAccountState()`. They can project Journal records, rehydrate Portfolio/RecoveryLedger/OrderRegistry and pause/intent state, scan trade history for supplied markets, and compare exact executions, balances, open orders and reservations.

Current `index.js`, `prepareOptionalJournal()` and `startHarvester()` do not call this pipeline. Historical PR #606 did wire it, but passed `marketUniverseComplete: false` while `auditRecoveredTradeHistory()` requires true; that trading-enabled path therefore failed closed after prior trading activity. The current runtime bypasses that fail-closed gate rather than solving historical market-universe completeness. See F-031 and #654.

## Process-restart recovery status — 2026-11-09

**Process-restart state restoration is not implemented in the current Harvester startup composition.** Do not interpret the PREFLIGHT audit or the Journal's standalone read/replay API as proof that prior trading state has been restored.

Current source behavior:

- `prepareOptionalJournal()` starts the Journal writer and exposes readiness, flush and close. It does not read or replay prior sessions.
- `src/index.js` passes an event publisher into `startHarvester()`; it does not pass restored Portfolio, RecoveryLedger, OrderRegistry or fill projection state.
- `start-harvester.js` creates fresh in-memory Portfolio, RecoveryLedger and OrderRegistry state and explicitly disables Journal replay.
- PREFLIGHT captures and durably records account balances and account-wide open orders. An unmatched order is classified as unowned and is not adopted. The current startup test explicitly permits runtime startup with an unowned open order; the `BLOCKED` audit classification is not itself a trading-readiness gate.

The engine's active-order and commitment guards read only the in-memory `OrderRegistry`; they do not include unowned account-wide open orders. With an empty registry, the Conservative policy can emit an `INITIAL_BUY`, and if free quote remains the order allocator can permit another same-symbol order while the prior exchange order is still open. The submission guard checks pause/readiness, price freshness and post-only crossing, not the unowned order. This is strongly indicated by source, not reproduced: the existing startup test does not emit a market-price tick. See F-031 in [AUDIT.md](../AUDIT.md) and #654.
- `reconcileOwnedOrders()` reconciles the orders already in the in-memory ownership registry. When that registry is empty, it returns without discovering historical order IDs or querying their fill history.
- The broker contract supports symbol-wide `getFills({ symbol, fromId })` discovery, but Harvester does not perform a startup-wide scan or restore a per-symbol cursor. Binance documents inclusive cursors, a maximum page size of 1,000 and time windows no longer than 24 hours. No guaranteed history-retention horizon was established; complete offline-fill discovery remains unproven.

The shared Journal package supports bounded read/replay, but replay is at-least-once and requires an idempotent consumer. That capability is not wired into Harvester startup. The previous statement that Harvester reads all prior sessions and blocks trading startup when historical trading events exist was inaccurate for the inspected current source and is removed.

**Operational restriction:** do not enable unattended process restarts until [#654](https://github.com/45s/coinzilla/issues/654) has a separately implemented and exact-head-tested restoration/reconciliation workflow. Keep trading fail-closed on missing or incomplete history, unknown ownership, duplicate/conflicting execution identities, unsupported commissions, or account/order discrepancies. Do not claim exactly-once transport delivery.

This is an investigation status, not an implementation proposal to be applied in the current phase. See [AUDIT.md](../AUDIT.md), [AUDIT_FINDINGS.md](../AUDIT_FINDINGS.md) F-031, and [ROADMAP.md](../ROADMAP.md).

## Trading process ownership locks

Trading-enabled startup acquires two exclusive locks before the Journal writer starts or the broker connects:

1. **Broker-wide host lock:** a file named `.<broker>-harvester-trading.lock` (for Binance, `.binance-harvester-trading.lock`) under `~/.coinzilla/harvester/process-locks/`. It is independent of the Journal directory and prevents another Harvester process running under the same OS user from trading through the same broker even when a programmatic caller uses a different Journal directory.
2. **Journal-directory lock:** `.harvester-trading.lock` inside the configured Journal directory. It prevents concurrent writers to the same recovery-history directory.

The host lock is acquired first, then the Journal lock. If Journal-lock acquisition fails, startup attempts to release the host lock; an uncertain host-lock release is surfaced rather than ignored. During shutdown, the Journal lock is released first and the host lock only after Journal-lock release is confirmed. If Journal-lock release is uncertain, the host lock is deliberately retained. Both locks remain held unless runtime shutdown and Journal close are confirmed. If runtime startup was attempted and then failed before a runtime handle was returned, the locks are retained because broker resources may have been partially activated.

Each lock records PID, hostname, start time and a random ownership token. A stale lock is automatically reclaimed only when its recorded hostname matches the current host, its PID is confirmed absent, and an immediate reread confirms the PID, hostname and ownership token are unchanged. A different-host lock, live or ambiguous PID, unreadable metadata, permission-denied process inspection or changed ownership token fails closed. The process check treats permission-denied inspection as potentially alive; it does not guess that the owner is dead. Verify the recorded owner before any manual removal.

The host lock is local to one OS user's home directory and one broker identifier. It does not coordinate different machines or different OS users. The Journal lock is directory-scoped; different Journal directories do not share that lock, but the broker-wide host lock still prevents a second same-user process for the same broker.

## Same-process recovery failure classification

A broker `recovered` status confirms transport/subscription restoration only.
Harvester remains blocked while application reconciliation is required. The
application recovery sequence is owned-order canonical history and complete
fills, queued-event drain, fresh account balances, account-wide open orders,
durable flush of both RECOVERY audit records, generation/event-sequence
revalidation, exact broker-generation acknowledgement, and the matching
global `reconciled` notification.

Failures are classified by the engine and carried to bootstrap with a
`failure.category`, `failure.stage`, and `failure.retryable`:

- `OWNERSHIP_INTEGRITY` and `ACCOUNTING_INTEGRITY` are terminal for the
  process. They set the sticky accounting-failure gate and prevent recovery
  acknowledgement.
- `ORDER_TRANSITION`, `REST_RECONCILIATION`, and `DURABILITY` are retryable
  only after a new single-flight attempt repeats the authoritative checks.
  They keep readiness closed and carry a generation-scoped failure marker.
- An unclassified error defaults to terminal accounting-integrity failure.
  Missing metadata is never treated as evidence that trading is safe.

If a retryable failure occurs while queued user-data events are being drained,
the active recovery attempt stops before either RECOVERY audit can authorize
broker acknowledgement. A later `recovered` reminder may clear that marker
only when a new attempt begins; it must then repeat all canonical REST reads,
queued-event draining, both durable Journal barriers, and generation
revalidation. Reclassification alone never clears readiness or acknowledges a
broker generation.

This is same-process recovery only. It does not enable Journal replay or
process-restart recovery. TESTNET acceptance remains PAUSED / UNVERIFIED.

