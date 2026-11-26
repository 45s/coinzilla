# Startup readiness diagnostics — issue #1860

**Status:** implementation committed on `feat/harvester/issue-1860-startup-readiness-diagnostics`; exact-head automated verification is pending.

This document records the source-verified design and traceability for the startup readiness report. It does not define a new trading-state authority, strategy rule, restart-restoration mechanism, or operator authorization policy.

## Existing lifecycle and safety boundary

The current composition is owned by `src/bootstrap/start-harvester.js`:

1. Resolve and validate effective configuration and explicit trading environment.
2. Verify the ADR-0001 Operational State Store and apply its existing prior-process restrictions. Restoration remains disabled.
3. Connect the selected execution broker and resolve provider/account identity.
4. Load exchange market metadata and validate strategy market rules.
5. Compose the engine and operator control.
6. Establish user-data delivery; publish and durably flush the PREFLIGHT account and account-wide open-order audits; drain queued events and validate application reconciliation.
7. Establish per-market price and book streams, seed missing prices from the broker request/response API, then start candle history for markets with volatility protection enabled.
8. Preserve existing cleanup and shutdown ownership on every failed startup path.

The key boundary is that user-data PREFLIGHT is necessary but not sufficient evidence of complete market readiness. The report must also sample actual market inputs after their existing producers have initialized. It must not treat a subscription acknowledgement as an observed price/book event.

## Authority and source-to-test traceability

| Readiness fact | Authoritative producer/source | Existing consumer or safety gate | Required diagnostic evidence | Regression coverage |
| --- | --- | --- | --- | --- |
| Effective configuration and market selection | `resolve-harvester-options.js`, `load-app-config.js`, `validate-market-trading-readiness.js` | Bootstrap fails before broker connection for invalid configuration/market rules | Validated enabled markets, environment and safe setting names; no secret values | `resolve-harvester-options.test.js`, `validate-market-trading-readiness.test.js`, startup tests |
| Durable state and prior process | `verifyOperationalStateStore()`, ADR-0001 Operational State Store, `projectHarvesterOperationalState()` | Existing process-restart gate; no automatic restoration | Store verification, previous-process observation, restoration disabled/observation-only consequence | startup tests; Operational State Store tests |
| Broker/provider identity | `connectBroker()`, broker adapter and provider identity | Bootstrap connection and route-identity checks | Connected provider/environment identity and safe capability result where supported | `connect-broker.test.js`, startup and routing tests |
| Account PREFLIGHT | `createAccountSnapshotManager()` | Durable account snapshot and Journal PREFLIGHT barrier | Snapshot source time, tracked asset count and audit completion | account snapshot manager tests; user-data startup tests |
| User-data stream and application reconciliation | `subscribeToUserData()`, user-data status/recovery handlers | `userDataState.ready`, `requiresReconciliation`, accounting/safety blockers | Subscription, actual status/event evidence, PREFLIGHT audit and reconciliation state | `subscribe-to-user-data.test.js`, recovery/status tests |
| Account-wide open orders and ownership | Account snapshot manager, ADR-0004 | Per-market `externalOrdersPolicy`; external orders stay unowned and untouched | Snapshot completion and affected symbols/policy classification, without exposing order IDs | account snapshot tests; startup external-order tests |
| Market price | `subscribe-to-market-data.js`, engine `state.prices` | Existing price freshness and submission gates | Actual accepted price timestamp/freshness, not subscribe acknowledgement | market-data subscription and engine freshness tests |
| Market book | `subscribe-to-market-data.js`, engine `state.books` | Existing order-book freshness and post-only submission gates | Actual accepted book timestamp/freshness | engine book-freshness tests and startup tests |
| Market metadata | `load-market-metadata.js`, `validate-market-trading-readiness.js` | Engine market metadata and exchange-rule gates | Metadata presence and validation outcome | market metadata and market-readiness tests |
| Candle history and volatility | `create-candle-history-service.js`, engine volatility protection state | Existing per-market volatility submission gate | Subscription, history/required counts, gap/fatal reason, last live event age and protection mode | candle-history and volatility-protection tests |
| Engine market safety | `getOperatorMarketSnapshots()` | Existing per-market blocker and final submission gates | Existing blocker list and scope, without mutating the engine | `conservative-trading-engine.test.js`, operator read-model tests |
| Journal PREFLIGHT | account snapshot manager and lifecycle EventBus flush barriers | Existing mandatory durable PREFLIGHT barrier | Report PASS only after the existing awaited barrier returns | account snapshot and user-data startup tests |
| Trading mode and authorization | resolved `tradingEnabled`, operator-control authorization | Existing engine admission and operator authorization | Report separately; health must never grant either | startup and operator authorization tests |

## Status and scope semantics

The report is a read-only projection of current runtime, account, user-data, market, candle and engine snapshots. It is not stored as mutable operational state.

- `PASS`: the authoritative source was read and the required condition is confirmed.
- `WARNING`: a known, non-blocking degradation or policy-allowed condition is present.
- `BLOCKED`: a required runtime/account condition is not safe, or a market-local condition blocks that market.
- `NOT_APPLICABLE`: the capability is disabled or not required by the effective configuration.
- Unknown or failed-to-read evidence is never converted to PASS.

Account/runtime blockers remain distinct from market-local blockers. A Conservative engine market snapshot is required only when a Conservative execution route is configured. For a runtime containing only non-Conservative routes, the report marks that Conservative snapshot as not applicable and reports a non-blocking degraded status; it does not claim those routes passed the Conservative audit or replace their existing strategy-owned admission checks. A market-local blocker must not be broadened to another market. Under ADR-0004, an unowned order remains external and untouched; `IGNORE` may permit the market to continue, while `BLOCK` is scoped to the affected symbol.

Health, trading enablement, operator authorization and restart-recovery permission remain separate. In particular, a verified connection or healthy report does not grant trading authorization, and a prior process never becomes restored by this report.

## Safety invariants

- No health diagnostic places, cancels, modifies or adopts an exchange order.
- No health diagnostic changes positions, balances, operator authorization, STOP state or trading enablement.
- No new Journal persistence barrier is introduced.
- Existing PREFLIGHT, order-submission, cancellation, RECOVERY and CLOSING durability contracts remain authoritative.
- Transport reconnection does not clear application reconciliation.
- A fresh accepted market price received while the global trading gate is closed is queued without consuming a strategy evaluation. After the existing gate opens, activation awaits the deferred replay to drain; a market-specific pause is not converted into a global deferred replay.
- Price/book subscription acknowledgement is not live-data readiness.
- Volatility inputs unavailable or invalid remain protected/blocked according to the existing volatility contract.
- Existing shutdown cleanup remains the owner of subscription, operator and broker teardown.

## Verification

Default tests remain offline, deterministic and credential-free. Test-first RED/GREEN evidence and exact-head GitHub Actions results are recorded in the task PR. No TESTNET or LIVE account operation is part of this issue.


## Test-first implementation checkpoints

The first regression slice specifies the source-backed report contract, the authorized operator read-model exposure, and deferred opening of the existing user-data trading gate. The RED checkpoint is expected until the report builder and deferred activation integration are implemented. No new mutable readiness state or exchange operation is introduced by the tests.


## Implementation checkpoint — immutable report builder

The first production slice now contains the pure readiness projection used by both startup and the authorized operator read model. It derives global account/runtime checks and per-market route, price, book, metadata, volatility and existing engine-blocker results from supplied snapshots. It is immutable, does not call the broker, does not persist facts, and never opens the existing trading gate.

Startup wiring and the operator projection remain in progress. Required checks with missing evidence fail closed at their declared runtime or market scope. External-order-only account audit classifications remain warnings; the existing per-symbol policy and engine blocker determine market impact.


## Implementation checkpoint — authorized operator read model

The existing authorized status and market queries now consume the same immutable readiness report used by startup. The report is exposed as readinessReport; per-market readiness and blockers are projected from that report rather than recomputed independently. Existing operator authorization remains the gate for reading it.


## Implementation checkpoint — startup boundary and market evidence

Startup now retains the existing user-data readiness flag as the only global trading gate. The PREFLIGHT snapshot and queued-event drain complete first; the gate is then deliberately left closed while market price, order-book and candle services initialize. One immutable report is logged from those live snapshots before the existing gate is opened. The activation continuation revalidates user-data safety immediately before setting the existing ready flag and resuming deferred evaluations.

Accepted WebSocket price/book events are distinguished from subscription acknowledgements; initial price seeds are reported separately. The engine operator snapshot now exposes book freshness and the existing LIMIT_MAKER book blocker. The account snapshot manager exposes safe audit summaries only; no order identifiers, balances or account IDs are included in diagnostics. Restoration remains disabled, and prior-process evidence keeps the runtime observation-only.


## Implementation checkpoint — engine book evidence and operator projection

The engine's existing operator market snapshot now includes order type, whether a book is required, book timestamp/freshness and the existing book blocker. The authorized status and market queries consume the immutable readiness report and expose the same per-market readiness/blocker projection; they no longer calculate a separate readiness interpretation.


## Test coverage checkpoint

The configured Harvester regression matrix now includes the immutable report, authorized operator read-model and deferred user-data activation suites. Existing account-snapshot, market-subscription, engine and startup suites also cover durable audit summaries, first accepted market-data events, book freshness and startup gate ordering. No LIVE or TESTNET account is used by these tests.


## Implementation checkpoint — source-backed readiness inputs

The startup composition now derives market route expectations from the configured per-symbol market-data provider identity (no fallback to the execution broker identity), checks the actual application-owned `BROKER_PORT_METHODS` contract, and includes the existing account-scoped safety-blocker projection. Price/book evidence carries the source-owned 5-second threshold; candle freshness is supplied by the candle-history service rather than duplicated in the report.


## Deferred user-data readiness

The existing `userDataState.ready` remains the only global trading gate. While the startup report is pending, the user-data status observer is prevented from reopening that gate on an early `connected` status. The explicit post-report activation continuation revalidates the existing reconciliation/account safety conditions, clears the temporary lifecycle deferral flag, and opens the same gate. This prevents asynchronous status callbacks from bypassing the startup boundary without adding a second readiness authority.


## Source-owned freshness thresholds and account safety

The readiness projection now reports the market-data service's 5-second price/book threshold and the candle-history service's own 65-second threshold. Account-scoped safety blockers are global blockers; a non-account-scoped blocker is surfaced as a warning and remains enforced by its owning market/runtime scope. The report includes each check's source of truth, expected condition, observed timestamp, severity and evidence state.


## Diagnostic record contract

Each report check now carries a stable code, source-of-truth description, expected condition, observed timestamp and evidence, severity, evidence state, diagnosis, possible causes where supported, recovery outcome where available, impact and operator action. The report remains a projection: it does not persist a second readiness state or perform financial operations.


## Operator read-model boundary

The startup boundary requires the full source-backed evidence set. A later operator query does not pretend that startup-only evidence (process continuity, PREFLIGHT durability, first-event provenance, or broker capability inspection) was rechecked if the source snapshot does not include it; those checks are explicitly `NOT_APPLICABLE` with their source limitation. Live engine blockers and the existing user-data readiness flag remain authoritative for current market/account admission.


## Operator read-model evidence

The report distinguishes the full startup boundary from later operator reads. Startup-only checks remain blocking when their required inputs are missing during startup. Outside startup, unavailable startup-only provenance is reported as `NOT_APPLICABLE`, while the existing user-data gate and engine-provided market blockers remain authoritative for live trading admission.


## Structured startup diagnostics

Startup readiness blocks now use a Harvester-owned `SystemCustomError` with a stable code and flat, sanitized context. User-data unsafe and reconciliation failures also retain stable codes. The terminal logger emits the check's expected condition, observed evidence, source, severity, possible causes, recovery outcome and operator action without exposing credentials or account identifiers.


## Verification correction

The user-data startup assertions now distinguish the stable structured error codes for unsafe initial events and unsafe deferred activation. A status-handler callback cannot reopen the existing readiness gate while the startup audit is pending.


The redaction test deliberately supplies a private account identifier and verifies that the projected report never serializes it. Provider identity comparisons still use the full source identity internally; only diagnostic output is sanitized.


## Startup failure preservation

Market-data and candle-history startup failures trigger a best-effort readiness report, but a secondary diagnostic failure is logged separately and never replaces the original startup exception. The original broker, market-data or candle-history failure remains the error rethrown to the existing lifecycle owner.


## User-data startup decomposition

The user-data startup sequence is split into explicit read-only PREFLIGHT, trading PREFLIGHT, and deferred activation steps. The subscription owner remains unchanged, and the existing account snapshot, open-order audit, queue drain, safety assertion and user-data readiness gate retain their original order.


## Authoritative user-data recovery

The recovery-generation transition now clears `streamUnsafe` and `requiresReconciliation` only for a matching, acknowledged authoritative `reconciled` subscription generation. A transport-level `recovered` event, stale generation, accounting failure or retryable recovery failure cannot clear the application reconciliation gate.


Market-price subscription setup now delegates the per-symbol intake reset to a small helper. The subscription lifecycle remains responsible for installing the handler, awaiting the broker acknowledgement and registering the subscription; readiness still requires an actual accepted price event or initial seed.


## Engine market projection decomposition

The operator market projection now separates market-data facts, pause/ownership facts, volatility facts and output shaping. The existing engine-owned blocker codes remain the source of truth for live market admission; the readiness report only projects them and adds startup-boundary diagnostics when those inputs are available.


## Operator read-query composition

The operator read use case now isolates runtime snapshot retrieval, engine market snapshot retrieval and readiness projection evaluation. Each boundary preserves its original structured error/cause; the public status and markets queries remain read-only and use the same existing engine snapshots.


The startup diagnostic fallback logger now uses the existing logger interface and sanitizes error codes before writing them. The original startup exception remains the one propagated to lifecycle cleanup.


## Candle-history execution boundaries

Historical retrieval, historical validation, buffered-event replay, live open-candle handling, live closed-candle handling and bounded gap backfill are separate functions. The service still owns its 65-second live-candle freshness threshold and remains the authority for volatility-history readiness.


## Broker connection evidence

Broker connection diagnostics measure the existing `connectBroker` handshake using the injected startup clock and preserve a sanitized failure code if connection fails. The capability check distinguishes the structural `BROKER_PORT_METHODS` contract from additional exchange capability requirements explicitly configured through the existing provider connection path; no unconfigured exchange permission is claimed.


Broker connection is measured around the existing `connectBroker` call. A failed handshake is reported through the integrated startup audit before the original connection error is rethrown; candle-history service construction is separately diagnosed and does not rewrite a successful broker connection as failed.


The connection check reports the measured handshake duration and any provider-supplied timeout/error code; it does not claim an application-level timeout where the existing BrokerPort connection contract does not define one.


## Final implementation contract

- The same immutable, read-only report builder is used by startup and authorized operator queries. It performs no broker calls, persistence, order actions or readiness-state mutation.
- Global runtime blockers (provider identity/capabilities, durable account and open-order PREFLIGHT, account-scoped safety, user-data safety and process continuity) prevent trading activation.
- Market-local blockers remain scoped to their market. The runtime may remain available while a market waits for a fresh accepted book or candle history; that market's evaluator stays deferred. This permits a late first book/candle event to recover the market without restarting the whole process.
- The report's aggregate `status` and `tradingGateOpen` are deliberately separate. A report can show no market ready while the global user-data gate is open; that does not permit strategy evaluation. Each market must first pass its own metadata, fresh-price, required LIMIT_MAKER book and configured volatility-history gates.
- The evaluator uses the same engine-owned metadata, freshness functions, candle-history snapshot and volatility-protection state as the report. It records deferred markets and resumes only through the existing book/candle event paths. Shutdown recovery-only evaluation keeps its existing exception.
- `userDataState.ready` remains the sole global trading gate. `tradingActivationDeferred` only prevents status callbacks from bypassing the startup continuation. `startupComplete` is lifecycle evidence and is set only after market-data startup succeeds; recovery remains pending before that point.
- A deferred `startMarketData()` call runs the same market lifecycle, report and activation sequence before marking startup complete. Failed startup leaves the global gate closed.
- The root command `npm run harvester` starts the existing application. Authorized Telegram status/markets pages expose the report and accepted book freshness; no standalone CLI or server is added.
- Prior-process evidence remains observation-only; no automatic restart restoration is claimed or performed.

The branch includes focused regressions for status-event bypass, deferred market-data startup, book/volatility evaluation gates, operator diagnostics and report scope. Exact-head test and CI results are pending.
