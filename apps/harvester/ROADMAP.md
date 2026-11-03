# Harvester Roadmap

> **Product direction — 2026-11-03 (mandatory): launch the trading app first, then improve it.**
> Harvester must reproduce the working Conservative/Free-Roll trading behaviour before adding more infrastructure. Use `apps/bot-free-roll` as the behavioural reference and Harvester's DDD boundaries as the implementation structure. Do not redesign the trading lifecycle or add generic frameworks when the working sibling app already demonstrates the required behaviour.
>
> **The first loop is deliberately simple:** load/validate config → connect → subscribe to enabled-market prices → receive a usable price → evaluate Conservative → submit BUY/SELL → process Binance acknowledgements and execution reports → update state from actual fills → immediately evaluate the next required action. A running loop is the deliverable; architecture is in service of it.
>
> **Not first-loop prerequisites:** Journal/EventBus integration, durable persistence, restart recovery, comprehensive historical reconciliation, generic readiness/state machines, cross-pair allocation, dashboards, Aggressive, and broad reservation frameworks. Keep these deferred unless a specific failing order-flow case proves a narrowly scoped safeguard is required.
>
> **Startup/account clarification:** a clean TESTNET account is a useful controlled-test setup, not a product requirement that should permanently prevent the app from launching. Do not require a full account snapshot after every execution report. Use actual fills as the source of strategy accounting. Check the specific free balance and in-process commitments needed before submitting each order. Refresh broker state only when a concrete uncertainty/disconnect/unknown outcome requires it. P0.7 source changes remove the clean-account/open-order/base-inventory startup gate and per-TRADE snapshots. GitHub Actions passed the P0.7 implementation. Local Binance Spot TESTNET evidence now confirms validated ZROUSDT prices, order activity, and multiple BUY TRADE execution reports. The pair then paused at 15:47:17 with UNKNOWN_OR_EXTERNAL_ORDER_EVENT because a canonical execution report did not match an order in Harvester's in-memory OrderRegistry. The first BUY path is therefore active, but the run is not accepted: identify the exact unowned report using TESTNET order history and order identifiers, fix only the proven mismatch, then verify the recovery SELL and next BUY. The first history-inspection attempt did not reach Binance: the command was invoked with an extra `--`, which the script treated as the symbol and rejected with its usage message. This is a command-line invocation error, not evidence of an exchange/API or trading failure. Retry with `pnpm run testnet:history ZROUSDT 50` (no `--`). The corrected read-only history query subsequently succeeded. It shows seven orders in the failing run window: BUY orders `h-ZROUSDT-1` / exchange order `665873`, `h-ZROUSDT-2` / `665881`, `h-ZROUSDT-4` / `665891`, `h-ZROUSDT-6` / `665893`, and `h-ZROUSDT-7` / `665894`, each FILLED for 5 ZRO; SELL orders `h-ZROUSDT-3` / `665882` and `h-ZROUSDT-5` / `665892` were CANCELED with zero execution. The same client IDs `h-ZROUSDT-1` and `h-ZROUSDT-2` also occur in older history around 09:15 UTC, demonstrating client-ID reuse across sessions. This is a concrete issue to inspect, but it is not yet proven to be the rejected report's cause. The history does not identify which exact incoming report triggered the registry rejection; obtain the open-order snapshot and correlate the rejected event's exact `orderId` / `clientOrderId` with submission, acknowledgement, and journal records.
>
> **No speculative fixes:** reproduce the observed event sequence, inspect the working Free-Roll implementation and shared broker mapping, identify the exact incorrect transition, add a deterministic regression test, then make the smallest change. A readiness deferral is not a broker rejection; a locally registered PENDING order is not cancellable until broker acknowledgement supplies a valid broker order ID.


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
  initial canonical account snapshot. External open orders and pre-existing
  inventory are not adopted; order checks use in-process cash flow, owned
  position quantity, and outstanding commitments. The default config enables
  only `ZROUSDT`.

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
- [x] Subscribe to user-data events and surface connection status. Startup uses one canonical account snapshot and known enabled-pair filters. External inventory/orders remain unowned; a clean account is a controlled-test recommendation, not a launch gate. Disconnect/recovery and unknown outcomes remain fail-closed; comprehensive history reconciliation is deferred.
- [x] Implement minimum process readiness for the first TESTNET cycle. When trading is explicitly enabled, startup requires TESTNET mode, exactly one enabled pair, active user-data stream, and a fresh account snapshot. External open orders and inventory are not adopted or treated as a startup prerequisite. Read-only broker mode remains available; genuine reconnect/reconciliation requirements still fail closed.
- [x] Enable the first TESTNET order only after explicit `HARVESTER_TRADING_MODE=testnet`, non-production NODE_ENV, validated config, enabled-pair exchange filters, fresh account snapshot, and active user-data stream. The policy prevents a new BUY from taking outstanding recovery capital plus its quote notional beyond the configured pair investment. Before submission the engine checks BUY quote notional against snapshot free quote adjusted by actual quote cash flow and active BUY commitments; SELL quantity is capped by Harvester-owned active base inventory and available free base after active SELL commitments. A balance-limited BUY is deferred while a valid recovery SELL may still proceed.
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


## P0.7 — Restore the simple Free-Roll execution lifecycle (IN PROGRESS)

### P0.7 implementation progress — CI passed; local TESTNET startup confirmed; awaiting first price

The working branch now contains the first implementation pass. It follows the
existing Free-Roll order sequence and keeps Harvester's DDD boundaries:

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

**Verification evidence so far:** all five GitHub Actions workflows passed on the current PR head; the workspace test workflow reported 1,367 passing tests, including Harvester 298/298, brokers 274/274, and Free-Roll 313/313. The operator has now confirmed a local Binance Spot TESTNET startup: configuration validated for ZROUSDT, broker connected, exchange rules validated, user-data subscription established, initial account snapshot accepted (517 balances), Conservative engine activated, and the ZROUSDT market-price subscription established. The process log ends in the expected waiting state for a validated market price and user-data readiness. No market-price event, BUY submission, acknowledgement, fill, SELL, or subsequent cycle is evidenced yet. Do not infer a trading failure merely because the market has not emitted a qualifying price; continue observing the running process.

**Still required before acceptance:** observe the first validated price and initial BUY request/acknowledgement; then capture the actual Binance execution reports, Portfolio/RecoveryLedger updates, recovery SELL, SELL fill, and next BUY. Diagnose the first missing/failed transition from those logs only. Local offline test execution remains unreported by the operator; GitHub Actions evidence is recorded above. Inspect the final diff and keep the bounded TESTNET run on Spot TESTNET only. Native Error/cause/AggregateError serialization from PR #462 is retained without a new logging implementation.


**Priority: immediate. This task is about making the existing app trade reliably, not adding another architecture layer.** The latest `develop` includes PR #462 (`fix(harvester): serialize order lifecycle and preserve diagnostics`). Continue from that state; do not repeat already-merged work.

### Required working behaviour

1. Load and validate the configured pair/strategy.
2. Connect the broker and subscribe to enabled-market prices.
3. On a usable price, evaluate Conservative and submit the initial BUY through the existing engine/broker port.
4. Process Binance order acknowledgements and execution reports.
5. Apply each actual fill exactly once to the in-process Portfolio/RecoveryLedger.
6. When a BUY fill changes the recovery SELL target, reconcile the existing SELL safely: if it is still PENDING, wait for its submission acknowledgement; do not send cancellation without a valid broker order ID. Once acknowledged and cancellable, cancel it, process fills that raced with cancellation, then place the correctly recalculated SELL.
7. Trigger the next strategy decision from the relevant order/fill transition; do not wait for an unrelated market tick.
8. Keep running the strategy cycle.

### Scope A — Remove unnecessary execution-readiness barriers

- [x] Trace and remove the per-report readiness reset and per-TRADE account snapshot refresh.
- [x] Compare directly with the working `apps/bot-free-roll` lifecycle and retain Harvester's canonical Fill/Portfolio/RecoveryLedger boundaries.
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
- [x] GitHub Actions on the current PR head: workspace tests (Harvester 298/298, brokers 274/274, Free-Roll 313/313; 1,367 total workspace tests passed), shared-utils tests, coverage, JavaScript syntax/workflow lint, and production dependency audit all passed. Local offline test execution has not yet been reported.
- [x] Operator-confirmed local TESTNET startup: config validated; Binance connected; ZROUSDT exchange rules validated; user-data subscription active; initial account snapshot accepted; Conservative engine activated; market-price subscription established.
- [x] Observe validated ZROUSDT market prices and BUY execution reports (`NEW` and `TRADE`) from the real TESTNET user-data stream.
- [ ] Diagnose the 15:47:17 `UNKNOWN_OR_EXTERNAL_ORDER_EVENT` using exact Binance order IDs/client order IDs from recent order history and the Harvester order-submission journal/logs. Do not guess at broker mapping or weaken order ownership.
- [ ] Verify that every BUY fill is accounted exactly once, the recovery SELL is submitted and filled, and the next BUY starts a subsequent cycle on Spot TESTNET.

### Out of scope for P0.7

Do not add Journal/persistence/restart recovery, historical trade replay, a generic reconciliation subsystem, a generic event queue/framework, multi-pair allocation, Aggressive, dashboard/notification work, or unrelated refactors. Do not change Free-Roll financial rules unless a demonstrated mismatch is found and documented.

### Acceptance

The app starts with the documented TESTNET opt-in, receives prices, submits BUY orders, and receives real Binance BUY execution reports. Current live evidence also exposed an unowned-order correlation failure that pauses the pair. Acceptance therefore remains blocked until the exact event/order identity mismatch is fixed with a regression test, BUY fills are accounted exactly once, and a real recovery SELL → next BUY cycle is observed. No full account snapshot is required after every fill.

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


### P0.6 implementation progress — engine transition serialization

- [x] The existing Conservative engine's public market-price, user-data, and explicit evaluation entry points are wrapped in a process-local promise-tail coordinator, with internal workflow calls kept inside the held transition. The deterministic concurrent market/user-data regression test uses an explicitly deferred SELL acknowledgement, verifies no cancellation while the PENDING order has no brokerOrderId, compares the recorded cancellation ID with the post-acknowledgement registry order, and proves duplicate fill delivery is not double-accounted. Harvester suite passed 285/285 on commit a2728bd.
- [ ] Re-entrant external callback behavior, cancellation eligibility and broker identifier validation, full CI, and TESTNET verification remain outstanding.


### P0.6 implementation progress — cancellation eligibility

- [x] Added a pure Harvester cancellation eligibility validator and applied it before recovery SELL and trailing BUY cancellation. The Binance adapter repeats eligibility checks for order-shaped requests and validates all forwarded IDs with the shared exported Binance normalizer. Validator, adapter, and Binance ID tests passed in the full package test run on commit a2728bd.
- [ ] Raw ID-only adapter calls receive Binance ID format validation but cannot prove order lifecycle state; Harvester application workflows must use order-shaped requests.


### P0.6 verification snapshot — 2026-11-03

- [x] Full workspace package tests passed on `a2728bd6d9925eb23c02ece7d1fe041e2060c3bd`: Harvester 285/285, shared utils 163/163, Free-Roll 313/313; workflow: https://github.com/45s/coinzilla/actions/runs/41606130252
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

Inspection of the working Free-Roll handler found a concrete behavioral difference: apps/bot-free-roll registers exchange-assigned broker order IDs in trackedOrderIds and checks the execution report's exchange order ID in its order-event handler. Harvester's OrderRegistry currently locates an order only by clientOrderId, even though its CanonicalOrder also carries brokerOrderId. The Binance user-stream adapter maps Binance executionReport.c to clientOrderId and executionReport.i to brokerOrderId; the canonical conversion retains both values.

This is an investigation finding, not a proven explanation for the reported unknown event. Do not change the registry's matching rules until the new TESTNET diagnostic captures the rejected event and demonstrates which identifier matches the owned order. Any future broker-ID correlation must still validate that client and broker identifiers refer to the same registered order; it must not adopt external orders.


### Free-Roll ownership audit — 2026-11-03

A direct source comparison was completed against `develop` (not inferred from the README):

- **Free-Roll ownership key:** `FreeRollBot.#handleOrderEvent()` obtains the exchange-assigned ID via `getOrderId(event.executedOrder)` and requires that ID to exist in the pair's `trackedOrderIds`. The BUY and SELL submission paths add that ID only after the broker response contains it. A fill is additionally checked against the same order ID, symbol, and side before accounting.
- **Harvester ownership key:** `OrderRegistry.applyUpdate()` currently locates an order only by `clientOrderId`. It then checks the broker ID as an immutable field only when the registered order already has a broker ID. A locally registered `PENDING` order has no broker ID yet, so a report with the same client ID and same immutable order intent can supply the broker ID and advance that registry entry.
- **Client-ID reuse is real:** Harvester currently generates IDs as `h-<symbol>-<process-local counter>`. The counter is initialized inside the decision executor, so it restarts with a new process. The supplied TESTNET history independently shows `h-ZROUSDT-1` and `h-ZROUSDT-2` reused in an older session. This makes client-ID-only correlation weaker than Free-Roll's exchange-order-ID ownership check.
- **What this does and does not prove:** this is a concrete ownership/parity gap and a plausible stale-event collision risk. It is **not yet proven to be the cause** of the reported 15:47:17 rejection. That rejection was reported as a missing client-ID registry match; without its actual `clientOrderId`, `brokerOrderId`, and current registry snapshot, we cannot tell whether the report had a missing/wrong client ID, was from an old session, or was an unrelated order. The repeated historical client IDs alone do not identify that event.
- **No code fix is included in this audit update.** Do not add a blind broker-ID fallback or accept an unknown event. The follow-up must reproduce the actual event and preserve fail-closed rejection of external orders.

**Required next evidence:** run the diagnostic branch and retain the complete structured rejection record, including symbol, `brokerOrderId`, `clientOrderId`, side, status, execution type/ID, and both registry-match fields. Compare those identifiers to this process's order-submission/acknowledgement logs and the matching TESTNET history row. Also determine whether the report was received before or after the matching broker acknowledgement.

**Deterministic regression cases required before changing ownership logic:**

1. A report for an acknowledged owned order is accepted only when its exchange order ID matches the registered broker order ID; client ID must also be consistent where supplied.
2. An unknown exchange order ID is rejected even if its client ID collides with a locally registered order from a previous session.
3. A report for an unacknowledged `PENDING` intent cannot silently establish ownership by supplying an arbitrary exchange order ID unless an observed, tested broker ordering contract explicitly requires this.
4. A valid Free-Roll-style fill still updates accounting once, and an unrelated/manual order remains unowned.

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


### Free-Roll order identity alignment — 2026-11-03

The working implementation was compared directly with Harvester:

- `apps/bot-free-roll/src/bot/bot-free-roll.js` tracks the exchange-assigned order ID in `state.trackedOrderIds` after the broker acknowledgement.
- Its `#handleOrderEvent()` gets `getOrderId(event.executedOrder)` and accepts the event only when that exchange order ID is tracked. Fill identity is checked using exchange order ID, symbol, and side. It does **not** require the execution report's client order ID to equal the locally submitted client ID.
- Harvester previously used `OrderRegistry.applyUpdate()` lookup by `clientOrderId` only. That was the behavioral mismatch behind the `666845` rejection: Binance's event `c` differed, although the exchange order ID was already registered.

Harvester is now aligned with that working behavior: acknowledged updates are located by `brokerOrderId` first; the registered client ID remains the canonical local ID; conflicting client and broker IDs that point to two different registered orders are still rejected. Unknown broker order IDs are not adopted. Binance's raw `c` and `C` are retained as event metadata for diagnostics.

The bootstrap now logs both identifiers on receipt, logs accepted/ignored processing outcomes, and emits complete error name/message/stack fields for rejected events. This should make future adapter/identity mismatches diagnosable without changing normal logs to raw Binance payload dumps.

Regression coverage added:

- Binance adapter preserves `c` and `C` separately.
- Registry accepts a report with a different client ID when its exchange order ID identifies the registered order, while retaining the submitted canonical client ID.
- Registry rejects an event when its broker ID and client ID point to different registered orders.

This is an intentional port of Free-Roll's proven order matching rule, not a new ownership strategy. The real TESTNET acceptance target remains BUY fill → recovery SELL submission/fill → next BUY.
