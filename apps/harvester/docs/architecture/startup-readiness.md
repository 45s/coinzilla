# Startup readiness diagnostics — issue #1860

**Status:** implementation in progress on `feat/harvester/issue-1860-startup-readiness-diagnostics`.

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

Account/runtime blockers remain distinct from market-local blockers. A market-local blocker must not be broadened to another market. Under ADR-0004, an unowned order remains external and untouched; `IGNORE` may permit the market to continue, while `BLOCK` is scoped to the affected symbol.

Health, trading enablement, operator authorization and restart-recovery permission remain separate. In particular, a verified connection or healthy report does not grant trading authorization, and a prior process never becomes restored by this report.

## Safety invariants

- No health diagnostic places, cancels, modifies or adopts an exchange order.
- No health diagnostic changes positions, balances, operator authorization, STOP state or trading enablement.
- No new Journal persistence barrier is introduced.
- Existing PREFLIGHT, order-submission, cancellation, RECOVERY and CLOSING durability contracts remain authoritative.
- Transport reconnection does not clear application reconciliation.
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
