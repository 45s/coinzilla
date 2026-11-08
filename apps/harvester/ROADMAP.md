# Harvester Roadmap

> **Conservative Strategy authority:** [CONSERVATIVE_DOMAIN_SPECIFICATION.md](./docs/domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md) is the sole authoritative rule definition. Roadmap items track implementation, evidence, and blockers only. Any older strategy-rule wording in historical sections is superseded and must not be used as current acceptance criteria. The canonical Mermaid flowchart is derived from the written specification and is not an independent authority.


> **CURRENT DIRECTION — 2026-11-06: CONSERVATIVE STRATEGY/POLICY AUDIT.** The active task is to find and fix Conservative decision, inventory, profit, fee, exchange-filter, and order-lifecycle defects, with regression tests. Process-restart recovery is deferred to the final roadmap section and is not a blocker for this audit.
>
> **2026-11-05 runtime decision:** durable Journal replay and process-restart recovery are intentionally disabled. Startup does not read historical Journal sessions, reconstruct Portfolio/RecoveryLedger/order state, or reconcile old trades. Harvester starts with fresh in-memory trading state for the current process. The separate durable account PREFLIGHT/CLOSING audit and pre-side-effect order/cancel intent flushes remain enabled. Do not reintroduce Journal replay or make it a startup prerequisite unless the user explicitly requests it.
>
> PR #513 and #515 established the incident lifecycle/accounting baseline. PR #545 added automatic account-wide PREFLIGHT auditing on every broker-connected startup; PR #546 corrected Binance WebSocket fill timestamps to use transaction time `T` for same-process reconciliation; PR #552 recorded the startup-audit completion; PR #553 reconciled the Journal durability policy; PR #554 fixed aggregate BUY/SELL commitment over-allocation; PR #559 added same-process canonical lookup and reconciliation for lost submission acknowledgements. All changes listed above are merged into `develop`; the remaining work is separately authorized TESTNET acceptance. PR-specific CI claims must be verified against each exact final PR head; historical green runs do not certify later commits.
>
> The startup audit is a required evidence gate: both full balances and account-wide open orders must be durably journaled before market subscriptions or trading-engine activation. Existing open orders are recorded as external/unowned but do not make the audit a trading-startup rejection. Broader Journal delivery remains asynchronous during trading; Journal is not trading-state authority.
>
> **The remaining critical milestone is joint Binance Spot TESTNET validation.** Offline CI is not exchange acceptance. Follow [TESTNET_VALIDATION_RUNBOOK.md](./docs/TESTNET_VALIDATION_RUNBOOK.md); keep Harvester stopped during preparation. No order submission/cancellation or account-setting change is authorized until the operator and assistant explicitly begin the joint session.
>
> The historical twelve-BUY incident is established: twelve distinct 400 DOGE BUYs at 0.07598 USDT (4,800 DOGE / 364.704 USDT gross), client IDs `h-DOGEUSDT-32` through `h-DOGEUSDT-43`, all TAKER. The confirmed race was FILLED acknowledgements preceding canonical fill application. The merged engine awaits full execution reconciliation before releasing the serialized transition; offline regression coverage includes twelve sequential immediate fills and weighted execution-price references. TAKER execution alone does not explain the repeated BUYs.
>
> Actual TESTNET commission amounts/assets must be reconciled per trade. Historical fills reporting zero commission remain zero; never retroactively apply the later 0.1% setting. Existing account inventory (previous baseline: 517 non-zero assets, including 12,321 free DOGE) is not Harvester-owned by default.
>
> Older sections below are historical implementation notes. Where they conflict with this current post-merge status, follow this notice and the final handoff section at the end of this roadmap.

## Conservative domain rule extraction — PR #653

The Conservative policy now delegates its core state predicates to
`src/domain/strategies/conservative/helpers.js`. Each predicate has
a focused deterministic unit test in `helpers.test.js`; the policy
continues to own intent calculation and order economics, while the trading
engine continues to own broker lifecycle and I/O.

This is an internal organization change only. The canonical behavior contract
remains [CONSERVATIVE_DOMAIN_SPECIFICATION.md](./docs/domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md);
no strategy behavior change or TESTNET acceptance is claimed. The focused
tests and full Harvester suite still require execution on the exact PR head.

## Future improvements — planned, not implemented

These items are intentionally recorded for future work. They are not current trading requirements, do not block the Conservative strategy, and must not be implemented as part of unrelated work without selecting them explicitly.

### C. Consolidated trading-session statistics

- [ ] Design and implement a clear per-session/per-market trading report using confirmed, deduplicated fills and actual commission amounts/assets as the source of truth.
- [ ] Report total BUY/SELL quantities and quote values, actual commissions by asset, total invested quote, recovered net proceeds, remaining recovery amount, and realized net profit.
- [ ] Report retained/free inventory separately from active strategy inventory, including any exchange-constrained dust.
- [ ] Show current/open order status and partial execution quantities without treating unfilled orders as executions.
- [ ] Keep calculations consistent with Portfolio and RecoveryLedger; do not introduce a second accounting source or mutate trading state for reporting.
- [ ] Provide a readable CLI/session summary first; decide on export/persistence only when that work is selected.

### D. Optional Telegram notifications

- [ ] Integrate Harvester with the existing @coinzilla/notifiers package for optional Telegram notifications.
- [ ] Define a small allowlisted set of useful operational events (startup/connection status, trading pause or safety halt, order/fill lifecycle milestones, and shutdown) before implementation.
- [ ] Keep notification delivery asynchronous and isolated: missing credentials, Telegram outages, formatting errors, or subscriber failures must never block order handling, accounting, startup readiness, or shutdown safety.
- [ ] Reuse existing notifier and event-bus contracts; do not add Telegram SDK logic to Harvester domain/use-case code or duplicate the notifier package.
- [ ] Define configuration, credential handling, message content, and tests when this feature is selected. Notifications remain disabled unless explicitly configured.
## Current work selection

- [~] Close the 2026-11-07/08 session follow-up: account-integrity halt leaving an owned BUY live is fixed in [PR #669](https://github.com/45s/coinzilla/pull/669); configured-asset snapshot correction is implemented in [PR #670](https://github.com/45s/coinzilla/pull/670). Tracking issue: [#667](https://github.com/45s/coinzilla/issues/667); evidence: [AUDIT.md session report](./AUDIT.md#2026-11-0708-binance-spot-testnet-session-audit--issue-667).
- [~] Graceful shutdown: cancel acknowledged `CG_coinGrabber` BUY orders only, preserve all SELL orders, keep user-data intake active through cancellation/fill reconciliation, and retain the existing CLOSING audit/process-lock guarantees. Tracking PR: [#663](https://github.com/45s/coinzilla/pull/663).
- [x] Account-integrity safety halt: after an unowned/invalid execution or accounting failure closes global readiness, reconcile Harvester-owned order identities and cancel only acknowledged BUY orders; preserve SELLs and external orders; keep the gate closed if any cancellation/fill reconciliation is unresolved. Tracking incident [#667](https://github.com/45s/coinzilla/issues/667), implementation PR [#669](https://github.com/45s/coinzilla/pull/669).

The former blanket TESTNET acceptance gate is removed. Explicitly selected Harvester work may proceed independently of TESTNET acceptance. Issue [#650](https://github.com/45s/coinzilla/issues/650) is the active Journal evidence workstream.

Trading safety requirements remain in force: live trading stays disabled unless explicitly authorized; TESTNET-only runtime protections, exact-order ownership, and the existing mandatory Journal durability barriers must not be weakened. Journal evidence beyond those barriers is bounded, allowlisted, and best-effort. Journal is not trading-state authority. Replay and process-restart recovery remain disabled unless separately requested.

## Strategy-scoped trading configuration

- [x] Keep Harvester configuration under `strategies.CG_coinGrabber`, including the strategy enabled flag, settings, and all market pairs.
- [~] Keep Conservative and Aggressive mode toggles under `CG_coinGrabber.settings`; Conservative remains enabled and Aggressive remains disabled/deferred.
- [~] Update runtime consumers, validation/bootstrap tests, and configuration documentation together.

## Journal evidence workstream

Issue [#650](https://github.com/45s/coinzilla/issues/650) is active independently of TESTNET acceptance. Expand investigation evidence within the bounded, allowlisted, best-effort contract in [JOURNAL_EVIDENCE_CONTRACT.md](./docs/JOURNAL_EVIDENCE_CONTRACT.md). Keep Journal replay and process-restart recovery disabled unless separately requested.

## Mission and delivery priority

**Mandatory execution order:** follow [Trading First](./docs/TRADING_FIRST.md). The first deliverable is a working Conservative TESTNET trading loop. Journal, durable persistence, comprehensive restart recovery/reconciliation, operational hardening, and Aggressive are secondary; do not make them blockers for the first working cycle. Implement only the minimum safety needed for a controlled TESTNET order flow.

**First priority: implement Conservative and make Harvester execute a complete, safe, repeatable trading cycle.** The Harvester-owned Conservative Domain Specification is the source of truth. Implement the strategy through Harvester's own domain and application boundaries. Strategy availability is configured in `trading-config.json`: Conservative is enabled and Aggressive remains disabled until Conservative is working end to end on TESTNET. Architecture expansion, optional features, and optimization come after that.

The paragraph below was an earlier audit snapshot and is superseded by the current implementation status and checklist in this roadmap. On `develop`, Harvester now composes the Conservative trading engine when TESTNET trading is explicitly enabled, submits strategy intents through the engine, tracks owned orders, processes canonical fills, updates Portfolio/RecoveryLedger, and has fake-broker coverage for a complete recovery cycle. A real Binance TESTNET cycle is still unverified; do not treat the offline simulation as exchange proof.

### Definition of "Harvester can trade"

The Conservative runtime supports multiple explicitly enabled TESTNET pairs. Each enabled market is validated and subscribed independently; per-market strategy state is isolated while account-level asset balances and active-order commitments are shared by canonical asset identity. Multi-pair TESTNET acceptance still requires dedicated regression and exchange evidence.

A first-trading release is not complete until a TESTNET end-to-end scenario demonstrates:

1. Start from the documented command and load/validate configuration.
2. Connect to the selected broker and establish market-data and user-data streams.
3. Load account balances and exchange trading rules for every enabled pair.
4. Establish the minimum safe TESTNET starting state: fresh balances and exchange filters for enabled pairs and a known price. External inventory and orders remain unowned and are not silently adopted; a clean account is recommended for a controlled first-cycle run but is not a startup prerequisite. Comprehensive historical reconciliation and durable restart recovery are deferred.
5. Receive a valid market update and evaluate the selected executable strategy.
6. Convert the strategy decision into a validated order intent.
7. Apply shared risk, balance, reservation, precision, minimum-notional, and post-only checks.
8. Submit the order and track its acknowledgement or an unknown outcome.
9. Receive order updates and every partial/final fill; normalize, deduplicate, and account for actual quantities and commissions.
10. Re-evaluate the strategy from the latest consistent market, order, and Portfolio state and continue the cycle.
11. Pause new orders safely on disconnect, stale data, unknown order outcomes, unsupported commission, balance/risk violations, or other immediate execution hazards; resume only after the affected live state is refreshed and understood.
12. Shut down cleanly and do not report in-flight orders as completed. Durable restart recovery is a later hardening milestone.

Live trading must remain explicitly disabled by default. TESTNET verification is required before any live-trading enablement.

## Runtime entrypoint hardening — current task

- [x] Remove public `runtime.placeOrder` and `runtime.broker` escape hatches.
      The broker port remains private to bootstrap and the Conservative engine;
      runtime consumers cannot submit orders outside the engine workflow.
- [x] Report the actual startup mode: Conservative TESTNET trading enabled,
      broker-connected read-only, or configuration-only/no broker.
- [x] Add regression coverage for startup messages and the absence of public
      broker/order-submission methods.
- [x] Update the README and agent delivery rules in the same implementation
      commit as the code and tests.
- [ ] Run Harvester tests and repository CI on the PR head; do not treat source
      inspection or a successful GitHub write as test verification.

This hardening does not change strategy decisions or claim a successful real
TESTNET cycle. The next proof remains a controlled Binance TESTNET run.

## Current branch implementation status

The current task branch has progressed beyond the initial `develop` audit described
below. The following first-cycle components are now implemented and composed
when `HARVESTER_ENABLE_TRADING=true`:

- Conservative pure policy: initial/standing BUY and recovery SELL intents,
  exact tick/step rounding, duplicate suppression, partial-fill wait behavior,
  configured pair-investment limit, exchange-fee-aware recovery planning.
- Submission: local PENDING canonical order registration, exchange-rule
  validation, broker submission, canonical acknowledgement verification, and
  unknown-outcome pause behavior.
- In-process lifecycle: market prices invoke the policy; only registered
  Harvester orders are accepted; canonical TRADE fills update Portfolio and
  RecoveryLedger; terminal full fills trigger the next decision.
- Recovery completion: a fully filled SELL must satisfy the actual cumulative
  net-profit condition and leave at least `keepQuantity`; the retained amount
  moves to free inventory and the cycle ledger resets.
- Startup: explicit TESTNET trading opt-in, one or more enabled pairs, a fresh
  initial canonical account snapshot covering every enabled market's assets. External open orders and pre-existing
  inventory are not adopted; order checks use in-process cash flow, owned
  position quantity, and outstanding commitments. The default config enables
  `ZROUSDT` and `DOGEUSDT`; FDUSD pairs remain disabled.

Offline bootstrap coverage simulates the complete first recovery cycle:
initial BUY → actual full BUY fill → next BUY and recovery SELL → actual full
SELL fill → profit check → free-inventory allocation. This is a fake-broker
simulation, not evidence of exchange behavior by itself. Real Binance TESTNET
executions have since been observed, including a completed recovery SELL, but
the same run exposed rapid BUY re-submission and an invalid post-cycle
MIN_NOTIONAL intent. Reservations and the safe repeatable TESTNET acceptance cycle remain unfinished. Durable Journal replay/restart recovery is intentionally disabled and is not a blocker. Do not mark the first trading
milestone complete until the incident fixes, reconciliation, and required CI
checks pass.



## Automated TESTNET startup account audit

- [x] On every trading-enabled startup, fetch the full exchange account balance snapshot and durably journal the OPENING account event before the trading engine is activated.
- [x] Fetch open orders account-wide (`getOpenOrders({})`, no symbol filter), normalize the complete order facts into an allowlisted Journal event, and durably flush it before market subscriptions.
- [x] Fail closed if the open-order query is unavailable/malformed or any pre-existing open order is present. Do not adopt or cancel orders; restart ownership recovery is not implemented yet.
- [x] Add DTO and bootstrap regressions for full order facts, empty-account READY, pre-existing-order BLOCKED, and no market subscription/order activation after a block.
- [ ] Verify Harvester tests and repository CI on the feature branch.
- [ ] After merge, the user only needs to start Harvester; no repeated manual balances/orders output is required. Inspect the Journal automatically for account baseline and open-order audit results.



## Standalone read-only TESTNET account preflight

- [x] Add `pnpm run testnet:audit` to query account balances and account-wide open orders through the Binance WebSocket API without starting Harvester.
- [x] Journal and durably flush both account events with phase `PREFLIGHT`; keep the normal Harvester startup gate using phase `OPENING`.
- [x] Return READY when there are no open orders and BLOCKED (exit code 2) when any pre-existing order is found; never submit or cancel orders.
- [x] Add offline tests for full balance/order capture, blocked and ready results, TESTNET-only environment validation, query failure, and resource cleanup.
- [ ] Verify the standalone audit command and full repository CI on this PR head.

## P0 — Deliver the first working trading cycle

Work through these items in dependency order. Keep the scope limited to what is necessary to execute and verify the first strategy safely.

### P0.1 — Conservative strategy contract and implementation

- [x] Select Conservative as the first executable strategy; Aggressive remains deferred.
- [x] Establish one authoritative strategy contract: [CONSERVATIVE_DOMAIN_SPECIFICATION.md](./docs/domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md).
- [~] Align domain policy, application order lifecycle, configuration validation, and regression tests with that canonical contract.
- [ ] Complete repository-wide documentation consolidation; no active competing Conservative rule definitions may remain.
- [ ] Pass the focused regression matrix and all required exact-head CI checks before acceptance.
- [ ] Keep PR #653 open and unmerged until acceptance criteria pass and the owner explicitly authorizes merging.

### P0.2 — Trading rules, account state, and startup readiness

- [x] Load and validate exchange symbol filters for enabled markets: price tick, quantity step, min/max quantity, min/max notional, and supported order types. POST-ONLY orders require fresh best-bid/best-ask data and validate BUY below best ask / SELL above best bid at both submission gates; missing/stale/crossed books defer broker I/O. Binance Spot's exact definite POST-ONLY rejection is handled without pausing, while other/unknown failures remain fail-closed.
- [x] Normalize broker filters into a stable Harvester-owned domain/application shape; do not leak exchange SDK payloads.
- [~] Load account balances and distinguish free, locked, and total balances. A canonical free/locked account snapshot is loaded and checked for every enabled-market asset; in-process allocation aggregates Harvester-owned inventory and active commitments by canonical asset ID. Periodic account refresh and external account-change reconciliation remain.
- [x] Enforce configured per-pair investment against available quote balance while coordinating shared quote assets across enabled pairs (e.g. multiple USDT markets) through the exact-decimal allocator.
- [x] Seed Conservative TESTNET market state after subscribing: use the existing Binance `ticker.price` request/response snapshot when no fresh aggregate-trade event arrived during startup. Reject invalid snapshots, fail startup when neither source provides a usable price, and reject WebSocket prices older than 5 seconds (or more than 1 second in the future). Enforce cached-price freshness at both order-submission gates, including after PENDING registration and before each action in a multi-order decision; defer broker I/O when the price expires.
- [x] Subscribe to user-data events and surface connection status. Startup uses one canonical account snapshot and known enabled-pair filters. External inventory/orders remain unowned; a clean account is a controlled-test recommendation, not a launch gate. Disconnect/recovery and unknown outcomes remain fail-closed; comprehensive history reconciliation is deferred.
- [x] Implement minimum process readiness for the first TESTNET cycle. When trading is explicitly enabled, startup requires TESTNET mode, at least one enabled pair, exchange rules for every enabled market, an active user-data stream, and a fresh account snapshot covering every enabled market's assets. External open orders and inventory are not adopted or treated as a startup prerequisite. Read-only broker mode remains available; genuine reconnect/reconciliation requirements still fail closed.
- [x] Enable the first TESTNET order only after explicit `HARVESTER_TRADING_MODE=testnet`, non-production NODE_ENV, validated config, enabled-pair exchange filters, fresh account snapshot, and active user-data stream. The policy prevents a new BUY from taking outstanding recovery capital plus its quote notional beyond the configured pair investment. Before submission the engine checks BUY quote notional against snapshot free quote adjusted by actual quote cash flow and active BUY commitments; SELL quantity is capped by Harvester-owned active base inventory and available free base after active SELL commitments. A balance-limited BUY is deferred while a valid recovery SELL may still proceed.
- [~] Validate environment/config combinations; explicit trading opt-in now fails startup unless `HARVESTER_BROKER=binance` is selected, and the existing TESTNET/non-production gates remain enforced. Review remaining mode/config combinations before declaring this item complete.
- [x] Validate enabled pair configuration against exchange assets/filters at startup: `orderQuantity` is rounded down by the actual base-asset step and checked against supported min/max quantity; quote-asset `investment` is checked against minimum notional. The symbol must match the exchange market metadata. Actual price/quantity/notional validation remains at order submission.

### P0.3 — Order intent, safety checks, and reservations

- [~] Define canonical Harvester order intent/command contracts using existing `@coinzilla/entities` types wherever suitable. `createPendingCanonicalOrder` builds immutable PENDING canonical orders; the complete engine command contract and lifecycle integration remain.
- [~] Implement pure order construction and validation functions for price/quantity precision, tick/step rounding, min/max quantity, min/max notional, and post-only constraints. `validateOrderAgainstTradingRules` enforces exchange increments and supported price/quantity/notional bounds with exact decimal arithmetic. Fresh book-based POST-ONLY crossing validation is enforced at both submission gates; complete order construction wiring and other runtime checks remain.
- [~] Implement shared pre-trade safety checks: enabled pair and READY state are enforced at runtime; fresh price/book, available quote/base, pair investment headroom, and active-order commitments are enforced by the engine and exact-decimal allocator. The Conservative engine aggregates quote cash flow, owned base inventory, and active BUY/SELL commitments across markets by canonical asset ID. Periodic account refresh/external account-change detection, generalized per-pair risk policy, and strategy takeover remain open.
- [x] Implement in-process BUY quote and SELL base reservations using active canonical orders as the reservation source. The engine registers PENDING before broker I/O and derives remaining commitments from PENDING/OPEN/PARTIALLY_FILLED/UNKNOWN orders; confirmed fills reduce the remaining order quantity while Portfolio/RecoveryLedger apply actual execution facts.
- [x] Use canonical order lifecycle states as reservation states rather than introducing a parallel reservation entity. PENDING, OPEN, PARTIALLY_FILLED, and UNKNOWN retain commitments; confirmed terminal states release the unfilled remainder, while late FILLED updates remain reconcilable.
- [x] Register each PENDING canonical order before broker submission and serialize market/order/fill/cancellation transitions. Unknown submission or cancellation outcomes remain active/paused until authoritative reconciliation; commitments are not released on an unconfirmed outcome.
- [x] Allocate each decision's order intents sequentially against remaining quote balance, pair investment headroom (outstanding recovery plus active BUY commitments), exchange-available base, and Harvester-owned active base. The allocator rejects an overcommitted SELL batch before any broker write and defers BUY intents that exceed remaining quote or investment headroom. Regression tests cover aggregate BUY and SELL intents.
- [~] Treat timeout/disconnect during place/cancel as UNKNOWN, not failed; the current process keeps the order commitment and pauses without retrying. During same-process recovery/shutdown, Harvester looks up a broker-acknowledged order by its original clientOrderId, attaches only a matching brokerOrderId, then reconciles canonical order history and actual fills. If lookup/history/fills are incomplete or conflict, the order remains UNKNOWN and the pair stays paused. Durable Journal-backed registry recovery after process restart remains unimplemented; the runbook requires abort/stop and operator investigation rather than restart.
- [~] Generate Binance-compatible client order IDs with a per-executor 88-bit random namespace and monotonic local sequence. Same-process client-ID lookup now reconciles a lost acknowledgement without retrying. Durable restart recovery, idempotent retries, and automatic resume remain unfinished.
- [x] The Conservative cancellation/replacement paths await broker confirmation, reconcile fills that raced with cancellation, and calculate replacement quantities from the reconciled Portfolio/RecoveryLedger. Deterministic engine regressions cover BUY and recovery-SELL cancellation/fill races.
- [x] Unknown submission/cancellation outcomes pause the affected pair and are not blindly retried. Same-process lost-ack reconciliation uses canonical lookup by clientOrderId followed by canonical order history and fill verification. Durable restart recovery and automatic resume remain deferred.

### P0.4 — Live order and fill lifecycle

- [x] Normalize user-data order/execution events at the broker adapter boundary. Binance TRADE execution reports are converted into canonical `Fill` entities using cached symbol metadata; non-trade order events remain normalized broker events. Normalization failures now include execution context and close the user-data trading gate.
- [x] Normalize actual fills with stable execution IDs, market, side, executed base and quote quantities, timestamps, and exchange-charged commission amount/asset. Missing/invalid execution IDs and incomplete fee facts fail closed.
- [x] Reject malformed or incomplete fills visibly; validate aggregate base/quote commission bounds and surface Binance normalization failures with an actionable pause reason. Third-asset commission quote valuation or fail-closed behavior is defined in the canonical specification and remains an implementation verification item.
- [x] Deduplicate fills using stable exchange execution identity and conflicting-fact fingerprints; serialize user-data event handling and Portfolio/RecoveryLedger updates in process memory. Fingerprint tests cover every mutable canonical execution fact and commission-entry order. Durable deduplication is explicitly deferred; it is not a P0.4 prerequisite.
- [x] **Verify order ownership before accounting:** the in-process engine applies updates only to orders registered with Harvester; unknown/manual executions pause only the affected pair and are not accounted. Deterministic multi-market tests cover cross-pair isolation, duplicate fills, and stale out-of-order order updates.
- [x] Handle NEW, PARTIALLY_FILLED, FILLED, CANCELED, REJECTED, EXPIRED, and exchange-specific terminal/unknown states. Adapter mapping, engine wait/pause/reevaluation behavior, and late FILLED-after-EXPIRED races have deterministic offline coverage.
- [x] Apply only incremental actual executions to shared Portfolio and Conservative RecoveryLedger in one immutable use-case transition; never apply requested order quantity or cumulative executed quantity twice. Regression coverage proves a rejected wrong-market fill cannot commit only the Portfolio projection.
- [x] Expose canonical per-order REST history through the Harvester broker port. The application-owned broker port and Binance adapter forward the existing broker package's `CanonicalOrder[]` capability; reconnect-time reconciliation is tracked in the next item.
- [x] Reconcile REST trade history/open orders with stream events to cover disconnect gaps and out-of-order delivery. After stream-level recovery, bootstrap reads REST snapshots without blocking stream events, drains events received during those reads, then applies reconciliation of only in-memory owned orders in the serialized engine queue. It validates complete cumulative fill quantities, rejects REST history behind stream-updated order state, and requires every previously processed stream execution ID to appear in REST history before applying missing fills through the existing idempotent accounting path. Incomplete/conflicting REST state keeps the market paused and trading gate closed. External/manual orders are never adopted. Durable restart and balance reconciliation remain deferred.
- [x] Reconcile completed recovery SELL execution history before cycle completion: distinct actual fill quantities must equal both executed and original order quantity; missing/incomplete history pauses before free-inventory allocation or ledger reset.
- [x] Ensure cancel/fill races, duplicate events, late events, and out-of-order events cannot double-count fills or release commitments prematurely. BUY and recovery SELL cancellation fill races, duplicate events, and stale out-of-order reports have deterministic offline coverage. Active canonical order commitments remain until authoritative lifecycle/fill reconciliation; late FILLED updates remain reconcilable.
- [x] Feed successful fill/order transitions back into strategy evaluation. The engine emits a reevaluation outcome after a reconciled terminal full fill; bootstrap runs that evaluation from the serialized user-data event flow and deliberately waits after partial fills.
- [x] Ensure a completed BUY transition immediately evaluates and submits required orders without waiting for another market-price event.

### P0.5 — Trading Engine orchestration

- [x] Implement the first in-process Conservative trading workflow. `makeConservativeTradingEngine` connects market prices to the pure policy, order registry, validated broker submission, canonical order updates, ownership checks, fill accounting, and immediate reevaluation after terminal order updates. Bootstrap composes the user-data callback and account-readiness gate; in-process order-backed quote/base commitments are derived from active canonical orders. Durable restart and periodic account reconciliation remain separate work.
- [~] Inject strategy decision evaluation and trailing-BUY repricing through a broker-independent policy object composed by bootstrap. The engine no longer imports Conservative policy calculators; Conservative-specific order lifecycle sequencing remains in the engine and is not yet generalized.
- [~] Only the Conservative policy is currently composed for execution and startup rejects Aggressive enablement, so one strategy controls the first pair. A generalized strategy-ownership/takeover registry remains deferred.
- [x] Serialize concurrent market-price, book, user-data/order, fill, cancellation, and reconciliation transitions through the engine's process-local transition queue; bootstrap also serializes accepted user-data delivery. Deferred-promise regressions cover pending acknowledgements, cancellations, and concurrent market updates.
- [~] Enforce market-price and book freshness at evaluation and both submission gates, serialize transitions, and reconcile owned order/fill state before resuming. The startup account snapshot is not periodically refreshed for external account activity; the controlled one-pair run forbids manual account changes, and comprehensive account reconciliation remains open.
- [ ] Handle strategy takeover as a controlled workflow: stop outgoing intents, reconcile/cancel relevant orders, account for in-flight fills/reservations, then activate the incoming strategy.
- [~] Startup failure cleanup, process shutdown, and user-data recovery gates are observable and covered. Reconnect does not reopen trading until authoritative order/fill reconciliation succeeds; generalized pause/resume and durable restart recovery remain incomplete.
- [~] Replace the current price-only callback flow with the actual decision-to-order execution pipeline. A tested application use case now converts pure Conservative intents into registered, exchange-rule-validated broker submissions; bootstrap composition and event-driven lifecycle integration remain.
- [x] Do not expose `runtime.placeOrder` or `runtime.broker`; all order submission remains private to the composed Conservative engine and its broker port.

### Separate deferred workstream #654 — Persistence, restart, and comprehensive recovery (outside this audit)

- [ ] Decide the minimum durable state required before enabling unattended trading: orders/client IDs, fills/deduplication IDs, reservations, Portfolio/Position, strategy control state, and relevant configuration/version.
- [ ] Integrate the already available shared Journal read/replay capability into Harvester's domain-specific durable state. This is deferred until after the first successful TESTNET trading cycle; do not implement it as a prerequisite.
- [ ] Persist execution facts before acknowledging successful processing/recovery.
- [ ] On startup/reconnect, reconcile persisted state against exchange balances, open orders, and available order/trade history before READY.
- [ ] Define behavior when exchange history is incomplete, retention-limited, or conflicts with local state; fail closed and require operator intervention where safe reconciliation is impossible.
- [ ] Test crash/restart at each order/fill transition and ensure no duplicate order or fill application.
- [ ] Do not claim exactly-once delivery; guarantee idempotent accounting through durable execution identity and reconciliation.

### Historical P0.7 — First strategy end-to-end verification (superseded status; evidence only)

- [x] Verify Conservative recovery SELL quantity/price rounding against actual base/quote commission fills at quantity-step, price-tick, and exact minProfit boundaries. Tests assert post-fill active inventory and realized net profit using exact decimal strings.

- [~] Add deterministic offline strategy-policy scenarios for initial BUY, duplicate suppression, combined standing BUY/recovery SELL intents, and missing exchange rules. Full broker-port lifecycle simulator scenarios remain.
- [ ] Add opt-in Binance TESTNET integration tests that place and cancel small, bounded test orders only when explicitly enabled.
- [~] Add a bootstrap-level TESTNET-mode fake-broker test that starts with a clean one-pair account, submits the initial Conservative BUY, applies its canonical full fill, and immediately submits the next BUY plus recovery SELL. The fake-broker bootstrap scenario now exercises the full first recovery cycle through BUY fill, simultaneous next BUY/recovery SELL placement, SELL fill, profit verification, and allocation of configured free inventory. A real Binance TESTNET run remains; the README now contains the controlled runbook, clean-account prerequisites, shutdown/restart warning, and expected order sequence.
- [ ] For end-to-end proof, exercise multiple enabled TESTNET pairs, including markets sharing quote assets and markets sharing base assets. Verify per-pair investment limits, account-level commitments, order/fill isolation, and that no pair can spend balances reserved by another.
- [~] Offline coverage verifies pre-submit quote/investment/base budget enforcement, min-notional and precision validation, fresh-book POST-ONLY crossing checks, stale price/book deferral, stream-loss trading gates, and unknown-outcome pause/no-retry behavior. Real Binance rejection, timeout, and recovery behavior remains NOT OBSERVED until the controlled TESTNET session.
- [ ] Verify loss protection and Conservative takeover do not force a loss-making sale or operate the same Position concurrently.
- [~] Provide a documented, reproducible TESTNET runbook and evidence for the first successful cycle. The runbook exists; a full recovery SELL fill and `recovery.cycle_completed` are now evidenced, but the same run exposed a rapid-BUY burst and a post-cycle MIN_NOTIONAL failure. A safe next-cycle BUY and repeatable cycle are not verified.
- [ ] Keep live trading disabled until the user explicitly approves a separate live-trading milestone after TESTNET evidence is reviewed.

## P1 — Implement Aggressive after Conservative is proven

- [x] Disable Aggressive at runtime with `HARVESTER_ENABLE_AGGRESSIVE=false`; reject startup if an attempt is made to enable it. Conservative is the only default evaluator and the only strategy composed for order execution.

Aggressive work must not delay P0. Start this phase only after Conservative has completed and passed the documented TESTNET end-to-end cycle.

- [ ] Review the remaining Aggressive decisions in [Trading Strategies](./docs/trading-strategies.md), ask one plain-language product question at a time, and update the specification before implementing unresolved behavior.
- [ ] Implement the Aggressive policy as plain pure domain functions that return order intents; do not copy broker/runtime code from another app.
- [ ] Implement exactly one BUY grid per market, with all configured BUY levels placed together when the cycle starts.
- [ ] Preserve the agreed grid math: lower BUY levels remain fixed percentages from the grid reference; upward repricing steps compound from the previous level and advance only by fully crossed steps.
- [ ] Implement per-BUY-order cumulative fill thresholds: create a separate SELL only after that BUY order is more than 50% filled and eligible unreserved quantity is worth strictly more than $5 USD equivalent; otherwise wait for full fill or more quantity.
- [ ] Implement multiple independent SELL orders against one shared Position, with explicit reservations so the same base quantity cannot be sold twice.
- [ ] Implement the agreed partial-SELL threshold for considering a new BUY, including duplicate-trigger prevention.
- [ ] Implement risk fallback to Conservative when either the investment limit or maximum price-drop limit is reached: stop new BUYs, cancel/reconcile all active orders, and consolidate remaining inventory into one Conservative SELL without forcing a loss.
- [ ] Add deterministic domain tests for grid construction/repricing, partial fills, reservations, cancel/fill races, risk fallback, and strategy handover.
- [ ] Verify Aggressive end to end on TESTNET using the same shared Trading Engine, Portfolio, order lifecycle, and safety gates as Conservative.
- [ ] Add strategy-specific statistics only after shared Position accounting and attribution semantics are stable.

## P2 — Operational hardening and improvements

- [ ] Complete the staged operational Journal integration described in [Journal Integration Roadmap](./docs/JOURNAL_INTEGRATION_ROADMAP.md). It can proceed independently of trading/TESTNET work; implement exactly one small PR per step. Journal must never block application startup, broker connectivity, or trading.
- [ ] Add actionable health/status reporting for process and each pair without exposing credentials or raw exchange payloads.
- [ ] Add bounded reconnect/backoff, timeouts, stream liveness/staleness detection, and resource cleanup tests.
- [ ] Add operator controls for pause/resume/stop and safe behavior when a pair is disabled while orders or inventory exist.
- [ ] Add alerts for unsafe states, rejected orders, reconciliation discrepancies, unsupported commissions, and repeated broker failures.
- [ ] Add performance optimization only after profiling a correct end-to-end implementation.
- [ ] Review dependency/security findings and shared package contracts as part of regular maintenance.

## Historical audit snapshot (superseded by the current implementation status above)

### Implemented and verified by source inspection

- [x] Node.js ESM workspace app, package scripts, config loader, and structural config validation.
- [x] Opt-in Binance adapter and Harvester-owned broker port.
- [x] Broker connect/disconnect lifecycle and cleanup of partially-created price subscriptions.
- [x] Enabled-pair aggregate-trade price subscriptions and incoming market-price validation.
- [x] Default Aggressive policy composition and handoff of validated prices plus the latest in-memory Portfolio.
- [x] Canonical Fill-driven in-memory Position/Portfolio transitions with base/quote commission accounting and process-lifetime duplicate-ID protection.
- [x] Application use cases for place-order, process-market-price, and update-portfolio.
- [x] Shared decimal helper reuse and shared default logger usage.
- [x] Offline tests exist for bootstrap, broker port/adapter, config, market price, strategy blocker behavior, order use case, and Portfolio transitions.

### Confirmed blockers / gaps found in the audit

- [ ] **No executable strategy:** `evaluateAggressiveStrategy` always returns `NO_ACTION`; no order intent is produced.
- [ ] **No engine:** market-price processing returns a decision but does not pass it into safety validation, order planning, or order submission.
- [ ] **Order use case is disconnected:** `placeOrder` is composed and exposed by runtime but is not invoked by the strategy/price workflow.
- [~] **User-data processing is only partially wired:** bootstrap subscribes to the stream, but actual execution events still need to be connected to canonical Fill accounting and the next strategy evaluation. Do not require full REST history reconciliation for the first clean TESTNET cycle.
- [~] **Incomplete account/rule readiness:** enabled-market symbol filters and a canonical account snapshot are loaded and validated, but minimum per-order balance checks and clean TESTNET starting-state validation still need wiring. Comprehensive reconciliation is deferred.
- [ ] **No current-price seed/staleness policy:** strategy only receives stream trade-price events; no REST snapshot initializes price or protects against stale data.
- [ ] **Portfolio is incomplete for strategy execution:** current Position stores net base quantity and signed quote cash flow only. It does not yet provide the agreed invested quote, average cost, realized profit, free/retained quantity, reserved inventory, or available inventory calculations.
- [ ] **No complete order lifecycle:** active-order tracking, stable client order IDs, and order-to-fill coordination must be wired into the trading loop; implement the minimum in-process form needed for the first TESTNET cycle.
- [ ] **No reservations:** open/uncertain BUY quote and SELL base commitments are not represented or enforced.
- [x] **Cross-pair balance allocator:** the Conservative engine aggregates quote cash flow, owned base inventory, and active BUY/SELL commitments across markets by canonical asset ID. Dedicated multi-pair concurrency and TESTNET acceptance evidence remains required.
- [~] **Durable persistence not integrated:** Journal now provides bounded read/replay with stable record IDs, but Harvester does not yet persist/replay its Portfolio, RecoveryLedger, order lifecycle, reservations, or applied execution identities; restart still loses those states.
- [~] **No comprehensive reconciliation:** historical execution reconciliation and durable restart reconciliation are not implemented; these are deferred. The first cycle still needs a known clean TESTNET starting state and a targeted refresh after disconnect/unknown order outcomes.
- [~] **Incomplete readiness/pause state:** minimum TESTNET readiness and safe pause-on-disconnect/unknown-outcome behavior must be connected to order submission; a broader state machine and operator controls are later hardening.
- [ ] **No complete operational journal:** lifecycle/decision/fill audit trail and operator-facing pause/recovery visibility are not implemented.
- [ ] **No end-to-end trading test:** current offline tests validate components, not a complete market-to-order-to-fill-to-next-decision cycle.
- [ ] **Live/testnet mode is not an explicit trading safety gate:** broker package environment behavior must be surfaced and verified by Harvester; live order submission must require an explicit opt-in separate from merely configuring a broker.
- [ ] **Startup does not reject an enabled pair because its exchange rules or balances are unavailable:** those prerequisites are not loaded yet.

## Product and architecture decisions already recorded

- [x] Harvester is an independent Node.js process with shared engine and strategy-specific policies.
- [x] Domain, application use cases, infrastructure adapters, and bootstrap have explicit responsibilities.
- [x] Meaningful deterministic calculations and decisions MUST be plain pure functions in focused modules.
- [x] Classes are for domain concepts that own state and protect invariants (e.g. Fill, Position, Portfolio).
- [x] Use cases are dependency-injected functions; strategies decide and never perform broker I/O.
- [x] Harvester owns its application-facing broker port and adapts `@coinzilla/brokers`.
- [x] One shared Position per market; Conservative and Aggressive share accounting but only one controls the pair at a time.
- [x] Confirmed canonical fills, including exchange-charged commissions, are the only source of Portfolio holdings changes.
- [x] Third-asset commissions require reliable quote valuation or fail-closed handling; see the canonical Conservative specification.
- [x] BUY prices round down and SELL prices round up to exchange tick rules.
- [x] Live exchange tests are opt-in and TESTNET-only; default tests never need credentials or network access.
- [x] Use shared `@coinzilla/utils` decimal functions and `defaultLogger`; do not duplicate generic utilities or call global console from Harvester.

## Open product decisions

- [x] Conservative owner decisions are closed and recorded in the canonical specification. No additional Conservative product decisions are pending.
- [ ] Finalize shared application reservation timing/release rules for submitted, partially filled, cancelled, rejected, expired, and uncertain orders; do not duplicate Conservative strategy policy.
- [ ] Finalize cross-pair account balance allocation and quote-asset contention behavior.
- [ ] Implement optional operational journaling as a separate observability task; no successful TESTNET cycle is required. Separately decide whether Journal read/replay should later participate in durable Harvester state/restart recovery. The staged operational event-journal plan does not implement replay or restart recovery.
- [ ] Decide whether strategy-specific P/L attribution is required.
- [ ] Decide operator intervention behavior for unreconcilable exchange/local-state discrepancies.

## Delivery rules

- Follow repository root guidance and `apps/harvester/AGENTS.md`.
- Work from `develop` using a short-lived task branch and target PRs to `develop`; do not commit task work directly to `develop` or `main`.
- **Mandatory:** follow [Trading First](./docs/TRADING_FIRST.md); implement the next missing step in the actual trading loop before any secondary infrastructure work.
- Keep durable recovery, comprehensive reconciliation, and optimization separate from operational observability. EventBus/Journal lifecycle logging may proceed without waiting for a Conservative TESTNET cycle.
- Do not implement unresolved financial/risk behavior by assumption; close the decision first.
- Do not mark an item complete until implementation, meaningful tests, required checks, and documentation are complete on the target branch.
- Keep live trading disabled by default; TESTNET trading must be explicitly opt-in.
- Report exact checks actually run; source inspection is not runtime verification.

### CI lockfile repair

The 2026-11-02 CI failure was caused by a malformed root importer in
`pnpm-lock.yaml`: after removing the Coin Farmer workspace, two dependency
entries were left indented under the empty root importer. This made the second
pnpm 12 lockfile document invalid YAML and blocked dependency installation,
unit tests, coverage, and audit. The root importer has been restored to the
empty form matching the root manifest; the full CI suite must be rerun on the
updated PR head before treating this repair as verified.


## Historical P0.7 implementation record — superseded by the canonical Conservative specification

### P0.7 implementation progress — CI passed; local TESTNET startup confirmed; awaiting first price

The working branch now contains the first implementation pass. It follows the
existing Conservative strategy order sequence and keeps Harvester's DDD boundaries:

- Ordinary execution reports no longer close the global readiness gate, and
  TRADE fills no longer trigger a full account snapshot.
- Portfolio and RecoveryLedger remain the single in-process accounting source.
  Order checks account for quote cash flow and active BUY commitments; SELL
  quantities are capped by active Harvester-owned inventory and outstanding
  SELL commitments.
- Startup no longer requires zero base inventory or an empty external open-order
  list. External inventory/orders are not adopted as Harvester-owned state.
- Deferred strategy evaluations are retained and can be resumed when readiness
  returns, without waiting for another market-price tick. Readiness is rechecked immediately before broker I/O; if it closes after local PENDING registration, OrderRegistry removes that local record and submission is returned as a deferral without contacting the broker.
- A recovery SELL that is still PENDING is not cancellable. Replacement intent
  is retained until acknowledgement; cancellation continues to require the
  registered broker order ID. Fill history is reconciled after cancellation,
  and delayed non-terminal reports after a confirmed cancellation are treated
  as stale while their fills remain idempotently accounted.
- Regression tests have been added for readiness deferral, pending SELL
  acknowledgement ordering, exact cancellation identity, fill-history
  reconciliation during cancellation, duplicate fill delivery, replacement
  quantity from latest accounting, and no per-TRADE account snapshot.

**Verification evidence so far:** all five GitHub Actions workflows passed on the current PR head; the workspace test workflow reported 1,367 passing tests, including Harvester 298/298, brokers 274/274, and Conservative strategy 313/313. The operator has now confirmed a local Binance Spot TESTNET startup: configuration validated for ZROUSDT, broker connected, exchange rules validated, user-data subscription established, initial account snapshot accepted (517 balances), Conservative engine activated, and the ZROUSDT market-price subscription established. The process log ends in the expected waiting state for a validated market price and user-data readiness. No market-price event, BUY submission, acknowledgement, fill, SELL, or subsequent cycle is evidenced yet. Do not infer a trading failure merely because the market has not emitted a qualifying price; continue observing the running process.

**Still required before acceptance:** observe the first validated price and initial BUY request/acknowledgement; then capture the actual Binance execution reports, Portfolio/RecoveryLedger updates, recovery SELL, SELL fill, and next BUY. Diagnose the first missing/failed transition from those logs only. Local offline test execution remains unreported by the operator; GitHub Actions evidence is recorded above. Inspect the final diff and keep the bounded TESTNET run on Spot TESTNET only. Native Error/cause/AggregateError serialization from PR #462 is retained without a new logging implementation.


**Priority: immediate. This task is about making the existing app trade reliably, not adding another architecture layer.** The latest `develop` includes PR #462 (`fix(harvester): serialize order lifecycle and preserve diagnostics`). Continue from that state; do not repeat already-merged work.

### Historical behavior summary — rules now defined only by the canonical specification

This implementation record is retained for provenance, not as an independent strategy contract. Current BUY/SELL, partial-fill, BUY-during-open-SELL, cancellation/reconciliation, commission, and terminal-order rules are defined exclusively in [CONSERVATIVE_DOMAIN_SPECIFICATION.md](./docs/domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md).

### Scope A — Remove unnecessary execution-readiness barriers

- [x] Trace and remove the per-report readiness reset and per-TRADE account snapshot refresh.
- [x] Verify the order lifecycle against the approved Conservative behavior contract and retain Harvester's canonical Fill/Portfolio/RecoveryLedger boundaries.
- [x] Ordinary TRADE fills update Portfolio/RecoveryLedger without requesting a full account snapshot.
- [x] Remove the broker readiness guard that misclassified local readiness as a broker rejection. `makeExecuteStrategyDecision` rechecks readiness immediately before broker I/O and removes a locally registered PENDING order if submission is deferred.
- [x] Retain deferred symbols and resume their latest evaluation when readiness returns, without another market tick.
- [x] Preserve exchange-rule validation and add free-balance calculations adjusted for actual cash flow, owned inventory, and active in-process order commitments.
- [x] Remove the clean-account/open-order/base-inventory startup prerequisite. The initial canonical snapshot remains for free-balance validation; external inventory/orders remain unowned. Keep the clean-account TESTNET runbook as a controlled-test recommendation, not a runtime gate.
- [x] Keep readiness and deferred evaluation local to the existing bootstrap/engine; no polling, sleeps, or per-TRADE REST reconciliation.

### Scope B — Reconcile recovery SELLs without cancelling PENDING orders

- [x] Trace the recovery SELL submission, BUY-fill replacement path, registry transitions, and acknowledgement callback.
- [x] Keep PENDING SELL orders registered; cancellation explicitly defers while submission is unresolved.
- [x] Store the acknowledged canonical order in OrderRegistry and require its validated broker order ID for cancellation.
- [x] Retain per-symbol replacement intent through PENDING acknowledgement; after acknowledgement, cancel by the registered ID, reconcile fills, and reevaluate from latest accounting.
- [x] Preserve the existing fail-closed unknown submission/cancellation path; no automatic retry was added.
- [x] Keep PENDING outside the cancellable status set; cancellation still requires a non-empty brokerOrderId.
- [x] Coalesce replacement intent per symbol and serialize fills/cancellation; replacement sizing reads the latest Portfolio/RecoveryLedger state.

### Scope C — Diagnostics and failure classification

- [ ] Preserve the Error serialization improvements merged in PR #462. Verify nested native `Error` and `AggregateError` values remain readable in logs; do not regress the shared logger.
- [ ] At each order boundary distinguish: local validation/precondition failure, expected readiness deferral, definite broker rejection, unknown submission/cancellation outcome, and invariant/ownership violation.
- [ ] Log safe correlation fields: symbol, event type, execution type, side, client order ID, order status, broker order ID presence, operation, and relevant readiness/reconciliation state. Never log credentials, signed requests, or raw sensitive exchange payloads.
- [ ] A readiness deferral must not be logged/classified as an exchange rejection when no broker request was sent.

### Required tests

- [x] Deferred BUY/SELL `placeOrder` promise: a BUY fill arrives while recovery SELL is PENDING; assert no cancellation call occurs before acknowledgement.
- [x] Resolve the SELL acknowledgement; assert cancellation uses the exact acknowledged broker order ID, then replacement SELL uses the latest post-fill quantity.
- [x] Emit a fill during cancellation; assert it is accounted once and replacement quantity reflects it.
- [x] Emit multiple BUY fills while SELL acknowledgement/cancellation is pending; assert no duplicate SELL and latest intent is not lost.
- [x] Execute a fill while a strategy evaluation is deferred; assert automatic reevaluation after the transition without requiring a new price tick.
- [x] Assert a local readiness deferral never calls the broker and is not classified as rejection/unknown submission.
- [x] Assert no full account snapshot is fetched for every ordinary TRADE execution; retain targeted refresh tests for actual uncertainty/reconnect paths.
- [x] Assert logs preserve Error message/stack/cause and safe event/order correlation fields.
- [x] GitHub Actions on the current PR head: workspace tests (Harvester 298/298, brokers 274/274, Conservative strategy 313/313; 1,367 total workspace tests passed), shared-utils tests, coverage, JavaScript syntax/workflow lint, and production dependency audit all passed. Local offline test execution has not yet been reported.
- [x] Operator-confirmed local TESTNET startup: config validated; Binance connected; ZROUSDT exchange rules validated; user-data subscription active; initial account snapshot accepted; Conservative engine activated; market-price subscription established.
- [x] Observe validated ZROUSDT market prices and BUY execution reports (`NEW` and `TRADE`) from the real TESTNET user-data stream.
- [ ] Diagnose the 15:47:17 `UNKNOWN_OR_EXTERNAL_ORDER_EVENT` using exact Binance order IDs/client order IDs from recent order history and the Harvester order-submission journal/logs. Do not guess at broker mapping or weaken order ownership.
- [ ] Verify that every BUY fill is accounted exactly once, the recovery SELL is submitted and filled, and the next BUY starts a subsequent cycle on Spot TESTNET.

### Out of scope for P0.7

Do not add Journal/persistence/restart recovery, historical trade replay, a generic reconciliation subsystem, a generic event queue/framework, Aggressive, dashboard/notification work, or unrelated refactors. Do not change approved Conservative financial rules without discussing the specific proposed change.

### Acceptance

The app starts with the documented TESTNET opt-in, receives prices, submits BUY orders, and receives real Binance BUY execution reports. Current live evidence also exposed an unowned-order correlation failure that pauses the pair. Acceptance therefore remains blocked until the exact event/order identity mismatch is fixed with a regression test, BUY fills are accounted exactly once, and a real recovery SELL → next BUY cycle is observed. No full account snapshot is required after every fill.

## P0.6 — Fix Binance order lifecycle race and diagnostic errors

**Status: planned — source inspection only; implementation and TESTNET verification are not complete.**

### Problem statement and evidence

The Conservative engine registers a canonical order in `PENDING` state before awaiting broker submission. `OrderRegistry.getActiveOrders()` deliberately includes `PENDING`. The engine's market-price and user-data entry points are independent asynchronous workflows; bootstrap serializes user-data callbacks with its own `userDataEventQueue`, but that queue does not serialize them against `processMarketPrice()`.

A BUY fill can therefore be processed while another order (including a recovery SELL) is still awaiting its broker acknowledgement. The BUY-fill path enumerates active SELLs and can call `broker.cancelOrder({ order })` for a PENDING order whose `brokerOrderId` is necessarily absent. The Binance adapter forwards that missing identifier to the broker cancellation API. This is consistent with the observed signed-parameter validation error for `orderId`; it is a source-supported race hypothesis, not yet a captured proof of the exact production interleaving.

A second, independent diagnostic defect is confirmed by the logging implementation: `formatLogContent()` JSON-stringifies structured values, while native `Error` properties such as `message` and `stack` are non-enumerable. An Error nested in an object or array can therefore appear as `{}`, losing the reason for a rejected operation. Some Harvester log call sites pass native Error instances and arrays of Errors directly.

### P0.6.1 — Reproduce and pin down the lifecycle ordering

- [ ] Read the current engine, execution use case, order registry, bootstrap queues, broker port, Binance adapter, shared Binance broker, and working Conservative strategy order submission/cancellation path before editing.
- [ ] Add a deterministic fake-broker regression test that holds a `placeOrder()` promise unresolved after the PENDING callback, emits a BUY fill that would normally cancel a recovery SELL, and proves no cancellation is attempted without a broker acknowledgement.
- [ ] Add a second ordering test for a market-price event racing with a user-data order/fill event; assert the final registry and submitted/canceled order sequence, not merely that promises resolve.
- [ ] Capture the order lifecycle with safe diagnostic fields: symbol, side, clientOrderId, status, brokerOrderId-present flag, operation, and event/transition sequence. Never capture credentials, signed parameters, or unredacted raw exchange payloads.
- [ ] Preserve a sanitized reproduction log as a temporary, untracked diagnostic artifact only if a real TESTNET reproduction is needed. Inspect `.gitignore` first; do not commit secrets or account identifiers. Remove the temporary artifact once the issue is resolved.

### P0.6.2 — Serialize engine state transitions

- [ ] Introduce one focused in-process transition coordinator for all state-mutating engine entry points: market-price processing, user-data order/fill processing, and any internal reevaluation that can submit/cancel orders.
- [ ] Ensure the serialization boundary covers the complete asynchronous transition, including PENDING registration, broker acknowledgement, registry update, cancellation/reconciliation, fill accounting, and follow-up decision. A queue around only user-data callbacks is insufficient.
- [ ] Preserve event ordering and prevent a queued event from observing a half-completed order submission. Define queue failure behavior so one rejected task cannot silently poison or skip subsequent work.
- [ ] Avoid deadlocks/re-entrant queue calls: internal workflow helpers should operate within the already-held transition rather than enqueueing themselves again.
- [ ] Keep the coordinator in the application/use-case layer. Do not add concurrency policy to the pure strategy, canonical entities, or Binance SDK adapter.
- [ ] Keep the implementation narrow and in-memory; do not introduce durable queues, a generic event framework, or a persistence/recovery subsystem as part of this fix.

### P0.6.3 — Enforce cancellation identity and lifecycle preconditions

- [ ] Add a focused pure validation function for cancellation eligibility using object-shaped input/output and the established `toResult` convention. It must require a broker-acknowledged order in a cancellable state and a valid broker order identifier.
- [ ] Reject PENDING, UNKNOWN, terminal, or otherwise non-cancellable orders before calling the broker. UNKNOWN must continue to pause/fail closed; it must not be treated as a cancellable order.
- [ ] Validate the identifier at the Harvester broker-port boundary as well as at the engine call site, so future callers cannot forward `undefined`, `null`, empty strings, unsafe numeric IDs, or malformed identifiers to Binance.
- [ ] Keep identifier normalization consistent with the shared Binance broker and the working Conservative strategy `getOrderId` behavior. Do not duplicate or weaken the shared exact-integer/safe-ID validation.
- [ ] Apply the same protection to recovery SELL cancellation, trailing BUY cancel/replace, and any other cancellation path. Preserve the existing cancel-then-fetch-fills reconciliation and fill-during-cancel protections.
- [ ] On an invalid lifecycle request, return a meaningful structured failure and pause the affected market where continuing could create duplicate or unsafe orders. Do not silently skip the cancellation and proceed as if it succeeded.

### P0.6.4 — Make Error and AggregateError logging lossless

- [ ] Fix the shared structured logger serialization path in `packages/utils` (currently `formatLogContent()` plus its JSON replacer) so native `Error` values remain useful when logged directly, nested in objects, or nested in arrays.
- [ ] Preserve at minimum `name`, `message`, and `stack` when available; include safe `cause` recursively and serialize `AggregateError.errors` as an array of normalized errors. Handle ordinary nested arrays/objects, circular references, non-Error thrown values, and hostile getters without making logging itself throw.
- [ ] Retain the existing sensitive-field redaction behavior. Error serialization must not bypass redaction or expose API keys, secrets, signatures, authorization headers, or raw signed request data.
- [ ] Define a stable, JSON-compatible error diagnostic shape and use it consistently at Harvester boundaries. Avoid ad hoc `error?.message` conversions that discard error type, stack, nested causes, or multiple errors.
- [ ] Audit every Harvester `logger.error` call that currently passes `error`, `errors`, or `AggregateError`; ensure callers pass structured context and the shared logger can serialize the complete nested error tree.
- [ ] Add shared-utils tests for a direct Error, Error in an object, Error in an array, nested AggregateError, cause chains, circular references, non-Error rejection values, redaction, and serialization fallback. Add Harvester tests proving logs for submission failure, cancellation failure, rejected/unowned order events, and event-queue failure retain actionable messages.
- [ ] Do not solve this by converting every Error to `String(error)` at call sites; that loses stack/cause and does not fix all nested structured logging.

### P0.6.5 — Documentation and verification

- [ ] Update this roadmap and the relevant Harvester architecture/broker lifecycle documentation in the same commit as each implementation/test change. Update shared-utils logging documentation/tests in the same commit as the logger change.
- [ ] Document the transition serialization guarantee and its scope accurately; do not claim cross-process serialization, durable recovery, or exactly-once delivery.
- [ ] Run focused engine, order-registry, broker-adapter, bootstrap, and shared-utils tests; then run `pnpm --filter @coinzilla/harvester test`, relevant `@coinzilla/utils` tests, and repository CI. Record exact outcomes and links; never mark unrun checks as passed.
- [ ] Verify the regression test fails against the pre-fix implementation and passes with the fix.
- [ ] After offline checks pass, perform a bounded Binance Spot TESTNET reproduction/verification only with explicit TESTNET credentials and trading opt-in. Confirm acknowledgements precede cancellation, every cancel uses the acknowledged brokerOrderId, cancellation/fill reconciliation remains correct, and the bot continues its intended next decision/order.
- [ ] Keep production/live trading disabled. Do not use production credentials or submit production orders.
- [ ] Remove temporary diagnostic artifacts after the issue is resolved and verify they are not tracked.
- [ ] Update the checklist only when implementation, tests, docs, CI, and required TESTNET evidence are actually complete.

### Acceptance criteria

1. No broker cancellation request can be issued for an order without a validated broker acknowledgement/identifier.
2. Concurrent market-price and user-data transitions cannot observe or mutate partially completed order lifecycle state.
3. Recovery SELL and trailing BUY cancel/replace still reconcile fills received during cancellation and never double-account them.
4. A deterministic regression test reproduces the former race and passes with the fix.
5. Structured logs retain Error name/message/stack, nested causes, and AggregateError member messages for direct, object, and array values, while sensitive fields remain redacted.
6. The full offline test/CI suite passes, and a bounded TESTNET run confirms the corrected lifecycle. Until TESTNET evidence exists, the trading issue remains open even if offline tests pass.

### Implementation boundaries

- Trading lifecycle correctness is P0 and must not be delayed by Journal, persistence, restart recovery, dashboards, or unrelated refactors.
- The logger fix is required because actionable diagnostics are necessary to validate this failure and future broker failures; it must remain a focused shared-utils improvement.
- Use Harvester's required DDD boundaries, pure functions for deterministic validation, object-shaped inputs/outputs, shared decimal/ID utilities, dependency injection, and `toResult`.
- Keep default tests deterministic/offline. Live exchange tests must be explicit, opt-in, and TESTNET-only.


### P0.6 implementation progress — engine transition serialization

- [x] The existing Conservative engine's public market-price, user-data, and explicit evaluation entry points are wrapped in a process-local promise-tail coordinator, with internal workflow calls kept inside the held transition. The deterministic concurrent market/user-data regression test uses an explicitly deferred SELL acknowledgement, verifies no cancellation while the PENDING order has no brokerOrderId, compares the recorded cancellation ID with the post-acknowledgement registry order, and proves duplicate fill delivery is not double-accounted. Harvester suite passed 285/285 on commit a2728bd.
- [ ] Re-entrant external callback behavior, cancellation eligibility and broker identifier validation, full CI, and TESTNET verification remain outstanding.


### P0.6 implementation progress — cancellation eligibility

- [x] Added a pure Harvester cancellation eligibility validator and applied it before recovery SELL and trailing BUY cancellation. The Binance adapter repeats eligibility checks for order-shaped requests and validates all forwarded IDs with the shared exported Binance normalizer. Validator, adapter, and Binance ID tests passed in the full package test run on commit a2728bd.
- [ ] Raw ID-only adapter calls receive Binance ID format validation but cannot prove order lifecycle state; Harvester application workflows must use order-shaped requests.


### P0.6 verification snapshot — 2026-11-03

- [x] Full workspace package tests passed on `a2728bd6d9925eb23c02ece7d1fe041e2060c3bd`: Harvester 285/285, shared utils 163/163, Conservative strategy 313/313; workflow: https://github.com/45s/coinzilla/actions/runs/41606130252
- [x] Shared utilities tests passed; workflow: https://github.com/45s/coinzilla/actions/runs/41606130302
- [x] Workspace coverage passed; workflow: https://github.com/45s/coinzilla/actions/runs/41606130160
- [x] JavaScript syntax and GitHub Actions lint passed; workflow: https://github.com/45s/coinzilla/actions/runs/41606130768
- [x] Production dependency audit passed; workflow: https://github.com/45s/coinzilla/actions/runs/41606130085
- [ ] Regression has not yet been run against the original pre-fix engine; only the fixed implementation's regression pass is confirmed.
- [ ] A dedicated queue-rejection/re-entrant-callback test and Harvester logger-boundary diagnostics audit remain outstanding.
- [ ] Bounded Binance Spot TESTNET verification remains outstanding. No production credentials or live orders were used.


### P0.7 ownership-failure diagnostics — 2026-11-03

- [x] Add a narrowly scoped structured diagnostic at the bootstrap boundary when the Conservative engine rejects an order event. It records the canonical symbol, exchange order ID, client order ID, side, execution type, order status, execution/trade ID when available, and registry match results by both client and broker order IDs. If a client-ID match exists, its registered status and broker ID are included to distinguish pending from acknowledged ownership.
- [x] Add a bootstrap regression test proving an unowned execution report is still rejected and paused while the safe correlation fields are logged.
- [ ] The actual 15:47:17 rejected report remains unidentified. This diagnostic must be collected on the next bounded TESTNET run before attributing the failure to client-ID reuse, broker mapping, or external order activity.
- [ ] No ownership rule, Binance mapping, or client-ID generation behavior is changed by this diagnostic-only step. Root-cause fix and its failure-reproducing regression test remain blocked on the exact rejected event identity.


### P0.7 ownership correlation comparison — 2026-11-03

A previous source audit identified the required ownership rule: execution reports are correlated using exchange-assigned broker order IDs recorded after broker acknowledgement. Harvester's OrderRegistry now implements this rule. Harvester's OrderRegistry currently locates an order only by clientOrderId, even though its CanonicalOrder also carries brokerOrderId. The Binance user-stream adapter maps Binance executionReport.c to clientOrderId and executionReport.i to brokerOrderId; the canonical conversion retains both values.

This is an investigation finding, not a proven explanation for the reported unknown event. Do not change the registry's matching rules until the new TESTNET diagnostic captures the rejected event and demonstrates which identifier matches the owned order. Any future broker-ID correlation must still validate that client and broker identifiers refer to the same registered order; it must not adopt external orders.


### Order ownership audit — 2026-11-03

A direct source comparison was completed against `develop` (not inferred from the README):

- **Conservative strategy ownership key:** `ConservativeEngine.#handleOrderEvent()` obtains the exchange-assigned ID via `getOrderId(event.executedOrder)` and requires that ID to exist in the pair's `trackedOrderIds`. The BUY and SELL submission paths add that ID only after the broker response contains it. A fill is additionally checked against the same order ID, symbol, and side before accounting.
- **Harvester ownership key:** `OrderRegistry.applyUpdate()` currently locates an order only by `clientOrderId`. It then checks the broker ID as an immutable field only when the registered order already has a broker ID. A locally registered `PENDING` order has no broker ID yet, so a report with the same client ID and same immutable order intent can supply the broker ID and advance that registry entry.
- **Client-ID reuse is real:** Harvester currently generates IDs as `h-<symbol>-<process-local counter>`. The counter is initialized inside the decision executor, so it restarts with a new process. The supplied TESTNET history independently shows `h-ZROUSDT-1` and `h-ZROUSDT-2` reused in an older session. This makes client-ID-only correlation weaker than Conservative strategy's exchange-order-ID ownership check.
- **What this does and does not prove:** this is a concrete ownership/parity gap and a plausible stale-event collision risk. It is **not yet proven to be the cause** of the reported 15:47:17 rejection. That rejection was reported as a missing client-ID registry match; without its actual `clientOrderId`, `brokerOrderId`, and current registry snapshot, we cannot tell whether the report had a missing/wrong client ID, was from an old session, or was an unrelated order. The repeated historical client IDs alone do not identify that event.
- **No code fix is included in this audit update.** Do not add a blind broker-ID fallback or accept an unknown event. The follow-up must reproduce the actual event and preserve fail-closed rejection of external orders.

**Required next evidence:** run the diagnostic branch and retain the complete structured rejection record, including symbol, `brokerOrderId`, `clientOrderId`, side, status, execution type/ID, and both registry-match fields. Compare those identifiers to this process's order-submission/acknowledgement logs and the matching TESTNET history row. Also determine whether the report was received before or after the matching broker acknowledgement.

**Deterministic regression cases required before changing ownership logic:**

1. A report for an acknowledged owned order is accepted only when its exchange order ID matches the registered broker order ID; client ID must also be consistent where supplied.
2. An unknown exchange order ID is rejected even if its client ID collides with a locally registered order from a previous session.
3. A report for an unacknowledged `PENDING` intent cannot silently establish ownership by supplying an arbitrary exchange order ID unless an observed, tested broker ordering contract explicitly requires this.
4. A valid Conservative strategy-style fill still updates accounting once, and an unrelated/manual order remains unowned.

The acceptance target remains a real TESTNET sequence: BUY fill → recovery SELL submission and fill → next BUY. Offline tests and order-history snapshots do not substitute for that proof.


### TESTNET rejected-event evidence — 2026-11-03 16:24

The operator supplied the previously missing structured rejection record:

- Event: `executionReport`, execution type `CANCELED`.
- Market/side/status: `ZROUSDT` / `BUY` / `CANCELED`.
- Incoming exchange order ID: `666845`.
- Incoming client order ID: `CU5G5c9IZgepakVzo3Z3kw`.
- Registry lookup by client ID: no match.
- Registry lookup by exchange order ID: **match found**.
- The matched registered order's client ID: `h-ZROUSDT-1`.

This proves the event is associated with an exchange order ID already present in Harvester's in-memory registry, while its incoming client ID conflicts with the client ID stored for that registered order. The earlier description of this as simply an unknown/untracked order was incomplete. It is an identifier-consistency rejection for an exchange-order-ID match.

#### Additional adapter finding: Binance original client order ID is discarded

Source inspection found the Binance user-data adapter maps raw execution-report fields:

- `c` → `newClientOrderId`;
- `C` → `originalClientOrderId`.

The following `adaptExecutedOrder()` maps `newClientOrderId` into `executedOrder.clientOrderId`, but does not preserve `originalClientOrderId` on the forwarded event. The broker's later canonicalization preserves the incoming `clientOrderId` but cannot recover the discarded `C` field.

Consequently, the current diagnostic still cannot determine whether Binance's `C` field equals the registered `h-ZROUSDT-1`, nor whether the incoming `c` is a replacement/new client ID or an unexpected value. This field must be preserved as event metadata in a follow-up diagnostic change, with adapter regression coverage. It must not be substituted for the canonical order client ID without understanding the Binance event semantics.

#### 16:24:48 TRADE event

The operator subsequently saw a BUY `TRADE` event and the informational log `Trade execution received`. In `start-harvester.js`, that informational log is emitted before the event is enqueued and before `processUserDataEventTransition()` completes. It proves receipt, not successful fill accounting. The supplied excerpt has no resulting `fill.applied`, accounting outcome, registry update, or rejected-event diagnostic for this TRADE report. Its exchange order ID and client ID are therefore still unknown.

#### Updated diagnosis and required evidence

The primary lead is now a conflict between the client ID in a Binance execution report and the client ID stored for the same exchange order ID. Do not add a broker-ID-only acceptance fallback: it would suppress a real identity conflict and could admit a mismatched event.

Next, inspect TESTNET order history for exchange order ID `666845` and capture the full history row, including `clientOrderId`, status, executed quantity and update time. For the next run, preserve raw Binance execution-report `c` and `C` (redacting credentials and unrelated account data), plus both IDs for the later TRADE report. Correlate these with the Harvester submission and acknowledgement for order `666845`.

Only after this comparison can we distinguish a Binance cancel/replacement identifier case, an adapter normalization issue, an order-ID collision, or another source of the mismatch. Add a deterministic test from the confirmed event semantics before changing ownership validation.


### Order identity alignment — 2026-11-03

The working implementation was compared directly with Harvester:

- The Conservative lifecycle records the exchange-assigned order ID after broker acknowledgement.
- Its `#handleOrderEvent()` gets `getOrderId(event.executedOrder)` and accepts the event only when that exchange order ID is tracked. Fill identity is checked using exchange order ID, symbol, and side. It does **not** require the execution report's client order ID to equal the locally submitted client ID.
- Harvester previously used `OrderRegistry.applyUpdate()` lookup by `clientOrderId` only. That was the behavioral mismatch behind the `666845` rejection: Binance's event `c` differed, although the exchange order ID was already registered.

Harvester is now aligned with that working behavior: acknowledged updates are located by `brokerOrderId` first; the registered client ID remains the canonical local ID; conflicting client and broker IDs that point to two different registered orders are still rejected. Unknown broker order IDs are not adopted. Binance's raw `c` and `C` are retained as event metadata for diagnostics.

The bootstrap now logs both identifiers on receipt, logs accepted/ignored processing outcomes, and emits complete error name/message/stack fields for rejected events. This should make future adapter/identity mismatches diagnosable without changing normal logs to raw Binance payload dumps.

Regression coverage added:

- Binance adapter preserves `c` and `C` separately.
- Registry accepts a report with a different client ID when its exchange order ID identifies the registered order, while retaining the submitted canonical client ID.
- Registry rejects an event when its broker ID and client ID point to different registered orders.

This is an intentional port of Conservative strategy's proven order matching rule, not a new ownership strategy. The real TESTNET acceptance target remains BUY fill → recovery SELL submission/fill → next BUY.


## DDD and Clean Architecture audit follow-up

The detailed source-code assessment is recorded in [DDD and Clean Architecture Audit](./docs/DDD_CLEAN_ARCHITECTURE_AUDIT.md). It assesses the audited `develop` snapshot at `3ad32af9285db23f1f4e587e56f534f7871730aa`; re-check current code before implementing individual items. Overall architectural assessment: **7.5/10**. This is a qualitative design assessment, not a test, release-readiness, or runtime score.

**Priority rule:** this work does not supersede [Trading First](./docs/TRADING_FIRST.md), the active P0 order-flow work, or the first real Conservative TESTNET acceptance. Documentation reconciliation can proceed now. Workflow refactoring should normally follow the first accepted TESTNET cycle unless a demonstrated correctness issue requires a targeted extraction.

### DDD-01 — Audit documentation reconciliation (documentation)

- [x] Record the detailed audit, scorecard, evidence scope, and video reference in `docs/DDD_CLEAN_ARCHITECTURE_AUDIT.md`.
- [x] Label the known obsolete Aggressive-first implementation snapshot in the architecture guide as historical and point readers to the current roadmap/audit. (Other implementation claims should continue to be updated with code changes.)
- [ ] Ensure current-state claims carry a revision/date and link to implementation evidence.
- [ ] Keep unresolved design decisions separate from implemented guarantees.

**Acceptance:** a reader can distinguish stable architecture rules, verified implementation, future work, and unresolved decisions without contradictory claims.

### DDD-02 — Harvester domain glossary and context map

- [ ] Define Harvester-owned terms and distinguish them from shared canonical Entities contracts.
- [ ] Document the Harvester / Entities / Brokers context relationship and dependency direction.
- [ ] Document Journal/EventBus as optional observers, not trading-state authority.
- [ ] Record contract ownership and consumer rules for shared concepts.

**Acceptance:** ownership of each core concept and contract is explicit; no package split or public rename is required to complete this task.

### DDD-03 — Portfolio / RecoveryLedger consistency contract

- [ ] Document the distinct responsibility of Portfolio and RecoveryLedger.
- [ ] Define canonical fill identity, duplicate and conflict behavior, and deduplication ownership.
- [ ] Define the visibility/atomicity invariant when both projections are updated.
- [ ] Specify behavior if one projection or workflow step fails.
- [ ] Add deterministic tests proving no subsequent strategy evaluation sees a silently partial accounting transition.

**Acceptance:** written invariant plus tests for normal, duplicate, conflicting, invalid, and partial-failure cases. Complete before durable persistence/restart recovery or broader concurrent-market expansion.

### DDD-04 — Extract accounting/recovery workflows from bootstrap

- [x] Extract the state-owning Portfolio/RecoveryLedger workflow factory into `src/use-cases/create-portfolio-workflow.js`. It owns serialized canonical-fill accounting, immutable projection commits, recovery completion/free-inventory allocation, ledger reset, and market-price workflow composition.
- [x] Keep the domain invariants in `Portfolio`, `RecoveryLedger`, and `evaluateRecoveryCompletion`; the extracted use case coordinates them and preserves the existing result/runtime API.
- [x] Add direct use-case tests for concurrent fills, duplicate delivery, invalid non-canonical input, and resulting Portfolio/RecoveryLedger state without starting Harvester.
- [x] Keep bootstrap as the composition root for this workflow and preserve the existing user-data event queue and process-lifecycle sequencing.
- [~] Continue the remaining bootstrap decomposition (account snapshot coordination, user-data intake/readiness, market/book subscriptions, and shutdown/resource cleanup) in small independently tested increments.

**Acceptance:** the accounting and recovery transition factory is independently testable; bootstrap composes it rather than implementing the stateful accounting/recovery workflow. The broader bootstrap cleanup remains follow-up work within this DDD-04 task.

### Market subscription coordinator extraction — 2026-11-08

- [x] Move book-ticker and market-price subscription setup, callback processing, subscription event publication, all-symbol readiness validation, and initial REST ticker seeding into `src/bootstrap/subscriptions/subscribe-to-market-data.js`.
- [x] Preserve the ordering guarantee that every enabled WebSocket stream is established before any REST ticker seed is fetched.
- [x] Preserve fresh WebSocket first-price preference, read-only mode behavior, callback error containment, and shutdown-owned unsubscribe handles.
- [x] Add direct tests for subscription/seed ordering, fresh WebSocket suppression of REST seed, read-only mode, and subscription failure evidence.

### Shutdown handler extraction — 2026-11-08

- [x] Move the process shutdown sequence into `src/bootstrap/shutdown/create-shutdown-handler.js`.
- [x] Preserve market-intake unsubscribe and in-flight callback draining, owned-order reconciliation before/after BUY cancellation, user-data drain/disconnect, unresolved-order checks, CLOSING account audit, error aggregation, and final broker disconnect.
- [x] Improve concurrent stop idempotency: all callers now await the same in-flight shutdown promise instead of later callers returning before cleanup completes.
- [x] Add direct tests for safety-critical ordering, concurrent callers, and aggregated cleanup failures.

### User-data recovery coordinator extraction — 2026-11-08

- [x] Move the application recovery task into `src/bootstrap/user-data/create-user-data-recovery-handler.js`.
- [x] Preserve owned-order REST reconciliation, event-sequence bracketing/retry of account and open-order snapshots, durable RECOVERY audit publication, and explicit broker acknowledgement.
- [x] Preserve recovery-generation invalidation and fail-closed behavior when reconciliation, snapshots, Journal durability, or acknowledgement fail.
- [x] Add direct tests for startup gating, successful recovery, superseded generations, events during REST audit reads, and durable audit failure.

### User-data status/recovery handler extraction — 2026-11-08

- [x] Move broker status publication, transport-unsafe transitions, recovery-generation invalidation, readiness updates, and observer failure handling into `src/bootstrap/user-data/create-user-data-status-handler.js`.
- [x] Preserve the distinction between broker stream recovery and application REST/stream reconciliation; only the application recovery coordinator may acknowledge recovery and reopen trading.
- [x] Add direct tests for disconnect invalidation, reconciled-but-still-blocked state, recovered-before-startup handling, execution normalization failure, and observer failure.
- [ ] Extract the REST/stream recovery task itself and its account-audit/acknowledgement sequence.

### User-data event handler extraction — 2026-11-08

- [x] Group user-data readiness, sequencing, recovery-generation, and intake flags in one explicit bootstrap state object.
- [x] Move serialized user-data event processing, canonical engine event handling, accounting/observer dispatch, readiness restoration, and failure-triggered safety-halt requests into `src/bootstrap/user-data/create-user-data-event-handler.js`.
- [x] Add direct tests for successful event sequencing, malformed input, unowned/invalid engine results, and observer isolation.
- [ ] Extract the user-data status/recovery coordinator while preserving generation invalidation, REST/stream reconciliation, durable account audits, and the broker recovery acknowledgement barrier.

### Market-data freshness policy extraction — 2026-11-08

- [x] Move the shared market-price/book timestamp freshness decision into the pure domain helper `src/domain/market/is-market-data-fresh.js`.
- [x] Keep time acquisition injected at the bootstrap/engine boundary; the helper has no clock, I/O, or mutable state.
- [x] Add deterministic tests for inclusive age/future-skew boundaries, stale/future timestamps, invalid values, and explicit policy overrides.

### Market metadata loading extraction — 2026-11-08

- [x] Move broker market-filter reads, canonical symbol/asset checks, enabled-pair readiness validation, market metadata storage, and trading-rule lifecycle publication into `src/bootstrap/market/load-market-metadata.js`.
- [x] Preserve metadata loading for disabled configured pairs so account audits still include their base/quote assets; only enabled pairs undergo trading readiness validation.
- [x] Add tests for enabled/disabled pair behavior, metadata-load failure, and symbol mismatch.
- [ ] Continue separating market/book subscription setup and initial ticker seeding.

### Account snapshot manager extraction — 2026-11-08

- [x] Move broker account-balance capture, configured-asset validation, account-wide open-order ownership classification, and durable PREFLIGHT/OPENING/CLOSING event publication into `src/bootstrap/account/create-account-snapshot-manager.js`.
- [x] Keep broker reads and mandatory Journal flush barriers in the bootstrap lifecycle boundary; preserve account-versus-strategy inventory ownership.
- [x] Add direct tests for durable publication, missing configured assets, stale snapshots, and unowned open orders.
- [ ] Continue separating the user-data event/readiness coordinator and market/book subscription lifecycle.

The manager does not replay Journal history, adopt external balances/orders, add per-fill REST snapshots, or weaken any durability barrier.

### Bootstrap resource-cleanup extraction — 2026-11-08

- [x] Move broker intake teardown and disconnect coordination into `src/bootstrap/broker/cleanup-broker.js`; keep it in bootstrap because it owns process resources and lifecycle ordering.
- [x] Preserve best-effort cleanup of market-price, book-ticker, and user-data subscriptions; attempt broker disconnect even when earlier cleanup operations reject.
- [x] Preserve the broker-disconnected lifecycle event and aggregate every cleanup error for the caller.
- [x] Add focused tests for successful cleanup ordering and multiple simultaneous cleanup failures.
- [ ] Continue extracting the account snapshot manager, market metadata loading, user-data coordinator, and shutdown orchestration in later increments.

This is process-lifecycle infrastructure, not trading policy. It does not alter the required shutdown BUY-cancellation/SELL-retention rules or the CLOSING account-audit barrier.

### DDD-05 — Decompose Conservative Trading Engine incrementally

- [ ] Map engine-owned mutable state to its responsible workflow or coordination boundary.
- [ ] Extract cohesive submission/acknowledgement, cancellation/reconciliation, order-update, fill-processing, and post-transition evaluation workflows as evidence supports.
- [ ] Keep transition serialization at the boundary that owns ordering.
- [ ] Preserve fail-closed order ownership and actual-fill accounting.
- [ ] Avoid class-per-event, callback-per-file, or broad rewrite.

**Acceptance:** the engine becomes a focused orchestrator; existing lifecycle behavior is protected by deterministic regression tests.

### DDD-06 — Executable architecture fitness checks

- [ ] Enforce domain dependency rules in automated checks where practical.
- [ ] Add/maintain broker adapter contract tests for canonical order and fill events.
- [ ] Add coverage for accounting consistency and engine event sequencing.
- [ ] Document process-local versus durable/cross-process guarantees.

**Acceptance:** critical dependency rules and financial lifecycle invariants are tested, not only documented.

### DDD-07 — Strategic boundary review (later, evidence-driven)

- [ ] Review Harvester / Entities / Brokers ownership using actual change and dependency patterns.
- [ ] Use an ADR for material aggregate, persistence-authority, or context-boundary changes.
- [ ] Do not introduce microservices, CQRS, event sourcing, repositories, or a DI framework by default.

**Acceptance:** any proposed boundary change includes rationale, consumer impact, migration plan, and tests.

### Conservative next-BUY execution-price correction — 2026-11-03

- [x] Use the actual volume-weighted average execution price of the completed BUY as the reference for the next standing BUY. Aggregate every canonical partial fill using executed quote notional / executed base quantity; never substitute the submitted limit price or the final partial-fill price.
- [x] Require the observed BUY fill quantity to reconcile exactly with the broker's FILLED order quantities before advancing the recovery/next-BUY transition. Pause the pair when the fill history is incomplete or inconsistent.
- [ ] Run the Harvester package tests and required CI checks on the task PR.
- [ ] Verify this behavior in the bounded Binance TESTNET acceptance cycle. Offline tests do not prove exchange behavior.



### Conservative BUY-completion submission ordering — 2026-11-03

- [x] Reconcile the completed BUY's actual fills and VWAP before advancing.
- [x] Cancel and reconcile any active recovery SELL before recalculating it.
- [x] Submit the replacement recovery SELL first; submit the next standing BUY only after the SELL is acknowledged successfully. If no sellable quantity exists, the BUY may proceed without a SELL.
- [x] Trigger the evaluation directly from the serialized user-data completion flow; no new market-price event is required.
- [x] Preserve simultaneous active BUY and recovery SELL orders after both submissions succeed.
- [x] Add policy and engine regression tests for intent/submission order and coexistence.
- [ ] Verify the full behavior on bounded Binance Spot TESTNET. Offline tests do not prove exchange behavior.


### Conservative recovery SELL completion reconciliation — 2026-11-03

- [x] Track distinct actual SELL fill quantities per broker order.
- [x] Require aggregate fill quantity to equal broker-reported executed quantity and original order quantity before recovery completion.
- [x] Fail closed on missing or inconsistent SELL execution history; do not allocate free inventory, reset the recovery ledger, or reactivate BUY trailing.
- [x] Add engine regressions for missing fills, incomplete fills, and multiple partial fills that reconcile to a complete SELL.
- [ ] Verify the complete SELL-completion transition on bounded Binance Spot TESTNET. Offline tests do not prove exchange behavior.


### Historical commission and order-type policy decision — 2026-11-03 (superseded)

The old makerPercent-only planning policy and its tests are preserved in PR #489 history only. The owner-approved current order-type selection and fee-reserve policy is defined exclusively in [CONSERVATIVE_DOMAIN_SPECIFICATION.md](./docs/domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md). Do not use the historical bullets below as current policy.

### POST-ONLY book-ticker subscription lifecycle regression — 2026-11-04

- [x] Extend the bootstrap shutdown regression to run with Conservative TESTNET trading explicitly enabled and assert that the book-ticker subscription is removed before queued user-data processing drains and before broker disconnect. This closes a test-coverage gap introduced by the book-ticker intake added for POST-ONLY validation; runtime behavior is unchanged.

 
## TESTNET live progress — 2026-11-04 (initial partial snapshot; superseded by later incident record)

This section preserves the initial operator-provided snapshot from earlier in the run. Later evidence on the same date includes a full recovery SELL fill, cycle-completion event, rapid BUY burst, and post-cycle MIN_NOTIONAL failure; see [TESTNET incident and account snapshot](#testnet-incident-and-account-snapshot--2026-11-04-supersedes-earlier-partial-progress-status) for the current consolidated status. The observations below remain historically accurate for the earlier snapshot only and do not establish acceptance of a complete safe cycle.

### Runtime observations

- [x] Harvester started in Conservative TESTNET mode and subscribed to the enabled DOGEUSDT market.
- [x] DOGEUSDT market prices were validated and evaluated; both `NO_ACTION` and later `PLACE_ORDERS` decisions were observed.
- [x] BUY order `1194922` was acknowledged as `NEW`.
- [x] A later cancellation report for that BUY was received with broker order ID `1194922`, `originalClientOrderId: h-DOGEUSDT-1`, and `clientOrderId: 6vkbmc75fHmEQ6opHmm99R`. Harvester logged `outcome: IGNORED` and `ignored: true`; this event is **not** counted as verified cancellation reconciliation.
- [x] Replacement BUY order `1195036` was acknowledged and later received a `TRADE` execution report with execution ID `binance:DOGEUSDT:212100`; the event log reported `fillApplied: true`.
- [x] Following that BUY fill, Harvester submitted and received `NEW` acknowledgements for recovery SELL order `1195057` and standing BUY order `1195058`.

### Later read-only open-orders snapshot

The operator ran `pnpm run testnet:orders` from `apps/harvester`. The returned Binance Spot TESTNET snapshot contained exactly these two open DOGEUSDT orders:

| Exchange order ID | Side | Price | Original quantity | Executed quantity | Status | Client order ID |
|---:|---|---:|---:|---:|---|---|
| `1195221` | SELL | `0.07496000` | `1198.00000000` | `0.00000000` | NEW | `h-DOGEUSDT-7` |
| `1195222` | BUY | `0.07461000` | `400.00000000` | `0.00000000` | NEW | `h-DOGEUSDT-8` |

Total open orders: 2; symbol: DOGEUSDT. This confirms that the exchange currently has both a recovery-side SELL and a standing BUY open. It does not prove either order filled, does not independently prove the SELL quantity is correct for the recorded Portfolio, and does not establish the cancellation/replace event was reconciled correctly inside the running process.

### Interpretation and remaining proof

- The process producing the supplied logs was started before PR #512 was pulled. Its sequential IDs (`h-DOGEUSDT-1` through `-8`) are therefore expected for that old process and do not test PR #512's random per-process namespace. Verify the new ID format only after starting a fresh process with the updated `develop` code.
- [ ] Verify cancellation/replacement correlation for the ignored CANCELED report using the full TESTNET order-history rows and the matching raw Binance event fields. Do not infer correctness from the `originalClientOrderId` field alone.
- [ ] Verify the SELL order fills and its actual commissions/proceeds are reconciled into Portfolio/RecoveryLedger.
- [ ] Verify recovery completion, keepQuantity/free-inventory allocation, and the next cycle's BUY on TESTNET.
- [ ] Verify the full BUY → fill → SELL → fill → next-cycle sequence, including actual fill accounting and no duplicate submissions.
- [ ] After restarting on PR #512 or later, verify generated client order IDs use the random namespace and do not collide with prior process IDs.

**Current milestone status:** partial real TESTNET execution demonstrated; the first complete Conservative trading cycle is still **in progress**, not complete. Keep the run bounded to one TESTNET pair and keep live trading disabled.


## TESTNET incident and account snapshot — 2026-11-04 (supersedes earlier partial-progress status)

This entry incorporates the later operator-provided Harvester journal, TESTNET order-history output, clean-shutdown evidence, and the read-only account-balance snapshot. It supersedes the earlier statement above that no recovery SELL fill had yet been observed. It does **not** mark the first trading milestone complete.

### What the run actually demonstrated

- [x] A recovery SELL was fully filled: DOGEUSDT order `1197105`, client order ID `h-DOGEUSDT-49`, SELL `5,595 DOGE` at `0.07613`, quote quantity `425.94735 USDT`, Binance trade ID `212335`.
- [x] Harvester recorded `execution.fill_applied` for that SELL and then `recovery.cycle_completed` with `freeQuantity: 1` and `realizedNetProfit: 0.36335`. These are journal-reported values; actual commission amount/asset is not present in the journal event, so independent net-PnL verification remains open.
- [x] The journal records twelve distinct DOGEUSDT BUY orders, client IDs `h-DOGEUSDT-32` through `h-DOGEUSDT-43`, broker order IDs `1197074` through `1197085`. Each was `400 DOGE` at `0.07598 USDT`, and all twelve were FILLED as TAKER within roughly three seconds: `4,800 DOGE` total and `364.704 USDT` gross quote spend.
- [x] The SELL and twelve BUYs are real exchange executions, not merely strategy intents. However, the BUY burst is not acceptable behavior and is a blocker to repeatable execution.
- [x] The operator-provided order-history output contained 102 rows total: 50 dated 2026-10-28 and 52 dated 2026-11-04. Within the 2026-11-04 subset, 21 FILLED BUYs total `8,400 DOGE` / `635.85200 USDT` gross quote and 8 FILLED SELLs total `8,390 DOGE` / `636.42265 USDT` gross quote. The net is `+10 DOGE` and `+0.57065 USDT` before commissions. This remains bounded order-history evidence, not a complete account ledger.
- [x] A later read-only open-orders command reported no open orders. A separate latest read-only balance snapshot reports 517 non-zero assets; DOGE `12,321.00000000 free / 0 locked`, USDT `9,792.44855000 free / 0 locked`, and FDUSD `9,990.86500000 free / 0 locked`.


### Source remediation progress — PR #513

- [x] Add an acknowledgement reconciliation barrier: a terminal FILLED acknowledgement now fetches its complete execution history, validates order identity and cumulative quantity, and applies ordered incremental fills before the current serialized transition can finish.
- [x] Fail closed and pause the pair when the acknowledgement execution history is unavailable, incomplete, or inconsistent.
- [x] Historical PR #513 code introduced an outstanding-recovery gate. That residual-suppression behavior is superseded by the canonical sell-through contract; current behavior must sell all sellable inventory above exact keepQuantity and classify dust.
- [x] Historical regression covered immediate-FILLED reconciliation and residual suppression. Current acceptance requires new sell-through/dust regressions from the canonical specification.
- [ ] Execute the Harvester test suite and coverage locally or in CI; inspect and fix any failures.
- [ ] Verify required workspace checks and CI are green.
- [ ] Review duplicate/out-of-order stream overlap, cancellation/fill races, and complete recovery lifecycle regressions against the new barrier.
- [ ] Run `pnpm --filter @coinzilla/harvester testnet:trades DOGEUSDT 1000`; inspect pagination/completeness and reconcile every trade-level commission fact to order history and the journal.
- [ ] Establish the limits of the opening-balance baseline; do not infer it from bounded order history.

**Verification status:** the source-remediation PR head before adding the read-only trade-history diagnostic passed the full workspace unit-test run, workspace test-coverage run and all configured coverage thresholds, JavaScript syntax and agent-policy checks, workflow lint, production dependency audit, and Utilities unit tests. Earlier CI attempts exposed a terminal registry ordering defect and a test assertion using Fill.id instead of tradeId; both were corrected before that passing run. The trade-history diagnostic and its focused tests have since been added; CI for the updated head is queued/pending and must be checked before calling the branch green. Exchange trade-level reconciliation remains incomplete, so the earlier offline results do not satisfy the TESTNET restart gate. Keep the process stopped.

### Incident A — repeated BUY submissions around immediate FILLED acknowledgements

**Trade-level clarification and source review (2026-11-04):** the twelve exchange orders are twelve distinct orders, not one order duplicated under a reused client/order ID. Each has a distinct client ID (h-DOGEUSDT-32 … h-DOGEUSDT-43) and broker order ID (1197074 … 1197085), but all twelve share the exact same side, quantity (400 DOGE), price (0.07598 USDT), and TAKER execution role. They were filled within roughly three seconds. Therefore the anomaly is repeated independent submission at an identical price/size, not an identifier collision. A 12-order burst is not inherently wrong during a dump; the suspicious evidence is that all twelve were at the same limit price rather than a sequence of price levels.

The source strategy computes a BUY limit from a single reference (lastBuyPrice, falling back to current market price) using priceStepPercent and rounds down to the exchange tick. 0.05 means **0.05%**, not 5%. After a BUY is fully reconciled, the engine stores the actual weighted execution price as lastBuyPrice; the next standing BUY should therefore be calculated from that updated reference. Repeated identical prices are consistent with multiple submissions being evaluated against stale/unreconciled BUY state. The incident logs support the acknowledgement/fill timing race described below, but do not prove the exact triggering market event for each order. Do not label the twelve orders as duplicate IDs or conclude that a 12-order burst itself is invalid.

**Merged PR #513 remediation (completed):** terminal FILLED acknowledgements are held behind complete fill-history retrieval, identity/quantity validation, and ordered fill application before the serialized transition completes. This closes the observed acknowledgement-to-accounting gap for immediate-FILLED broker acknowledgements. The remaining alternate lifecycle path—non-terminal acknowledgement followed by streamed partial/final fills, duplicate/out-of-order reports, and cancellation/fill races—is now assigned to follow-up PR #515 for deterministic verification.


The twelve BUYs used distinct client IDs, so this is not the client-ID collision addressed by PR #512. The journal ordering and source inspection support the race: a FILLED acknowledgement could remove the BUY from the active-order registry before canonical fills updated Portfolio/last-buy state, allowing a market transition to see neither an active BUY nor the reconciled fill. PR #513 now addresses this by keeping the registered order non-terminal while it retrieves and validates complete execution history, then applying ordered incremental fills before the serialized strategy transition can complete. Deterministic tests cover delayed immediate-FILLED acknowledgement reconciliation with multiple executions and incomplete history. This is an offline regression fix; it has not yet been validated by a subsequent TESTNET run.

**Remediation status:** implemented in PR #513 with the reconciliation barrier and fail-closed pair pause described above. Do not weaken duplicate suppression or rely on unique client IDs to solve repeated independent submissions. Review duplicate/out-of-order stream overlap and cancellation/fill races before accepting the lifecycle.

### Historical Incident B — residual-suppression defect (superseded by canonical sell-through)

The historical incident occurred after a SELL completion event: the RecoveryLedger reset, a keep amount was allocated, and a later strategy evaluation attempted a tiny SELL for residual inventory that failed MIN_NOTIONAL. The old remediation treated positive outstandingRecoveryAmount as a prerequisite for any further recovery SELL and suppressed additional SELLs after ledger reset.

**This old remediation is superseded.** The owner-approved current contract requires selling all exchange-sellable inventory above exact keepQuantity, preserving full accumulated cost basis, and explicitly classifying exchange-constrained dust. Do not use the historical residual-suppression rule or its regression as current acceptance criteria. See [CONSERVATIVE_DOMAIN_SPECIFICATION.md](./docs/domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md).

### Account reconciliation — still incomplete

The balance snapshot is account-wide and contains extensive non-zero pre-funded TESTNET assets. It is not a clean starting state and cannot identify which DOGE belongs to Harvester. The 50-order history summary is bounded and the journal's `commissionStatus: COMPLETE` does not include the actual commission amount or asset. Consequently:

- Do not equate the account's 12,321 DOGE with Harvester's active or free inventory.
- Do not infer the opening DOGE balance by subtracting the bounded 50-order net quantity.
- Do not treat journal `realizedNetProfit: 0.36335` as independently reconciled net profit until actual per-trade commissions are included.
- The incident segment arithmetic (12 BUYs: `+4,800 DOGE / -364.704 USDT`; recovery SELL: `-5,595 DOGE / +425.94735 USDT`) is `-795 DOGE / +61.24335 USDT` gross before fees. This is only a segment cash-flow delta; it is not standalone PnL because the SELL includes inventory accumulated outside those twelve BUYs.
- The latest no-open-orders snapshot and zero locked balances establish no currently reported locked quantity at those snapshot times; they do not establish internal Portfolio correctness.

To close reconciliation, run the newly added read-only command `pnpm --filter @coinzilla/harvester testnet:trades DOGEUSDT 1000` from the repository root. It calls Binance `GET /api/v3/myTrades` and prints trade ID, order ID, side, price, base/quote quantities, commission amount/asset, maker/taker role, and timestamp. Correlate every returned trade to order history and the Harvester journal. The command retrieves one page (up to 1,000 trades); if more than 1,000 executions exist, retrieve subsequent pages by passing the next trade ID as the optional third CLI argument (`FROM_ID`) before claiming completeness. Also obtain exact account balance snapshots immediately before and after the run if available. If an opening snapshot is unavailable, record the unresolvable baseline explicitly rather than inventing it.

### Updated acceptance status and execution gate

- [x] Real BUY and SELL executions have occurred on Binance Spot TESTNET.
- [x] At least one full recovery SELL and cycle-completion event have been observed.
- [ ] No duplicate/repeated BUY submission under rapid FILLED acknowledgement/fill races.
- [ ] Post-cycle strategy evaluation does not create an invalid residual-inventory recovery SELL.
- [ ] All execution reports, cancellation/replacement outcomes, and fills reconcile to complete exchange trade history.
- [ ] Actual per-trade commission amount/asset reconciles to Portfolio, RecoveryLedger, free inventory, and net profit. The order-history-only gross result is +10 DOGE / +0.57065 USDT before fees.
- [ ] A safe next-cycle BUY occurs after recovery completion, and the full cycle repeats without duplicate orders or invalid intents.
- [ ] Current exchange balances reconcile to a known opening baseline and Harvester-owned inventory.
- [ ] Deterministic regression tests, Harvester tests, workspace checks, and required CI pass on PR #513.
- [x] Live trading remains disabled.

**Historical milestone status at the PR #513 checkpoint:** the twelve-BUY acknowledgement/fill race was addressed and the +0.20730 USDT difference was identified as a cycle/session scope mismatch. The old residual-suppression policy was later superseded by the owner-approved sell-through contract. This checkpoint does not establish current implementation acceptance. Current blockers and CI are tracked in the final Conservative audit section below.


### Follow-up source review — conflicting duplicate execution records

A review of PR #513's immediate-FILLED acknowledgement reconciliation found one additional fail-closed gap: duplicate canonical fill IDs were deduplicated without verifying that repeated records carried identical payloads. A conflicting duplicate could be silently discarded, potentially hiding inconsistent exchange history. The engine now compares duplicate Fill.value payloads and pauses the affected pair with ACKNOWLEDGED_FILL_HISTORY_CONFLICTING_DUPLICATE if they differ. A deterministic engine regression test supplies the same fill ID with conflicting quantities and asserts that the pair pauses before accounting is applied. This is source-level hardening; it does not change the interpretation of the twelve distinct exchange BUY orders.


### TESTNET commission configuration change — 2026-11-04

The operator inspected the Binance Spot TESTNET API Keys / Account settings page. The earlier screenshot showed **Commissions: None**. The operator then changed the account-level commission setting to **0.1% maker & taker** (the later screenshot shows this selected setting). Treat the incident's reported zero per-trade commissions as consistent with the earlier `None` setting; do not assume those historical fills were charged 0.1%. For all subsequent TESTNET executions, expect the configured 0.1% maker/taker rate, but reconcile the actual commission amount and commission asset returned on every trade rather than calculating or assuming fees from the UI setting alone. This is an account setting, not a per-order or per-strategy setting; the page shows four registered API keys with TRADE, USER_DATA, and USER_STREAM permissions. Record the setting change timestamp before the next controlled run, and verify the effective commission configuration before submitting any order. This change does not resolve the existing +0.57065 USDT gross / +0.36335 USDT journal discrepancy; historical trades remain zero-commission according to the supplied trade records.

## Latest PR #513 review — 2026-11-04

- [ ] **Exact-head CI before merge:** an earlier run against the previous PR merge ref failed the MIN_NOTIONAL regression because it expected `ok: true`; the current branch test now expects `ok: false` and checks the validation error and one-time pause. Rerun required workflows on the exact current PR head; do not merge until green.
- [x] **Fee reserve policy:** recovery SELL sizing now reserves the greater of configured maker/taker rates; tests cover zero, maker-higher, taker-higher, equal, and invalid rates.
- [ ] **Follow-up PR — lifecycle coverage:** extend deterministic coverage for streamed non-terminal → FILLED/TRADE ordering, multiple partial fills, duplicate/out-of-order updates, cancel/fill overlap, REST/stream overlap, and concurrent price updates during transitions. Existing immediate-FILLED acknowledgement, incomplete-history, conflicting-duplicate, and twelve-sequential-fill regressions remain in PR #513.
- [x] **Historical profit reconciliation:** the five cycle profits sum to the session-wide +0.57065 USDT cash flow; the prior four cycles explain the +0.20730 difference. Historical fills reported zero commission. The later 0.1% maker/taker setting applies only to future executions.

Harvester remained stopped. No TESTNET restart or order submission occurred during this review. The remaining lifecycle matrix and future closed-session balance audit are follow-up work; they do not block merging the source remediation once exact-head CI is green. The TESTNET gate remains closed until those follow-up acceptance checks are complete.


## 2026-11-04 TESTNET incident — investigation progress and blockers

**Current state: STOPPED. Continue offline investigation and fixes only in follow-up PR #515. No TESTNET restart, order submission/cancellation, or account setting change is authorized.**

### Evidence established

- Twelve distinct DOGEUSDT BUYs were submitted: client IDs h-DOGEUSDT-32 through h-DOGEUSDT-43, broker order IDs 1197074 through 1197085, each 400 DOGE at 0.07598 USDT (30.392 USDT each), all TAKER. The Journal proves the race: all 12 FILLED acknowledgements were published before the first corresponding execution.fill_applied event. The last acknowledgement was at 14:46:17.482; the first fill was applied at 14:46:17.483 and the remaining fills only afterward. The strategy therefore reevaluated with stale lastBuyPrice/Portfolio state. This is a confirmed acknowledgement/fill reconciliation race, not 12 independent decisions or an ID collision.
- A 5,595 DOGE recovery SELL exceeded that burst's 4,800 DOGE by 795 DOGE, so it necessarily included earlier accumulated inventory.
- The saved Harvester Journal contains 21 BUY fills (8,400 DOGE; 635.85200 USDT gross) and 8 SELL fills (8,390 DOGE; 636.42265 USDT gross): +10 DOGE and +0.57065 USDT net quote cash flow before commissions.
- **Resolved: the 0.20730 USDT difference is a cycle/session scope mismatch, not missing PnL.** The five recovery-cycle profits are +0.07808, +0.03285, +0.06053, +0.03584, and +0.36335 USDT. Their exact sum is +0.57065 USDT. The previous four cycles sum to exactly +0.20730 USDT; +0.36335 is only the fifth/latest cycle. The fill cash flow between each RecoveryLedger reset matches its cycle-completion profit exactly.
- Historical exchange fills report zero commissions. The TESTNET account commission setting was subsequently changed from None to 0.1% maker and 0.1% taker. Do not retroactively apply the new setting to historical fills. Future accounting must use actual commission amount and asset on each fill.
- The account snapshot showed 12,321 free DOGE and 517 non-zero assets. Wallet balances are not Harvester-owned inventory and cannot be used as the strategy's opening position without explicit reconciliation.

### Source changes now made in PR #513

- [x] Recovery SELL fee reserve now uses the greater of configured maker and taker percentages; the role and reserved percentage are returned by the pure fee calculator.
- [x] Replaced the test that explicitly ignored taker fees with tests for zero, maker-higher, taker-higher, equal, and invalid fee inputs.
- [x] Updated Conservative strategy regression expectation to size a fee-bearing recovery SELL against the higher taker fee.
- [x] Added structured DEBUG records for every market-price event and correlated Conservative evaluation, including monotonic market/evaluation IDs, current/previous price, lastBuyPrice, reference overrides, active orders, pair settings, readiness/pause state, Portfolio/RecoveryLedger snapshots, decisions and executable intents.
- [x] Added per-fill accounting DEBUG records before and after applying an execution: trade/execution/order identity, side, price, base/quote quantity, actual commission asset/amount/status, prior Position and RecoveryLedger, applied/duplicate outcome, next Position and ledger, cumulative recovery/profit values. Rejected accounting records include errors and unchanged state.
- [x] Added regression tests asserting per-fill accounting audit records and correlated market-event/strategy-evaluation traces.
- [x] Add recovery-completion trace: exact eligibility inputs/result, free-quantity allocation, and pre/post reset state.
- [x] Added a full-cycle bootstrap regression asserting BUY/SELL accounting traces and eligible recovery-completion/allocation records. [ ] Verify actual logger DEBUG visibility/configuration in the local development run; injected-logger tests do not prove the operator's current logger configuration displays them.

### Remaining investigation — actual blockers

1. **Resolved — 0.20730 USDT discrepancy.** Five RecoveryLedger cycle profits sum exactly to +0.57065 USDT session quote cash flow. The +0.36335 event is the final cycle only; +0.20730 is the sum of the previous four. The Journal balance-audit command now sums cycle profits per JSONL session. Historical per-fill commission amount/asset fields were absent from the old Journal payload, so retain the zero-commission exchange result and use actual commission facts for future fills.
2. **Resolved — twelve-BUY burst root cause.** The saved Journal shows all 12 FILLED acknowledgements before the first execution was applied. The current engine awaits canonical REST fill-history reconciliation and applies the fills before the serialized transition releases. Existing delayed-ack tests plus the new 12-fill real-Conservative-policy regression cover the ordering and verify each subsequent BUY price advances from the preceding reconciled fill.
3. **Audit event/market interleaving.** Confirm a market event cannot evaluate against stale portfolio/order state while execution processing or REST reconciliation is pending. Add deterministic race tests where market updates overlap immediate FILLED acknowledgements, partial fills, cancel/fill races, duplicate/out-of-order executions, and reconciliation.
4. **Complete accounting invariants.** Verify base-asset commission reduces received BUY inventory / SELL inventory consumption correctly; quote-asset commission affects quote cost/proceeds exactly once; third-asset or incomplete commission data pauses safely. Compare Portfolio signed cash flow and RecoveryLedger values per fill and per cycle.
5. **Verify fee economics end-to-end.** Check all callers/config fixtures supply both makerPercent and takerPercent; test recovery quantity/price rounding and net-profit guarantee at both fee rates. Confirm Binance's effective 0.1% setting on a future controlled run and compare actual commissions, never estimates, after execution.
6. **Reconcile ownership and opening state.** Separate Harvester executions from unrelated wallet inventory and trades. The 12,321 DOGE wallet balance is not a valid strategy Position. Establish the exact opening baseline and owned order/trade set before interpreting cumulative holdings.
7. **Run verification on the exact latest PR head.** Run Harvester unit tests, coverage, workspace checks, lint/policy/security checks, and GitHub Actions. Earlier passing results belong to earlier commits; no latest-head green CI may be claimed until observed.

### Acceptance blockers before any TESTNET restart

- [x] Explain the 0.20730 USDT difference: five cycle profits sum exactly to +0.57065 USDT; the last cycle alone was +0.36335 and the previous four total +0.20730.
- [x] Explain the twelve BUYs: all 12 FILLED acknowledgements preceded the first applied fill; the stale-state race is fixed with an awaited reconciliation barrier and deterministic regression tests.
- [ ] Complete recovery-completion logging and deterministic lifecycle/race tests.
- [x] Confirm maker/taker fee reserve tests and exact recovery SELL tick/base-fee quantity boundaries pass on PR #515 code head `test(harvester): normalize fake broker order acknowledgement`; the complete production-caller audit remains open.
- [x] PR #513 source-remediation merge gate satisfied and merged. PR #515 has its own offline acceptance gate: lifecycle, accounting, fee-policy, and account-audit follow-up must be complete and exact-head CI green before #515 is merge-ready.
- [ ] Reconcile account opening baseline and Harvester-owned trades/orders; confirm the 0.1% commission setting is effective.
- [ ] Obtain explicit operator approval for a controlled TESTNET run.

PR #513 is already merged. Keep PR #515 draft until its offline acceptance criteria and exact-head CI pass. Do not restart TESTNET while any TESTNET acceptance gate remains open; merge status is not a trading-readiness signal.


## TESTNET incident — account balance audit implementation (2026-11-04)

- [x] Add an allowlisted account-snapshot lifecycle event with OPENING/CLOSING phase, exact free/locked/total quantities, deterministic asset ordering, and every broker-returned asset (not only enabled-pair assets).
- [x] Require Journal enabled, ready, and durably flushable before TESTNET trading can proceed. Read-only operation remains optional.
- [x] Capture and fsync OPENING balances after user-data subscription/queue barrier and before Conservative engine activation or market-price subscription/order evaluation.
- [x] During graceful shutdown, stop new intake and drain accepted user-data events; reconcile owned orders before capturing CLOSING balances and flushing while broker REST remains connected.
- [x] Mark CLOSING snapshot INCOMPLETE with explicit reasons when reconciliation fails, owned orders remain non-terminal, intake fails, or user-data/accounting remains unsafe. A failed closing snapshot fails shutdown.
- [x] Document account-vs-strategy ownership and that raw balance deltas do not prove PnL without execution, commission, external movement, and inventory valuation reconciliation.
- [x] Verify the engine-level regression: after a completed SELL the ledger is reset, exactly keepQuantity is allocated as free, extra residual remains active, and residual alone cannot generate another recovery SELL. The test exercises the real Portfolio, RecoveryLedger, and completion callback and passed in the latest 378/378 Harvester test run.
- [x] Run focused Harvester tests, full workspace tests/coverage, syntax/workflow lint, Utilities tests, and production dependency audit on the latest PR #515 code head; all required workflows passed, with Harvester 378/378.
- [x] Reconcile the historical +0.57065 gross exchange cash flow / +0.36335 final-cycle profit gap: previous four cycles total +0.20730 and all five total +0.57065. Historical commission amount/asset remains absent from the old Journal event payload; exchange records report zero commissions.
- [x] Classify the twelve distinct 400 DOGE @ 0.07598 TAKER BUYs: the Journal event ordering confirms the stale acknowledgement/fill race. Current code waits for canonical fill reconciliation; the delayed-ack and 12-fill real-policy tests cover it.
- [~] Lifecycle matrix in progress: streamed BUY partial fills through cumulative 0.4 → 0.7 → 1.0 and shutdown waiting for pending REST order reconciliation are now covered and passed CI. Existing tests cover cancel/fill, REST/stream overlap, duplicate fill, stale order updates, and immediate-FILLED acknowledgement. Remaining out-of-order/conflicting event permutations and further shutdown edge cases still require explicit review.
- [ ] Keep TESTNET stopped until all gates above and current-head CI are green. Do not submit orders as part of this PR work.

- [x] Add a read-only Journal audit command that pairs OPENING/CLOSING snapshots per JSONL session and reports exact per-asset balance deltas, missing/duplicate endpoints, and INCOMPLETE audit reasons.
- [ ] Run the Journal audit command against a real closed TESTNET session and reconcile its asset deltas with exchange trade/commission history and any external account activity.

## PR #515 offline follow-up progress — 2026-11-04

**Latest verified code increment:** `test(harvester): assert pair-specific maker fee policy`.

- [x] Task handoff and README / ROADMAP / TRADING_FIRST incident status no longer describe PR #513 as pending.
- [x] Remove duplicate OPENING snapshot flush-failure test.
- [x] Add recovery SELL exact tick-rounding and base-commission retained-inventory boundary tests.
- [x] Validate maker/taker percentages in both trading-config and market-readiness validation: accept 0 inclusive, reject 100 or higher.
- [x] Align trading config with the reported fee settings: USDT pairs use 0.1% maker/taker; FDUSD pairs retain the configured zero-maker policy and use 0.1% taker. README and config tests document/verify this split.
- [x] Add duplicate CLOSING snapshot endpoint and malformed Journal snapshot/session/profit record tests.
- [x] Add streamed BUY partial-fill sequence coverage (cumulative 0.4 → 0.7 → 1.0) and assert VWAP is reconciled before strategy advancement.
- [x] Add REST/stream stale-history protection: REST order history behind an already-applied stream fill is rejected without applying stale REST fills.
- [x] Add shutdown interleaving coverage: shutdown waits for REST owned-order reconciliation; failed reconciliation produces an INCOMPLETE CLOSING snapshot before broker disconnect.
- [x] Add CLOSING snapshot durability-failure coverage and verify broker disconnect still occurs while shutdown reports an incomplete result.
- [x] Add multi-fill commission reconciliation and verify Portfolio quote cash flow equals RecoveryLedger outstanding recovery.
- [x] Add fee-adjusted cycle reconciliation and verify Portfolio quote cash flow equals RecoveryLedger realized cycle profit and exact free keepQuantity.
- [x] Add concurrent market-update coverage while initial BUY acknowledgement and trailing BUY cancellation are pending; queued updates do not create duplicate active BUY orders.
- [x] Add out-of-order stale OPEN-after-FILLED event coverage.
- [x] Latest exact-head CI passed: Harvester 387/387, workspace tests and coverage, Utilities tests, JavaScript syntax, workflow lint/actionlint, and production dependency audit.
- [x] Lifecycle matrix complete offline: immediate-FILLED acknowledgement; streamed BUY/SELL partials; duplicate/conflicting fills; stale OPEN after FILLED; late PARTIALLY_FILLED after CANCELED; late FILLED after CANCELED/EXPIRED; stale REST history; REST/stream overlap; cancel/fill overlap; pending BUY/SELL acknowledgements; concurrent market updates during BUY acknowledgement and trailing cancellation; shutdown waiting for REST reconciliation; and CLOSING durability failure are covered by deterministic regression tests.
- [x] Accounting and fee policy complete offline: Portfolio/RecoveryLedger base/quote commission atomicity, unsupported third-asset/unknown commission failures, conflicting replay, multi-fill totals, fee-adjusted cycle profit, per-session Journal aggregation, the single active production sell-fee caller, maker/taker selection, [0,100) config/readiness validation, and price/quantity boundaries are covered.
- [x] Account-audit offline verification complete: OPENING/CLOSING ordering, OPENING and CLOSING durability failures, incomplete closing on reconciliation failure, duplicate endpoints, malformed session/phase/profit records, and per-session cycle-profit aggregation are covered. No eligible historical session has an OPENING snapshot; the historical incident Journal predates this feature, so actual balance-delta reconciliation remains a TESTNET-session task.
- [ ] Branch synchronization: `develop` has advanced with unrelated broker-package refactoring and CI coverage commits after this branch's merge base. The branch must be updated before merge; the available GitHub connector does not expose the repository-tree read or PR branch-update operation needed to perform that merge here.
- [ ] Historical account baseline: a future controlled session is required for an actual OPENING/CLOSING balance audit against exchange trades, commissions, and external account activity.


### Deterministic lifecycle acceptance evidence

| Race / lifecycle case | Regression evidence |
|---|---|
| Immediate FILLED acknowledgement waits for all execution history before strategy reevaluation | `waits for executions behind an immediate FILLED acknowledgement before evaluating the next market event` |
| Streamed partial BUYs reconcile cumulative quantity and VWAP | `reconciles streamed BUY partial fills cumulatively before advancing the strategy` |
| Multiple SELL fills reconcile before recovery completion | `reconciles multiple actual SELL fills before completing recovery` |
| Duplicate/conflicting fill facts do not double-apply accounting | Duplicate-fill engine test and conflicting replay accounting test |
| Out-of-order OPEN after FILLED is ignored | `ignores an out-of-order OPEN update after the BUY has already filled` |
| Late partial trade after terminal cancellation is rejected without mutation | `rejects a late PARTIALLY_FILLED trade update after terminal cancellation` |
| Late FILLED after partial CANCELED/EXPIRED remains reconcilable | `allows a late terminal FILLED update after partial CANCELED or EXPIRED races` |
| REST behind stream cumulative state is rejected | `rejects REST order history that is behind an already processed stream fill` |
| REST/stream overlap, missing fills, incomplete history, conflicting IDs | Existing focused reconciliation regression tests |
| Market updates while BUY/SELL acknowledgement is pending | BUY acknowledgement and pending SELL acknowledgement serialization tests |
| Market updates while trailing cancellation is pending | `serializes concurrent market updates while a trailing BUY cancellation is pending` |
| Shutdown while REST reconciliation is pending | CLOSING snapshot remains unpublished until reconciliation resolves; failure yields INCOMPLETE audit |
| CLOSING snapshot durability failure | Shutdown reports incomplete but still disconnects broker |

**Offline status:** the lifecycle, accounting, fee-policy, and account-audit implementation/test work is complete on the verified code head. Remaining gates are branch synchronization, a final exact-head CI run after documentation updates, and the separately authorized controlled TESTNET session.

Harvester remains stopped. No TESTNET write operations have been performed as part of this follow-up.


## PR #515 finalization and controlled TESTNET handoff — 2026-11-04

- [x] Offline lifecycle, accounting, fee-policy, and account-audit remediation completed; exact pre-documentation PR head passed Harvester 387/387 and all five required workflows (JavaScript Syntax, Utils Unit Tests, Dependency Audit, Test Coverage, Unit Tests).
- [x] Added `docs/TESTNET_VALIDATION_RUNBOOK.md` with explicit one-pair/one-cycle limits, current expected ZROUSDT configuration, account ownership baseline, OPENING/CLOSING verification, order/cancel authorization, execution and REST reconciliation, commission accounting, Portfolio/RecoveryLedger reconciliation, abort/recovery conditions, and evidence checklist.
- [x] README links to the controlled TESTNET validation runbook. Runbook is preparation only; it does not authorize execution.
- [ ] Synchronize PR #515 with current `develop` before merge. Latest observed comparison before the documentation-only commits: 53 commits ahead / 9 behind. The GitHub integration available to this agent cannot invoke GitHub's PR **Update branch** operation. Do not replace this with a force-push or unsafe ref update.
- [ ] After synchronization, verify exact PR head and merge base, rerun all required workflows, inspect every result, mark PR ready, and merge only when required checks are green.
- [ ] After merge, record the merge commit/message and confirm Harvester remains stopped. The joint TESTNET session remains a separate, explicit operator/assistant authorization gate.

**Safety:** No Harvester process was started. No TESTNET orders were submitted or canceled, no account settings were changed, and no exchange write operations were performed. Offline CI is not TESTNET acceptance.


### Branch synchronization correction — 2026-11-04

- [x] Branch synchronization completed by creating a real two-parent merge commit: `Merge latest develop into Harvester lifecycle audit`.
- [x] Merge commit: `0d018d1f2992744d50040b6c7dce9352373169c1`; parents are feature head `6a083d3011cacd682688c520683067eae00ce83b` and then-current `develop` head `ed48e31bebee12c93652f8879171997a21102d4c`.
- [x] Three-way tree comparison against the common ancestor found zero overlapping changed paths; the resulting PR comparison is `ahead` 58 / `behind` 0.
- [x] The resulting PR diff contains 17 Harvester files only; the broker/coverage changes from `develop` are incorporated in the merge base and are not part of the PR diff.
- [ ] Verify all five required workflows on the synchronized merge commit, then mark PR ready and merge only when every required check is green.

**Correction:** Earlier entries in this roadmap stating that the GitHub connector could not synchronize the branch are superseded by this completed merge. No TESTNET operations were performed.


## Post-PR #515 TESTNET handoff — 2026-11-04

- [x] PR #515 merged into `develop`; merge message: `test(harvester): complete incident lifecycle and audit verification`.
- [x] Exact merge commit: `26fab0c5c22822aa3a8cfa5f851f3e35da37aeb8`.
- [x] All five required workflows passed on that exact commit: Unit Tests, Test Coverage, JavaScript Syntax, Utils Unit Tests, Dependency Audit.
- [x] Offline lifecycle matrix, accounting/commission invariants, fee-policy audit, and OPENING/CLOSING snapshot/audit failure-mode coverage completed and merged.
- [x] Runbook audited against current config, scripts, source lifecycle behavior, and CI state. Read-only command reference and explicit 12-BUY stale-reference evidence requirements added.
- [x] `TRADING_FIRST.md` current incident and implementation status corrected; older pending-PR status explicitly superseded.
- [ ] Joint TESTNET session: verify TESTNET credentials/environment, live 0.1% maker/taker account setting, current ZROUSDT exchange filters, account baseline/ownership, and durable OPENING snapshot before first write.
- [ ] During the bounded one-pair/one-cycle session, verify no duplicate/stale same-price BUY, canonical fill reconciliation before next strategy transition, reconciled weighted BUY reference, actual commission amount/asset, Portfolio/RecoveryLedger/Journal agreement, and owned-order limits.
- [ ] Graceful shutdown, durable COMPLETE CLOSING snapshot, read-only per-session balance audit, and exact account trade-history reconciliation against external activity.
- [ ] Live partial-fill/cancel/late-event paths not naturally exercised in the bounded session remain NOT OBSERVED; do not mark them TESTNET-proven without a separately bounded and explicitly authorized scenario.
- [ ] Joint evidence review and explicit acceptance. Until then TESTNET validation remains NOT ACCEPTED and Harvester remains stopped.

**Safety during preparation:** no Harvester process was started; no TESTNET orders were submitted/canceled; no account settings were changed; no exchange write operations were performed.


## Live reconciliation incident follow-up — 2026-11-04

### Findings and implementation status

- **ACKNOWLEDGED_FILL_IDENTITY_MISMATCH — CONFIRMED cause; FIXED in PR #529.** Binance Spot `myTrades` records identify an execution by trade ID and exchange order ID; they do not carry a client order ID. The canonical Binance `Fill` adapter therefore correctly leaves `Fill.clientOrderId` undefined. The engine incorrectly required it to equal the acknowledged order's client ID. Reconciliation now accepts an absent fill client ID only when exchange order ID, market, and side match; a present but conflicting client ID still fails closed. Real TESTNET trade IDs 9939/9940 are added as broker-adapter fixtures.
- **REST_STREAM_RECONCILIATION_FAILED for order 698704 — broker contract defect CONFIRMED; exact incident trigger NOT REPRODUCED from the supplied log; fix implemented in PR #529.** Binance `allOrders` uses `orderId` as a lower-bound cursor, not an exact order lookup. The broker previously returned the entire cursor page, while shutdown reconciliation required exactly one canonical order. With subsequent session orders 698745 and 698746, a query starting at 698704 can legitimately return multiple rows. The shutdown error is emitted when the result is not exactly one `CanonicalOrder` (or the broker result is unsuccessful); the supplied incident excerpt omits the raw response/cardinality, so it cannot prove which branch fired or establish a missing field. The broker now validates the cursor page and filters to the exact requested exchange order ID before adapting/returning canonical history. Shutdown reconciliation additionally verifies the historical client order ID. Missing target history remains incomplete; unrelated rows are not mistaken for the target.
- **Submission-unknown after a FILLED acknowledgement — CONFIRMED gap; FIXED in PR #529.** Previously the engine left the local order PENDING without its already-known exchange order ID until fills had been reconciled. A failed history lookup therefore made later user-data events and shutdown reconciliation unable to correlate by broker ID. The registry now attaches the acknowledged broker order ID while retaining UNKNOWN / zero reconciled quantity; later canonical partial/final events or shutdown REST reconciliation can advance it safely. A pair pause remains sticky and is enforced at the final submission gate.
- **Readiness status — FIXED in PR #529.** Structured market-event diagnostics distinguish `brokerReady` from effective `tradingReady`; the latter is false while the pair is paused. The submit gate independently rejects a paused pair.

### SELL 698745 cancellation — strategy path CONFIRMED; raw event identifier NOT REPRODUCED

After BUY 698746 is fully reconciled, the Conservative engine intentionally cancels every active recovery SELL for that market before it reevaluates recovery SELL sizing against the newly increased owned inventory. This is the `BUY_FILLED_RECALCULATE_RECOVERY_SELL` path, not evidence of an unsolicited exchange cancellation. A replacement SELL is not sent in the same user-data callback: the engine waits for a subsequent eligible market evaluation. The cancellation request now emits structured intent diagnostics. Binance execution reports expose both `c` (current client order ID) and `C` (original client order ID); the adapter preserves both and the registry correlates by exchange order ID while retaining Harvester's original local client ID. The supplied `IR2BlFAQOVPlsCtcQqq2A5` value alone does not establish whether it was `c`, `C`, or a cancel request identifier; raw execution-report fields are required to attribute it conclusively. Do not call it cancel/replace without that evidence.

### Preserved accounting evidence

- Trade 9939: BUY 5 ZRO at 1.792; gross quote cost 8.96 USDT; base commission 0.005 ZRO; net base 4.995 ZRO.
- Trade 9940: BUY 5 ZRO at 1.789; gross quote cost 8.945 USDT; base commission 0.005 ZRO; net base 4.995 ZRO.
- Combined: net base 9.990 ZRO; gross BUY cost / outstanding recovery 17.905 USDT; net SELL proceeds 0; realized net profit -17.905 USDT.
- These values are exact regression expectations. The account-wide baseline remains external unless independently attributed; no wallet balance is adopted as Harvester inventory.

### Remaining evidence / status

- Source changes and regression fixtures are on `fix/harvester-live-reconciliation`. All five required CI workflows passed on PR head `4388fe596cff4eaeee22465510a4bb8373c79b78` after synchronization with `develop`. Subsequent offline review added strict canonical-history identity/status validation and regressions for conflicting fill ownership and delayed trade-history visibility; those additions require a fresh CI run.
- Cancellation raw Binance `c/C` values and any actual replacement after the next market event: **NOT OBSERVED** in supplied evidence.
- Live partial-fill, cancel/fill race, late-event and post-fix shutdown paths: **NOT OBSERVED**; no new TESTNET activity is authorized by this work.
- Portfolio/RecoveryLedger/Journal live reconciliation for these two fills is supported by the supplied arithmetic, but no new Journal file was supplied for an independent event-by-event audit. Verify the Journal in the next joint session.
- Harvester remains stopped. No order, cancellation, account-setting change, or exchange write was performed.


### CI iteration — 2026-11-04

- Initial draft PR CI confirmed JavaScript syntax, dependency audit, and utilities tests pass.
- The first full broker test run exposed two newly introduced fixture issues (an existing cursor test used a nonmatching order ID after exact filtering was added; the new `get-fills` fixture used `test` instead of the file's imported `it`). Both are corrected in the follow-up commit; rerun all workflows on the updated and then develop-synchronized head.


### Acknowledgement recovery domain-state correction — 2026-11-04

- The first CI run showed that `CanonicalOrder` intentionally forbids a broker ID on `PENDING`. This invariant is preserved. The acknowledgement attachment now moves the registered order to `UNKNOWN` with the exchange broker ID and zero reconciled quantity. `UNKNOWN` is an existing active status that can transition to PARTIALLY_FILLED/FILLED when canonical stream or REST execution facts arrive. This represents an acknowledged but not yet reconciled execution state without inventing applied quantity.
- Regression expectations now require UNKNOWN + brokerOrderId after a failed FILLED-ack reconciliation, then verify one-time application of a later stream fill while the pair remains paused.


- **CI regression refinement — 2026-11-04:** Broker-layer fixture verifies raw Binance `myTrades` fills have no clientOrderId. The engine intentionally enriches a reconciled fill with the known owned-order client ID before accounting/journaling; the engine-level assertion therefore verifies that enrichment rather than expecting the accounting event to remain without identity. The corrected expectation passed the five-workflow run on head `4388fe5`.


### Accounting and Journal regression follow-up — 2026-11-04

- Added the exact two-fill ZROUSDT regression to the accounting use case: 9939 / 698704 and 9940 / 698746, 0.005 ZRO commission each, net 9.990 ZRO, quote cash flow -17.905 USDT, RecoveryLedger buy cost/outstanding recovery 17.905 USDT, zero sell proceeds, and two deduplicated execution IDs.
- Added an engine event-publication regression proving two distinct reconciled executions produce exactly two `FILL_APPLIED` events with the corresponding canonical fill IDs, and a replay does not publish a third fill event. The Journal consumes the same EventBus stream; live Journal file contents still require inspection during the next joint TESTNET session.


### Post-review hardening — 2026-11-04

- Canonical historical order adaptation now rejects a missing/mismatched symbol and a missing or unsupported exchange status. Optional timestamps and unrelated exchange metadata remain optional. Regression coverage includes missing order/client IDs, symbol, side, status, and execution quantities.
- Added a delayed `myTrades` visibility regression: an empty history result cannot manufacture a fill or clear a pause; the acknowledged order remains UNKNOWN with zero reconciled quantity and its broker ID, then later REST history applies each exact execution once.
- Added conflicting fill ownership cases for broker order ID, market, side, and client order ID. Added acknowledgement replay checks so an identical acknowledgement is idempotent but changed immutable order intent cannot bypass validation merely because the client/broker IDs match.
- Current exact PR head `dcf2b63c98306dc149dde970c4710729f223d5f5` passed all five required workflows: Unit Tests, Test Coverage, JavaScript Syntax, Utils Unit Tests, and Dependency Audit. The branch remains synchronized with `develop`.
- These are offline verification results. Live partial-fill/cancel-race/late-event and post-fix shutdown behavior remain NOT OBSERVED and are reserved for the controlled joint TESTNET session. Harvester remains stopped; no exchange write was performed.


### Binance duplicate-fill timestamp parity — 2026-11-05

- [x] Root cause: Binance WebSocket `executionReport` exposes event publication time `E` and transaction time `T`. REST `myTrades.time` uses transaction time; using `E` for WebSocket canonical fills caused a timestamp mismatch for the same trade identity.
- [x] WebSocket canonical fills now use transaction time while order-update metadata retains event publication time.
- [x] Added full REST/WebSocket canonical Fill parity coverage with `E !== T`, plus Portfolio and RecoveryLedger duplicate-delivery tests for both arrival orders.
- [ ] Merge only after all required CI workflows pass on the synchronized PR head. No TESTNET operations are authorized by this offline fix.

- [x] Feature branch synchronized with the latest `develop` head before final CI verification.


## Automatic startup account audit — 2026-11-05

- [x] Capture and journal account-wide balances on every connected startup, including read-only `pnpm run dev`.
- [x] Capture and journal account-wide open orders on every connected startup using the existing broker connection.
- [x] Use shared `PREFLIGHT` phase for trading-enabled and read-only startup; durably flush each event before market subscriptions or engine activation.
- [x] Record existing orders without adopting or changing them. Pre-existing unowned orders are an observational audit finding, not a startup prerequisite; trading-enabled and read-only startup may proceed after the account snapshot and open-order audit are durably journaled.
- [x] Add regressions for exactly-once reads, event ordering and durability, existing-order preservation, query failures, and Journal flush failures.
- [x] Exact-head CI passed and the implementation merged in PR #545. TESTNET remains stopped pending a separately controlled session.

- [x] Feature branch synchronized with the latest `develop` head before final CI verification.

- [x] Re-synchronized with `develop` after the Binance fill fix merged; final CI is running on the current PR head.

- [x] Rechecked synchronization against the latest `develop` head immediately before final verification.

- [x] Rebased on the newest `develop` tip after concurrent broker documentation updates.

- [x] Confirmed no overlapping Harvester changes while synchronizing with the latest broker roadmap update.


## Journal restart recovery — intentionally disabled, 2026-11-05

PR #606 previously introduced Journal replay, domain-state restoration, and historical exchange reconciliation. That implementation is not part of the current runtime: `startHarvester` no longer projects or restores Journal records, `index.js` does not require a recovery snapshot, and the Journal service does not read previous sessions during startup.

The supported runtime starts with fresh in-memory Portfolio, RecoveryLedger, and order ownership state. It does not resume prior positions or orders. Existing exchange open orders remain unowned and are recorded in the PREFLIGHT audit, but their presence alone does not block startup. Harvester never adopts or cancels them. An execution event for an unowned order remains an ownership violation and pauses the affected pair. The current-session PREFLIGHT/CLOSING account audit and durable order/cancel intent barriers remain active.

Do not repair, expand, or re-enable restart recovery as part of the first Conservative TESTNET workflow. It is deferred unless the user explicitly requests it.


## Durable exchange-write intent barriers — retained P0 safety

- [x] Persist and durably flush each `order.submission_requested` intent before calling the broker placement port. If publication/flush fails, remove the unsent local PENDING order, pause the pair, and do not call the broker.
- [x] Add `order.cancel_requested` with immutable order identity, cumulative executed quantity, status, and reason; durably flush it before cancellation calls.
- [x] Fail closed on non-durable intent flushes; preserve the existing rule that unknown broker outcomes retain commitments and pause the pair.

These barriers deliberately await filesystem durability only immediately before exchange side effects. Ordinary market-price evaluation, strategy policy, and fill accounting remain asynchronous with respect to Journal delivery. They do not provide restart recovery.


## Single-writer process ownership — P0, 2026-11-05

- [x] PR #568 acquires an exclusive process lock in the configured Journal directory before opening a Journal writer.
- [x] PR #568 refuses a second local trading process using the same Journal directory.
- [x] PR #568 releases the lock only after runtime stop and Journal shutdown are confirmed; retains it when either is uncertain.
- [x] PR #568 never auto-reclaims stale locks; operator verification is required.
- [x] PR #607 adds a broker-wide host lock independent of Journal directory configuration, preventing concurrent same-user/same-broker trading processes across different Journal directories. All six required workflows passed on the exact final head before merge.
- [ ] Coordinate locks across different OS users or machines if multi-user or distributed same-account deployments become supported.


## P0 — Durable restart recovery (separate deferred scope #654; not this audit)

- [x] PR #568 — local Journal-directory single-writer ownership; acquired before Journal writer startup and broker connection, retained after uncertain runtime/Journal shutdown.
- [x] PR #607 — broker-wide same-host/same-OS-user/same-broker lock across different Journal directories; host lock is retained if Journal-lock release is uncertain.
- [x] PR #606 — strict Journal projection for order intents, acknowledgements, cancellation outcomes, exact fills, duplicate execution identities, recovery cycles, pauses, account snapshots, open-order snapshots, and process sessions.
- [x] PR #606 — rehydrate canonical Fill values, Portfolio, RecoveryLedger, free inventory, OrderRegistry, paused markets, completed-cycle identities, trailing-buy state, and cancel/replace intents.
- [x] PR #606 — load canonical Market metadata for enabled and historically owned symbols before restoring domain state.
- [x] PR #606 — reconcile restored owned orders through canonical client-order lookup, canonical order history, and complete paginated REST fill history; compare exact execution totals and identities.
- [x] PR #606 — reconcile account-wide open orders against durable Harvester ownership; reject unowned, duplicate, missing, or contradictory orders.
- [x] PR #606 — compare current free/locked balances against the original durable PREFLIGHT baseline, replayed Portfolio cash flows/inventory, and exact active-order reservations.
- [x] PR #606 — gate trading readiness on canonical order/fill reconciliation, account ownership audit, user-data stream safety, and absence of unresolved pause/cancel/replace intents.
- [x] PR #606 — preserve unresolved recovery replacement intents; only clear them after canonical exchange history proves the prior order was canceled or filled.
- [x] PR #606 — add rate-paced account trade-history pagination and exact exchange/Journal execution parity checks; reject unknown, missing, duplicate, or contradictory fills.
- [x] PR #606 — require complete account-wide trade-history evidence before recovered trading readiness; current Binance exchangeInfo omits delisted symbols, so the completeness gate intentionally remains closed.
- [ ] Add explicit pagination regression coverage for more than 1,000 fills and complete bootstrap restart fixtures for every supported lifecycle state.
- [ ] Query and reconcile account-wide external/manual trade history since the durable baseline to detect executions not attributable to recovered Harvester orders.
- [ ] Prove repeated full recovery attempts are idempotent across process crashes during reconciliation and recovery-cycle completion.
- [ ] Expand crash-boundary tests across submission intent, broker acknowledgement, partial/full fill, cancellation request/result, replacement intent, reservation commit/release, Journal closure, and process-lock release.
- [ ] Add persisted Journal truncation/missing-page fixtures and validate monotonic audit timestamps, post-close activity rejection, and contradictory cancellation/fill transitions.
- [ ] Keep TESTNET acceptance NOT ACCEPTED until the separate joint validation session.

**Current safety boundary:** PR #606 and PR #607 are merged into `develop`. Durable reconstruction and canonical exchange reconciliation are implemented for known Harvester-owned state. Trading-enabled restart after prior trading remains fail-closed because the current Binance exchangeInfo catalog cannot prove the historical symbol universe, including delisted markets. The complete account-wide external/manual execution audit and full crash-boundary matrix remain open. No TESTNET order submission, cancellation, modification, trading-enabled restart, or account mutation is permitted during this engineering work.

## Standalone TESTNET order-cancellation operator tool — 2026-11-05

- [x] PR #618 merged the explicitly invoked Spot TESTNET cancel-all command's non-interactive behavior, with an explicit account-wide warning.
- [x] Route script diagnostics through the shared `defaultLogger`, preserve per-symbol failure handling and final account-wide verification, and cover the workflow with deterministic offline tests; all required CI checks passed on the merged head.
- [x] Update the README and TESTNET operator runbook. No TESTNET account operation was performed; the controlled TESTNET acceptance gate remains separately closed.

## Scoped development logging — explicitly authorized 2026-11-05

This work is an explicit user-authorized exception to the general observability
deferral, limited to developer diagnostics. It does not reopen Journal recovery,
persistence, exchange operations, or broader observability projects.

- [x] Configure shared `@coinzilla/utils` transports: compact INFO console,
  DEBUG `logs/harvester.log`, and TRACE `logs/harvester-trace.log`.
- [x] Add interactive `/log info|debug|trace|status` console-level controls.
- [x] Keep commands disabled for non-interactive stdin and close diagnostic
  transports after existing SIGINT/SIGTERM runtime, Journal, and EventBus cleanup.
- [x] Add structured JSONL, console formatting, command, and shutdown-order tests.
- [x] Run Harvester tests, workspace coverage, syntax, dependency audit, and
  process-lock CI on the synchronized dependency-complete head; all required
  workflows passed. The read-only TESTNET integration job was skipped.
- [x] PR #632 merged into `develop` after shared logger API PR #631 and workspace CI passed.
- [x] PR #636 preserves semantic SUCCESS/SYSTEM console labels, distinguishes them during duplicate suppression, and keeps colored output within the 200-character limit.
- [x] Document concise log-message rules: omit redundant application prefixes, keep INFO operator-focused, move routine market evaluations to DEBUG, and avoid duplicate event records.
- [x] Console INFO output omits the redundant `INFO` label; SYSTEM is used for Journal, WebSocket, subscription, readiness, and shutdown lifecycle transitions.
- [x] The `pnpm run dev` child-process runner respects stdout/stderr and `logs_harvester/terminal.log` backpressure, pausing reads until writable destinations drain; focused tests cover forwarding, backpressure, and destination changes. This protects the development terminal/log mirror only and does not change Harvester trading or Journal transports.

## Historical Conservative strategy evidence audit — 2026-11-06 (evidence snapshot; contract superseded)

**Audit:** [AUDIT.md](./AUDIT.md)  
**Findings register:** [AUDIT_FINDINGS.md](./AUDIT_FINDINGS.md)  
**Execution ledger:** [AUDIT_EXECUTION_HISTORY.md](./AUDIT_EXECUTION_HISTORY.md)  
**Parent evidence:** [#645](https://github.com/45s/coinzilla/issues/645)  
**Specification follow-up:** [#646](https://github.com/45s/coinzilla/issues/646)  
**Baseline:** `develop` `4af3434f788b87139513921f220294ae90daf4d5`

The 2026-11-06 Journal (114 records) and the 100-row DOGEUSDT and ZROUSDT order-history exports have been parsed. Twenty-three current-session order submissions are correlated to Journal client IDs and exchange order IDs. ZRO trade-level quantities, commissions, realized quote profit (+0.01136454 USDT), residual base (+0.05 ZRO), and account balance deltas reconcile. The 0.05 ZRO consists of 0.01 free quantity allocated at recovery completion plus 0.04 active residual from fee-reserved sell sizing / quantity-step rounding.

DOGE remains **CONFLICT**: order history reports SELL 1276698 / client suffix -11 FILLED for 1,196 DOGE, while the Journal has no applied DOGE SELL fill and retains the order acknowledgement as OPEN; the CLOSING snapshot has 1,196 DOGE locked. The DOGE total balance delta exactly matches the three net BUY fills, not the reported SELL. The CLOSING account audit is INCOMPLETE with two unresolved owned orders. No cause or realized DOGE SELL PnL is asserted.

The original `harvester.log` and `harvester-trace.log` attachments have now been read-only integrity-verified and parsed; see [AUDIT_LOG_EVIDENCE_2026-11-06.md](./AUDIT_LOG_EVIDENCE_2026-11-06.md). ZRO Portfolio/RecoveryLedger runtime accounting is directly observed and reconciles. DOGE order 1276698 is OPEN with zero executed at the final runtime evaluations and absent from the 12 shutdown execution records, strongly favoring open/unfilled, but the separate exchange order-history row reports FILLED. DOGE remains CONFLICT; CLOSING remains INCOMPLETE with two unresolved orders, and the second order identity is not proven. No source fix is justified by current evidence; no TESTNET orders, cancellations, or restarts were performed.

The specification/config-boundary drift in fee-reserve policy, residual-inventory behavior, Portfolio recovery allocation, and zero-value input acceptance is tracked in [#646](https://github.com/45s/coinzilla/issues/646). The exact-once completion and full partial-fill/replacement lifecycle test gaps identified in `ACCOUNTING_INVARIANTS.md` are tracked in [#648](https://github.com/45s/coinzilla/issues/648). Keep the TESTNET gate closed until the DOGE order lifecycle and CLOSING account state are correlated against the original logs and any resulting defect is reproduced with deterministic offline regression coverage.


## Conservative audit closure sequence — 2026-11-06

**Status:** overall PARTIAL; DOGE SELL CONFLICT; ZRO arithmetic PASS; CLOSING audit INCOMPLETE; TESTNET acceptance NOT ACCEPTED. See [AUDIT.md](./AUDIT.md), [AUDIT_FINDINGS.md](./AUDIT_FINDINGS.md), [AUDIT_EXECUTION_HISTORY.md](./AUDIT_EXECUTION_HISTORY.md), and parent [#645](https://github.com/45s/coinzilla/issues/645).

### Gate 0 — evidence integrity

- [x] Obtain original harvester.log and harvester-trace.log read-only; preserve original attachments unchanged.
- [x] Independently verify SHA-256 against #645: harvester.log 5be28db5f6bc998e1190c1bddf4a91c97703fe9e502e98422932511a56ff633d; harvester-trace.log 4a030ccc4cd645b42ffdf01cb285d4cb1fa5d54417f8845a076448f1d20abcd3.
- [x] Record exact bytes, physical line counts, newline termination, timestamps, and key source-line ranges in [AUDIT_LOG_EVIDENCE_2026-11-06.md](./AUDIT_LOG_EVIDENCE_2026-11-06.md).
- [ ] Obtain the full CLOSING snapshot/open-order payload including both unresolved order identities, reservations, free/locked balances, source timestamps, and reconciliation diagnostics.
- [ ] Preserve full DOGE/ZRO order and trade history with commission asset/amount, redacted runtime config, and timestamped exchange filters.

### Gate 1 — reconstruct each order

- [x] Parse all 114 Journal records, both 100-row order-history exports, and every original application-log line after checksum verification.
- [ ] Retain source filename/line, original timestamp/timezone/milliseconds, and normalized UTC.
- [ ] Correlate by symbol, clientOrderId, orderId, tradeId, event type, and timestamp; never by price/quantity alone.
- [ ] Build a per-order timeline: decision intent → submission → acknowledgement → user-data update → cancel request/confirmation → fills → REST terminal state → closing reconciliation.
- [ ] Separate strategy decision from broker side effect, order status from trade execution, and Journal time from exchange time.
- [ ] Identify both unresolved orders and reconcile remaining quantity/reservation to free/locked balances.

### Gate 2 — accounting

- [ ] Resolve DOGE SELL 1276698 / suffix -11 against exchange trades and actual commissions. Explain history FILLED vs Journal OPEN vs 1,196 DOGE locked.
- [ ] Reconcile free/locked/total DOGE and USDT. Book SELL proceeds/PnL only after actual trade/commission evidence.
- [ ] Preserve DOGE BUY reconciliation: 1,200 gross, 1.2 fee, 1,198.8 net, 85.836 USDT debit.
- [ ] Preserve ZRO reconciliation: 40 gross BUY, 0.04 fee, 39.91 SELL, 0.05 residual, +0.01136454 USDT net.
- [ ] Verify 0.01 free allocation and 0.04 active residual against Portfolio/RecoveryLedger state.
- [ ] Verify ZRO order 727905 (5 @ 1.596, NEW, 7.98 USDT locked) at closing and identify whether it is one of the two unresolved orders.
- [ ] Rule out deposits, withdrawals, transfers, or manual trades before attributing all USDT movement to Harvester.

### Gate 3 — canonical contract and documentation consolidation (#646)

Owner decisions are closed and recorded in the canonical specification. This historical checklist is superseded: do not reopen maker/taker fee policy, the $0.01 minimum profit, exact keepQuantity, full accumulated cost recovery, residual sell-through, partial SELL behavior, or decision B. The active gate is to remove contradictory rule definitions, make every other artifact reference the canonical specification, and pass the repository-wide documentation audit before implementation.

### Gate 4 — canonical Conservative regression coverage (#648)

- [ ] Prove full accumulated spent recovery plus at least 0.01 net; no proportional cost reduction for keepQuantity.
- [ ] Prove exact keepQuantity and sell-through of every exchange-sellable residual; classify dust and preserve its basis.
- [ ] Prove actual base/quote commissions and reliable third-asset quote valuation; otherwise fail closed.
- [ ] Prove a partial SELL without a new BUY remains the same exchange order at the same price.
- [ ] Prove decision B: new BUY during OPEN/PARTIALLY_FILLED SELL cancels, reconciles terminal state and every fill/commission, updates accounting, then replaces.
- [ ] Cover fill-during-cancel including terminal FILLED, CANCELED, EXPIRED, REJECTED, UNKNOWN, incomplete history, and duplicate/conflicting fill identities.
- [ ] Prove exact-once completion/reset only at exact keepQuantity and realized net profit >= 0.01.
- [ ] Prove keepQuantity=0 through the complete end-to-end workflow.
- [ ] Run focused tests, Harvester suite, workspace coverage, syntax, and exact-head CI; record commit and outcomes.

### Gate 5 — user-data recovery (#626)

- [ ] Re-read original #626 acceptance criteria; #627/#629 merges are not acceptance evidence.
- [ ] Map each criterion to source, deterministic regression, failure mode, and exact CI head.
- [ ] Cover reconnect/resubscribe, REST reconciliation, lost/late/duplicate/reordered fills, unknown submission outcomes, cancel/fill races, and interrupted recovery boundaries.
- [ ] Keep #626 open until every criterion has a verified disposition and owner acceptance.

### Gate 6 — release decision

- [ ] Update #645 and all audit docs from verified evidence and exact tested commits.
- [ ] If a runtime defect is confirmed, create a focused issue and minimal regression-backed PR.
- [ ] Keep TESTNET acceptance closed until DOGE is explained, both unresolved orders are identified, critical offline tests pass, and a separate controlled session is explicitly authorized.

**Priority:** evidence integrity → exchange/order facts → accounting → domain decision → regression coverage → confirmed fixes → exact-head CI → parent/roadmap update → separately authorized TESTNET acceptance. No later gate passes while an earlier critical conflict remains open.


## 2026-11-06 original-log verification update

The previous statement that the application logs were inaccessible is superseded. Both original attachments have been parsed and checksum-verified; the durable derived evidence is in [AUDIT_LOG_EVIDENCE_2026-11-06.md](./AUDIT_LOG_EVIDENCE_2026-11-06.md). ZRO in-memory Portfolio and RecoveryLedger state is now a direct PASS. DOGE SELL 1276698 remains CONFLICT: runtime shows OPEN/zero executed and the shutdown execution inventory has no DOGE SELL, while exchange order history reports FILLED. The 1,196 DOGE locked and CLOSING `UNRESOLVED_OWNED_ORDERS:2` still require full closing open-orders and canonical trade/order facts. The ZRO BUY 727905 is one confirmed unresolved order; the identity of the second is not proven. Keep TESTNET acceptance NOT ACCEPTED and do not submit/cancel orders or restart Harvester to investigate.


## Conservative audit — 2026-11-06 post-CLOSING trade-history update

- [x] Preserve the operator-supplied 50-row DOGEUSDT actual-trade export, including all commission fields: [AUDIT_DOGE_TRADES_2026-11-06.md](./AUDIT_DOGE_TRADES_2026-11-06.md).
- [x] Preserve the operator-supplied 50-row ZROUSDT actual-trade export, including all commission fields: [AUDIT_ZRO_TRADES_2026-11-06.md](./AUDIT_ZRO_TRADES_2026-11-06.md).
- [x] Reconcile DOGE order 1276698 from two SELL fills: 1,196 DOGE; 85.93260000 USDT gross; 0.08593260 USDT fee; 85.84666740 USDT net. Both fills occurred after the ~07:58 CLOSING snapshot.
- [x] Reconcile ZRO order 727905 from trade 12182: 5 ZRO gross BUY; 0.005 ZRO commission; 4.995 ZRO net; 7.98 USDT quote debit. Fill occurred after the ~07:58 CLOSING snapshot.
- [x] Reconfirm ZRO recovery SELL 727904: 39.91 ZRO; 64.09546 USDT gross; 0.06409546 fee; 64.03136454 net; +0.01136454 USDT versus 64.02 USDT BUY cost.
- [ ] Obtain fresh read-only balances and open orders after these later fills; reconcile DOGE and ZRO free/locked/total inventory and USDT.
- [ ] Determine whether any later Harvester session/Journal reconciled the post-shutdown fills into Portfolio and RecoveryLedger.
- [ ] Obtain the full ~07:58 CLOSING open-orders payload to prove both unresolved order identities and reservations; later fills do not substitute for the historical snapshot.
- [ ] Keep TESTNET acceptance NOT ACCEPTED until account-wide reconciliation and recovery acceptance are independently proven.

**Interpretation:** The prior DOGE runtime-vs-history discrepancy is explained by chronology: runtime/CLOSING were observed before later exchange fills. This does not prove the stopped process accounted for those fills. ZRO 727905 is confirmed filled after CLOSING. Do not retroactively rewrite the historical CLOSING snapshot or claim post-shutdown processing.


## Audit continuation checkpoint — 2026-11-06 11:57 UTC

The live GitHub verification confirms PR #653 is still open/unmerged and its branch matched the recorded exact HEAD at the start of the check. All seven evidence/audit artifacts are in the PR diff and fetch successfully. Five Actions workflows associated with that exact HEAD passed, including their inspected jobs; the read-only Binance TESTNET integration job was skipped. The separate commit-status endpoint returned pending with zero statuses and must remain separately reported.

**Next priorities (still blocking acceptance):**
1. Obtain a fresh read-only TESTNET account-balance and open-order snapshot, including DOGE/ZRO/USDT free, locked, and total amounts, plus canonical order detail/trades/commissions. Do not infer later balances from the bounded 50-row trade exports.
2. Obtain the complete historical ~07:58 UTC CLOSING open-order payload to prove the identities and reservations of both unresolved owned orders.
3. Inspect any later Harvester Journal/runtime session for DOGE order 1276698 and ZRO order 727905; prove whether post-CLOSING fills were applied to Portfolio and RecoveryLedger. Until direct evidence exists, this remains UNVERIFIED.
4. Owner decisions are now closed. #646 tracks implementation/specification conformance and regression verification against the canonical specification; no further owner input is required.
5. Continue #626 with the existing fail-closed recovery contract; disposition the original empty TypeError cause and obtain controlled TESTNET/owner acceptance without weakening the gate or implying process-restart Journal replay.
6. Retain #649's merged exact-once regression as delivered coverage; map remaining lifecycle gaps to tests and acceptance evidence.

The GitHub connector used for this session is read-only for exchange evidence: it cannot expose secret values or dispatch the secret-backed exchange-history workflow. Do not request or expose API secrets. TESTNET acceptance remains NOT ACCEPTED; no exchange writes, order mutations, withdrawals, account-setting changes, or bot restarts are permitted as part of this audit.


## Evidence correction — previously supplied balances and open-orders snapshot (2026-11-06)

A review of parent issue #645 comment 6680483675 and the original Journal comment 6680290142 confirms that these records were already supplied by the operator and must not be described as absent.

### Historical account snapshots from the original Journal

| Phase | Asset | Free | Locked | Total |
|---|---|---:|---:|---:|
| PREFLIGHT (~07:00:04Z) | DOGE | 19,119.8 | 0 | 19,119.8 |
| PREFLIGHT (~07:00:04Z) | USDT | 8,954.11668541 | 0 | 8,954.11668541 |
| PREFLIGHT (~07:00:04Z) | ZRO | 245.125 | 0 | 245.125 |
| CLOSING (~07:58:11Z) | DOGE | 19,122.6 | 1,196 | 20,318.6 |
| CLOSING (~07:58:11Z) | USDT | 8,860.31204995 | 7.98 | 8,868.29204995 |
| CLOSING (~07:58:11Z) | ZRO | 245.175 | 0 | 245.175 |

The PREFLIGHT account snapshot was COMPLETE and its open-orders snapshot reported zero orders. The CLOSING account snapshot was INCOMPLETE with `UNRESOLVED_OWNED_ORDERS:2`. These are historical Journal facts, not current wallet balances.

### Operator-supplied latest open-orders snapshot

The operator also supplied a separate point-in-time open-orders response, preserved in issue #645 comment 6680483675. It showed one open order:

- Symbol: ZROUSDT
- Side/type: BUY LIMIT
- Exchange order ID: `727905`
- Client order ID: `h-971fc65d9a264984ab8aa7-23`
- Price: `1.59600000`
- Original quantity: `5.00000000`
- Executed quantity: `0`
- Status: `NEW`

This matches the ZRO BUY later confirmed by trade 12182 at 08:38:24.782Z. It is a supplied latest snapshot, but it is not the complete account-wide open-orders payload captured at the earlier ~07:58Z CLOSING event.

### Corrected evidence classification

- **Already supplied and preserved:** PREFLIGHT and CLOSING balances; PREFLIGHT zero-open-orders Journal record; separate latest one-order ZROUSDT open-orders snapshot; DOGE/ZRO order histories; bounded 50-row DOGE/ZRO trade exports; original Journal and parsed application-log evidence.
- **Still not supplied/located in the preserved audit:** the complete historical ~07:58Z CLOSING open-orders payload identifying both unresolved owned orders.
- **Still unverified:** a timestamped account-balance/open-orders snapshot after the later DOGE 1276698 and ZRO 727905 fills; any later Harvester Journal/runtime evidence proving those post-CLOSING fills were applied to Portfolio/RecoveryLedger.
- Do not call historical balances or the supplied one-order snapshot "missing". Do not call them post-fill/current balances. Do not infer internal accounting from exchange fills alone.

The raw evidence remains immutable. This correction updates derived audit interpretation only; it does not rewrite the original Journal or retroactively alter the CLOSING snapshot.


## Evidence chronology correction — post-CLOSING DOGE/ZRO executions (2026-11-06)

The exchange-side DOGE SELL order 1276698 did fill, but only after the Harvester runtime's final OPEN/zero-executed observation and the ~07:58 UTC CLOSING snapshot: trade 221990 (278 DOGE) at 08:03:01.841Z and trade 221991 (918 DOGE) at 08:03:18.202Z. Net proceeds were 85.84666740 USDT after 0.08593260 USDT quote commission. ZRO BUY 727905 also filled after CLOSING at 08:38:24.782Z, crediting 4.995 net ZRO after base commission.

This supersedes the earlier same-time DOGE conflict interpretation. It does not close the account settlement gap: post-shutdown Harvester Portfolio/RecoveryLedger application and post-fill balances/open orders remain UNVERIFIED. The complete historical CLOSING open-orders payload identifying both unresolved orders remains outstanding. Preserve the original CLOSING snapshot unchanged and keep TESTNET acceptance NOT ACCEPTED.


## Conservative owner decisions — canonical reference only

All owner-approved decisions are recorded in [CONSERVATIVE_DOMAIN_SPECIFICATION.md](./docs/domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md). This roadmap does not duplicate them. No Conservative product decisions remain open; the active work is documentation consistency, implementation, regression evidence, and exact-head CI.

## Conservative Strategy audit — current implementation gate (2026-11-06)

The canonical specification is [CONSERVATIVE_DOMAIN_SPECIFICATION.md](./docs/domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md). All owner decisions are closed; do not reopen them. This roadmap records implementation status and evidence only.

### Documentation consistency gate — PASS (2026-11-06)

- [x] Rewrite the canonical specification so earlier sections contain no obsolete or conflicting rules; keep one derived Mermaid algorithm in that document.
- [x] Convert README, trading-strategies, Accounting Invariants, Portfolio notes, glossary, behavior baseline, runbook, delivery plan, broker guide, and relevant roadmap sections to reference/evidence roles.
- [x] Mark historical decisions and implementation snapshots as superseded where they conflict with current Harvester contracts.
- [x] Reconcile #645, #646, #653, and #655 references with the canonical contract; remove duplicate owner-decision summaries from issue trackers.
- [x] Search the repository for coinToKeep/keepCoinQuantity, proportional cost recovery, maker-only fee assumptions, residual-suppression, partial SELL repricing, third-asset commission handling, and unresolved zero-value decisions.
- [x] Review the Conservative-matching documentation and README/roadmap results, plus the relevant source/test references. No active competing Conservative rule definition remains.

**Search/evidence scope:** the current PR tree contains 86 Markdown/MDX/text documents. Repository-wide Conservative search returned 32 matching files, including Harvester implementation/tests and relevant Harvester/legacy documentation. The matching documentation was reviewed and either converted to a canonical reference, reduced to implementation/test evidence, or explicitly marked historical. Root agent/workflow guidance contains no separate Conservative rules. The old behavior baseline is now a pointer only. Issues #645/#646 and PRs #653/#655 point to the same canonical document.

**Gate result:** PASS. Runtime implementation against the canonical specification is now authorized. This documentation result does not imply implementation, test, CI, or TESTNET acceptance.

### Implementation and regression gate

- [ ] Recover the full accumulated spent basis plus at least 0.01 net after actual commissions; never prorate cost for retained inventory.
- [ ] Sell all sellable quantity above exact keepQuantity; explicitly classify exchange-constrained dust and preserve its basis.
- [ ] Verify actual base, quote, and reliably valued third-asset commissions; fail closed when valuation is unavailable.
- [ ] Implement decision B: cancel the open SELL on a new BUY fill, reconcile terminal state and all fills/fees, update accounting, then replace from updated position.
- [ ] Prove partial SELL without a new BUY keeps the same exchange order and same price.
- [ ] Cover FILLED, CANCELED, EXPIRED, REJECTED, UNKNOWN, fill-during-cancel, and incomplete-history outcomes.
- [ ] Verify keepQuantity=0 only through the complete end-to-end workflow.
- [ ] Run focused Harvester unit/integration/syntax/coverage checks and exact-head CI. No TESTNET acceptance is implied by offline checks.

### Current CI baseline

At starting PR #653 head 5f2b88f1697b36225c4579212bf8044c2527c2f2: Unit Tests FAIL; Test Coverage FAIL; JavaScript Syntax PASS; Utils Unit Tests PASS; Dependency Audit PASS. The legacy commit-status endpoint reported zero statuses. These are the baseline to improve, not a passing acceptance result.

PR #653 must remain open and unmerged until all acceptance criteria pass and the owner explicitly authorizes merging. Restart reconciliation remains separate in #654.
## Operator workstation lifecycle clarification — 2026-11-06

**Owner clarification:** Harvester runs on the operator's personal PC, not an always-on server. The operator may stop the process while exchange orders remain open. Binance orders can continue resting and may fill while Harvester is offline. This is an expected operating condition, not by itself a strategy defect, policy violation, failed order, or missing owner action. Do not require 24/7 uptime or treat post-shutdown fills as evidence that the operator did something wrong.

**Correct lifecycle contract:**
1. On shutdown, record the last observed state and identify owned open orders; do not assume stopping the local process cancels exchange orders.
2. While offline, exchange orders remain exchange-side and can be partially/fully filled. Harvester cannot update its in-memory Portfolio/RecoveryLedger during that interval.
3. On the next startup, before enabling new trading, reconcile exchange-owned open orders, all fills since the last durable checkpoint, commissions, and authoritative balances. Apply fills idempotently, resolve terminal/partial order states, then rebuild Portfolio/RecoveryLedger and reservations. Keep trading fail-closed until reconciliation succeeds.
4. Never retroactively rewrite a historical shutdown snapshot. Report subsequent fills as post-shutdown exchange events and reconcile them in the next session.

**Reclassification of 2026-11-06 evidence:** DOGE SELL 1276698 filled at 08:03:01.841Z and 08:03:18.202Z after the ~07:58Z CLOSING snapshot / ~07:58:16Z process stop; ZRO BUY 727905 filled at 08:38:24.782Z. These are expected exchange-side events during operator downtime. The absence of same-session post-fill Portfolio/RecoveryLedger updates is therefore NOT a defect and NOT an acceptance blocker by itself. The relevant engineering question is whether the next Harvester startup reliably discovers and applies these fills before trading resumes. That restart-reconciliation behavior still needs source/test evidence and, where appropriate, controlled TESTNET validation.

Do not request the operator to keep the PC/process online continuously, nor request a restart or new exchange action as a prerequisite for offline code investigation. No live exchange action is authorized by this clarification.


## Historical audit continuation — source-verified residual and restart blockers (2026-11-06; superseded status)

### Residual sell-through — implementation IN PROGRESS

The original defect was source-confirmed: the strategy gated SELL creation on positive `outstandingRecovery`; completion allocated `keepQuantity` and reset the ledger while leaving active residual above the reserve. The old regression encoded the unwanted suppression.

**First implementation pass committed:**
- Removed the positive-outstanding-recovery gate for active inventory above exact `keepQuantity`; the original cost/proceeds basis remains required.
- When cumulative net proceeds already cover cycle cost plus `minProfit`, residual SELL pricing uses the current market reference rounded up to the price tick, not an artificial one-tick floor.
- Added pre-intent `MIN_QUANTITY` and `MIN_NOTIONAL` checks. Untradeable quantity-step/minimum-filter remainder is reported as `EXCHANGE_CONSTRAINED_DUST` with exact quantity and limiting rule; no invalid SELL is emitted.
- Recovery completion now waits without pausing or resetting the ledger while active quantity remains above `keepQuantity`; the engine requests another serialized strategy evaluation after the completed SELL.
- Added strategy and completion regressions for profitable residual sell-through, quantity-step dust, minimum-notional dust, exact reserve completion, duplicate SELL suppression, and missing cost/profit basis. Existing accounting tests already cover actual base- and quote-asset commissions.

**Not yet accepted:** exact-head CI exposed additional test fixtures that assumed a completed cycle could leave residual active inventory. Those fixtures are being corrected to distinguish exact reserve, sellable residual, and exchange-constrained dust. Do not mark this fix PASS until the full Harvester suite and exact-final-HEAD CI pass.

### Current audit work ordering
1. Fix Conservative policy and lifecycle defects, starting with residual sell-through while preserving the original cost/profit basis.
2. Verify actual base/quote commission accounting, exact `keepQuantity`, quantity-step handling, minimum quantity/notional, post-only behavior, and explicit dust classification.
3. Add focused regression tests for residual sell-through, base-asset commissions, quantity-step/minimum-notional dust, exact retained quantity, repeated evaluation, and duplicate-order prevention.
4. Run the Harvester tests and exact-final-HEAD CI; update the Conservative specification, audit findings, ROADMAP, issue #646, parent issue #645, and PR #653.
5. Keep PR #653 open/unmerged until Conservative policy acceptance criteria are met. Do not make TESTNET acceptance claims without actual evidence.

Process-restart reconciliation is explicitly deferred and is not part of the active Conservative strategy implementation sequence.

## Deferred — process-restart recovery (last roadmap item; not an active audit blocker)

**Status: DEFERRED. Do not implement as part of the current Conservative strategy/policy audit.** The current work is limited to making Conservative strategy decisions and order lifecycle behave according to the owner-approved policy. This item must not interrupt, delay, or become an acceptance prerequisite for the current audit.

When separately prioritized in the future, the restart-recovery work may cover the workstation-offline lifecycle: exchange orders may fill while Harvester is stopped; on a later startup, reconcile those fills, actual commissions, order states, and balances before new trading. No 24/7 uptime is required. Preserve historical shutdown snapshots. Track the deferred investigation in [issue #654](https://github.com/45s/coinzilla/issues/654).


## Conservative Strategy audit — canonical authority and current status (2026-11-06)

The sole authoritative rule definition is [CONSERVATIVE_DOMAIN_SPECIFICATION.md](./docs/domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md). All other docs, READMEs, issues, PRs, tests, and implementation notes are references, evidence, or derived artifacts only. The canonical Mermaid algorithm is a visualization of its written rules, not a second source of truth.

Owner decision B is final: a new BUY fill while a recovery SELL is open requires cancellation, terminal-state and complete fill/commission reconciliation, accounting update, then replacement planning from the updated position. Incomplete reconciliation fails closed. A partial SELL without a new BUY remains the same exchange order at the same price.

The repository-wide documentation consistency gate passed in commit 9c3691c9546dc35ec0c92e7e7e33912a13fca1c8. Runtime implementation against the canonical specification may now proceed. The required implementation and regression scope is defined by the canonical specification. Restart reconciliation remains separately tracked in #654.

At the exact starting PR #653 head 5f2b88f1697b36225c4579212bf8044c2527c2f2, Unit Tests and Test Coverage failed; JavaScript Syntax, Utils Unit Tests, and Dependency Audit passed. The legacy commit-status endpoint reported no statuses. Do not infer completion from prior CI checkpoints. PR #653 remains open and unmerged; no merge is authorized.


## Conservative accounting conformance follow-up — 2026-11-06

The latest source inspection found that the implementation still consumed the RecoveryLedger's legacy `buyCost` projection in two decision-critical paths: recovery completion in `start-harvester.js`, and order-commitment allocation in `conservative-trading-engine.js`. The engine integration test also passed the obsolete `buyCost` argument to `evaluateRecoveryCompletion`. These paths now use `Position.spent` as the authoritative accumulated cost basis and `RecoveryLedger.netSellProceeds` only for confirmed cumulative SELL proceeds. Accounting-delta diagnostics now derive outstanding recovery and realized profit from Position.spent plus ledger net proceeds.

Changes committed on this branch:
- `4ba244b6680ddd0279e3570abeb4bbfd965b910f` — recovery completion now supplies `position.spent.amount`.
- `50116cd09526bac563dfe7887aeb5a00b27821e1` — order-commitment allocation derives outstanding recovery from Position.spent minus confirmed net SELL proceeds; diagnostics derive the same projections.
- `b5cd59a05da69830242f16c282e2ddc237d38edb` — corrected the engine regression to assert/use `spent` rather than `buyCost`.

The RecoveryLedger's legacy `buyCost` remains a compatibility projection for historical serialization/restart scope (#654), not a strategy decision input. Remaining references must be reviewed to ensure they are compatibility/diagnostic assertions only. No local test execution is claimed. The GitHub commit workflow/status endpoints currently return no runs and no statuses for the final commit; exact-head test/CI verification remains outstanding. PR #653 remains open and unmerged. Restart reconciliation remains deferred to #654.


## Conservative Strategy — actual DOGE/ZRO outcome conformance (2026-11-06)

**New active priority: reconcile observed exchange outcomes against the canonical Conservative contract, then fix every proven mismatch.** The actual DOGEUSDT and ZROUSDT trade exports are not merely incident background; they are concrete acceptance evidence. The raw exports remain immutable in [AUDIT_DOGE_TRADES_2026-11-06.md](./AUDIT_DOGE_TRADES_2026-11-06.md) and [AUDIT_ZRO_TRADES_2026-11-06.md](./AUDIT_ZRO_TRADES_2026-11-06.md). The sole expected-behavior authority remains [CONSERVATIVE_DOMAIN_SPECIFICATION.md](./docs/domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md).

### Execution order

1. **Reconstruct expected C-strategy decisions from the original session evidence.** For each DOGE/ZRO pair, align config values (especially `keepQuantity`, order quantity, price step, fee settings and exchange filters), market references, strategy decisions, submitted order parameters, broker acknowledgements, and every distinct exchange trade. Use the original Journal/logs and order histories; do not infer missing config or decision inputs.
2. **Reconcile each BUY.** Sum distinct gross base and quote quantities; subtract actual base-asset commissions from acquired quantity; add quote-asset commissions and reliably valued third-asset commissions to `Position.spent`. Verify order VWAP and completed-BUY sequencing.
3. **Reconcile each SELL.** Compare planned quantity/limit price with actual order parameters and fills. Sum gross executed base/quote; apply actual commissions by asset; calculate net proceeds and cumulative realized profit against the full accumulated `spent` basis. Never use configured fee estimates as actual commissions.
4. **Reconcile inventory and completion.** Calculate net position quantity after every fill; compare sold quantity and remaining inventory with exact configured `keepQuantity`, exchange quantity step, minimum quantity/notional, and any explicitly classified `EXCHANGE_CONSTRAINED_DUST`. Confirm that no sellable residual was silently retained or that ledger completion/reset occurred prematurely.
5. **Reconcile lifecycle behavior.** Verify partial SELL/no-new-BUY remains the same order at the same price; new BUY during open SELL triggers cancel → terminal-state/full-fill/commission reconciliation → accounting update → replacement; duplicate fills are no-ops; incomplete facts fail closed. Distinguish events occurring after the recorded workstation shutdown from events the running process was expected to handle.
6. **Classify every mismatch with evidence.** Each item must be marked FOLLOWED, VIOLATED, or UNVERIFIED and point to the exact expected decision, actual exchange fact, and source/log/test evidence. A difference is not automatically a code defect: identify whether it is strategy calculation, config, exchange filter, fee handling, broker/order lifecycle, or an evidence gap.
7. **Fix proven defects test-first.** Add a focused regression reproducing the mismatch, implement the smallest safe correction, then run focused Harvester tests and the full exact-head CI matrix. Update this roadmap, AUDIT.md, AUDIT_FINDINGS.md, the relevant raw-evidence interpretation (without editing raw rows), issue #646, parent #645, and PR #653 in the same work session.
8. **Close only on evidence.** The DOGE and ZRO reconciliation tables must balance from fills through Position.quantity, Position.spent, cumulative net SELL proceeds, retained inventory/dust, and final profit. No unresolved VIOLATED item may remain; UNVERIFIED items must be explicitly dispositioned against the acceptance scope. Keep PR #653 open/unmerged until all acceptance criteria pass and the owner explicitly authorizes merge.

### Known starting arithmetic (exchange evidence, not yet a full strategy verdict)

- **DOGE:** three BUY fills = 1,200 gross DOGE, 1.2 DOGE base commission, 1,198.8 net acquired; BUY quote cost = 85.836 USDT. Post-CLOSING SELL order 1276698 filled 1,196 DOGE at 0.07185; gross proceeds 85.9326 USDT, actual quote commission 0.0859326 USDT, net proceeds 85.8466674 USDT. Arithmetic net profit against those BUYs is +0.0106674 USDT. The simple quantity difference is 2.8 DOGE before comparing with configured keepQuantity and exchange constraints. The SELL fills occurred after the ~07:58 UTC CLOSING snapshot/process stop; do not claim the stopped process applied them.
- **ZRO:** eight BUY fills = 40 gross ZRO, 0.04 ZRO base commissions, 39.96 net acquired, and 64.02 USDT BUY cost. SELL order 727904 filled 39.91 ZRO; gross proceeds 64.09546 USDT, actual quote commission 0.06409546 USDT, net proceeds 64.03136454 USDT, realized profit +0.01136454 USDT. The 0.05 ZRO remainder is 0.01 configured retained quantity plus 0.04 residual in the historical completion record; verify whether the residual was legally sellable or correctly classified as exchange-constrained dust under the actual symbol filters. BUY order 727905 later filled 5 gross ZRO with 0.005 ZRO base commission (4.995 net credited) after CLOSING; this belongs to a later exchange event, not the earlier strategy snapshot.

These arithmetic checks establish exchange-side cash/base flows only. They do not by themselves prove that the original strategy decision, planned order quantity/price, internal state transition, or post-shutdown processing was correct. The two trade exports are bounded 50-row queries, not exhaustive all-time history.

**Scope boundary:** process-restart reconstruction remains deferred to #654. This active work uses the already supplied session decisions and actual fills to validate Conservative strategy calculations and lifecycle; it does not expand into restart implementation or require 24/7 uptime. No TESTNET writes or bot restart are authorized by this plan.

 
## 2026-11-06 — actual DOGE/ZRO conformance checkpoint

**Completed investigation:** actual DOGE/ZRO SELL quantities and prices were recalculated from the audit-baseline config and canonical Conservative equations. Under candidate quantity-step assumptions (DOGE 1, ZRO 0.01), the calculations match the submitted order parameters: DOGE 1,196 @ 0.07185; ZRO 39.91 @ 1.606. Both use ordinary LIMIT with 0.1% planning reserve, exact keepQuantity (DOGE 1, ZRO 0.01), and minProfit=0.01. The original logs only say `Exchange trading rules validated`; exact historical tick/step/minimum-filter values are not preserved, so historical filter-based calculation and residual dust classification remain UNVERIFIED.

**Confirmed discrepancy:** ZRO order 727904 filled profitably (+0.01136454 USDT), but historical recovery completion allocated 0.01 ZRO and reset the ledger while 0.04 ZRO remained active. Repeated following evaluations returned NO_ACTION with actions=[] despite the active residual. At baseline, RecoveryLedger.buyCost was the only accumulated cost-basis record; reset discarded the 64.02 USDT recovery basis. Root cause: completion accepted active quantity greater than keepQuantity; strategy suppressed residual SELL once outstanding recovery reached zero. The current branch implementation corrects both: defer completion while any active residual exceeds keepQuantity, continue residual SELL planning after profit is secured, and classify exchange-constrained dust without resetting cost/proceeds basis.

**DOGE disposition:** order 1276698's two distinct SELL fills occurred after shutdown. Exchange-side profit is +0.01066740 USDT and remaining quantity is 2.8 DOGE (1 keep + 1.8 excess). The stopped process was not expected to account for those fills. Historical decision-time exchange filters were not preserved, so the historical 1.8 DOGE dust classification and later in-process application remain UNVERIFIED. This is a documented historical evidence limitation, not a blocker for this audit; restart reconciliation remains deferred to #654.

**Regression work:** added actual DOGE trade-ID/commission fixture, actual ZRO eight-BUY/one-SELL fixture, exact residual/dust assertions, and an exact ZRO completion-gate regression. Current branch source contains the residual sell-through and exact-keep completion correction. No strategy specification change was needed; the canonical specification remains the only rule authority.

**Verification:** test changes were committed on the audit branch (latest test commits: `4915171b8c136ae44892d230e403289fe256dc8d`, `030f93feb765cdc68ccf75f3ae8b0cbf6c81c331`, `ecc8196c1c50a9d09a06cec3c17b297017805b84`). Local repository execution is unavailable in this environment because the GitHub clone could not resolve `github.com`; GitHub Actions/commit statuses have not appeared for these commits. Do not report the new tests as passed. Re-run focused tests and the complete Harvester/CI matrix on the exact final branch HEAD before acceptance.

PR #653 remains OPEN and UNMERGED. #654 remains deferred and out of scope. No TESTNET writes, cancellations, new orders, or bot restarts were performed.


## 2026-11-06 lifecycle audit — partial BUY while recovery SELL is open

**Confirmed source finding — VIOLATED:** `processUserDataEventTransition()` in `src/use-cases/conservative-trading-engine.js` accounts a BUY TRADE fill but returns from the generic `PARTIALLY_FILLED` branch before canceling an active recovery SELL. Cancellation currently occurs only in the later FILLED-BUY path. The canonical specification requires the existing SELL to be canceled and fully reconciled after any new BUY fill, including a partial BUY fill, before recalculating SELL quantity/price.

**Fix and regression added:** commit `9c054725e03a751b06b8a3421e859201640c6469` adds cancellation/reconciliation/replanning for a partial BUY while a recovery SELL is active; commit `3cfc085d0caecc9a74ca9cb279298dde7c6075df` adds a regression asserting the BUY remains PARTIALLY_FILLED, the old SELL is canceled, and a replacement SELL is opened only after reconciliation. Exact-head GitHub Actions had no runs at the time of this update; test and fix are therefore **PENDING VERIFICATION**, not passed.

**Related lifecycle checks:** partial SELL fills are applied through the paired idempotent accounting transition and do not trigger completion; the cancellation-race regression at test line 2551 proves one application when a raced SELL fill is replayed. Dust becoming sellable after a later BUY still requires a dedicated regression. Completion must continue to require exact keepQuantity and preserve above-keep dust/basis without allocation/reset.

The canonical specification remains the sole source of truth and is unchanged. PR #653 remains open/unmerged; #654 remains deferred. No TESTNET writes, cancellations, new orders, or bot restarts were performed.


## Lifecycle audit refinement — partial BUY replacement path (2026-11-06)

The partial-BUY fix required one additional source correction: `evaluateConservativeStrategy()` had an early return for any partially filled BUY, which suppressed all SELL planning even after the old recovery SELL had been reconciled. That gate is removed; active BUY/SELL orders themselves continue to suppress duplicate intents, while SELL planning can now use the updated active Position. Commit `546c2388962774ea89bcc78a98e319337252c895` contains this policy correction; regression commit `58f9369a5ef4b74b83b8680b174ac99765e3a310` updates the scenario to apply the BUY fill to both Position and RecoveryLedger and verify a larger replacement SELL while the BUY remains PARTIALLY_FILLED.

Current lifecycle classifications:
- Partial SELL exact-once accounting: FOLLOWED in-process; paired accounting and stable fill fingerprints, with partial/terminal regression coverage.
- SELL fill racing cancellation and late stream replay: FOLLOWED in-process; test verifies one accounting application.
- Any BUY fill while recovery SELL is open: source correction and regression added; **PENDING VERIFICATION** until exact-head tests run.
- Dust becoming sellable after a later BUY while preserving accumulated basis: UNVERIFIED; source retains Position.spent and evaluates aggregate active quantity, but a dedicated dust-plus-later-BUY regression is still missing.
- Exact keepQuantity on completion: FOLLOWED by the completion predicate and tests; above-keep residual/dust defers free allocation and both Position/RecoveryLedger reset.

Latest source/test head known at this checkpoint: `58f9369a5ef4b74b83b8680b174ac99765e3a310`. No GitHub Actions runs were visible for that exact head. Do not claim tests passed. The canonical specification remains the only source of strategy rules and is unchanged. PR #653 remains open/unmerged; #654 remains deferred. No exchange or TESTNET actions were performed.


## 2026-11-06 audit continuation — partial BUY policy regression

Source/spec comparison found one stale regression in `src/domain/strategies/conservative/strategy.test.js`: it expected a PARTIALLY_FILLED BUY to suppress both strategy sides. The canonical contract requires active orders to suppress duplicate intents, but does not suppress a valid recovery SELL; the BUY remains active and no duplicate BUY is created. Current `evaluateConservativeStrategy` already plans the SELL while `hasActiveBuy` prevents another BUY. Updated the test to assert that behavior (commit `b1f28cb4dbe49e1d51cf110db1f1307e3d2644e1`). This is a test/spec alignment change, not a recovery, Journal, or broker implementation change. Exact-head CI/test execution is still pending; no pass is claimed.


## 2026-11-06 audit continuation — dust plus subsequent BUY regression

Added a domain regression covering the canonical dust lifecycle: a profitable SELL leaves 0.05 above `keepQuantity` that is below the quantity step; a later BUY is then applied to both Position and RecoveryLedger; the test asserts the old dust remains in active quantity, the original spent basis is preserved and increased by the new BUY cost, prior net SELL proceeds remain included, and the combined inventory produces a valid aggregate recovery SELL. Test-only change: `f8ff57f7170cb0750ee540862e393c1aadad6590`. No recovery, Journal, or broker implementation was changed. Exact-head CI/test execution remains pending.


## 2026-11-06 audit finding — dust disposition is not durably recorded

The canonical specification requires recording the exact `EXCHANGE_CONSTRAINED_DUST` quantity and limiting exchange filter. `evaluateConservativeStrategy` returns `inventoryDisposition`, but the engine's no-action path returns before publishing `STRATEGY_DECISION`; its evaluation log records `reason` and `actions` but omits `inventoryDisposition`. The lifecycle decision DTO also accepts only strategy, symbol, reference price, and actionable order facts. Therefore the dust quantity/filter classification is transient in the returned decision and is not evidenced in the lifecycle event/log path. **AUDIT GAP / NOT FIXED.** The Position quantity and spent basis remain active; the newly added later-BUY regression covers their aggregation. Per owner instruction, no Journal, event DTO, broker, or recovery implementation was changed. Track the missing durable dust disposition record separately from the completed test-only accounting regression.


## 2026-11-06 audit continuation — conflicting partial-BUY lifecycle assertion

A second stale test was found in the full-cycle `conservative-trading-engine.test.js` scenario. It asserted that a partial fill of the second BUY must leave the existing recovery SELL untouched until the BUY becomes FILLED. This directly contradicted canonical specification §5 (owner decision B: any new BUY fill while SELL is OPEN/PARTIALLY_FILLED requires cancel, full reconciliation, and replacement) and the current engine branch that performs that sequence on PARTIALLY_FILLED BUY. Updated the test to expect cancellation/reconciliation/replacement after the partial fill, preserve the BUY's PARTIALLY_FILLED state, then cancel/reconcile that replacement again when the remaining BUY fills. The expected order sequence now includes both replacement SELLs. Test-only commits: `fad7f3165b9ee3d515406693489923aeee753179`, `445c20d0441e56ea5c8126aa44d0a66b4938f9ae`, `03f27ac273b371e219bf358fd7df510d847eabfd`. No recovery, Journal, or broker implementation was changed. Exact-head tests remain unverified.


## 2026-11-06 audit continuation — lifecycle regression precision

After aligning the full-cycle partial-BUY scenario with owner decision B, its fill-count, order-count, and cancellation assertions were updated for both cancellation/reconciliation cycles (follow-up test commit `9c9b0d12fcd04d2ce08915a09e4431241bfd7f9f`). The partial-SELL/no-new-BUY regression was also strengthened to assert the same SELL remains PARTIALLY_FILLED with unchanged limit price and original quantity, with no duplicate SELL or cancellation after a market-price event (test commit `bbeb8ce4f39111bc0f076b99b9dc2001766332c6`). These are test-only changes. Exact-head CI remains unverified.


## Conservative lifecycle audit continuation — 2026-11-06 21:05 +02:00

- [x] Re-inspected the exact PR #653 HEAD against the canonical Conservative specification.
- [x] Verified source/test coverage for partial BUY + active recovery SELL, partial SELL stability without a new BUY, residual sell-through, dust combined with a later BUY, MAX_QUANTITY/MAX_NOTIONAL sell-through, and completion blocked by excess inventory.
- [ ] Add focused terminal recovery-SELL regression cases for CANCELED, EXPIRED, and REJECTED, including partial terminal executions and reconciliation failures. See F-011 in `AUDIT_FINDINGS.md`.
- [ ] Execute focused tests, Harvester suite, and exact-head CI; current HEAD has no associated PR-triggered Actions runs visible in the audit query.
- [ ] Resolve exact dust quantity/limiting-filter durable recording only within the separately approved scope; do not expand Journal/event infrastructure under this audit instruction.

This pass found a regression-proof gap, not a confirmed source/spec runtime mismatch. PR #653 remains open and unmerged. The canonical specification is unchanged and remains the sole rule authority. Restart durability, Journal/event infrastructure, brokers, exchange integrations, and TESTNET operations remain outside this audit.

## Conservative audit — F-011 test coverage added (2026-11-06)

- [x] Add focused terminal recovery-SELL regression cases for CANCELED, EXPIRED, and REJECTED, including partial execution, actual quote commission, missing history, and conflicting duplicate fill facts.
- [ ] Execute focused engine tests and the complete Harvester test suite on the exact current PR head; verify exact-head CI before marking F-011 complete.

These are test-only changes. No production, Journal, broker, exchange, restart, or TESTNET work is included. PR #653 remains open and unmerged.


## Current Conservative audit status — 2026-11-06

- [x] Source/test coverage reviewed for partial SELL stability without a new BUY.
- [x] Source/test coverage reviewed for decision-B BUY-fill cancellation, terminal SELL reconciliation, and replacement ordering.
- [x] Focused terminal recovery-SELL regression cases added for CANCELED, EXPIRED, and REJECTED, including partial executions, actual quote commission, and incomplete/conflicting history fail-closed cases.
- [x] Residual sell-through, quantity-step and MIN_NOTIONAL dust, MAX_QUANTITY/MAX_NOTIONAL caps, exact keepQuantity completion gating, and dust-plus-later-BUY basis preservation are represented in regression tests.
- [ ] Execute focused Harvester tests and the full Harvester suite.
- [ ] Verify all required workflows and commit statuses on the exact final PR HEAD.
- [x] Durably record exact retained-dust quantity and limiting exchange filter in the recovery completion event; completion validates the evidence before allocating keepQuantity + dust.

The checked items above indicate source/test inventory review and test presence only, **not passing test execution**. Local cloning is unavailable because github.com DNS resolution failed; exact-head Actions/status queries currently return no runs/statuses. PR #653 stays OPEN and UNMERGED. The canonical specification remains the sole rule authority; it is unchanged.

## Conservative Strategy owner clarification — dust is a retained keep bonus (2026-11-06)

The canonical rule is **unsellable exchange-constrained dust is retained on top of configured `keepQuantity`**. Example: `keepQuantity = 1.00` plus `0.04` unsellable dust means retain `1.04` total. Do not discard dust, force an exchange-invalid SELL, or count it as sold. After all exchange-sellable quantity is sold and the other completion conditions pass, retain `keepQuantity + dust`; dust alone does not block completion/reset. Preserve the dust quantity and its accounting provenance.

This supersedes older roadmap/audit wording that required above-keep dust to remain active, block completion/reset, or wait for a later BUY to make it sellable. The sole rule authority is [CONSERVATIVE_DOMAIN_SPECIFICATION.md](./docs/domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md).

**Historical checkpoint (superseded 2026-11-07):** source completion/accounting and durable dust evidence were still unverified at this point. The audit-closure section below records the implemented validation and lifecycle event. Exact-head CI remains pending.

## Conservative Strategy implementation audit closure — 2026-11-07

**Status: CLOSED for in-scope source implementation and documentation alignment.** This section supersedes earlier roadmap checkpoints that listed the residual/dust, partial-BUY, terminal-SELL, and durable dust-evidence work as outstanding.

The active audit scope is now implemented and represented by offline regressions:

- Continue SELLing all exchange-sellable position quantity above the exact configured `keepQuantity`, including after cumulative net proceeds have already met the minimum-profit target. Residual pricing uses the validated current market reference; the original full cost/proceeds basis remains intact until completion.
- Apply exchange quantity/price/notional filters and fee reserve to each residual SELL. Respect maximum quantity/notional by selling in valid chunks; do not classify price-filter blocks as dust.
- Classify only exchange-constrained quantity-step, MIN_QUANTITY, or MIN_NOTIONAL remainder as dust, with exact remainder and evaluated filter evidence. Retain that dust as a bonus on top of `keepQuantity`.
- Validate the dust evidence at completion and persist its quantity, reason, and relevant filter/evaluated values in the recovery-completion lifecycle event. Allocate `keepQuantity + dust` and reset the recovery basis only after terminal FILLED execution reconciliation and the actual net-profit gate pass.
- Preserve the same partial SELL order and price when no new BUY occurs. For any BUY fill during an active recovery SELL, cancel and reconcile terminal state plus every actual fill/commission before calculating and submitting the replacement. Keep a partially filled BUY active without creating a duplicate BUY.
- Reconcile CANCELED, EXPIRED, and REJECTED recovery SELL outcomes before reevaluation; missing/conflicting history fails closed.
- Cover exact-once accounting/completion and the full partial-fill/cancel/replace lifecycle. The engine lifecycle regression now runs for both positive `keepQuantity` and supported `keepQuantity = 0`.

The test-to-contract evidence map is [ACCOUNTING_INVARIANTS.md](./docs/domain/ACCOUNTING_INVARIANTS.md). The audit findings and historical evidence limitations are recorded in [AUDIT.md](./AUDIT.md) and [AUDIT_FINDINGS.md](./AUDIT_FINDINGS.md).

**Explicitly outside this closure:** workstation process-restart reconstruction remains deferred to [#654](https://github.com/45s/coinzilla/issues/654). The historical CLOSING open-order payload and post-fill account snapshot were not preserved; those historical facts remain UNVERIFIED and non-blocking. Exact historical DOGE/ZRO exchange filters were not captured, so no candidate filter assumptions are represented as historical facts. No TESTNET acceptance is claimed.

**Next phase — verification only:** execute the focused Conservative tests, full Harvester test suite, and required exact-head CI. The tests are present but have not yet been run on this updated head; no passing test or CI result is claimed. Fix any failures in that separate phase. This audit closure does not authorize TESTNET writes, bot restarts, or merging PR #653.
