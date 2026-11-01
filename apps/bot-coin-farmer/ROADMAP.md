# Coin Farmer — Implementation Roadmap

**Application:** `apps/bot-coin-farmer`  
**Status:** Proposed implementation plan; all CF implementation items are not started  
**Reference:** Free-Roll V1 documentation and source on `develop`  
**Target branch for implementation PRs:** `develop`

This roadmap turns the CF architecture into deliverable, reviewable work. It is not a copy of V1's FR backlog and does not claim V1 roadmap items are complete in CF.

## 1. Product scope for the first release

The first CF release targets one CEX-agnostic accumulation/recovery strategy for cryptocurrency spot markets. It is **not a conventional grid bot**. The initial concrete integrations are:
- Binance WebSocket broker via `@coinzilla/brokers`.
- Telegram notifications via `@coinzilla/notifiers`.
- Existing EventBus and Journal packages for internal events/operational records.
- In-memory state repository for deterministic tests and early development; durable database adapter later.

The first real-money release is blocked until exact financial accounting, fill/order reconciliation, inventory safety, durable restart recovery, controlled testnet acceptance and operational release gates are complete.

## 2. Non-negotiable engineering invariants

1. V1 stays untouched by CF tasks and is never a runtime dependency.
2. Domain/application code is CEX-agnostic; exchange payloads/status/filter names exist only in adapters.
3. Use shared Coinzilla canonical entities when their contracts fit; do not duplicate Money, Quantity, Market, Fill, Order, Commission, Balance or TradingRules.
4. Use exact decimal arithmetic for every financial amount, price, quantity, fee, notional, increment and P&L calculation. No JS Number arithmetic for these values.
5. Actual per-fill execution and commission facts are accounting truth; acknowledgements and configured fee percentages are not.
6. A fill is immutable and idempotent; same identity with changed facts is a discrepancy.
7. Active, free, reserved, executed-awaiting-reconciliation and external inventory remain distinct.
8. No SELL may use free/external inventory or inventory reserved elsewhere.
9. One centralized pure SELL profitability approval; unknown/incomplete facts deny.
10. Cancel/replace and timeout outcomes are reconciled; timeout is unknown, not proof of failure.
11. Disconnect, stream gap, restart or mismatch blocks order mutation until reconciliation succeeds.
12. Notifications are side effects only and cannot change strategy/accounting outcomes.
13. No live trading until the release gate is explicitly approved.

## 3. Target dependency shape

```text
src/index.js
   |
   v
bootstrap (composition root + process lifecycle)
   |
   +---- config (JSON loading + validation)
   |
   +---- constructs infrastructure (Binance / Telegram / EventBus / Journal / StateRepository)
   |
   v
application (strategy runner, pair manager, reconciliation)
   |
   +---- depends on ports and calls pure domain decisions
   |
   v
domain (strategy, accounting, profitability, inventory, state machine)
   |
   v
@coinzilla/entities (canonical shared values)
```

The dependency direction is inward. Infrastructure implements the contracts in `ports/`; bootstrap composes concrete implementations and injects them into application workflows. No domain/application import of Binance or Telegram packages.

## 4. Phases and deliverables

### Phase 0 — Architecture baseline and behavior contract

**Goal:** make the design actionable before creating trading code.

- [ ] CF-001 — Merge/review the detailed architecture, module catalog, workflows, diagrams and this roadmap.
- [ ] CF-002 — Complete the V1-to-CF behavior mapping for the first strategy scope: BUY calculation, standing-order lifecycle, recovery SELL, keepQuantity, full-fill rule, fees, manual wallet activity and pair states.
- [ ] CF-003 — Record unresolved strategy decisions that block the first executable workflow (at minimum stale-price/stream-gap policy, insufficient funds, SELL replacement policy).
- [ ] CF-004 — Audit current shared entity constructors/exports/tests and the exact Binance broker methods needed by the first adapter; record contract gaps and package owners.

**Exit gate:** no strategy rule needed by the first vertical slice is ambiguous; public shared contracts to be reused are identified; no CF runtime code has been written against assumed APIs.

### Phase 1 — Workspace application skeleton and runtime shell

**Goal:** a runnable Node process that starts and stops safely without placing orders.

- [ ] CF-010 — Add `apps/bot-coin-farmer/package.json` using ESM, Node engine `>=22.23.4`, workspace scripts and only reviewed workspace dependencies.
- [ ] CF-011 — Add `src/index.js` and runtime composition/start/shutdown modules.
- [ ] CF-012 — Add JSON config loading/validation and `.env.example`; credentials remain environment secrets.
- [ ] CF-013 — Wire structured logger, EventBus and Journal through adapters.
- [ ] CF-014 — Add partial-startup rollback, idempotent shutdown, SIGINT/SIGTERM handling and bounded cleanup tests.
- [ ] CF-015 — Establish native Node test runner, syntax check, coverage baseline and app CI integration.

**Acceptance:** app starts in no-trading mode with valid config; invalid config fails before broker order capability is exposed; partial startup cleans already-created resources; shutdown drains event/journal work; default tests require no network or credentials.

### Phase 2 — Canonical domain contracts and pure strategy kernel

**Goal:** exact, deterministic strategy decisions without any exchange dependency.

- [ ] CF-020 — Reuse and test `Asset`, `Market`, `Money`, `Quantity`, `CanonicalOrder`, `Fill`, `Commission`, `Balance`, `TradingRules`, `BrokerCapabilities` and `BrokerResult` from `@coinzilla/entities` where suitable.
- [ ] CF-021 — Define CF's domain-facing market state and state transition contract.
- [ ] CF-022 — Implement exact BUY price/step calculation using last trade and the approved V1 formula.
- [ ] CF-023 — Implement canonical order intent and pure order eligibility/trading-rule validation.
- [ ] CF-024 — Implement pure SELL profitability approval with exact breakdown and refusal codes.
- [ ] CF-025 — Implement fill accounting for quote/base fees and explicit unknown/zero commission status.
- [ ] CF-026 — Implement immutable fill ledger, duplicate/conflict detection and deterministic replay.
- [ ] CF-027 — Implement active/free/reserved/executed-awaiting-reconciliation/external inventory projections and invariants.
- [ ] CF-028 — Implement recovery-cycle completion and exactly-once keepQuantity allocation.
- [ ] CF-029 — Implement pure per-market state transitions for INITIALIZING, READY, ACTIVE, RECONCILING, PAUSED_UNSAFE and STOPPED.

**Acceptance:** unit tests cover exact arithmetic boundaries, duplicate and conflicting fills, quote/base/zero/unknown fees, no-third-asset behavior, inventory conservation, no double reservation, profitability refusal reasons, and all allowed/forbidden state transitions. No broker, network, filesystem or Telegram imports in domain tests.

### Phase 3 — Broker ports, fake broker and Binance WebSocket adapter

**Goal:** CEX-neutral application contracts with Binance as the first implementation.

- [ ] CF-030 — Define narrow broker ports: market data, trading, account, execution history, market rules and connection lifecycle.
- [ ] CF-031 — Define normalized success/rejection/unsupported/retryable/ambiguous outcomes; include source timestamps and history completeness.
- [ ] CF-032 — Implement deterministic fake broker and shared adapter contract fixtures.
- [ ] CF-033 — Implement Binance WebSocket broker factory using `BinanceWebSocketBroker` and `BinanceWebSocketConfig`.
- [ ] CF-034 — Implement Binance mapping for last trades, orders, fills, commissions, balances and trading rules using canonical shared entities.
- [ ] CF-035 — Preserve raw source IDs/exact decimal strings; validate pagination and completeness; no raw Binance event reaches application/domain.
- [ ] CF-036 — Add Binance adapter contract tests and explicitly test unsupported/incomplete broker facts.

**Acceptance:** application/domain tests run with fake broker only; Binance fixtures map to the same port contracts; strategy imports no Binance modules; required unsupported capabilities fail closed. No order placement in this phase.

### Phase 4 — First market lifecycle and standing BUY

**Goal:** one market can initialize and maintain a BUY intent in simulation/TESTNET behind safety gates.

- [ ] CF-040 — Implement per-market coordinator and serialized task queue.
- [ ] CF-041 — Implement market initialization: validate capability/fee/rules, reconcile existing broker orders and balances, subscribe to last trades/user data.
- [ ] CF-042 — Implement last-trade quality gate and record stale/gap/invalid observations.
- [ ] CF-043 — Implement initial reference and standing BUY price calculation.
- [ ] CF-044 — Implement BUY intent validation, available-funds check, stable client order identity and idempotent submit.
- [ ] CF-045 — Track order acknowledgement separately from execution; prevent duplicate BUYs on repeated ticks.
- [ ] CF-046 — Implement order update handling and terminal/unknown lifecycle mapping.

**Acceptance:** deterministic simulation proves correct initial/subsequent buy price, exact tick rounding, no duplicate order/reservation, stale data refusal, insufficient funds refusal and ambiguous create timeout reconciliation.

### Phase 5 — Fill ledger and coordinated recovery SELL

**Goal:** actual fills drive accounting and recovery orders.

- [ ] CF-050 — Implement canonical fill ingestion from user stream and history; apply once by stable identity.
- [ ] CF-051 — Implement exact quote/base commission accounting; explicit zero vs unknown; third-asset rejection/pause.
- [ ] CF-052 — Implement partial-fill capture and the approved wait-for-full-order strategy progression.
- [ ] CF-053 — Implement cancel/reconcile/replace workflow for an old SELL after a completed BUY.
- [ ] CF-054 — Implement centralized SELL profitability approval and exact exchange rule validation.
- [ ] CF-055 — Implement recovery SELL placement and reservation accounting.
- [ ] CF-056 — Implement full SELL completion, actual net recovery verification and exactly-once keepQuantity allocation.
- [ ] CF-057 — Implement canceled/expired/partial SELL handling with no premature free allocation.
- [ ] CF-058 — Implement fill/cancel races and unknown mutation outcomes.

**Acceptance:** adversarial tests cover multiple buys before sell, sell before next buy, partial/multiple fills, duplicate stream/history fills, fill during cancel, unknown fee, quote/base fee, under-profitable sell, retained free quantity and no overlap of reservations. No live order path.

### Phase 6 — Notifications and operational diagnostics

**Goal:** operators receive useful events without coupling Telegram to strategy.

- [ ] CF-060 — Define stable canonical application event names/payloads for order completion, fill accepted, market pause, recovery and runtime lifecycle.
- [ ] CF-061 — Implement event-bus adapter and curated notification mapper.
- [ ] CF-062 — Integrate optional Telegram through `@coinzilla/notifiers`.
- [ ] CF-063 — Test disabled credentials, partial credentials, successful sends, send failures, queue draining and shutdown.
- [ ] CF-064 — Add structured diagnostics for readiness, order/fill identity, ledger completeness, reservations, reconciliation and pause reason; redact secrets.

**Acceptance:** Telegram is disabled when both credentials are absent; one missing credential fails configuration; send failures never alter state or prevent cleanup; no raw CEX payloads or secrets are sent.

### Phase 7 — Durable state and restart recovery

**Goal:** recover exact strategy state after process loss without guessing.

- [ ] CF-070 — Finalize versioned persistence snapshot and ledger/checkpoint contract.
- [ ] CF-071 — Select database/storage technology only after durability, deployment and operational requirements are agreed.
- [ ] CF-072 — Implement durable `StateRepository` adapter with atomic writes and schema migration strategy.
- [ ] CF-073 — Persist fill ledger, inventory buckets, recovery cycles, order/client identities and reconciliation cursor/checkpoint.
- [ ] CF-074 — Implement startup recovery: load local state, fetch authoritative broker facts, reconcile balances/orders/fills/rules, replay missing fills idempotently.
- [ ] CF-075 — Implement disconnect/reconnect and stream-gap recovery using the same reconciliation workflow.
- [ ] CF-076 — Add operator-visible discrepancy codes and explicit resume workflow.

**Acceptance:** restart at every order/fill lifecycle point restores exact state; duplicate replay does not double-count; incomplete history or balance mismatch remains PAUSED_UNSAFE; no order mutation occurs before successful reconciliation. Until this phase passes, CF must not be described as restart-safe or production-ready.

### Phase 8 — Simulation, multi-market and adversarial verification

**Goal:** prove invariants under deterministic failure scenarios.

- [ ] CF-080 — Build seeded fake exchange simulator for last trades, latency, fills, partial fills, fees, rejects, timeouts, disconnects and history.
- [ ] CF-081 — Add deterministic event replay and state-machine/model-based tests.
- [ ] CF-082 — Test multi-market isolation and shared quote/base balance reservation.
- [ ] CF-083 — Test market-rule changes, stale prices, stream gaps, rate limits and reconnect backoff.
- [ ] CF-084 — Add long-running soak simulation and ledger invariant checks after every transition.

**Acceptance:** repeatable seeded runs produce identical results; no invariant violation or unexplained ledger drift; no market failure corrupts another market; shared funds cannot be double-spent.

### Phase 9 — TESTNET and release readiness

**Goal:** prove the full application in a controlled exchange environment before any real-money consideration.

- [ ] CF-090 — Add explicit TESTNET environment/config guard and safe defaults.
- [ ] CF-091 — Add controlled end-to-end create/cancel/fill/reconcile scenarios on Binance TESTNET.
- [ ] CF-092 — Verify Telegram smoke test in a dedicated test chat; keep secrets in deployment secret store.
- [ ] CF-093 — Add kill switch, live-environment confirmation and least-privilege credential checklist.
- [ ] CF-094 — Run extended reconnect/restart/soak test with durable persistence enabled.
- [ ] CF-095 — Complete security, operations, recovery, data-retention and deployment runbooks.
- [ ] CF-096 — Conduct explicit human production-readiness review and separate cutover decision.

**Acceptance:** every invariant has test evidence; no unresolved critical discrepancy; restart/recovery proven; no secrets in logs; TESTNET orders are reconciled and cleaned up; live trading remains disabled until explicit approval. No profit guarantee is claimed.

## 5. Cross-cutting PR rules

- One focused task or tightly coupled set per PR.
- Start each implementation branch from latest `develop`; target `develop`.
- Follow root `AI_AGENT_WORKFLOW.md` and `ENGINEERING_STANDARDS.md`.
- Update this roadmap with PR links and verified status only after merge.
- Changes to `packages/entities`, `packages/brokers`, `packages/notifiers`, `packages/event-bus` or `packages/journal` must follow package ownership rules.
- No V1 source/docs changes in CF implementation PRs unless a separate task explicitly authorizes a V1 change.
- Do not create empty placeholder modules or implement future phases prematurely.
- Do not merge or enable live trading without the required user/release approval.

## 6. Definition of done for a roadmap item

A task is complete only when:
1. The owning module and contract are documented.
2. Tests prove success, failure and boundary behavior.
3. Exact financial values remain exact end-to-end.
4. Relevant safety invariants are asserted.
5. No forbidden dependency crosses into domain/application.
6. The PR is merged to `develop` and its final head is verified.
7. This roadmap and relevant diagrams/docs reflect the delivered behavior.

## 7. Current implementation status

- [x] CF documentation and target architecture baseline — this documentation PR.
- [ ] CF package manifest and runnable runtime.
- [ ] CF domain/application/adapters source code.
- [ ] Binance adapter integration owned by CF.
- [ ] Telegram integration owned by CF.
- [ ] Durable persistence and restart recovery.
- [ ] TESTNET acceptance.
- [ ] Production readiness and cutover.

V1's implementation status does not count as CF completion.
