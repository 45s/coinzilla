# Harvester Roadmap

## Independent operational observability

The trading-first priority governs trading implementation and does not make the separately approved staged EventBus/Journal observability work dependent on a TESTNET trading cycle. Follow [the Journal Integration Roadmap](./docs/JOURNAL_INTEGRATION_ROADMAP.md) one small PR at a time. This work must remain optional and must not gate, delay, or change trading behavior.

## Mission and delivery priority

**Mandatory execution order:** follow [Trading First](./docs/TRADING_FIRST.md). The first deliverable is a working Conservative TESTNET trading loop. Journal, durable persistence, comprehensive restart recovery/reconciliation, operational hardening, and Aggressive are secondary; do not make them blockers for the first working cycle. Implement only the minimum safety needed for a controlled TESTNET order flow.

**First priority: implement Conservative (Free-Roll) and make Harvester execute a complete, safe, repeatable trading cycle.** The existing `apps/bot-free-roll/README.md` is the strategy source of truth. Harvester must implement that strategy using its own shared engine and domain model; do not copy the old app's broker/runtime implementation. Aggressive is explicitly deferred until Conservative is working end to end on TESTNET. Architecture expansion, optional features, and optimization come after that.

The paragraph below was an earlier audit snapshot and is superseded by the current implementation status and checklist in this roadmap. On `develop`, Harvester now composes the Conservative trading engine when TESTNET trading is explicitly enabled, submits strategy intents through the engine, tracks owned orders, processes canonical fills, updates Portfolio/RecoveryLedger, and has fake-broker coverage for a complete recovery cycle. A real Binance TESTNET cycle is still unverified; do not treat the offline simulation as exchange proof.

### Definition of "Harvester can trade"

The first proof is deliberately scoped to one explicitly enabled TESTNET pair and a clean test account. Expand to multiple enabled pairs and shared-asset allocation after that first cycle works.

A first-trading release is not complete until a TESTNET end-to-end scenario demonstrates:

1. Start from the documented command and load/validate configuration.
2. Connect to the selected broker and establish market-data and user-data streams.
3. Load account balances and exchange trading rules for every enabled pair.
4. Establish the minimum safe TESTNET starting state: fresh balances and exchange filters for enabled pairs, a known price, and no unexplained pre-existing orders or strategy inventory. Comprehensive historical reconciliation and durable restart recovery are deferred.
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
  configured pair-investment limit, actual commission-aware recovery planning.
- Submission: local PENDING canonical order registration, exchange-rule
  validation, broker submission, canonical acknowledgement verification, and
  unknown-outcome pause behavior.
- In-process lifecycle: market prices invoke the policy; only registered
  Harvester orders are accepted; canonical TRADE fills update Portfolio and
  RecoveryLedger; terminal full fills trigger the next decision.
- Recovery completion: a fully filled SELL must satisfy the actual cumulative
  net-profit condition and leave at least `keepQuantity`; the retained amount
  moves to free inventory and the cycle ledger resets.
- Startup: explicit TESTNET trading opt-in, exactly one enabled pair, a fresh
  account snapshot, no open orders, and no pre-existing base inventory.
  Per-order BUY/SELL quantities are checked against current free account
  balances. The default config now enables only `ZROUSDT`.

Offline bootstrap coverage simulates the complete first recovery cycle:
initial BUY → actual full BUY fill → next BUY and recovery SELL → actual full
SELL fill → profit check → free-inventory allocation. This is a fake-broker
simulation, not evidence of a real Binance TESTNET run. Reservations, stream
reconnect reconciliation, restart recovery, and a real TESTNET execution
remain unfinished. Do not mark the first trading milestone complete until the
real TESTNET cycle and required CI checks pass.

## P0 — Deliver the first working trading cycle

Work through these items in dependency order. Keep the scope limited to what is necessary to execute and verify the first strategy safely.

### P0.1 — Freeze the first executable strategy scope: Conservative Free-Roll

- [x] Select Conservative (Free-Roll) as the first strategy. Its source of truth is `apps/bot-free-roll/README.md` v0.014; Aggressive is deferred to P1.
- [~] Port the Free-Roll business rules into Harvester domain policies without copying the old app's broker/runtime implementation. Exact-decimal pricing, recovery planning, fee-policy, fill-accounting, and completion primitives now exist; they are not yet connected to the Trading Engine or order execution.
- [x] Define the first Conservative order-intent contract and pure strategy evaluation context (last traded price, pair config, active Position/recovery ledger, active orders, and exchange filters). The policy emits initial/standing BUY and recovery SELL intents without broker I/O.
- [~] Preserve initial BUY pricing: last traded price multiplied by `(1 - priceStepPercent / 100)`, rounded down to the broker tick. A pure exact-decimal calculator and boundary tests have been added on the current task branch; broker-rule loading and strategy integration remain.
- [~] Preserve standing-order behavior: the pure Conservative policy now emits both a recovery SELL and next standing BUY when inventory exists, and suppresses duplicate intents for active orders. Engine submission, fill lifecycle, balance reservations, and cycle completion remain.
- [~] Preserve pooled recovery accounting across partial/cancelled/replaced SELLs; only confirmed net SELL proceeds reduce outstanding recovery cost. Harvester now has a quote-currency fill projection and immutable `RecoveryLedger` that accumulates actual BUY costs and confirmed net SELL proceeds across fills. Order lifecycle integration, durable deduplication, and restart recovery remain.
- [~] Preserve fee rules: actual fill commission rates are calculated from canonical fills; the configured maker/taker ceiling is activated only after a non-zero actual commission is observed; base/quote fees are supported; third-asset or incomplete commission data is rejected. The fee policy and calculation are implemented as pure domain functions but are not yet wired into strategy evaluation.
- [~] Preserve free-coin rules: `Position` now separates active and free base inventory, and `Portfolio` supports transferring exactly `keepQuantity` between those buckets. A pure completion gate requires a fully filled SELL, sufficient actual cumulative net profit, and enough residual active inventory. The order-lifecycle trigger and ledger reset are not yet integrated.
- [ ] Preserve partial-fill policy: capture each execution accurately, but do not advance the strategy until the relevant order is fully filled and reconciled. Fill-level ledger updates are implemented as domain primitives; gating strategy advancement on final order reconciliation remains.
- [ ] Preserve external inventory separation; never adopt wallet balances/deposits/manual trades as strategy inventory without explicit reconciliation.
- [x] Ensure all deterministic strategy calculations and decisions are plain pure functions; the Conservative policy is a broker-independent pure function and never calls the broker or performs I/O.
- [ ] Record any unresolved Free-Roll requirements as explicit blockers; do not invent financial behavior.

### P0.2 — Trading rules, account state, and startup readiness

- [~] Load and validate exchange symbol filters for enabled markets: price tick, quantity step, min/max quantity, min/max notional, and supported order types are loaded/validated; authoritative post-only crossing validation remains.
- [x] Normalize broker filters into a stable Harvester-owned domain/application shape; do not leak exchange SDK payloads.
- [~] Load account balances and distinguish free, locked, and total balances. A canonical free/locked account snapshot is loaded and checked for enabled-market assets; balance allocation and reconciliation against strategy-owned inventory/commitments remain.
- [ ] Validate configured per-pair investment against available quote balance and coordinate shared quote assets across pairs (e.g. multiple USDT pairs).
- [ ] Seed market state with a current REST price/snapshot before relying on WebSocket trade events; define stale/missing-price behavior.
- [~] Subscribe to user-data events and surface connection status. For the first controlled TESTNET cycle, use a fresh account snapshot, known enabled-pair filters, and a clean account with no unexplained pre-existing orders/inventory. Do not block the first cycle on full historical REST reconciliation or durable replay. On reconnect or an unknown order outcome, pause new submissions and refresh the affected balances/open orders/order status before resuming; comprehensive history reconciliation is deferred.
- [~] Implement minimum process readiness for the first TESTNET cycle. When trading is explicitly enabled, startup requires TESTNET mode, exactly one enabled pair, active user-data stream, fresh account snapshot, empty open-order set, and zero pre-existing base inventory for that pair. Read-only broker mode remains available; reconnect still fails closed.
- [~] Enable the first TESTNET order only after minimum checks: explicit `HARVESTER_TRADING_MODE=testnet`, non-production NODE_ENV, validated config, enabled-pair exchange filters, fresh account snapshot, active user-data stream, no open orders, and zero pre-existing base inventory. The policy prevents a new BUY from taking outstanding recovery capital plus its quote notional beyond the configured pair investment. Before submission the engine checks BUY quote notional and SELL base quantity against the latest free account balances; an unaffordable BUY is deferred while a sellable recovery SELL may still proceed. Explicit reservation accounting remains.
- [ ] Validate environment/config combinations; require explicit TESTNET/live mode selection and explicit live-trading opt-in. Fail closed on ambiguous or missing production settings.
- [ ] Validate enabled pair configuration against actual exchange assets/filters and fail startup with actionable diagnostics when incompatible.

### P0.3 — Order intent, safety checks, and reservations

- [~] Define canonical Harvester order intent/command contracts using existing `@coinzilla/entities` types wherever suitable. `createPendingCanonicalOrder` builds immutable PENDING canonical orders; the complete engine command contract and lifecycle integration remain.
- [~] Implement pure order construction and validation functions for price/quantity precision, tick/step rounding, min/max quantity, min/max notional, and post-only constraints. `validateOrderAgainstTradingRules` now enforces exchange increments and supported price/quantity/notional bounds with exact decimal arithmetic. Post-only crossing validation, complete order construction wiring, and runtime enforcement remain.
- [ ] Implement shared pre-trade safety checks: enabled pair, READY state, fresh price, available quote/base balance, investment cap, per-pair risk cap, account-wide asset availability, and strategy takeover state.
- [ ] Define and implement BUY quote and SELL base reservation rules before submission.
- [ ] Define reservation states and transitions for created/submitted/acknowledged/partially-filled/filled/cancel-pending/cancelled/rejected/expired/unknown outcomes.
- [ ] Reserve conservatively before an order can race with another order; reconcile the exchange response before releasing or resizing reservations.
- [ ] Ensure multiple SELL reservations never exceed available base inventory and multiple BUY commitments never exceed available quote/investment limits.
- [ ] Treat timeout/disconnect during place/cancel as UNKNOWN, not failed; reconcile by client order ID, order status, open orders, and trade history before retrying.
- [ ] Implement idempotent client order IDs and safe retry/reconciliation rules.
- [ ] Implement cancel/replace workflow that processes fills received during cancellation before calculating replacement quantity.
- [ ] Never blindly resubmit a state-changing request after an unknown transport outcome.

### P0.4 — Live order and fill lifecycle

- [~] Normalize user-data order/execution events at the broker adapter boundary. Binance TRADE execution reports are now converted into canonical `Fill` entities using cached symbol metadata; non-trade order events remain normalized broker events.
- [~] Normalize actual fills with stable execution IDs, market, side, executed base and quote quantities, timestamps, and actual commission amount/asset. Missing/invalid execution IDs and incomplete fee facts fail closed.
- [ ] Reject malformed, incomplete, or unsupported fills visibly; third-asset commissions remain unsupported and must not be silently ignored.
- [~] Deduplicate fills using stable exchange execution identity and conflicting-fact fingerprints; serialize user-data event handling and Portfolio/RecoveryLedger updates in process memory. Durable deduplication remains.
- [~] **Verify order ownership before accounting:** the in-process engine applies updates only to orders registered with Harvester; unknown/manual executions pause the pair and are not accounted. Additional multi-symbol and duplicate/out-of-order event cases remain.
- [ ] Handle NEW, PARTIALLY_FILLED, FILLED, CANCELED, REJECTED, EXPIRED, and exchange-specific terminal/unknown states.
- [~] Apply only incremental actual executions to shared Portfolio and Conservative RecoveryLedger in one immutable use-case transition; never apply requested order quantity or cumulative executed quantity twice.
- [ ] Reconcile REST trade history/open orders with stream events to cover disconnect gaps and out-of-order delivery.
- [ ] Ensure cancel/fill races, duplicate events, late events, and out-of-order events cannot double-count fills or release filled reservations.
- [~] Feed successful fill/order transitions back into strategy evaluation. The engine triggers the next decision after a terminal full-fill update and deliberately waits after partial fills; live bootstrap callback composition remains.
- [ ] Ensure the bot does not wait for a new market-price event when a fill/order-state transition itself requires an immediate strategy reaction.

### P0.5 — Trading Engine orchestration

- [~] Implement the first in-process Conservative trading workflow. `makeConservativeTradingEngine` now connects market prices to the pure policy, order registry, validated broker submission, canonical order updates, ownership checks, fill accounting, and immediate reevaluation after terminal order updates. Bootstrap composition, account readiness, reservations, and recovery-cycle completion remain.
- [ ] Keep strategy-specific policy out of the engine and broker adapter.
- [ ] Ensure exactly one strategy controls each pair's shared Position at a time.
- [ ] Serialize or otherwise consistently coordinate concurrent market, order, fill, and cancellation events.
- [ ] Prevent stale snapshots from producing duplicate or conflicting orders.
- [ ] Handle strategy takeover as a controlled workflow: stop outgoing intents, reconcile/cancel relevant orders, account for in-flight fills/reservations, then activate the incoming strategy.
- [ ] Make process startup, partial startup failure, reconnect, pause/resume, and shutdown idempotent and observable.
- [~] Replace the current price-only callback flow with the actual decision-to-order execution pipeline. A tested application use case now converts pure Conservative intents into registered, exchange-rule-validated broker submissions; bootstrap composition and event-driven lifecycle integration remain.
- [ ] Keep `runtime.placeOrder` as a controlled engine capability; callers must not bypass safety checks by invoking it directly.

### Deferred follow-up (not a P0 gate) — Persistence, restart, and comprehensive recovery

- [ ] Decide the minimum durable state required before enabling unattended trading: orders/client IDs, fills/deduplication IDs, reservations, Portfolio/Position, strategy control state, and relevant configuration/version.
- [ ] Integrate the already available shared Journal read/replay capability into Harvester's domain-specific durable state. This is deferred until after the first successful TESTNET trading cycle; do not implement it as a prerequisite.
- [ ] Persist execution facts before acknowledging successful processing/recovery.
- [ ] On startup/reconnect, reconcile persisted state against exchange balances, open orders, and available order/trade history before READY.
- [ ] Define behavior when exchange history is incomplete, retention-limited, or conflicts with local state; fail closed and require operator intervention where safe reconciliation is impossible.
- [ ] Test crash/restart at each order/fill transition and ensure no duplicate order or fill application.
- [ ] Do not claim exactly-once delivery; guarantee idempotent accounting through durable execution identity and reconciliation.

### P0.7 — First strategy end-to-end verification

- [~] Add deterministic offline strategy-policy scenarios for initial BUY, duplicate suppression, combined standing BUY/recovery SELL intents, and missing exchange rules. Full broker-port lifecycle simulator scenarios remain.
- [ ] Add opt-in Binance TESTNET integration tests that place and cancel small, bounded test orders only when explicitly enabled.
- [~] Add a bootstrap-level TESTNET-mode fake-broker test that starts with a clean one-pair account, submits the initial Conservative BUY, applies its canonical full fill, and immediately submits the next BUY plus recovery SELL. The fake-broker bootstrap scenario now exercises the full first recovery cycle through BUY fill, simultaneous next BUY/recovery SELL placement, SELL fill, profit verification, and allocation of configured free inventory. A real Binance TESTNET run remains; the README now contains the controlled runbook, clean-account prerequisites, shutdown/restart warning, and expected order sequence.
- [ ] For the first end-to-end proof, use one explicitly enabled TESTNET pair and verify its configured investment/balance limits. Add multi-pair shared-asset allocation after this first cycle works.
- [ ] Verify post-only rejection, insufficient balance, min-notional, precision, stale price, stream loss, and unknown order outcome all fail safely.
- [ ] Verify loss protection and Conservative takeover do not force a loss-making sale or operate the same Position concurrently.
- [ ] Provide a documented, reproducible TESTNET runbook and evidence (logs/journal/test results) for the first successful cycle.
- [ ] Keep live trading disabled until the user explicitly approves a separate live-trading milestone after TESTNET evidence is reviewed.

## P1 — Implement Aggressive after Conservative is proven

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
- [ ] **No cross-pair balance allocator:** required before enabling multiple pairs that share an account asset; the first end-to-end proof is deliberately scoped to one enabled pair.
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
- [x] Actual canonical fills, including actual commissions, are the only source of Portfolio holdings changes.
- [x] Third-asset commission fills are rejected for now; they must never be silently ignored.
- [x] BUY prices round down and SELL prices round up to exchange tick rules.
- [x] Live exchange tests are opt-in and TESTNET-only; default tests never need credentials or network access.
- [x] Use shared `@coinzilla/utils` decimal functions and `defaultLogger`; do not duplicate generic utilities or call global console from Harvester.

## Open product decisions

- [ ] Complete the remaining strategy-specific questions in [Trading strategies](./docs/trading-strategies.md), but prioritize only decisions that block the first executable cycle.
- [ ] Finalize reservation timing/release rules for submitted, partially filled, cancelled, rejected, expired, and uncertain orders.
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


## P0.6 — Fix Binance order lifecycle race and diagnostic errors

**Status: planned — source inspection only; implementation and TESTNET verification are not complete.**

### Problem statement and evidence

The Conservative engine registers a canonical order in `PENDING` state before awaiting broker submission. `OrderRegistry.getActiveOrders()` deliberately includes `PENDING`. The engine's market-price and user-data entry points are independent asynchronous workflows; bootstrap serializes user-data callbacks with its own `userDataEventQueue`, but that queue does not serialize them against `processMarketPrice()`.

A BUY fill can therefore be processed while another order (including a recovery SELL) is still awaiting its broker acknowledgement. The BUY-fill path enumerates active SELLs and can call `broker.cancelOrder({ order })` for a PENDING order whose `brokerOrderId` is necessarily absent. The Binance adapter forwards that missing identifier to the broker cancellation API. This is consistent with the observed signed-parameter validation error for `orderId`; it is a source-supported race hypothesis, not yet a captured proof of the exact production interleaving.

A second, independent diagnostic defect is confirmed by the logging implementation: `formatLogContent()` JSON-stringifies structured values, while native `Error` properties such as `message` and `stack` are non-enumerable. An Error nested in an object or array can therefore appear as `{}`, losing the reason for a rejected operation. Some Harvester log call sites pass native Error instances and arrays of Errors directly.

### P0.6.1 — Reproduce and pin down the lifecycle ordering

- [ ] Read the current engine, execution use case, order registry, bootstrap queues, broker port, Binance adapter, shared Binance broker, and working Free-Roll order submission/cancellation path before editing.
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
- [ ] Keep identifier normalization consistent with the shared Binance broker and the working Free-Roll `getOrderId` behavior. Do not duplicate or weaken the shared exact-integer/safe-ID validation.
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


### P0.6 implementation progress — shared logger

- [ ] Shared Error/AggregateError normalization implementation and regression tests have been authored on the existing lifecycle-race branch; they still require execution in a repository checkout before this item can be marked complete.
- [ ] Harvester lifecycle transition serialization, cancellation eligibility validation, broker-boundary ID validation, Harvester diagnostic integration tests, full CI, and bounded TESTNET verification remain outstanding.
- [ ] Do not treat a GitHub source commit as evidence that tests, regression-before-fix verification, CI, or TESTNET checks passed.
