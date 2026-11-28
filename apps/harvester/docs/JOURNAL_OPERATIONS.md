# Harvester Journal Operations

> **Secondary / deferred while trading is broken (2026-11-27).** Journal and Operational State diagnostics are not the active P0 and must not delay or be presented as progress toward correct trading. Use them only when a narrowly scoped read is required to diagnose a concrete trading defect; do not expand facts, persistence, SQLite, history, or projection work.

## Read-only Operational State diagnostics

When startup reports that the existing Operational State Store cannot be projected, run the diagnostic before attempting another startup:

```bash
cd apps/harvester
pnpm run operational-state:diagnose
```

From the repository root, the equivalent command is:

```bash
pnpm --filter @coinzilla/harvester operational-state:diagnose
```

The command uses the same `OPERATIONAL_STATE_DIRECTORY` resolution and production `readAll()` integrity verifier as Harvester startup. It reports two independent outcomes:

- `storeIntegrity`: whether the existing facts and committed-head manifest pass the production JSONL, sequence, digest-chain, checkpoint, and filesystem-safety checks.
- `projection`: whether those verified facts can be converted into the offline recovery candidate.

A projection failure does not mean the files are corrupt. It means the verified records currently violate a projection invariant; the report preserves the specific error message. The command prints only fact-type counts and candidate counts, never fact payloads, order IDs, or credentials.

Exit codes: `0` integrity and projection both succeed; `1` CLI/configuration error; `2` store integrity failure (projection skipped); `3` store integrity succeeds but projection fails.

The command is strictly diagnostic: it does not initialize, append, repair, truncate, or delete the store; connect to Binance; read exchange credentials; start Harvester; or submit/cancel orders. It does not enable recovery or restore trading state. Do not use the initialization command as a repair mechanism. Preserve the original files and investigate the reported failure.

## Purpose and limits

Harvester uses one in-process EventBus to publish selected operational and trading-lifecycle facts. The Journal subscribes to that bus and appends event records to local JSONL files. Journal persistence is optional in configuration-only/no-broker mode; it is a required startup dependency for every broker-connected mode because the account PREFLIGHT audit must be durably recorded before market subscriptions.

The Journal subscribes to the shared EventBus, so derived Telegram notification events are persisted alongside their source lifecycle events. Notification mappings must omit optional fields when the source fact is unavailable: EventBus accepts `undefined`, but the Journal intentionally rejects it under the lossless JSONL contract. In particular, a BLOCKED account-wide open-orders alert may cover multiple symbols, and a user-data subscription failure has no market symbol. Both remain safety notifications; an absent `symbol` is omitted rather than represented as `undefined` or used to suppress the alert.

### Durable Journal barriers

Harvester exposes two distinct Journal durability operations through `prepareOptionalJournal()` and its event publisher:

- `flush()` drains EventBus delivery, waits for Journal writes, and syncs the session. Use it at lifecycle boundaries outside a pending EventBus handler.
- `flushWrites()` waits for already-enqueued Journal writes and syncs the session without draining EventBus. It is safe to await from inside a pending EventBus handler. A successful result must explicitly include `{ ok: true, durable: true }`.

Do not alias `flushWrites()` to `flush()` or fall back to the global flush when the write-only capability is unavailable. Recovery decision and recovery SELL deferral evidence must be durably acknowledged through `flushWrites()` before recovery completion or further broker submission. Missing capability, rejected publication, write failure, or missing durable acknowledgement fails closed and preserves the original failure for diagnosis. Recovery-decision persistence failures use stable pause reason `RECOVERY_DECISION_EVIDENCE_PERSISTENCE_FAILED`; blocked recovery SELL deferral-evidence failures use `RECOVERY_SELL_DEFERRAL_EVIDENCE_PERSISTENCE_FAILED`.

For Journal-backed trading intents (order submission and cancellation), synchronous publication must be acknowledged through `flushWrites()` before broker I/O. Do not use global `flush()` as a per-order durability barrier: it drains EventBus subscribers and can let an optional observer failure block trading. The write-only barrier persists the Journal's queued writes and fsyncs the session without waiting for unrelated EventBus observers. A pending asynchronous publication for a recovery SELL submission or any cancellation intent is not durable evidence and fails closed before broker I/O. A pending asynchronous custom observer for an initial BUY remains non-blocking and is not awaited; production broker submission still requires the independent Operational State Store intent/outcome callbacks, and this observer path does not claim Journal durability. Optional lifecycle/observer events remain best-effort; their eventual failures are diagnostic rather than trading failures.

The Journal is an operational observer, not trading-state authority. Portfolio and RecoveryLedger remain in-memory application state. The offline `projectHarvesterJournalRecovery()` and `restoreHarvesterJournalState()` helpers can validate and rehydrate a candidate state for controlled offline use, but runtime startup does not invoke them or resume trading from Journal data. Journal replay is not yet wired as runtime trading-state authority. There is no database, outbox, exactly-once delivery, or per-market-price capture.

## Configuration

The application enables the Journal by default. Each process writes its
Journal JSONL session inside the matching
`apps/harvester/logs/sessions/<UTC timestamp>-<runtime session ID>/`
directory, beside that process's structured logs. Cumulative diagnostic files
remain under `apps/harvester/logs/cumulative/`. The application entrypoint
does not expose environment or `config/index.js` settings to disable the
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
The current deployment remains Binance-only. Environment files and externally injected environment values provide the explicit Binance `TRADING_MODE`, Binance API credentials, standard process settings, and optional notifier secrets; `NODE_ENV` never selects the exchange. The accepted target in [ADR-0003](../../../docs/architecture/decisions/ADR-0003-multi-provider-routing.md) adds named provider-instance configuration and explicit execution/market-data routes, tracked by [issue #1339](https://github.com/45s/coinzilla). The source-verified [multi-provider migration audit and implementation plan](../../../docs/architecture/multi-provider-migration-plan.md) records the required provenance, account-isolation and lock-transition work. That target is not yet implemented: do not add provider selectors or route overrides to deployment files until the validated schema and migration are delivered. Secrets remain environment/secret-manager inputs and must not appear in Journal records, logs, configuration fingerprints, or provider provenance. Trading-enable and Journal settings remain unchanged.

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

The orchestration and guarded confirmation use cases were merged in [PR #1047](https://github.com/45s/coinzilla/pull/1047). The offline JSON context adapter, audit-only/explicit-confirmation CLI and production-audit evidence matrix were merged in [PR #1053](https://github.com/45s/coinzilla/pull/1053); all required core CI workflows passed on exact code head `2c3a48442f893521403d53e4816631a9de4b0878`, while optional read-only TESTNET integration was skipped. See the [Step 7 recovery operator guide](recovery/README.md) for the evidence-bundle contract and command. Step 7 implementation is complete, but confirmation remains an explicit operator workflow over reviewed evidence. It is not invoked by runtime startup and does not add a Telegram command. It has no order-placement or cancellation dependency; no exchange writes are performed by the workflow.

## Event inventory

All events use source `harvester`. Payloads are created by Harvester-owned allowlist mappers; fields not listed below are not copied into the event DTO.

Every mapper must follow the temporary payload constraint in [Journal Evidence Contract — Safety and delivery](./JOURNAL_EVIDENCE_CONTRACT.md#safety-and-delivery). EventBus's accepted in-memory graph is wider than JSONL's lossless representation; until [Journal issue #889](https://github.com/45s/coinzilla/issues/889) is resolved, payloads reaching Journal must be acyclic and JSON-safe. This is a consumer-side restriction only: do not change EventBus behavior or Harvester's existing mandatory durability gates as a workaround.

| Event | Allowlisted payload facts |
|---|---|
| `harvester.process_started` | `application`, `version`, `runtimeSessionId`, `processId`, original `startedAt`, and allowlisted Git `source` metadata (branch, full/short commit, subject/date, working-tree state, metadata source) |
| `harvester.started` | `broker`, `strategyMode`, `enabledMarkets`, `tradingEnabled` |
| `harvester.startup_failed` | `stage`, sanitized `error` name/message |
| `harvester.stopped` | `reason`, `outcome`, optional sanitized `error` |
| `config.validated` | `enabledMarkets`, `strategyMode`, `tradingMode`, `configurationFingerprint` (SHA-256 of canonicalized effective strategy settings), `tradingEnabled` |
| `broker.connected` | `broker` |
| `broker.connection_failed` | `broker`, sanitized `error` |
| `broker.disconnected` | `broker`, `outcome`, optional sanitized `error` |
| `broker.status_changed` | `broker`, `stream`, `status`, `recoveryRequired`, optional `attempt`, `code`, `error` |
| `broker.subscription_established` | `broker`, `stream`, optional `market` |
| `broker.subscription_failed` | `broker`, `stream`, optional `market`, sanitized `error` |
| `strategy.decision` | `strategy`, `symbol`, `referencePrice`, actionable `actions` (side/type/price/quantity/optional reason) |
| `order.submission_requested` | client order ID, symbol, side, type, exact price/quantity, status; durably flushed before the broker placement call |
| `order.submission_deferred` | original client order ID and order facts plus a bounded local reason; best-effort terminal evidence when a registered request is deferred before broker I/O |
| `order.submitted` | submission facts plus broker order ID and acknowledged status; optional verified OrderRegistry strategy/Position/purpose/cycle ownership |
| `order.updated` | canonical order facts, provider provenance (`providerInstanceId`, `providerType`, `accountId`) from the post-update OrderRegistry entry, and optional verified strategy/Position/purpose/cycle ownership after an applied registry transition |
| `order.submission_failed` | client order ID, symbol, side, outcome, optional sanitized error |
| `strategy.paused` | `symbol`, `reason`, optional sanitized `error` |
| `order.cancel_requested` | full owned order intent, broker order ID, executed quantity, current status, cancellation reason; durably flushed before the broker cancellation call |
| `order.cancelled` | order facts, broker order ID, executed quantity, canceled status, and optional verified OrderRegistry strategy/Position/purpose/cycle ownership |
| `order.cancel_failed` | client order ID, symbol, side, optional broker order ID, current order status (including UNKNOWN), outcome, optional sanitized error, and optional verified OrderRegistry strategy/Position/purpose/cycle ownership |
| `execution.fill_applied` | fill/trade/order IDs, symbol, side, exact price/quantity/quote quantity, liquidity role, optional execution time, exact commission amounts and asset IDs/codes, optional exact historical `quoteValue` (amount plus quote-asset ID/code) for third-asset commissions, commission status |
| `execution.unowned_order` | client/broker order IDs, symbol, side, order status, reason |
| `execution.invalid_fill` | order facts, reason, optional Fill identity facts, sanitized error |
| `execution.accounting_failed` | order and Fill identity facts, sanitized error |
| `execution.duplicate_fill` | Fill facts plus `duplicate: true` |
| `recovery.cycle_completed` | `symbol`, `marketId`, allocated base `freeQuantity`, quote-asset `realizedNetProfit` |
| `recovery.cycle_not_completed` | exact SELL client/broker identity, `CONTINUE_SELL_THROUGH` or `BLOCKED` outcome, reason, realized profit, active/keep quantities, configured minimum profit |
| `account.snapshot_captured` | PREFLIGHT/RECOVERY/CLOSING lifecycle phase or targeted COMMISSION_BASELINE phase, audit status, exchange source timestamp, allowlisted exact free/locked/total balances, audit reasons |
| `account.open_orders_captured` | PREFLIGHT/RECOVERY/CLOSING phase, monotonic local observation time, READY/RECONCILED/BLOCKED decision, complete account-wide open-order list (client/broker IDs, symbol, side, type, exact price/original/executed quantities, status), block reasons |

The `harvester.process_started` event records the process attempt, including its original UTC entry timestamp, even when optional Journal initialization delays publication. It is distinct from `harvester.started`, which records successful runtime startup. The process event is allowlisted and best-effort: for broker-connected startup, it is admitted before the existing PREFLIGHT flush can persist it; it does not add a separate durability barrier.

The `config.validated` event records the environment-filtered enabled-market set, explicit trading mode, and a deterministic SHA-256 fingerprint of the effective strategy settings. It never includes the raw strategy configuration or credentials. The fingerprint is correlated with the process-start Git provenance through the same Journal session; this remains best-effort evidence and adds no durability barrier beyond the existing PREFLIGHT flush. When the Operational State Store is enabled, the same fingerprint helper populates its durable baseline, and startup verifies that the persisted digest and enabled-market list match the resolver's effective runtime selection before broker connection. A trading mode with no configured pairs and a mode whose configured pairs are all disabled are distinct fail-closed cases. The startup integration regression verifies the fingerprint is published before broker subscription and that reconnect readiness follows authoritative recovery.

The process event, structured DEBUG/TRACE session filenames, and logger context share one immutable process identity: the UTC `startedAt` timestamp and `runtimeSessionId`. The development runner creates that identity once and passes it to the child process; its cumulative and timestamped terminal files use the same identity. A standalone `start` process generates its own identity and has no development terminal-capture files. See [Logging](./LOGGING.md) for exact filenames and stream lifecycle. Configuration-only/no-broker startup does not await optional Journal readiness, and logger context remains the immediate fallback when Journal is delayed or unavailable. Startup-failure and shutdown paths do not separately await the process-start publication promise; the existing Journal close lifecycle remains unchanged and may wait for Journal readiness. If the process exits before the Journal subscriber becomes ready, the Journal event is not guaranteed, but DEBUG/TRACE logs retain the process identity. When readiness is delayed, the event may appear after `harvester.started` in append order; its payload `startedAt` remains the process-entry time. Missing build metadata is recorded as null/unknown rather than inferred.

A `strategy.decision` event is emitted only when the strategy produces at least one actionable order. NO_ACTION evaluations are not journaled. No event is emitted for every market-price update.

The broker status `recovered` means the remote user-data subscription has returned; it does not mean Harvester has reconciled account state or reopened order placement.

For `account.open_orders_captured`, `readiness: BLOCKED` with `UNOWNED_OPEN_ORDERS` is an ownership-audit classification, not a global trading-startup rejection. Every pair defaults to `externalOrdersPolicy: "ignore"`: manual/external orders remain unowned and untouched, and their unmatched execution reports are diagnostic-only rather than accounting failures. A pair can opt into same-symbol blocking with `externalOrdersPolicy: "block"`; this applies uniformly to every unmatched startup order, regardless of its client-order ID prefix. An unmatched execution report is classified against the current process's generated order-ID namespace. Prior-session `h-` IDs are external to this process and follow the configured external-order policy; only an unmatched ID in the current process namespace remains fail-closed. No external fill is added to Harvester Portfolio or RecoveryLedger. Manual balance changes can still affect exchange free-balance checks and cause normal exchange rejections. A transport reconnect alone does not clear an existing Harvester accounting/reconciliation latch. See [issue #667](https://github.com/45s/coinzilla/issues/667#issuecomment-6717086777).

A broker `rpcError` explicitly marked `recoveryRequired: false` and carrying no contradictory reconciliation flag is diagnostic-only and does not itself invalidate the application recovery generation. Missing or malformed recovery metadata remains fail-closed. An actual `connectionClosed` status, including code `1006`, starts recovery; that abnormal close code does not identify the underlying network cause.

For `order.updated`, the DTO is built from the post-update canonical OrderRegistry entry resolved using the previously registered canonical client-order ID. Provider provenance (`providerInstanceId`, `providerType`, `accountId`) is copied from that entry, not the raw incoming broker report; missing provider identity remains invalid for history projection. For `order.submitted`, `order.updated`, `order.cancelled`, and `order.cancel_failed`, the publisher adds ownership only when the exact current OrderRegistry entry matches the client-order ID, broker-order ID, and market ID. The DTO carries only registered strategy/Position/purpose and optional cycle identifiers; unowned or unmatched orders omit the ownership object.

## Startup and capture gaps

A standalone read-only audit can be run while Harvester remains stopped with `pnpm run testnet:audit`. It creates its own Journal session and writes both account events with phase `PREFLIGHT`; it does not start trading or alter exchange state. Exit code 2 means the audit was persisted successfully but open orders were found.

For every broker-connected startup (including read-only mode), bootstrap reads the broker's full raw account-balance response and complete account-wide open-order set. The account-snapshot manager filters the runtime `AccountSnapshot` and its durable/Journal audit to base and quote assets from all configured market metadata (including disabled-pair metadata retained for audit) plus third-asset commission assets whose baseline is actually required by an applied fee. The raw PREFLIGHT balance list is held only in a temporary in-memory lookup map so a later third-asset commission can be compared with its original free/locked/total balance; unrelated wallet assets are not emitted in account-snapshot DTOs. Bootstrap publishes `account.snapshot_captured` and `account.open_orders_captured` with `phase: PREFLIGHT`; the durable-facts account snapshot record is committed before its Journal event is published and durably flushed. These barriers complete before market-data subscriptions and before user-data readiness opens. The trading engine object is composed earlier, but its `canTrade` gate remains closed until the queued user-data events and PREFLIGHT audits succeed.

`main()` starts the optional Journal service and invokes Harvester without awaiting `journalService.ready` before broker connection. The first required PREFLIGHT event flush waits for Journal readiness; if the Journal is unavailable or the flush is not durable, startup fails before market subscriptions proceed. If either account query fails, event mapping/publication fails, or a required durable-facts/Journal barrier is not confirmed, startup fails closed. A pre-existing order is recorded as external/unowned and is never adopted or cancelled. The `BLOCKED` value is an audit classification, not a trading-readiness gate: `subscribeToUserData()` sets `state.ready = true` after queued events and other safety flags pass, without gating on open-order audit readiness. The current trading-enabled startup test explicitly allows market subscriptions/runtime startup with an unmatched open order. Its fake broker emits no market-price tick, so it does not prove that later strategy activity cannot overlap that unowned order.

For Binance account snapshots, `accountSnapshotSourceTime` is the exchange `account.status.updateTime` (the last account update), not the time the snapshot was fetched and not a global event cursor. The log record timestamp is the observation time. Do not infer a stale PREFLIGHT snapshot solely because this source timestamp is older; use the accepted-snapshot monotonicity checks and the actual PREFLIGHT observation.

Same-process user-data reconnect publishes separate `RECOVERY` account and open-order audits and waits for their required durable-facts/Journal barriers before acknowledging the recovered broker generation. Trading-enabled graceful shutdown publishes separate `CLOSING` account-balance and account-wide open-order audits after strategy safety proof and before shared-service teardown. Each CLOSING pass refreshes the open-order snapshot. A successful query preserves the full account-wide order set; a failed, partial, or malformed query durably records a `BLOCKED` snapshot with `CLOSING_OPEN_ORDERS_CAPTURE_FAILED` before the following CLOSING balance audit is marked `INCOMPLETE`. A `BLOCKED` ownership classification for unmatched/external orders is not a read failure or shutdown blocker. A targeted `COMMISSION_BASELINE` event records exactly one newly used third-asset commission baseline. There is no `OPENING` phase.

The production `main()` entry point verifies/projects the ADR-0001 durable-facts ledger and refuses a second process session while prior `PROCESS_STARTED` facts exist; automatic runtime restoration remains disabled pending #654 Steps 8–9 acceptance. A direct bootstrap/test harness that omits this production gate is not evidence that restart is supported. Programmatic callers of `main()` can inspect `journalService.ready` and `journalService.status`.

## Write failures and durability

- After the startup PREFLIGHT gate succeeds, ordinary event delivery to the Journal is asynchronous. Market-price evaluation, strategy policy, and fill accounting do not await Journal subscriber or filesystem writes.
- Before any broker order-placement or cancellation call, Harvester commits the corresponding ADR-0001 durable-fact intent and publishes the matching Journal event under the existing durability barriers. The durable-facts store is the restart-evidence authority; the Journal remains an independently durable operational observer. If a required fact/event publication or durability acknowledgement fails, the broker write is not attempted and the affected pair is paused.
- When the Operational State Store is configured, production Conservative composition marks durable submission callbacks as required. The engine validates the intent/outcome callback pair before activation, maps the application callbacks to the executor's canonical `onDurableSubmissionIntent` / `onDurableSubmissionOutcome` contract, and the executor independently rejects a missing pair when durability is required. An absent callback is never interpreted as permission to submit. The intent is committed before broker placement; the classified outcome is committed before local acknowledgement/failure handling. The separate Journal `order.submission_requested` flush remains required and is not a substitute for the Operational State Store fact.
- The explicit startup PREFLIGHT, same-process reconnect RECOVERY, and trading-enabled shutdown CLOSING account audits are lifecycle barriers. Account-balance and open-order snapshot facts are committed before their respective Journal events and flush. CLOSING open-order read/validation failures are represented by a durable BLOCKED fact and make the paired CLOSING balance audit INCOMPLETE; failure to persist or flush either fact keeps shutdown incomplete. A failure in PREFLIGHT blocks startup; a failure in RECOVERY keeps the generation unacknowledged and trading readiness closed; a failure in CLOSING reports incomplete shutdown. This is distinct from ordinary best-effort event observation.
- Journal writes are serialized. The Journal validates the complete source-event graph against its lossless JSONL contract before append. A serialization or append failure is retained in writer state, marks the session `writeFailed`, rejects later record admission, and is surfaced by `Journal.flush()`/`close()`; the Journal must not report `durable: true` after an event was omitted. Records already accepted into the write queue still drain in order. EventBus `publish()`/`flush()` success is not a Journal persistence acknowledgement; inspect Journal `flush()`/`close()` results and `writeErrorCount`. See [Journal issue #889](https://github.com/45s/coinzilla/issues/889) and [PR #920](https://github.com/45s/coinzilla/pull/920).
- The status becomes `degraded` and exposes `writeFailed` and `writeErrorCount` to programmatic callers.
- A successful `record()` means the write completed; it does not mean the data was fsynced.
- `flush()` and normal `close()` wait for pending EventBus deliveries and queued writes, then call filesystem sync.
- A successful close reports `durable: true`. A failed write/sync/close reports errors and does not claim durability.
- Disk-full, permission, or filesystem errors can therefore leave a session incomplete. The Journal does not automatically recover writes in that session; resolve the filesystem issue and start a new process session.

## Persistence responsibility and safety dependencies

The following stores are deliberately separate. Success or availability in one must never be substituted for another:

| Mechanism | Required responsibility | Failure behavior |
| --- | --- | --- |
| **ADR-0001 Operational State Store** | Required before broker-capable startup when Conservative recovery is enabled or any Recovery Seller market is enabled. It is not created for ordinary Conservative operation with recovery disabled. When enabled, it stores durable submission/cancellation intents and outcomes, applied-fill/commission facts, account snapshots and process-session boundaries used for idempotency and recovery. | When required, verification or append failure blocks the corresponding broker side effect, keeps the affected market paused, and prevents required reconciliation/shutdown evidence from being declared complete. Journal or relational history is not a fallback. Without this store, do not claim durable recovery replay or cross-restart submission-intent idempotency. |
| **Harvester Journal** | Independently durable operational event history and lifecycle proof: submission/cancellation observations, fills, safety markers, PREFLIGHT/RECOVERY/CLOSING audits, and shutdown lifecycle events. A successful flush/close with filesystem sync is required at the documented barriers. | Missing/failed Journal durability blocks the dependent lifecycle transition. EventBus delivery or a started Journal process is not a durability acknowledgement. |
| **Legacy order-history SQLite projection** | Optional query/history projection. It is not the source of truth for submission idempotency, fill application, or strategy safety. | If unavailable, emit the explicit persistence warning and do not claim its history projection is available. It does not replace or disable Operational State Store / Journal barriers. |
| **Relational trading-history SQLite projection** | Optional normalized orders/fills/commissions and exchange-history cursor projection. It supports history queries and startup exchange-history synchronization when the required repositories are available. | If unavailable while legacy history remains active, keep the legacy projection, log the relational failure, and explicitly report startup history synchronization as SKIPPED. A skipped sync is not a successful or complete history reconciliation. Do not use this optional database as proof of current account/order state or as a substitute for Operational State Store / Journal facts. |

For recovery-enabled Conservative and Recovery Seller operation, durable submission idempotency and exactly-once recovery fill accounting depend on verified Operational State Store writes and their corresponding Journal durability barriers—not on the relational trading-history database. With Conservative recovery disabled, the Operational State Store is intentionally absent; the Journal remains required for account-audit and shutdown lifecycle durability, but restart-safe recovery replay and durable order-intent idempotency are not claimed. Shutdown safety always depends on authoritative exchange/order/fill reconciliation, participant safety markers and Journal flush; Operational State Store facts are additionally required whenever the recovery-enabled process store is active. A relational-history warning alone does not prove those mechanisms failed. Conversely, a successful Journal start does not prove the Operational State Store or relational history is available.

The startup exchange-history synchronizer deliberately logs and returns when relational repositories are unavailable. This means only that optional historical projection/backfill was skipped; it must never be reported as complete coverage. When a specific recovery decision requires history that is not present in canonical durable facts or authoritative exchange evidence, that decision remains UNKNOWN/blocked. Do not manufacture a complete history result from an empty optional repository.

## Startup open-orders readiness versus ownership audit

`account.open_orders_captured.readiness=BLOCKED` with `UNOWNED_OPEN_ORDERS` means the account-wide snapshot was captured and durably classified, but one or more open orders are not owned by this Harvester process. It is not, by itself, the global startup readiness gate. Under `externalOrdersPolicy: ignore`, startup may continue while those orders remain external and untouched; no adoption, cancellation, modification, or strategy ownership is inferred. Under `externalOrdersPolicy: block`, the affected market's strategy submission gate is blocked; unrelated markets remain independent. A required PREFLIGHT balance/ownership integrity failure, Operational State Store verification failure, failed account-wide snapshot read/durability barrier, or user-data readiness/reconciliation failure remains a true startup blocker and must not be ignored.

The engine object may be activated before user-data readiness is established, but its `canTrade` gate remains closed until the user-data and account-integrity checks succeed. Logs must keep the audit classification (`readiness`, `blockReasons`, `symbols`) separate from engine activation and actual per-market trading readiness. A successful audit capture with `readiness=BLOCKED` must not be relabeled `READY`; an allowed startup under `ignore` must not be misreported as an ignored required gate.

## Shutdown lifecycle milestones

These milestones are separate and must not be collapsed into one generic `STOPPED` log:

1. **Strategy safety completed** — every registered strategy participant returns `COMPLETED` and its safety marker remains valid. This proves only that the strategy's current owned orders, fills, commissions and recovery coverage are safe to stop managing.
2. **Durable CLOSING** — after strategy proof and market-intake quiescence, the account-wide closing snapshot and CLOSING audit are durably written. Failure prevents shared-service teardown.
3. **Runtime shutdown completed** — required market/user-data intake and broker teardown phases complete, final reconciliation/Journal barriers pass, and the runtime shutdown handler reaches `RUNTIME_SHUTDOWN_COMPLETED`.
4. **Durable PROCESS_STOPPED (when the Operational State Store is enabled)** — only after the runtime stop returns confirmed success does the outer Harvester stop append the `PROCESS_STOPPED` fact. If the store is active and this append is not confirmed, the outer stop reports `SHUTDOWN_INCOMPLETE`; it must not publish a successful process-stop result or release the process lock. When Conservative recovery is disabled and no RS market is enabled, this fact is intentionally absent.

5. **STOPPED lifecycle event and bounded outer cleanup** — after the runtime stop and durable `PROCESS_STOPPED` acknowledgement are confirmed, the process handler publishes the non-durable `STOPPED` lifecycle event, flushes the EventBus, closes Telegram notifications, closes the Journal/EventBus/trading-history API/persistence services, and closes the process logger. EventBus flush and Telegram close each have a 5,000 ms deadline; observability cleanup has a 30,000 ms deadline; logger close has a 5,000 ms deadline. A failed or timed-out stage stops downstream cleanup and retains the process lock.
6. **Process-lock release** — the application and host locks are released only after every required outer cleanup stage, including process logger close, has succeeded. Lock release has a 5,000 ms deadline and is a separate cleanup result; it is not proof that the OS process has exited.
7. **OS process exit** — occurs only after the outer shutdown handler returns and the process event loop exits. No missing trace record, missing console line, or missing STOPPED event proves that the OS process exited.

For multi-provider composition, each account runtime is stopped independently and must return both `ok: true` and `status: STOPPED`; an absent or non-STOPPED result is a shutdown failure and retains that account's process lock. The aggregate runtime reports `durableProcessStopAcknowledged: true` only when every started provider runtime also explicitly returns that acknowledgement. When the Operational State Store is absent, the durable-facts acknowledgement remains `false`; the outer process handler must then satisfy the enabled Journal-backed STOPPED barrier (publisher, enabled Journal, and successful EventBus flush) before proceeding. If the store is enabled but its `PROCESS_STOPPED` append fails or times out, shutdown is incomplete; do not substitute the Journal fallback or release the process lock. Provider-level stop success alone is not proof that the aggregate process may release its final process lock. The final process lock remains held until all required outer cleanup and logger-close stages succeed. Runtime-stop confirmation is cached independently from market-data-stop confirmation, so retries after another account's failure do not repeat completed shutdown work. Active provider account locks are not released by an account runtime's stop method; they remain held until the outer process cleanup and logger-close stages succeed. An account that never started may release its unused lock only after startup cleanup is confirmed. Every actual lock-release result requires `released: true`, or `released: false` with `alreadyReleased: true`; `{ ok: true }` alone is not release proof. Startup-failure cleanup also defers process-lock release until after logger closure. It releases only when no runtime was started and EventBus flush, Telegram notification close, Journal/API/persistence cleanup, and logger close (including explicit failure results) are all confirmed; ambiguous release results are reported through fallback diagnostics after the logger closes.

The default participant deadline is 120,000 ms and covers the participant's initial proof plus one coordinator-triggered reproof if a late fill/callback invalidates the marker after a successful wait. The Conservative participant also re-reads the live safety snapshot between its bounded market passes. If the marker remains invalid after two completed participant proofs, the terminal result is `BLOCKED` with reason `SHUTDOWN_SAFETY_REEVALUATION_LIMIT_EXCEEDED:2`; if a stage does not settle by the deadline, the result is `TIMED_OUT`. Diagnostics include the strategy ID, participant operation, configured deadline, market, current operation, last successful step, missing evidence, active/pending owned order identities and nested error summary. Every awaited participant stage races the same AbortSignal, so the participant returns a terminal timeout/abort result even if an underlying REST, reconciliation, drain or flush promise cannot itself be cancelled. Such an underlying operation remains unconfirmed and visible as the current operation with its pending owned-order identities; its eventual settlement is not a safety acknowledgement. The participant cannot advance later stages or publish a new safe marker after the deadline, and shared services/process lock remain protected.

Every asynchronous shutdown phase outside the strategy participant proof has its own default 30,000 ms deadline, including accepted-work drains, CLOSING audits, feed/user-data teardown, Journal flush, operator-control stop and broker disconnect. A timeout aborts that phase's signal and records a terminal `TIMED_OUT` result. If the underlying operation ignores abort, it remains visible in `shutdownDiagnostics.pendingOperations`; a later stop attempt cannot overlap the same phase until that operation settles. Strategy proof retains its separate 120,000 ms coordinator deadline and is not shortened by the phase wrapper.

The outer process-shutdown handler also bounds its own cleanup waits: runtime stop has a 720,000 ms total deadline; EventBus flush and Telegram notification close each have a 5,000 ms deadline; Journal/EventBus/API/persistence cleanup has a 30,000 ms outer deadline; process logger close and process-lock release each have a 5,000 ms deadline. These deadlines are separate from the inner strategy/phase deadlines. A timed-out operation remains single-flight; retries await the same pending promise instead of starting a concurrent close, flush or release. No downstream cleanup or process-lock release runs after a required stage fails or times out.

The outer durable `PROCESS_STOPPED` append has a separate default 30,000 ms deadline. A timeout or still-pending append leaves the process-stop phase `TIMED_OUT`/`PENDING`, changes the process state to `SHUTDOWN_INCOMPLETE`, and prevents `SHUTDOWN_COMPLETED` or process-lock release. A late append settlement is not retroactive proof for the failed shutdown attempt; a later attempt must confirm the idempotent fact. `RUNTIME_SHUTDOWN_COMPLETED` is only the in-memory runtime boundary, not the durable process-stop or OS-exit boundary.

## Strategy-owned normal shutdown

> **Owner-approved shutdown contract — [issue #1186](https://github.com/45s/coinzilla/issues/1186):** This section records the required Conservative shutdown sequence. The canonical rules are defined in [the Conservative specification](./domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md#10-conservative-graceful-shutdown--protect-trading-before-stopping-services). Safety is state-driven: evaluate immediately after authoritative reconciliation; there is no arbitrary wait or quiet-period timer.

Shutdown is an application-level coordination process. The application coordinator knows only the strategy participant contract; each strategy owns its domain safety rules. Conservative owns its BUY gate, owned-order cancellation, fill/commission reconciliation and recovery SELL coverage. Other strategies register independent policies.

The required order is:

1. **Activate every strategy shutdown gate synchronously.** No service is stopped before every participant has received the shutdown request.
2. **Conservative immediately starts cancelling all Harvester-owned active BUYs.** It does not cancel manual/external orders. The final submission gate rejects every BUY path; only the explicitly authorized recovery SELL may be submitted.
3. **Keep required services alive.** Market-price/book intake, Binance user-data intake, broker connectivity and operator control remain available while each market reconciles pending order identity, cancellation outcomes, racing fills and actual commissions. Accepted market-price events continue through recovery-only evaluation; no BUY, trailing-BUY replacement, retry or delayed BUY path may run.
4. **Secure recovery SELL coverage per market.** Recalculate from final Position and RecoveryLedger facts. An old SELL must reach a confirmed terminal state and its complete fill history must be reconciled before replacement. Verify the final SELL against authoritative Binance order state and net financial coverage.
5. **Mark each market SAFE_TO_SHUTDOWN immediately when all conditions are proven and Journal-durable.** Late execution/order evidence invalidates the affected marker and triggers immediate re-evaluation. A safe market does not release shared services while another market or strategy is unsafe.
6. **Fence new market callbacks and drain accepted market work.** Only after the all-strategy safety barrier passes, synchronously prevent new price/book callbacks from registering work. Keep the market subscriptions, user-data intake, operator control and broker connected while draining every accepted price/book task and the user-data events those tasks enqueue.
7. **Re-prove safety and durably publish CLOSING.** Re-run the strategy safety proof after the accepted market and user-data work drains. Publish and durably flush the account-wide CLOSING open-order snapshot, then the filtered CLOSING balance snapshot, while market subscriptions and all other required services remain connected. A failed, partial, or malformed open-order read must first produce a durable BLOCKED snapshot; the following balance snapshot records INCOMPLETE. If drain, proof or CLOSING durability fails, reopen market callback processing and abort shutdown.
8. **Unsubscribe market feeds.** Only after CLOSING is durable, unsubscribe market-price and book feeds. If unsubscription partially fails, reopen callbacks for subscriptions that remain active and abort before stopping user-data/operator/broker services.
9. **Stop user-data intake and drain accepted events.** Re-prove safety if late execution evidence invalidates a marker, refresh the account-wide CLOSING open-order snapshot and filtered CLOSING balance snapshot when required, then flush the Journal.
10. **Stop operator control and disconnect Binance last.** Publish STOPPED and close Journal/EventBus/release process locks only after runtime shutdown and cleanup are confirmed.

There are no arbitrary sleeps, 20-second delays, quiet periods or time-based guesses. If safety cannot be proven, fail closed: retain the connections and services needed for reconciliation/recovery, report the exact strategy, market and blockers, and do not report STOPPED.

The composed-bootstrap acceptance regression in `src/bootstrap/start-harvester.test.js` exercises this sequence through `startHarvesterForTest` with two enabled Conservative markets. It checks that both markets independently emit safe evidence before either market feed is unsubscribed, the CLOSING open-order and balance barriers precede teardown, market feeds stop before user-data intake, broker disconnect is last, and a durable `PROCESS_STOPPED` fact exists after the runtime returns STOPPED. This is offline composition evidence only; it does not establish exchange-side outcomes or retroactively prove a historical process exit. A companion composed-runtime failure case injects an unsuccessful event-publisher flush and asserts that both market feeds, shared user-data intake and the broker remain connected and no `PROCESS_STOPPED` fact is appended. The injected publisher is a deterministic port: its successful `durable` acknowledgement validates the shutdown contract's barrier handling, but does not exercise the production Journal adapter's filesystem fsync; the Journal package's own fsync tests remain the evidence for that lower-level guarantee.

### Strategy and market safety markers

Conservative tracks every configured market independently. A market is safe only when the BUY gate is active; no owned BUY is pending, open, partially filled or unknown; cancellation outcomes, fills and actual commissions are reconciled; no order/accounting transition remains ambiguous; recovery SELL coverage is authoritatively verified or no recovery obligation remains; and the Journal durability barrier succeeds.

The marker is process-local. It is not trusted after restart; rebuild safety from the Journal and authoritative exchange state. An execution report, REST reconciliation result, newly discovered owned order, changed SELL state or accounting discrepancy invalidates the affected marker. A market is re-audited before the shared shutdown barrier can pass.

**Shutdown blocker taxonomy — [#1479](https://github.com/45s/coinzilla/issues/1479):** `ORDER_OR_FILL_RECONCILIATION_INCOMPLETE` is emitted only when canonical owned-order reconciliation or a required user-data drain fails. It is independent of BUY-cancellation, recovery SELL reconciliation/input, recovery coverage, Journal durability and external integrity blockers. Those failures retain their own diagnostics and remain fail-closed. Recovery-input failures preserve their stable reason (for example `STALE_MARKET_PRICE` or `MARKET_METADATA_UNAVAILABLE`) alongside `SHUTDOWN_RECOVERY_INPUT_UNAVAILABLE`; the reason does not authorize a retry or bypass authoritative verification.

**Fresh-price recovery during shutdown — [#1479](https://github.com/45s/coinzilla/issues/1479):** when recovery input is missing or stale specifically because of `MARKET_PRICE_UNAVAILABLE` or `STALE_MARKET_PRICE`, the participant waits for an accepted fresh market-stream event for at most `MARKET_DATA_MAX_AGE_MS` (5,000 ms). The waiter is outside the serialized engine transition queue so market events can be accepted and processed. A successful wait triggers one complete recovery SELL reconciliation retry; the workflow rechecks freshness and canonical order state. If no event arrives, the blocker is `MARKET_PRICE_REFRESH_TIMEOUT`; if the price becomes stale again, `STALE_MARKET_PRICE` remains blocking. The BUY gate remains active throughout. This is event-driven, not a sleep or quiet-period proof. A one-shot ticker response without a source timestamp is never relabeled as fresh. **Initial drain invariant:** previously safe process-local market markers must be re-audited when the shared initial user-data drain fails; an old marker cannot bypass a current drain failure. This regression is tracked in #1479. The safety-marker re-evaluation loop must also be bounded: one initial complete pass plus one re-audit for late accepted evidence; further invalidation fails closed with `SHUTDOWN_SAFETY_REEVALUATION_LIMIT_EXCEEDED:2` rather than spinning indefinitely. This is a pass-count bound, not a time-based safety proof.

### Market-scoped REST snapshot parity

`reconcileOwnedOrders({ symbol })` and `reconcileOwnedOrders({ symbols })` preserve the caller's original market scope through REST collection and the serialized snapshot-apply transition. The parity check compares current registry membership only for markets in that explicit scope. An owned order in another market does not invalidate a symbol-scoped snapshot. A reconciliation with no symbol filter remains global and compares the complete current registry.

Use the original requested scope, not only the symbols represented by orders at collection start. If another owned order appears in any explicitly requested market while REST reads are in flight, the serialized parity check must detect it even when that market had no order in the initial snapshot. Within the requested scope, added, removed, replaced or unidentified orders remain fail-closed as `REST_STREAM_REGISTRY_RACE` / ownership-integrity failures. A newer stream cumulative fill remains fail-closed as `REST_STREAM_EXECUTION_LAG`; processed-fill/REST-history and Journal parity checks remain unchanged.

This scope correction only isolates unrelated markets. It does not weaken canonical client/broker identity, complete paginated fill history, exactly-once fill/commission accounting, or the durable Journal barriers. Both Conservative shutdown reconciliation passes retain the same requested market scope; keep user-data intake and broker connectivity alive until the existing safety and shared-service barriers pass. For a registry-race failure, inspect the requested symbol set and the affected market's order/stream history; never retry blindly, adopt an external order, or bypass the market pause.

### Ambiguous orders and fail-closed behavior

Keep the original client order ID for an ambiguous placement. Reconcile by canonical identity; never retry placement or submit a duplicate recovery SELL just because an acknowledgement timed out. Never cancel an order unless canonical ownership is proven. An external/manual open order is never adopted, canceled or modified; its presence alone does not block shutdown safety. An actual unowned execution or unresolved account-wide ownership/balance discrepancy remains a separate integrity blocker. If an owned BUY/SELL remains UNKNOWN, terminal fill history is incomplete, recovery coverage is insufficient, accounting is unsafe, or Journal durability cannot be proven, report the exact strategy/market/blocker, keep required services connected and do not publish STOPPED.

A failure in one market does not erase another market's SAFE_TO_SHUTDOWN marker, but it prevents shared services from stopping. The coordinator waits for all strategy participants; it does not decide whether a Conservative order is safe.

### Ambiguous order acknowledgements during shutdown

A placement request can have an uncertain local outcome even when Binance accepted the order. Keep the original client order ID and retain the order as UNKNOWN; never retry placement because an acknowledgement timed out. An authoritative user-data `executionReport` with the matching owned `clientOrderId` and exchange-assigned `brokerOrderId` resolves identity. The first matching `NEW` report advances UNKNOWN to OPEN; duplicates are idempotent and conflicting identities remain rejected.

Shutdown starts cancellation of known Harvester-owned BUYs immediately. Pending or UNKNOWN identities are reconciled while market-price, user-data and broker services remain connected; cancel an order only after canonical ownership is proven. Never guess an exchange order ID or cancel an external/manual order. The broker requests Binance `newOrderRespType: "RESULT"` for canonical placement so `LIMIT_MAKER` acknowledgements contain the order facts required by the canonical adapter instead of Binance's minimal default ACK.

### Shutdown-only recovery and safety pauses

The shutdown-only recovery SELL path is a narrowly authorized exception, not a general pause override. The final submission gate permits it only while stopping, for a SELL with purpose `RECOVERY_SELL`, and while the explicit shutdown-recovery submission scope is active. That does not prove that every market pause is safe to bypass.

The latest-transition evaluator and shutdown recovery workflow both reject a market in `state.paused`. Keep those guards: a hard strategy safety pause must never be bypassed by shutdown recovery. The shutdown safety auditor also treats a durable pause, or any non-recovery-managed pause, as an explicit `STRATEGY_SAFETY_PAUSED` blocker. Recovery-managed cancellation pauses remain separately identified and fail closed until their canonical cancellation/reconciliation facts are resolved.

The PR #1190 regression fixture uses order-specific cancellation quantities: zero for BUY cancellation and the already-recorded cumulative fill quantity for the recovery SELL cancellation. This keeps terminal order quantity consistent with the complete distinct fill history. The important recovery boundary is the remaining sellable quantity above `keepQuantity`: when a late SELL fill leaves sellable quantity, shutdown must cancel/reconcile the stale SELL and submit a correctly sized replacement; when it consumes all sellable quantity, only the retained `keepQuantity` remains and no replacement is required. The workflow now bases `requiresSell` on sellable quantity, not on an outstanding cost balance that cannot be recovered from retained inventory. Hard and unresolved recovery-managed pauses remain fail-closed; no pause guard is bypassed.

### Safety and lifecycle invariants

- The strategy shutdown gate is activated before shutdown context construction or shared-service cleanup. It rejects initial BUYs, trailing-BUY replacements, retries, delayed evaluations and every final broker-boundary BUY submission.
- Market-price/book intake, Binance user-data intake, operator control and broker connectivity remain available while owned BUY cancellation, pending identity resolution, cancellation outcomes, racing fills and actual commissions are reconciled. Accepted market-price events use recovery-only evaluation; only recovery SELL work is allowed. After every strategy participant is safe, fence new market callbacks and drain accepted price/book tasks and their queued user-data events before re-proving safety and durably publishing CLOSING.
- The pre-unsubscribe drain checks both promise settlement and the callback's returned result. A rejected task or a fulfilled `{ ok: false }` result is a shutdown blocker; callback-level error normalization must never turn failed market processing into a successful drain. The drain diagnostics retain the original callback errors rather than only reporting the settled-promise wrapper.
- Cancel only registered, Harvester-owned BUYs. Each broker cancellation is preceded by a durably flushed `order.cancel_requested` event. The canonical response must match the owned order and be terminal; canonical fills are checked for identity, duplicates and cumulative executed-quantity parity before normal accounting applies them.
- User-data intake remains active through BUY cancellation, final owned-order reconciliation, the market callback fence and the accepted market-task drain. Re-prove safety and durably publish CLOSING before unsubscribing market feeds. Only then stop user-data intake and drain accepted events; if late evidence invalidates a market marker, reconcile again, re-verify recovery SELL coverage and publish an updated CLOSING snapshot before shared cleanup.
- Shutdown does not cancel SELLs as generic cleanup. It may cancel only a Harvester-owned recovery SELL that no longer covers the final recovery plan. Before replacement, durably record cancellation intent, confirm the canonical terminal order, reconcile complete terminal fill history and actual commissions, and apply those fills exactly once. Then submit a recovery SELL only; never submit a standing BUY or a blind duplicate. Other valid owned SELLs remain resting; external/manual orders are never adopted, canceled or modified.
- After recovery replanning, perform another canonical owned-order reconciliation and final coverage audit. An OPEN or PARTIALLY_FILLED recovery SELL is acceptable only when its remaining quantity and net proceeds cover the final recovery obligation and configured profit target, including actual commission facts. UNKNOWN, stale, undersized, financially insufficient or otherwise unverifiable SELL state keeps the market unsafe.
- Each market's SAFE_TO_SHUTDOWN marker is independent and process-local. It is set only after all order/fill/accounting facts are reconciled and the Journal evidence is durable. Late execution/order evidence invalidates the affected marker. A safe market cannot release shared services while another market or strategy participant is unsafe.
- Only trading-enabled runs publish the paired CLOSING audits. After strategy safety proof, fetch the complete account-wide open-order set with `getOpenOrders({})` while the broker is connected. Persist the `ACCOUNT_OPEN_ORDERS_CAPTURED` fact, publish `account.open_orders_captured` with phase `CLOSING`, and cross the Journal flush barrier. Successful snapshots preserve broker/client order IDs, side, type, status, price, original quantity and executed quantity; `observedAt` is the local monotonic capture time because the broker query supplies no authoritative source timestamp. Unmatched/external orders remain BLOCKED and untouched; their presence alone does not make the balance audit incomplete. A failed, partial, or malformed read records a BLOCKED snapshot with `CLOSING_OPEN_ORDERS_CAPTURE_FAILED`, never a fabricated empty/READY account, and causes the following balance audit to be INCOMPLETE. Then fetch the filtered CLOSING balance snapshot, persist its fact, publish `account.snapshot_captured` with phase `CLOSING`, and cross its Journal flush barrier. Unrelated wallet assets remain excluded. These are separate audit dimensions, not a Portfolio import or order adoption.
- Stop operator control and market-price/book intake, drain accepted market work, then disconnect Binance only after all strategy participants are safe and the CLOSING/Journal barrier is durable. Publish STOPPED only after runtime shutdown and cleanup are confirmed.

### Failure and process-lock behavior

If BUY cancellation, identity resolution, order/fill reconciliation, actual-commission accounting, recovery SELL coverage, accepted user-data drain, either CLOSING snapshot, or either durable-facts/Journal barrier cannot be proven, keep the required trading and recovery services connected. Reject runtime shutdown, report the exact strategy/market/blocker, retain Journal/EventBus/process locks and never publish STOPPED. A late or UNKNOWN order is not a reason to disconnect.

The thrown `AggregateError` exposes `shutdownDiagnostics` and the structured log includes the pre-shutdown status, CLOSING audit reasons, stage-specific reconciliation failures, cleanup error summaries with bounded messages, stacks and nested causes, accounting/reconciliation/safety-halt flags, retryable recovery generation data and exact unresolved owned-order identities/status/quantities. An OPEN/PARTIALLY_FILLED recovery SELL is excluded from unresolved orders only after the final coverage audit proves it satisfies the plan. Diagnostics contain normalized identity/accounting facts, never raw broker payloads.

The process owns two Harvester locks: a broker-wide host lock and an application process lock. Both live under `~/.coinzilla/harvester/process-locks/`, outside the logs tree. Release is allowed only when runtime shutdown was confirmed and Journal close returned a successful result. If runtime shutdown is uncertain, or Journal close/drain/sync is not confirmed, retain both locks. Release the application lock first and only then the host lock; if application-lock release is uncertain, deliberately retain the host lock. A failed lock release is reported and leaves the remaining lock in place.

Separately, the Journal package owns a hidden `.coinzilla-journal.lock` in the active session directory while its JSONL writer is open. Journal removes only the lock it acquired. This package-level writer lock is not one of the two Harvester process-ownership locks.

An EventBus flush/close timeout, Telegram notification close failure, observability cleanup failure, process logger close failure, or process-lock release timeout makes outer shutdown incomplete and retains the process lock. The handler stops before downstream cleanup when a required stage fails, records the failing phase, and leaves pending operations single-flight for a later retry. These failures are not evidence of unresolved trading orders, but they do prevent a successful process-exit/lock-release acceptance claim.

The deterministic regression suite covers gate-before-cleanup ordering, per-market and per-strategy barriers, BUY submission races, recovery-only price evaluation, cancellation-racing fills, late evidence invalidation, recovery SELL coverage, incomplete shutdown and process-lock retention. A real `startHarvester` bootstrap regression also proves that a market callback's fulfilled `{ ok: false }` result keeps market/user-data intake and broker connectivity alive. A process kill, machine crash, power loss or failed filesystem sync can still lose recent records; the Journal is not an unconditional durability guarantee.

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

The current startup composition initializes `userDataState.accountingFailed=false`, trading-enabled `requiresReconciliation=false`, and empty engine pause/recovery-intent Sets. A Conservative strategy-originated `pause()` immediately adds the market to the process-local `paused` and `durablePausedMarkets` Sets, records `STRATEGY_MARKET_PAUSED` when the Operational State Store is configured, publishes `STRATEGY_PAUSED`, and, for safety-critical reasons, cancels only active BUY orders owned by the current process through the existing serialized cancellation/fill-reconciliation transition. Expected preflight/metadata/strategy validation rejections and explicitly retryable REST reconciliation failures retain existing standing BUYs. It does not adopt startup-snapshot, manual, external, or prior-process orders. Cancellation-racing fills are applied before the terminal CANCELED status is committed, so the registry follows valid non-terminal-to-terminal transitions.

If pause-fact persistence, lifecycle-event publication, or owned-BUY cancellation is incomplete, the market BUY gate remains active. The engine records `STRATEGY_SAFETY_PAUSE_INCOMPLETE` in the operator snapshot and attempts to append a durable `SAFETY_BLOCKER_RAISED` fact with that reason. Inspect the snapshot's `safetyPauseCancellation` details and blocker evidence; do not infer that an empty cancellation response or a process restart cleared an UNKNOWN order. Only an explicitly purpose-tagged `RECOVERY_SELL` may pass this strategy-safety gate; Recovery Seller evaluation and canonical fill accounting continue. These durable facts are evidence only and do not restore the process-local pause on restart. See [ADR-0008](architecture/decisions/0008-strategy-safety-pause-cancels-owned-buys.md).

The per-market strategy pause/recovery-intent sets are not guaranteed to survive a process restart. The separate `accountingFailed` process-lifetime latch is tracked by F-023/#769. PREFLIGHT and new live events may detect some unresolved conditions, but they do not reconstruct every previous pause reason or offline terminal fill. Do not treat restart as resolution of an earlier safety halt. Keep trading disabled until the prior cause has been authoritatively reconciled or explicitly acknowledged. See F-029 in [AUDIT.md](audits/reports/AUDIT.md), F-031/#654 and F-028.

## Applied-fill Journal durability boundary

The Harvester engine applies the canonical fill to in-memory accounting and then calls the best-effort `publishLifecycleEvent()` for `execution.fill_applied`. `processExecutionFillTransition()` ignores the publication result and does not invoke the durable Journal flush barrier. Publication is synchronous admission only; EventBus subscriber delivery is asynchronous. Journal append reports `durable: false`; explicit `flush()` waits for pending EventBus deliveries and Journal writes, then performs filesystem sync/fsync. A mapping/publication failure or missing publisher can therefore leave an applied fill with no corresponding Journal event while the engine returns success.

The engine's durable flush barrier protects order submission/cancellation intent before the exchange side effect.

During Operational State Store replay, an applied fill is associated with its original durable order using canonical client/broker order identity. The fill must preserve the order's provider identity (`providerInstanceId`, `providerType`, `accountId`). Strategy ownership (`strategyId`, `positionId`, `cycleId`, and `purpose`) is recorded on the submission intent/outcome and remains authoritative there; it is not duplicated onto the `Fill` payload. Replay must validate ownership on the order and provider provenance on the linked fill without requiring the fill to repeat strategy metadata. The offline restore guard distinguishes the shared `RECOVERY_SELL` purpose by originating `strategyId`: CG Position-scoped recovery sells remain in the Conservative candidate projection, RS orders/fills remain deferred from Conservative restoration, and legacy/unknown strategy records with ambiguous recovery purposes remain fail-closed. It does not immediately protect the post-fill accounting event. Graceful Journal close drains and syncs accepted events; unexpected process termination or power loss has no equivalent guarantee.

Therefore the Journal must not be described as a crash-consistent fill ledger or complete trading-state authority. This is a confirmed missing durability guarantee, not evidence that a particular historical fill was lost. See F-028 in [AUDIT.md](audits/reports/AUDIT.md) and [#654](https://github.com/45s/coinzilla/issues/654).

## Existing offline recovery helpers — not wired into current runtime

The repository retains tested offline helpers: `projectHarvesterJournalRecovery()`, `restoreHarvesterJournalState()`, `fetchAccountTradeHistory()`, `auditRecoveredTradeHistory()`, and `auditRecoveredAccountState()`. They can project Journal records, rehydrate Portfolio/RecoveryLedger/OrderRegistry and pause/intent state, scan trade history for supplied markets, and compare exact executions, balances, open orders and reservations.

### One-market exchange audit semantics (offline only)

`fetchAccountTradeHistory()` reports the exact canonical market symbols queried, query start time and whether every page for those markets was exhausted. Page exhaustion does not prove exchange-retention coverage. `auditRecoveredTradeHistory({ scope: "MARKET" })` therefore also requires a durable operator-verified history-retention baseline whose covered-from time is no later than the query start. The audit validates only the requested Market and does not claim account-wide completeness. The evidence reference must identify a `MARKET_HISTORY_COVERAGE_CONFIRMED` fact with a stable fact ID, matching symbol, covered-from time, query-start coverage through the verification time, evidence digest and verifier identity. The offline adapter resolves and verifies the fact against the ADR-0001 durable-facts store through merged [PR #1053](https://github.com/45s/coinzilla/pull/1053). Tests cover durable-fact provenance and fail-closed behavior. Account-wide history remains fail-closed: a caller-supplied `marketUniverseComplete: true` boolean is not proof that delisted or otherwise unenumerated symbols are covered.

`auditRecoveredAccountState()` requires every asset present in the durable baseline and current account snapshot to be present on both sides. Missing assets are not interpreted as zero. Account-wide open orders outside the restored OrderRegistry remain unowned and untouched; when canonical Market metadata is available, their exact remaining BUY/SELL commitments are included in locked-balance reconciliation and their symbols are returned as narrow blockers. An unowned order on an unrelated symbol does not by itself block the target market, but missing metadata or an unexplained reservation fails closed.

### Durable market-history coverage facts

`recordMarketHistoryCoverage()` appends a `MARKET_HISTORY_COVERAGE_CONFIRMED` fact only to an already initialized, integrity-verified ADR-0001 store. Its strict payload contains the canonical symbol, `coveredFromTime`, `verifiedAt`, the SHA-256 digest of the reviewed evidence artifact, and a non-secret `verifiedBy` identity. The store rejects malformed payloads, unsupported fields, coverage-window narrowing, and verification-time regression.

`readMarketHistoryCoverage()` calls the store's integrity-verifying `readAll()` path, validates the per-symbol monotonic sequence, and projects the latest fact into the exact evidence shape consumed by the one-market audit. A valid interval must cover the query start: `coveredFromTime <= historyStartTime <= verifiedAt`; the current account snapshot must not predate `verifiedAt`.

The fact writer is an application use case, not a Telegram command. The offline audit-only/explicit-confirmation CLI and evidence-bundle adapter were added in merged [PR #1053](https://github.com/45s/coinzilla/pull/1053). Creating a coverage fact still requires explicit operator review and a reviewed evidence artifact; confirmation requires an already initialized, integrity-verified durable-facts store. A missing or invalid fact leaves the market audit blocked. This workflow is not wired into runtime startup.

These recovery audit/confirmation primitives are offline-only. They are not wired into startup, do not publish runtime READY, and do not enable process-restart restoration. The separate process-lifetime Telegram `/pause <SYMBOL>` operator control is runtime-wired by merged PR #1067; it does not expose recovery confirmation or restore pause state after restart.

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

Trading-enabled startup acquires two exclusive locks before the Journal writer starts or the broker connects. Both are stored under the host-shared `~/.coinzilla/harvester/process-locks/` directory, outside every Git worktree:

1. **Broker/account host lock:** `.<broker>-harvester-trading-<scope-sha256>.lock`.
2. **Harvester application lock:** `.harvester-trading-<scope-sha256>.lock`.

The scope fingerprint is SHA-256 over the canonical provider and validated `TRADING_MODE` (`testnet` or `live`). It excludes API keys, API secrets, account identifiers, worktree paths, branch names and process identity. Testnet and LIVE produce different fingerprints. Missing, malformed or unsupported scope values fail closed before broker connection. This is the completed #1307 broker/environment isolation contract; it is not yet account-scoped. The multi-provider plan records the required account-aware identity and mixed-version lock transition before multiple accounts can share a host.

The host lock is acquired first, then the application lock. If application-lock acquisition fails, startup attempts to release the host lock; an uncertain host-lock release is surfaced rather than ignored. During shutdown, the application lock is released first and the host lock only after application-lock release is confirmed. If application-lock release is uncertain, the host lock is deliberately retained. Both locks remain held unless runtime shutdown, durable `PROCESS_STOPPED`, EventBus flush, Telegram notification close, Journal/EventBus/API/persistence cleanup and process logger close are all confirmed. A lock-release result must explicitly confirm `released: true` or the idempotent `alreadyReleased: true` outcome; `ok: true` without either terminal disposition is ambiguous and keeps shutdown incomplete. The runtime stop contract is explicit: success must return `{ok: true, status: "STOPPED"}`. An undefined or ambiguous result is incomplete shutdown; it must not append `PROCESS_STOPPED`, close shared services, or release either lock. A durable CLOSING audit is not a STOPPED confirmation. If runtime startup was attempted and then failed before a runtime handle was returned, the locks are retained because broker resources may have been partially activated.

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

[ADR-0004](./architecture/decisions/0004-startup-open-orders-are-external.md) records the accepted ownership rule, implemented in [PR #1166](https://github.com/45s/coinzilla/pull/1166). The account-wide audit records all open orders durably and classifies unmatched identities without adopting or modifying them. Every unmatched startup order is external to the current process, regardless of client-order ID prefix. `externalOrdersPolicy: "ignore"` allows that market to continue strategy evaluation; `externalOrdersPolicy: "block"` applies the same-symbol evaluation/submission restriction to any unmatched order. Under `"block"`, a newly observed unmatched manual execution report immediately installs a provisional guard for that symbol and schedules a fresh account-wide open-order snapshot. The report is diagnostic-only for accounting: it is never adopted or applied to Portfolio/RecoveryLedger and does not close global user-data readiness. The guard is replaced only after the complete snapshot crosses the existing durable Journal barrier; a still-open order remains a symbol-scoped blocker, an empty/closed result releases the provisional guard, and read/durability failure retains it. An unmatched execution report for a reserved `h-` client ID remains fail-closed because it may represent an execution from a previous process; it is never attributed to the current process. Manual orders may change exchange free balances, so normal balance validation/rejections still apply.

## Market-scoped exchange order identity

An exchange-assigned broker order ID is not a globally unique Harvester identity. For Binance Spot, order IDs are scoped to the market symbol; the same numeric ID may validly appear for different symbols. Harvester therefore identifies an acknowledged exchange order by the composite `market.id + brokerOrderId`, while the original Harvester `clientOrderId` remains globally unique within the OrderRegistry.

All broker-ID lookups and order-update matching must include the canonical market identity. An unscoped broker-ID lookup is permitted only when it resolves to exactly one registered order; if multiple markets contain the same broker ID, the lookup fails as ambiguous rather than selecting an arbitrary order. Ownership is resolved through the canonical order and checked against its market, client ID and broker ID before attribution.

Do not key persisted or in-memory cross-market order maps by `brokerOrderId` alone. Do not infer order ownership from a matching numeric broker ID in another market. Regression coverage is maintained in `order-registry.market-identity.test.js` and the Recovery Seller mixed-SELL reconciliation tests.

## Account-scoped safety blocker operations

An active `SAFETY_BLOCKER_RAISED` with `scope: ACCOUNT` is a global order-admission stop. Confirm its blocker ID and reason before taking operator action. Do not work around it with another market, strategy, side, purpose, or shutdown Recovery Seller SELL.

The Harvester must refuse trading activation when an account blocker is already active and reject every final broker submission while it remains active. Startup must read and project verified Operational State history even when CG recovery and Recovery Seller are disabled; recovery feature flags do not disable account-blocker admission. An unresolved ACCOUNT blocker in that history prevents broker connection. The dynamic account gate is also re-read after durable order-intent persistence at the final broker boundary; if a blocker becomes active between initial admission and broker I/O, the local PENDING order is removed and the broker is not called. When the supported Recovery Seller STOP is restored with its feature enabled, the process may remain observation-only; incoming market-price events must not invoke strategy evaluation or enable execution routes. A blocker fact outside an active process session makes the history unprojectable and is also a startup failure; absence of PROCESS_STARTED is not evidence that a ledger containing safety facts is a clean first run. A Recovery Seller STOP closes in-memory admission before awaiting durable persistence; a failed write remains fail-closed. Resolve only through the explicit durable resolution workflow after independent order, fill, balance, Portfolio and reservation reconciliation with an identified operator/action. Never edit or delete the blocker fact manually.

Market-scoped blockers apply only to their symbol. The ADR-0008 Recovery Seller SELL exception is limited to its documented market-level strategy pause and is subordinate to any account-scoped blocker.

External open orders remain unowned and untouched. `externalOrdersPolicy: IGNORE` permits scoped continuation; `BLOCK` prevents trading only on the affected market. An audit `readiness: BLOCKED` classification is not itself a global safety STOP.
