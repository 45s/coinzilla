# Harvester Journal Operations

## Purpose and limits

Harvester uses one in-process EventBus to publish selected operational and trading-lifecycle facts. The Journal subscribes to that bus and appends event records to local JSONL files. Journal persistence is optional in configuration-only/no-broker mode; it is a required startup dependency for every broker-connected mode because the account PREFLIGHT audit must be durably recorded before market subscriptions.

The Journal is an operational observer, not trading-state authority. Portfolio and RecoveryLedger remain in-memory application state. The offline `projectHarvesterJournalRecovery()` and `restoreHarvesterJournalState()` helpers can validate and rehydrate a candidate state for controlled offline use, but runtime startup does not invoke them or resume trading from Journal data. Journal replay is not yet wired as runtime trading-state authority. There is no database, outbox, exactly-once delivery, or per-market-price capture.

## Configuration

The application enables the Journal by default. Each process writes its
Journal JSONL session inside the matching
`apps/harvester/logs/sessions/<UTC timestamp>-<runtime session ID>/`
directory, beside that process's structured logs. Cumulative diagnostic files
remain under `apps/harvester/logs/cumulative/`. The application entrypoint
does not expose environment or `config.json` settings to disable the
Journal or change its directory. The lower-level `prepareOptionalJournal()`
helper accepts `enabled` and `directory` options for controlled programmatic
composition and tests; these are not deployment settings.

The `dev` package script loads `.env.development` before starting the logging
runner; the child Harvester process inherits those values. Set
`TRADING_MODE=testnet` in `.env.development`. The `start` package script
loads `.env`; set `TRADING_MODE=live` there for production LIVE execution.
`TRADING_MODE` must be exactly `testnet` or `live`; missing or invalid values
fail startup. `NODE_ENV` may describe the Node.js runtime but never selects the
exchange. No launcher or preload script forces either value.
Environment files and externally injected environment values may provide
`TRADING_MODE`, Binance API credentials, standard process settings, and
optional notifier secrets; they do not provide a broker selector,
trading-enable flag, runtime profile, or Journal configuration.

The Journal and diagnostic logs share the same process session directory,
but retain independent formats and lifecycles. Legacy flat JSONL files remain
readable. The balance-reconciliation CLI scans both legacy root-level sessions
and new per-process session directories. See [Logging](./LOGGING.md) for the
directory layout and cumulative destinations. The Harvester `.gitignore`
excludes its `/logs/` directory.

## Session files and JSONL format

- One new session file is created for each Journal start inside the current process session directory.
- With the Harvester process identity, the filename is `YYYY-MM-DD_HH-MM-SS-<runtime-session-id>.jsonl`; standalone Journal consumers without an identity retain the timestamp-only filename and numeric collision suffix.
- Files are opened exclusively; an existing session file is never overwritten.
- Each line is one JSON object containing the EventBus event fields (`id`, `timestamp`, `source`, `name`, and `data`) plus `__coinzillaJournal` metadata with `schemaVersion: 1` and the same event ID.
- Writes are serialized in arrival order for that Journal subscription.
- Directory and file permissions use the operating system defaults and process umask; the Journal does not apply a custom permission mode.

There is no automatic file rotation, retention, compression, or deletion. Session files accumulate until an operator archives or removes them. Protect the directory with appropriate OS permissions because event records include market, order, and error identifiers.

## Legacy history discovery and chronology (forensic only)

Use Harvester's `readHarvesterJournalHistory({ directory })` for historical inspection. Pass either the Harvester log root or the `logs/sessions` directory itself. Do not call `Journal.read()` on the `logs/sessions` parent and treat an empty result as proof that no process sessions exist: the package-level Journal reader reads files in one directory; Harvester's history reader performs the recursive process-session discovery.

The Harvester reader:

- Reads legacy root-level flat JSONL files and recursively discovers nested per-process session directories.
- Rejects unreadable directories, symbolic links, discovered process directories without a JSONL session file, malformed session entries, duplicate record IDs, and configured directory/session/record/byte limit violations.
- Returns record positions relative to the supplied history root so equal timestamp-only filenames in different process directories remain distinguishable.
- For multiple process sessions with `harvester.process_started` metadata, orders by the canonical millisecond `data.startedAt` and validates that the directory's timestamp/runtime-session suffix agrees with that identity.
- For multiple legacy sessions without process-start metadata, uses unique first-record event timestamps only when the event ranges are monotonic and strictly non-overlapping. A single legacy flat session remains readable without process-start metadata.
- Allows legacy first-record timestamps and process-start timestamps to coexist only when their persisted event ranges establish a strict, non-overlapping total order. Rejects duplicate process identities, timestamp ties, overlapping event ranges, backwards event timestamps, or missing chronology. Runtime-session IDs and second-resolution directory/filename strings are never tie-breakers.
- Treats `harvester.process_started` as best-effort process identity metadata. It may be appended after `harvester.started`; its payload `startedAt` remains the process-entry timestamp, so the event's append timestamp is not used as the session activity-range boundary.

A successful scan means the discovered forensic files were readable and could be ordered under these legacy rules. It does **not** make Journal authoritative restart state, prove that missing exchange fills did not occur, establish a complete historical baseline, or open the ADR-0001 startup readiness gate. Multiple-session ambiguity and any missing/unreadable session remain hard failures. Any one-time baseline still requires the explicit operator-assisted reconciliation rules in [ADR-0001](./architecture/decisions/0001-application-owned-recovery-facts.md).

## Step 7 — one-market recovery confirmation

The one-market recovery workflow is separate from Journal persistence. Journal history is projected and restored only as a candidate; the ADR-0001 durable-facts stream remains the sole authority for confirmed market-history coverage.

The read-only reconciliation sequence is:

1. Restore the candidate state from the discovered Journal history.
2. Reconcile every Harvester-owned order by canonical client/broker identity and exchange status before auditing balances. This updates the candidate recovery state through the existing serialized engine reconciliation boundary.
3. Read a fresh canonical account snapshot and the complete account-wide open-order set.
4. Exhaust exchange fill history for exactly the target market from the operator-reviewed coverage start time.
5. Run `auditRecoveredAccountState()` with `tradeHistoryScope: "MARKET"`, complete-history enforcement and the candidate `MARKET_HISTORY_COVERAGE_CONFIRMED` evidence.
6. Append the coverage fact only when the target market is READY, then read the fact back and verify its symbol, time boundary, evidence digest and verifier identity.

An unowned order on the target market blocks confirmation; external orders remain unowned and untouched. Unowned orders in another market remain a symbol-scoped blocker and do not automatically invalidate an otherwise-ready target market. Incomplete history, ambiguous owned-order identity/status, missing asset/market metadata, account-balance mismatch, invalid evidence or an unreadable durable-fact ledger all fail closed.

The orchestration and guarded confirmation use cases were merged in [PR #1047](https://github.com/45s/coinzilla/pull/1047). The offline JSON context adapter, audit-only/explicit-confirmation CLI and production-audit evidence matrix are implemented in [PR #1053](https://github.com/45s/coinzilla/pull/1053); all required CI checks passed on code head `837d2781492c53047b5c21345d3de8ef6b07badd`. PR #1053 remains draft and unmerged pending user review. See the [Step 7 recovery operator guide](recovery/README.md) for the evidence-bundle contract and command. This workflow is not invoked by runtime startup and does not add a Telegram command. It has no order-placement or cancellation dependency; no exchange writes are performed by the workflow.

## Event inventory

All events use source `harvester`. Payloads are created by Harvester-owned allowlist mappers; fields not listed below are not copied into the event DTO.

Every mapper must follow the temporary payload constraint in [Journal Evidence Contract — Safety and delivery](./JOURNAL_EVIDENCE_CONTRACT.md#safety-and-delivery). EventBus's accepted in-memory graph is wider than JSONL's lossless representation; until [Journal issue #889](https://github.com/45s/coinzilla/issues/889) is resolved, payloads reaching Journal must be acyclic and JSON-safe. This is a consumer-side restriction only: do not change EventBus behavior or Harvester's existing mandatory durability gates as a workaround.

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
| `execution.fill_applied` | fill/trade/order IDs, symbol, side, exact price/quantity/quote quantity, liquidity role, optional execution time, exact commission amounts and asset IDs/codes, optional exact historical `quoteValue` (amount plus quote-asset ID/code) for third-asset commissions, commission status |
| `execution.unowned_order` | client/broker order IDs, symbol, side, order status, reason |
| `execution.invalid_fill` | order facts, reason, optional Fill identity facts, sanitized error |
| `execution.accounting_failed` | order and Fill identity facts, sanitized error |
| `execution.duplicate_fill` | Fill facts plus `duplicate: true` |
| `recovery.cycle_completed` | `symbol`, `marketId`, allocated base `freeQuantity`, quote-asset `realizedNetProfit` |
| `recovery.cycle_not_completed` | exact SELL client/broker identity, `CONTINUE_SELL_THROUGH` or `BLOCKED` outcome, reason, realized profit, active/keep quantities, configured minimum profit |
| `account.snapshot_captured` | PREFLIGHT/OPENING/CLOSING or targeted COMMISSION_BASELINE phase, audit status, exchange source timestamp, allowlisted exact free/locked/total balances, audit reasons |
| `account.open_orders_captured` | PREFLIGHT/OPENING phase, observation time, READY/BLOCKED decision, complete account-wide open-order list (client/broker IDs, symbol, side, type, exact price/original/executed quantities, status), block reasons |

The `harvester.process_started` event records the process attempt, including its original UTC entry timestamp, even when optional Journal initialization delays publication. It is distinct from `harvester.started`, which records successful runtime startup. The process event is allowlisted and best-effort: for broker-connected startup, it is admitted before the existing PREFLIGHT flush can persist it; it does not add a separate durability barrier.

The process event, structured DEBUG/TRACE session filenames, and logger context share one immutable process identity: the UTC `startedAt` timestamp and `runtimeSessionId`. The development runner creates that identity once and passes it to the child process; its cumulative and timestamped terminal files use the same identity. A standalone `start` process generates its own identity and has no development terminal-capture files. See [Logging](./LOGGING.md) for exact filenames and stream lifecycle. Configuration-only/no-broker startup does not await optional Journal readiness, and logger context remains the immediate fallback when Journal is delayed or unavailable. Startup-failure and shutdown paths do not separately await the process-start publication promise; the existing Journal close lifecycle remains unchanged and may wait for Journal readiness. If the process exits before the Journal subscriber becomes ready, the Journal event is not guaranteed, but DEBUG/TRACE logs retain the process identity. When readiness is delayed, the event may appear after `harvester.started` in append order; its payload `startedAt` remains the process-entry time. Missing build metadata is recorded as null/unknown rather than inferred.

A `strategy.decision` event is emitted only when the strategy produces at least one actionable order. NO_ACTION evaluations are not journaled. No event is emitted for every market-price update.

The broker status `recovered` means the remote user-data subscription has returned; it does not mean Harvester has reconciled account state or reopened order placement.

For `account.open_orders_captured`, `readiness: BLOCKED` with `UNOWNED_OPEN_ORDERS` is an ownership-attribution result, not a global trading-startup rejection. The owner-confirmed policy allows pre-existing external orders: Harvester records them, leaves them unowned, and never adopts, cancels, or modifies them. Global trading readiness is decided separately by durable account auditing and user-data/accounting safety checks. An actual unowned execution event triggers the fail-closed accounting safety halt; a transport reconnect alone does not clear that latch. See [issue #667](https://github.com/45s/coinzilla/issues/667#issuecomment-6717086777).

A broker `rpcError` explicitly marked `recoveryRequired: false` and carrying no contradictory reconciliation flag is diagnostic-only and does not itself invalidate the application recovery generation. Missing or malformed recovery metadata remains fail-closed. An actual `connectionClosed` status, including code `1006`, starts recovery; that abnormal close code does not identify the underlying network cause.

## Startup and capture gaps

A standalone read-only audit can be run while Harvester remains stopped with `pnpm run testnet:audit`. It creates its own Journal session and writes both account events with phase `PREFLIGHT`; it does not start trading or alter exchange state. Exit code 2 means the audit was persisted successfully but open orders were found.

For every trading startup, bootstrap fetches the full account balance snapshot and account-wide open orders, publishes `account.snapshot_captured` and `account.open_orders_captured` with `phase: PREFLIGHT`, and durably flushes each event before market subscriptions or trading-engine activation. `main()` starts the optional Journal service and invokes Harvester without awaiting `journalService.ready` before broker connection. The first required PREFLIGHT event flush waits for Journal readiness; if the Journal is unavailable or the flush is not durable, startup fails before market subscriptions proceed. If either account query fails, event mapping/publication fails, or either flush is not durable, startup fails closed. A pre-existing order is recorded as external/unowned and is never adopted or cancelled. The `BLOCKED` value is an audit classification, not a trading-readiness gate: `subscribeToUserData()` sets `state.ready = true` after queued events and other safety flags pass, without gating on open-order audit readiness. The current trading-enabled startup test explicitly allows market subscriptions/runtime startup with an unmatched open order. Its fake broker emits no market-price tick, so it does not prove that later strategy activity cannot overlap that unowned order. A prior-process Harvester order can be treated as external after restart; see #654. Programmatic callers of `main()` can inspect `journalService.ready` and `journalService.status`.

## Write failures and durability

- After the startup PREFLIGHT gate succeeds, ordinary event delivery to the Journal is asynchronous. Market-price evaluation, strategy policy, and fill accounting do not await Journal subscriber or filesystem writes.
- Before any broker order-placement or cancellation call, Harvester publishes the corresponding order intent (`order.submission_requested` or `order.cancel_requested`) and awaits a successful durable Journal flush. If publication or durability fails, the broker write is not attempted and the affected pair is paused.
- The explicit startup PREFLIGHT audit and trading-enabled CLOSING balance audit are lifecycle exceptions: each awaits a durable flush. A failure in either gate fails startup or reports incomplete shutdown; this is distinct from ordinary per-event observation.
- Journal writes are serialized. The Journal validates the complete source-event graph against its lossless JSONL contract before append. A serialization or append failure is retained in writer state, marks the session `writeFailed`, rejects later record admission, and is surfaced by `Journal.flush()`/`close()`; the Journal must not report `durable: true` after an event was omitted. Records already accepted into the write queue still drain in order. EventBus `publish()`/`flush()` success is not a Journal persistence acknowledgement; inspect Journal `flush()`/`close()` results and `writeErrorCount`. See [Journal issue #889](https://github.com/45s/coinzilla/issues/889) and [PR #920](https://github.com/45s/coinzilla/pull/920).
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
    participant Broker as Broker WebSocket API
    participant Journal
    participant Bus as EventBus
    participant Telegram as Optional Telegram subscriber
    participant Locks as Host and application locks

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
        Note over Engine,User: Execution reports may arrive during WebSocket API cancellation; the stream remains active so accepted reports can be applied before the audit.
        Stop->>User: await queued cancellation and execution-report work
        Stop->>Engine: reconcileOwnedOrders() final verification
        Engine->>Broker: reconcile registered owned orders against canonical WebSocket API request/response state
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

    Stop->>Broker: disconnect()
    Broker-->>Stop: disconnect result
    alt All shutdown and audit stages confirmed
        Stop->>Stop: status=STOPPED
    else Any shutdown or audit blocker remains
        Stop->>Stop: status=SHUTDOWN_INCOMPLETE
        Stop->>Stop: log and attach shutdownDiagnostics
    end
    Stop-->>Main: resolve or reject runtime.stop()
    Main->>Bus: publish harvester.stopped; flush accepted events
    opt Telegram notifications enabled
        Main->>Telegram: close and drain accepted notifications
        Telegram-->>Main: cleanup result
    end
    Main->>Journal: close and drain writes; sync and close session file
    Main->>Bus: close with 5000 ms timeout
    alt Runtime stop and Journal close both confirmed
        Main->>Locks: release application lock, then broker-wide host lock
        Locks-->>Main: release result
    else Runtime stop or Journal close not confirmed
        Note over Main,Locks: Retain the trading-process locks and exit non-zero.
    end
    Main->>Main: close logger transports
```

### Ambiguous order acknowledgements during shutdown

A placement request can have an uncertain local outcome even when Binance accepted the order. Harvester must retain the original client order ID and keep the order UNKNOWN; it must not retry placement. An authoritative user-data `executionReport` with the matching owned `clientOrderId` and exchange-assigned `brokerOrderId` resolves the identity. The first matching `NEW` report advances the registry from UNKNOWN to OPEN; duplicate reports are idempotent, and conflicting client/broker identities remain rejected.

This identity recovery is important to shutdown: the initial `reconcileOwnedOrders()` can now see the exchange identity and the existing cancellation selector can cancel the acknowledged owned BUY. If identity reconciliation remains incomplete, shutdown must not guess an order ID or cancel an external order; it records an incomplete CLOSING audit, rejects shutdown, and the process entrypoint retains its locks. Open owned SELLs remain intentionally preserved. The broker requests Binance `newOrderRespType: "RESULT"` for canonical placement so `LIMIT_MAKER` acknowledgements contain the order facts required by the canonical adapter instead of Binance's minimal default ACK.

### Ordering and safety invariants

- The handler marks shutdown in progress (`stopped=true`, `ready=false`, `status=STOPPING`) before unsubscribing market streams. It unsubscribes both market-price and book-ticker subscriptions, waits for already accepted market-price tasks, and waits for the current user-data queue before touching owned orders. No new strategy decisions should be started by later market callbacks.
- For trading-enabled runs, the first owned-order reconciliation resolves pending client-order identities and reads canonical order state before cancellation selection. The cancellation workflow selects only registered, acknowledged BUY orders in OPEN or PARTIALLY_FILLED state. Each broker cancellation is preceded by a durably flushed `order.cancel_requested` event. The canonical response must match the owned order and be terminal; canonical fills are then checked for identity, duplicates and cumulative executed-quantity parity before normal accounting applies them.
- User-data intake remains active through cancellation and the final owned-order reconciliation. After cancellation, the handler awaits queued user-data work, performs its final WebSocket API/stream owned-order reconciliation, disconnects user-data intake, marks intake stopped, and awaits the final accepted queue. The final reconciliation is verification, not another cancellation pass. If it leaves an owned BUY non-terminal, shutdown fails closed.
- Shutdown never cancels SELL orders. An owned SELL in OPEN or PARTIALLY_FILLED state is explicitly excluded from the unresolved-order check and remains resting at the broker. Other non-terminal/unknown owned-order states are unresolved.
- Only trading-enabled runs capture a CLOSING account audit. The snapshot is fetched while broker WebSocket API is connected, filtered to configured market assets plus third-asset commission baselines actually used in the session, checked for required asset coverage, published as `account.snapshot_captured` with `phase: "CLOSING"`, and accepted only after the event publisher confirms a durable flush. Unrelated wallet assets remain excluded. An audit reason produces `auditStatus: "INCOMPLETE"`; a query, publish or flush failure means no durable CLOSING audit can be claimed. The CLOSING event is a balance snapshot, not an open-orders audit or a Portfolio import.
- Broker disconnect is attempted after the CLOSING audit attempt, even when earlier shutdown stages recorded errors. The process then publishes `harvester.stopped`, flushes EventBus work, closes the optional Telegram subscriber, closes Journal, closes EventBus, and finally evaluates lock release.

### Failure and process-lock behavior

For trading-enabled runs, any owned-BUY cancellation failure, initial/final owned-order reconciliation failure, unresolved non-terminal/unknown owned order, or unsafe user-data/accounting state makes the CLOSING audit INCOMPLETE and rejects runtime shutdown. Market-intake unsubscribe errors, user-data-intake stop errors, CLOSING snapshot query/publish/flush errors, and broker-disconnect errors also make runtime shutdown fail. The process sets a non-zero exit status, still attempts later cleanup, and retains the trading-process locks because `runtime.stop()` was not confirmed. When shutdown is incomplete, the runtime status is `SHUTDOWN_INCOMPLETE`, never `STOPPED`. The thrown `AggregateError` exposes a `shutdownDiagnostics` object and the structured error log includes the same safe summary: the status before shutdown, all CLOSING audit reasons, stage-specific reconciliation failures with category/stage/retryability and error messages, cleanup failure names/messages, accounting/reconciliation/safety-halt flags, retryable recovery category/stage/generation, current and last-acknowledged recovery generations, and exact unresolved owned-order symbol, side, client/broker IDs, status, executed quantity and original quantity. Deliberately preserved OPEN/PARTIALLY_FILLED SELLs are excluded from the unresolved-order list. Broker-disconnect and other post-snapshot cleanup failures are reported as cleanup failures, not retroactively added to the already-published CLOSING audit reasons. The diagnostics contain normalized identity/accounting facts rather than raw broker payloads. A successful shutdown sets `STOPPED` only after broker disconnect and all cleanup checks succeed.

The process owns two Harvester locks: a broker-wide host lock and an
application process lock. Both live under
`~/.coinzilla/harvester/process-locks/`, outside the logs tree. Lock release
is allowed only when runtime shutdown was confirmed and Journal close returned
a successful result. If runtime shutdown is uncertain, or Journal
close/drain/sync is not confirmed, both locks are retained. The release
function removes the application lock first and only then the host lock; if
application-lock release is uncertain, the host lock is deliberately
retained. A failed lock release is reported and leaves the remaining lock in
place.

Separately, the Journal package owns a hidden `.coinzilla-journal.lock` in the
active session directory while its JSONL writer is open. Journal removes only
the lock it acquired. This package-level writer lock is not one of the two
Harvester process-ownership locks.

An EventBus close timeout (bounded at five seconds) still causes a non-zero process exit, but it does not by itself retain the trading lock when runtime shutdown and Journal close were both confirmed. Telegram/log-transport cleanup failures are also reported separately from the runtime-stop and Journal-close lock-release gates. This distinction prevents an ancillary delivery failure from being described as an unresolved trading state.

The handler's shutdown ordering and basic success/error aggregation are covered by
`create-shutdown-handler.test.js`. Process tests in `src/index.test.js` verify
that runtime-stop failure and unconfirmed Journal close retain the process lock.
The tests do not establish an additional post-reconciliation BUY-cancellation
pass; the sequence above intentionally documents the implementation that exists.

A process kill, machine crash, power loss, or failed filesystem sync can still lose recent records. The Journal is not an unconditional durability guarantee.

## Diagnosing a missing or incomplete session

1. Confirm the application can create and write `apps/harvester/logs/cumulative/` and `apps/harvester/logs/sessions/<current-session>/` under the default `apps/harvester/logs/` root.
2. Check startup logs for `Journal started` or the structured `Optional Harvester Journal startup failed` entry. Inspect its `errors` array for the original filesystem error code, message, and path. For a known operator-facing identifier and recovery procedure, use the [Harvester Error Vocabulary](./error-vocabulary.md).
3. Check the latest session directory under `logs/sessions/`, then verify that its UTC-named `.jsonl` file parses line-by-line as JSON and includes `__coinzillaJournal.schemaVersion = 1`. Older flat root-level JSONL sessions are retained and remain readable by the balance-reconciliation CLI.
4. Check the process logs for `Failed to write journal event`, `Journal closed with errors`, or `observability shutdown incomplete`.
5. If a programmatic caller is available, inspect `journalService.status`: `state`, `enabled`, `started`, `writeFailed`, `writeErrorCount`, and `closed`.

An absent first startup event can be the documented asynchronous-subscription gap. A `writeFailed` session will not resume writing automatically. A missing final stopped event or a failed close can indicate interrupted shutdown or failed durability confirmation.

## Security

Event DTOs do not include credentials, raw exchange messages, or SDK objects. Account-audit events persist configured market-asset balances and the complete account-wide open-order set using allowlisted exact-decimal fields; unrelated wallet balances are not persisted or treated as Harvester-owned. When a non-zero third-asset commission is first applied, the account snapshot manager publishes one targeted `COMMISSION_BASELINE` snapshot containing only that asset's original PREFLIGHT free/locked/total balance. The raw PREFLIGHT balance map is retained in memory only; it is not copied wholesale into Journal. The baseline is merged with the original PREFLIGHT snapshot during offline reconciliation. Applied-fill events persist each commission's exact amount and asset ID/code; third-asset commissions also persist their exact historical quote valuation as a separate quote-asset amount and identity. DTO mapping rejects a third-asset commission without that valuation and rejects a valuation in an asset other than the market quote asset. The recovery projector validates and retains the same fields, and offline restoration rebuilds the canonical Commission with both the original fee asset/amount and historical quoteValue. It never derives a historical value from a current price. Legacy journal fills that contain a third-asset commission but no quoteValue remain unrestorable and fail closed. If an optional Journal baseline write fails, valid fill accounting continues; the later account reconciliation fails closed because the required fee-asset baseline is absent. This does not wire automatic process-restart recovery. Error DTOs contain only a bounded name/message and redact common credential assignment patterns, bearer tokens, and credential-bearing URLs. This is not a substitute for protecting the log directory: event names, market/order identifiers, and error text remain operationally sensitive.

## Safety-pause state is process-local

The current startup composition initializes `userDataState.accountingFailed=false`, trading-enabled `requiresReconciliation=false`, and empty engine pause/recovery-intent Sets. The engine's `pause()` adds symbols to in-memory `paused` and `durablePausedMarkets` Sets and publishes `STRATEGY_PAUSED`; it does not persist a durable checkpoint or restore that event on startup.

The per-market strategy pause/recovery-intent sets are not guaranteed to survive a process restart. The separate `accountingFailed` process-lifetime latch is tracked by F-023/#769. PREFLIGHT and new live events may detect some unresolved conditions, but they do not reconstruct every previous pause reason or offline terminal fill. Do not treat restart as resolution of an earlier safety halt. Keep trading disabled until the prior cause has been authoritatively reconciled or explicitly acknowledged. See F-029 in [AUDIT.md](audits/reports/AUDIT.md), F-031/#654 and F-028.

## Applied-fill Journal durability boundary

The Harvester engine applies the canonical fill to in-memory accounting and then calls the best-effort `publishLifecycleEvent()` for `execution.fill_applied`. `processExecutionFillTransition()` ignores the publication result and does not invoke the durable Journal flush barrier. Publication is synchronous admission only; EventBus subscriber delivery is asynchronous. Journal append reports `durable: false`; explicit `flush()` waits for pending EventBus deliveries and Journal writes, then performs filesystem sync/fsync. A mapping/publication failure or missing publisher can therefore leave an applied fill with no corresponding Journal event while the engine returns success.

The engine's durable flush barrier protects order submission/cancellation intent before the exchange side effect. It does not immediately protect the post-fill accounting event. Graceful Journal close drains and syncs accepted events; unexpected process termination or power loss has no equivalent guarantee.

Therefore the Journal must not be described as a crash-consistent fill ledger or complete trading-state authority. This is a confirmed missing durability guarantee, not evidence that a particular historical fill was lost. See F-028 in [AUDIT.md](audits/reports/AUDIT.md) and [#654](https://github.com/45s/coinzilla/issues/654).

## Existing offline recovery helpers — not wired into current runtime

The repository retains tested offline helpers: `projectHarvesterJournalRecovery()`, `restoreHarvesterJournalState()`, `fetchAccountTradeHistory()`, `auditRecoveredTradeHistory()`, and `auditRecoveredAccountState()`. They can project Journal records, rehydrate Portfolio/RecoveryLedger/OrderRegistry and pause/intent state, scan trade history for supplied markets, and compare exact executions, balances, open orders and reservations.

### One-market exchange audit semantics (offline only)

`fetchAccountTradeHistory()` reports the exact canonical market symbols queried, query start time and whether every page for those markets was exhausted. Page exhaustion does not prove exchange-retention coverage. `auditRecoveredTradeHistory({ scope: "MARKET" })` therefore also requires a durable operator-verified history-retention baseline whose covered-from time is no later than the query start. The audit validates only the requested Market and does not claim account-wide completeness. The evidence reference must identify a `MARKET_HISTORY_COVERAGE_CONFIRMED` fact with a stable fact ID, matching symbol, covered-from time, query-start coverage through the verification time, evidence digest and verifier identity. This slice validates the reference shape and timing only; it does not yet resolve the fact ID against the durable-fact store. Tests use synthetic evidence. Durable-fact projection and provenance verification remain pending. Account-wide history remains fail-closed: a caller-supplied `marketUniverseComplete: true` boolean is not proof that delisted or otherwise unenumerated symbols are covered.

`auditRecoveredAccountState()` requires every asset present in the durable baseline and current account snapshot to be present on both sides. Missing assets are not interpreted as zero. Account-wide open orders outside the restored OrderRegistry remain unowned and untouched; when canonical Market metadata is available, their exact remaining BUY/SELL commitments are included in locked-balance reconciliation and their symbols are returned as narrow blockers. An unowned order on an unrelated symbol does not by itself block the target market, but missing metadata or an unexplained reservation fails closed.

### Durable market-history coverage facts

`recordMarketHistoryCoverage()` appends a `MARKET_HISTORY_COVERAGE_CONFIRMED` fact only to an already initialized, integrity-verified ADR-0001 store. Its strict payload contains the canonical symbol, `coveredFromTime`, `verifiedAt`, the SHA-256 digest of the reviewed evidence artifact, and a non-secret `verifiedBy` identity. The store rejects malformed payloads, unsupported fields, coverage-window narrowing, and verification-time regression.

`readMarketHistoryCoverage()` calls the store's integrity-verifying `readAll()` path, validates the per-symbol monotonic sequence, and projects the latest fact into the exact evidence shape consumed by the one-market audit. A valid interval must cover the query start: `coveredFromTime <= historyStartTime <= verifiedAt`; the current account snapshot must not predate `verifiedAt`.

The fact writer is an application use case, not a Telegram command. This slice does not add a CLI or startup integration; creating a coverage fact still requires an explicit offline operator review and a reviewed evidence artifact. A missing fact leaves the market audit blocked.

These are offline audit primitives only. They are not wired into startup, do not publish runtime READY, and do not enable process-restart restoration or OPERATOR control.

Current `index.js`, `prepareOptionalJournal()` and `startHarvester()` do not call this pipeline. Historical PR #606 did wire it, but passed `marketUniverseComplete: false` while `auditRecoveredTradeHistory()` requires true; that trading-enabled path therefore failed closed after prior trading activity. The current runtime bypasses that fail-closed gate rather than solving historical market-universe completeness. See F-031 and #654.

## Process-restart recovery status — 2026-11-09

**Process-restart state restoration is not implemented in the current Harvester startup composition.** Do not interpret the PREFLIGHT audit or the Journal's standalone read/replay API as proof that prior trading state has been restored.

Current source behavior:

- `prepareOptionalJournal()` starts the Journal writer and exposes readiness, flush and close. It does not read or replay prior sessions.
- The Journal reader scans direct session files in its configured directory; it does not recursively discover nested process-session directories. Current Harvester composition points the writer at a new `logs/sessions/<timestamp>-<runtime-session-id>/` directory. A restart reader must explicitly enumerate prior process-session directories and legacy flat root-level sessions; calling `Journal.read()` on the new process directory is not prior-session recovery. Calling it on the `logs/sessions` parent is not sufficient either: the flat reader skips directory entries and can return successful empty history while ignoring every child session directory. Same-second session filenames are also ordered by random session-ID suffix, not actual millisecond start time; see F-040. See the [2026-11-10 restart-recovery audit](audits/reports/2026-11-10_18-44-49_restart-recovery-audit.md) and #654.
- `src/index.js` passes an event publisher into `startHarvester()`; it does not pass restored Portfolio, RecoveryLedger, OrderRegistry or fill projection state.
- `start-harvester.js` creates fresh in-memory Portfolio, RecoveryLedger and OrderRegistry state and explicitly disables Journal replay.
- PREFLIGHT captures and durably records account balances and account-wide open orders. An unmatched order is classified as unowned and is not adopted. The current startup test explicitly permits runtime startup with an unowned open order; the `BLOCKED` audit classification is not itself a trading-readiness gate. The same-process recovery handler also ignores the BLOCKED classification before acknowledging broker recovery, so this is not limited to first startup.

The engine's active-order and commitment guards read only the in-memory `OrderRegistry`; they do not include unowned account-wide open orders. With an empty registry, the Conservative policy can emit an `INITIAL_BUY`, and if free quote remains the order allocator can permit another same-symbol order while the prior exchange order is still open. The submission guard checks pause/readiness, price freshness and post-only crossing, not the unowned order. This is strongly indicated by source, not reproduced: the existing startup test does not emit a market-price tick. See F-031 in [AUDIT.md](audits/reports/AUDIT.md) and #654.

- `reconcileOwnedOrders()` reconciles the orders already in the in-memory ownership registry. When that registry is empty, it returns without discovering historical order IDs or querying their fill history.
- The broker contract supports symbol-wide `getFills({ symbol, fromId })` discovery, but Harvester does not perform a startup-wide scan or restore a per-symbol cursor. Binance documents inclusive cursors, a maximum page size of 1,000 and time windows no longer than 24 hours. No guaranteed history-retention horizon was established; complete offline-fill discovery remains unproven.

The shared Journal package supports bounded read/replay, but replay is at-least-once and requires an idempotent consumer. That capability is not wired into Harvester startup. The previous statement that Harvester reads all prior sessions and blocks trading startup when historical trading events exist was inaccurate for the inspected current source and is removed.

**Accepted target contract:** [ADR-0001 — Application-owned durable facts for process-restart recovery](./architecture/decisions/0001-application-owned-recovery-facts.md) defines a separate append-only, integrity-checked durable-fact stream and a closed startup reconciliation gate. The ADR is design-only; it does not wire Journal replay, alter current Journal durability barriers, or enable restart recovery.

**Operational restriction:** do not enable unattended process restarts until the ADR's later delivery steps have a separately implemented, audited, and exact-head-tested restoration/reconciliation workflow. Keep trading fail-closed on missing or incomplete history, unknown ownership, duplicate/conflicting execution identities, unsupported commissions, or account/order discrepancies. Do not claim exactly-once transport delivery.

See [AUDIT.md](audits/reports/AUDIT.md), [AUDIT_FINDINGS.md](audits/reports/AUDIT_FINDINGS.md) F-031, and [ROADMAP.md](../ROADMAP.md).

## Trading process ownership locks

Trading-enabled startup acquires two exclusive locks before the Journal writer starts or the broker connects:

1. **Broker-wide host lock:** a file named `.<broker>-harvester-trading.lock` (for Binance, `.binance-harvester-trading.lock`) under `~/.coinzilla/harvester/process-locks/`. It prevents another Harvester process running under the same OS user from trading through the same broker.
2. **Harvester application lock:** `.harvester-trading.lock` in the same dedicated `~/.coinzilla/harvester/process-locks/` directory. It is no longer mixed into the logs or per-session Journal directories.

The host lock is acquired first, then the application lock. If application-lock acquisition fails, startup attempts to release the host lock; an uncertain host-lock release is surfaced rather than ignored. During shutdown, the application lock is released first and the host lock only after application-lock release is confirmed. If application-lock release is uncertain, the host lock is deliberately retained. Both locks remain held unless runtime shutdown and Journal close are confirmed. If runtime startup was attempted and then failed before a runtime handle was returned, the locks are retained because broker resources may have been partially activated.

Each lock records PID, hostname, start time and a random ownership token. A stale lock is automatically reclaimed only when its recorded hostname matches the current host, its PID is confirmed absent, and an immediate reread confirms the PID, hostname and ownership token are unchanged. A different-host lock, live or ambiguous PID, unreadable metadata, permission-denied process inspection or changed ownership token fails closed. The process check treats permission-denied inspection as potentially alive; it does not guess that the owner is dead. Verify the recorded owner before any manual removal.

Both Harvester process locks are local to one OS user's home directory; they do not coordinate different machines or different OS users. The Journal package's hidden writer lock remains scoped to the active session directory and protects that directory's JSONL writer.

## Additional restart-recovery limitations — 2026-11-10

- **Third-asset commission valuation (F-039):** PR #990 preserves exact commission amount/asset identity and historical quoteValue through the applied-fill DTO, journal projection and offline restoration. Legacy records without quoteValue fail closed; no current-price reconstruction is permitted. Wallet reconciliation for unconfigured commission assets remains outstanding. See [AUDIT_FINDINGS.md](audits/reports/AUDIT_FINDINGS.md) and #654.
- **Same-second session chronology:** process start times have millisecond precision, but session paths and Journal filenames retain only seconds. The reader breaks same-second ties by random session ID, not chronological start time. See F-040 in [AUDIT_FINDINGS.md](audits/reports/AUDIT_FINDINGS.md) and #654.
- **Recovery-cycle outcome evidence:** the engine records `recovery.cycle_completed` for a reset or `recovery.cycle_not_completed` for an explicit residual sell-through/blocked result. The projection requires a completed or explicit non-completed outcome for every fully filled SELL, ties the outcome to the exact SELL order identity, permits another SELL only after `CONTINUE_SELL_THROUGH`, and restores `BLOCKED` outcomes as market pauses. A missing Journal event fails closed at projection time. Journal remains observer-only and this is not the ADR-0001 durable-fact store; restart restoration stays disabled until the durable store and reconciliation steps are complete. See F-041 in [AUDIT_FINDINGS.md](audits/reports/AUDIT_FINDINGS.md) and #654.

**Record completeness:** current Journal events carry random IDs and timestamps but no monotonic sequence or integrity chain. The reader can detect malformed/truncated lines and duplicate IDs, but a whole valid middle line can disappear without a structural error. Do not treat successful JSONL parsing as proof of a complete event history. See F-042 in [AUDIT_FINDINGS.md](audits/reports/AUDIT_FINDINGS.md).

**Safety-event coverage:** the recovery projector currently skips several recorded Harvester events, including unowned-order, invalid-fill and accounting-failure evidence. Do not treat a successful projection as proof that all recorded safety failures were restored. See F-043 in [AUDIT_FINDINGS.md](audits/reports/AUDIT_FINDINGS.md).

**Reconnect snapshot compatibility:** same-process recovery publishes account and open-order snapshots with phase `RECOVERY`, but the retained process-restart projector rejects that phase. Any normal reconnect can therefore make the session unprojectable. See F-044 in [AUDIT_FINDINGS.md](audits/reports/AUDIT_FINDINGS.md).

These are confirmed defects/limitations in the retained offline recovery path. Current startup does not invoke replay. Keep unattended restarts disabled until the record contract and ordering are corrected and tested.

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

The `REST_RECONCILIATION` identifier is retained for compatibility; current
canonical reads use Binance WebSocket API request/response RPC, not HTTP REST.

- An unclassified error defaults to terminal accounting-integrity failure.
  Missing metadata is never treated as evidence that trading is safe.

If a retryable failure occurs while queued user-data events are being drained,
the active recovery attempt stops before either RECOVERY audit can authorize
broker acknowledgement. A later `recovered` reminder may clear that marker
only when a new attempt begins; it must then repeat all canonical WebSocket API request/response reads,
queued-event draining, both durable Journal barriers, and generation
revalidation. Reclassification alone never clears readiness or acknowledges a
broker generation.

This is same-process recovery only. It does not enable Journal replay or
process-restart recovery. TESTNET acceptance remains PAUSED / UNVERIFIED.

## External open orders and strategy eligibility

Account-wide open-orders audits classify unmatched orders as external/unowned. Their symbols are retained as a strategy-only exclusion set only after the audit event is durably flushed. The Conservative engine defers evaluation and checks again before broker submission for those symbols; unrelated markets remain eligible. A later authoritative reconnect audit replaces the set and clears a symbol only after the no-longer-present state is durably recorded. Do not adopt, cancel, or modify external orders. This guard is same-process only and does not restore trading state after a process restart.
