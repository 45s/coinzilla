# Harvester Roadmap

## Mission and delivery priority

**First priority: implement Conservative (Free-Roll) and make Harvester execute a complete, safe, repeatable trading cycle.** The existing `apps/bot-free-roll/README.md` is the strategy source of truth. Harvester must implement that strategy using its own shared engine and domain model; do not copy the old app's broker/runtime implementation. Aggressive is explicitly deferred until Conservative is working end to end on TESTNET. Architecture expansion, optional features, and optimization come after that.

The current `develop` implementation is a connected market-data prototype, not a trading bot. It loads config, can connect to Binance, subscribes to enabled-pair trade-price streams, validates prices, invokes the Aggressive policy, and maintains an in-memory Portfolio when canonical fills are supplied manually. The default Aggressive policy deliberately returns `NO_ACTION`; no order is generated or submitted from a market-price event. Live user-data/fill ingestion, order lifecycle management, exchange-rule validation, account/risk coordination, durable recovery, and an executable strategy are missing.

### Definition of "Harvester can trade"

A first-trading release is not complete until a TESTNET end-to-end scenario demonstrates:

1. Start from the documented command and load/validate configuration.
2. Connect to the selected broker and establish market-data and user-data streams.
3. Load account balances and exchange trading rules for every enabled pair.
4. Establish a reconciled initial state and explicit trading-readiness status.
5. Receive a valid market update and evaluate the selected executable strategy.
6. Convert the strategy decision into a validated order intent.
7. Apply shared risk, balance, reservation, precision, minimum-notional, and post-only checks.
8. Submit the order and track its acknowledgement or an unknown outcome.
9. Receive order updates and every partial/final fill; normalize, deduplicate, and account for actual quantities and commissions.
10. Re-evaluate the strategy from the latest consistent market, order, and Portfolio state and continue the cycle.
11. Pause safely on disconnect, stale data, unreconciled state, unsupported commission, balance/risk violations, or other unsafe conditions.
12. Shut down cleanly without losing track of in-flight operations.

Live trading must remain explicitly disabled by default. TESTNET verification is required before any live-trading enablement.

## P0 — Deliver the first working trading cycle

Work through these items in dependency order. Keep the scope limited to what is necessary to execute and verify the first strategy safely.

### P0.1 — Freeze the first executable strategy scope: Conservative Free-Roll

- [x] Select Conservative (Free-Roll) as the first strategy. Its source of truth is `apps/bot-free-roll/README.md` v0.014; Aggressive is deferred to P1.
- [~] Port the Free-Roll business rules into Harvester domain policies without copying the old app's broker/runtime implementation. First exact-decimal planning primitives are in progress; they are not yet connected to order execution.
- [ ] Define the minimal first-cycle order intent and strategy context (last traded price, pair config, active Position/recovery ledger, active orders, reservations, balances, exchange filters).
- [~] Preserve initial BUY pricing: last traded price multiplied by `(1 - priceStepPercent / 100)`, rounded down to the broker tick. A pure exact-decimal calculator and boundary tests have been added on the current task branch; broker-rule loading and strategy integration remain.
- [ ] Preserve standing-order behavior: after a qualifying BUY fill, maintain both a profitable recovery SELL and the next standing BUY when state and available funds permit.
- [~] Preserve pooled recovery accounting across partial/cancelled/replaced SELLs; only confirmed net SELL proceeds reduce outstanding recovery cost. A pure exact-decimal recovery SELL planner has been added on the current task branch; fill-ledger integration and lifecycle orchestration remain.
- [ ] Preserve fee rules: actual fill commissions are authoritative; configured maker/taker rates are planning ceilings; base/quote fees are supported; third-asset fees or incomplete commission data pause the pair.
- [ ] Preserve free-coin rules: allocate exactly `keepQuantity` only after a fully reconciled recovery SELL and actual cumulative net profit meets `minProfit`; previously earned free coins never re-enter active calculations.
- [ ] Preserve partial-fill policy: capture each execution accurately, but do not advance the strategy until the relevant order is fully filled and reconciled.
- [ ] Preserve external inventory separation; never adopt wallet balances/deposits/manual trades as strategy inventory without explicit reconciliation.
- [ ] Ensure all deterministic strategy calculations and decisions are plain pure functions; strategy policies never call the broker or perform I/O.
- [ ] Record any unresolved Free-Roll requirements as explicit blockers; do not invent financial behavior.


### P0.2 — Trading rules, account state, and startup readiness

- [ ] Load and validate exchange symbol filters for enabled markets: price tick, quantity step, min/max quantity, min/max notional, supported order types, and post-only constraints.
- [ ] Normalize broker filters into a stable Harvester-owned domain/application shape; do not leak exchange SDK payloads.
- [ ] Load account balances and distinguish free, locked, and total balances.
- [ ] Validate configured per-pair investment against available quote balance and coordinate shared quote assets across pairs (e.g. multiple USDT pairs).
- [ ] Seed market state with a current REST price/snapshot before relying on WebSocket trade events; define stale/missing-price behavior.
- [ ] Subscribe to user-data events and surface connection/recovery status.
- [ ] Implement explicit process and per-pair readiness states (e.g. CONFIG_VALID, CONNECTING, RECONCILING, READY, PAUSED, STOPPING, FAILED); connection alone must never mean READY.
- [ ] Do not enable order submission until required account, filters, market data, user stream, and reconciliation gates are satisfied.
- [ ] Validate environment/config combinations; require explicit TESTNET/live mode selection and explicit live-trading opt-in. Fail closed on ambiguous or missing production settings.
- [ ] Validate enabled pair configuration against actual exchange assets/filters and fail startup with actionable diagnostics when incompatible.

### P0.3 — Order intent, safety checks, and reservations

- [ ] Define canonical Harvester order intent/command contracts using existing `@coinzilla/entities` types wherever suitable.
- [ ] Implement pure order construction and validation functions for price/quantity precision, tick/step rounding, min/max quantity, min notional, and post-only constraints.
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

- [ ] Normalize user-data order/execution events at the broker adapter boundary into canonical Harvester events.
- [ ] Normalize actual fills with stable execution IDs, market, side, executed base and quote quantities, timestamps, and actual commission amount/asset.
- [ ] Reject malformed, incomplete, or unsupported fills visibly; third-asset commissions remain unsupported and must not be silently ignored.
- [ ] Deduplicate fills using stable exchange execution identity; serialize concurrent event processing per account/market as required.
- [ ] Handle NEW, PARTIALLY_FILLED, FILLED, CANCELED, REJECTED, EXPIRED, and exchange-specific terminal/unknown states.
- [ ] Apply only incremental actual executions to Portfolio; never apply requested order quantity or cumulative executed quantity twice.
- [ ] Reconcile REST trade history/open orders with stream events to cover disconnect gaps and out-of-order delivery.
- [ ] Ensure cancel/fill races, duplicate events, late events, and out-of-order events cannot double-count fills or release filled reservations.
- [ ] Feed every successful fill/account/order transition back into the strategy context and trigger the next decision when appropriate.
- [ ] Ensure the bot does not wait for a new market-price event when a fill/order-state transition itself requires an immediate strategy reaction.

### P0.5 — Trading Engine orchestration

- [ ] Implement the shared Trading Engine workflow that connects market events, user-data events, current Portfolio/Position, active orders, balances, filters, readiness, strategy decisions, safety checks, order execution, and fill accounting.
- [ ] Keep strategy-specific policy out of the engine and broker adapter.
- [ ] Ensure exactly one strategy controls each pair's shared Position at a time.
- [ ] Serialize or otherwise consistently coordinate concurrent market, order, fill, and cancellation events.
- [ ] Prevent stale snapshots from producing duplicate or conflicting orders.
- [ ] Handle strategy takeover as a controlled workflow: stop outgoing intents, reconcile/cancel relevant orders, account for in-flight fills/reservations, then activate the incoming strategy.
- [ ] Make process startup, partial startup failure, reconnect, pause/resume, and shutdown idempotent and observable.
- [ ] Replace the current price-only callback flow with the actual decision-to-order execution pipeline.
- [ ] Keep `runtime.placeOrder` as a controlled engine capability; callers must not bypass safety checks by invoking it directly.

### P0.6 — Persistence, restart, and recovery required for safe operation

- [ ] Decide the minimum durable state required before enabling unattended trading: orders/client IDs, fills/deduplication IDs, reservations, Portfolio/Position, strategy control state, and relevant configuration/version.
- [ ] Implement durable journal/state storage using the repository's approved shared packages or a separately approved persistence adapter; do not create an app-local generic storage framework.
- [ ] Persist execution facts before acknowledging successful processing/recovery.
- [ ] On startup/reconnect, reconcile persisted state against exchange balances, open orders, and available order/trade history before READY.
- [ ] Define behavior when exchange history is incomplete, retention-limited, or conflicts with local state; fail closed and require operator intervention where safe reconciliation is impossible.
- [ ] Test crash/restart at each order/fill transition and ensure no duplicate order or fill application.
- [ ] Do not claim exactly-once delivery; guarantee idempotent accounting through durable execution identity and reconciliation.

### P0.7 — First strategy end-to-end verification

- [ ] Build deterministic broker-port fakes/simulator scenarios for market updates, acknowledgements, partial fills, commissions, cancellations, rejections, disconnects, and recovery.
- [ ] Add opt-in Binance TESTNET integration tests that place and cancel small, bounded test orders only when explicitly enabled.
- [ ] Verify a complete buy → partial/full fill → position update → sell decision → sell fill → next cycle.
- [ ] Verify configured investment and account balances cannot be exceeded across multiple enabled pairs sharing a quote asset.
- [ ] Verify post-only rejection, insufficient balance, min-notional, precision, stale price, stream loss, and unknown order outcome all fail safely.
- [ ] Verify loss protection and Conservative takeover do not force a loss-making sale or operate the same Position concurrently.
- [ ] Provide a documented, reproducible TESTNET runbook and evidence (logs/journal/test results) for the first successful cycle.
- [ ] Keep live trading disabled until the user explicitly approves a separate live-trading milestone after TESTNET evidence is reviewed.

## P1 — Complete strategy coverage

- [ ] Implement the first selected strategy fully against the shared engine and verify its full lifecycle.
- [ ] Implement the second strategy mode (Conservative Free-Roll or Aggressive, whichever was not selected for P0) against the same engine contracts.
- [ ] Complete the strategy handover and shared inventory behavior across all agreed edge cases.
- [ ] Implement all remaining documented grid repricing, partial-fill, partial-SELL, fallback, and recovery edge cases.
- [ ] Add strategy-level statistics/performance attribution only after shared Position accounting is stable and attribution semantics are agreed.
- [ ] Add strategy backtesting/replay tooling if it materially improves deterministic verification; keep it separate from production execution paths.

## P2 — Operational hardening and improvements

- [ ] Add structured journal records for startup, readiness transitions, strategy decisions, order intent, submission, acknowledgement, cancellation, fills, reconciliation, pause/resume, and shutdown.
- [ ] Add actionable health/status reporting for process and each pair without exposing credentials or raw exchange payloads.
- [ ] Add bounded reconnect/backoff, timeouts, stream liveness/staleness detection, and resource cleanup tests.
- [ ] Add operator controls for pause/resume/stop and safe behavior when a pair is disabled while orders or inventory exist.
- [ ] Add alerts for unsafe states, rejected orders, reconciliation discrepancies, unsupported commissions, and repeated broker failures.
- [ ] Add performance optimization only after profiling a correct end-to-end implementation.
- [ ] Review dependency/security findings and shared package contracts as part of regular maintenance.

## Audit: current implementation on `develop`

### Implemented and verified by source inspection

- [x] Node.js ESM workspace app, package scripts, config loader, and structural config validation.
- [x] Opt-in Binance adapter and Harvester-owned broker port.
- [x] Broker connect/disconnect lifecycle and cleanup of partially-created price subscriptions.
- [x] Enabled-pair aggregate-trade price subscriptions and incoming market-price validation.
- [x] Existing default Aggressive policy composition and handoff of validated prices plus the latest in-memory Portfolio (to be replaced by Conservative for the first executable release).
- [x] Canonical Fill-driven in-memory Position/Portfolio transitions with base/quote commission accounting and process-lifetime duplicate-ID protection.
- [x] Application use cases for place-order, process-market-price, and update-portfolio.
- [x] Shared decimal helper reuse and shared default logger usage.
- [x] Offline tests exist for bootstrap, broker port/adapter, config, market price, strategy blocker behavior, order use case, and Portfolio transitions.

### Confirmed blockers / gaps found in the audit

- [ ] **No executable Conservative strategy:** Free-Roll is specified in `apps/bot-free-roll/README.md` but has not been ported into Harvester; the current Aggressive policy returns `NO_ACTION`.
- [ ] **No engine:** market-price processing returns a decision but does not pass it into safety validation, order planning, or order submission.
- [ ] **Order use case is disconnected:** `placeOrder` is composed and exposed by runtime but is not invoked by the strategy/price workflow.
- [ ] **No live user-data processing:** the broker port/adapter expose user-data subscription methods, but bootstrap does not subscribe to them or translate events into canonical order/fill events.
- [ ] **No exchange filters/account initialization:** no symbol filters or account snapshot are loaded into runtime; config precision is not a substitute for exchange rules.
- [ ] **No current-price seed/staleness policy:** strategy only receives stream trade-price events; no REST snapshot initializes price or protects against stale data.
- [ ] **Portfolio is incomplete for strategy execution:** current Position stores net base quantity and signed quote cash flow only. It does not yet provide the agreed invested quote, average cost, realized profit, free/retained quantity, reserved inventory, or available inventory calculations.
- [ ] **No order model/state store:** no active-order registry, order lifecycle state machine, client order ID policy, or order-to-fill coordination.
- [ ] **No reservations:** open/uncertain BUY quote and SELL base commitments are not represented or enforced.
- [ ] **No cross-pair balance allocator:** separate pair budgets can compete for the same real exchange asset.
- [ ] **No durable deduplication or persistence:** fill IDs exist only in process memory; restart loses Portfolio and applied-fill history.
- [ ] **No reconciliation:** startup/reconnect does not compare local state with balances, open orders, and exchange executions; broker recovery gate is not wired to Harvester readiness.
- [ ] **No readiness/pause safety state:** broker connected and subscribed is currently the closest runtime status; it is not sufficient to authorize trading.
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

- [ ] Complete only Free-Roll decisions that block the first executable cycle, using `apps/bot-free-roll/README.md` as source of truth. Aggressive decisions are deferred until P1.
- [ ] Finalize reservation timing/release rules for submitted, partially filled, cancelled, rejected, expired, and uncertain orders.
- [ ] Finalize cross-pair account balance allocation and quote-asset contention behavior.
- [ ] Finalize durable storage and restart/reconciliation guarantees.
- [ ] Decide whether strategy-specific P/L attribution is required.
- [ ] Decide operator intervention behavior for unreconcilable exchange/local-state discrepancies.

## Delivery rules

- Follow repository root guidance and `apps/harvester/AGENTS.md`.
- Work from `develop` using a short-lived task branch and target PRs to `develop`; do not commit task work directly to `develop` or `main`.
- Keep the first-trading milestone ahead of optional architecture work and optimization.
- Do not implement unresolved financial/risk behavior by assumption; close the decision first.
- Do not mark an item complete until implementation, meaningful tests, required checks, and documentation are complete on the target branch.
- Keep live trading disabled by default; TESTNET trading must be explicitly opt-in.
- Report exact checks actually run; source inspection is not runtime verification.
