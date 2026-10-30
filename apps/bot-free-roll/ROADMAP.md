# Free-Roll Engineering Roadmap

**Application:** `apps/bot-free-roll`  
**Status:** Active engineering plan — implementation not yet production-ready  
**Principles:** SOLID · stable · simple · exchange-agnostic · test-first  
**Last reviewed:** 2026-10-30

> This roadmap is the long-term development contract for the Free-Roll application. Read it before planning, implementing, reviewing, or asking an AI agent to change this application. The roadmap is intentionally sequenced as small, independently reviewable PRs. It is a direction and acceptance plan, not a promise that every item must be implemented exactly as written: update it when repository evidence or an explicitly approved strategy decision requires a change.

---

## 1. Mission and non-negotiable outcome

Build a reliable spot Free-Roll strategy that can work with different centralized exchanges (CEXs) without changing strategy/domain logic.

The strategy may depend only on Coinzilla-owned domain entities and broker capability contracts. Exchange SDKs, API payloads, exchange-specific order statuses, fee formats, symbol filters, and connection details belong in broker adapters.

The application must:

1. Account for **actual executions**, not order acknowledgements or estimated fills.
2. Correctly account for quote- and base-asset commissions, explicit zero-fee executions, and mixed quote/base fees across fills; reject pairs requiring third-asset commissions and pause if one unexpectedly appears.
3. Use exact decimal arithmetic for all financial values and exchange increments.
4. Never intentionally submit a SELL that fails the configured minimum **net** profitability rule.
5. Never sell free inventory or reserve the same inventory for multiple orders.
6. Reconcile fills, orders, balances, and local state before resuming after uncertainty, disconnects, or restart.
7. Stop safely when it cannot prove that the next action is safe.
8. Be covered by deterministic unit tests, adapter contract tests, state-machine tests, and controlled integration/simulation tests.

**Important limitation:** no software can guarantee that a market order will fill, that a limit price will ever be reached, or that market movement will not make a position lose value. The engineering guarantee is narrower: the bot must not intentionally place a SELL below its calculated conservative net-profit threshold, and it must refuse to trade when the required facts are unknown or inconsistent.

## 2. Source-of-truth documents

Read these together, in this order:

1. `README.md` — approved Free-Roll strategy behavior and unresolved strategy decisions.
2. `ROADMAP.md` — implementation sequence, architecture target, quality gates, and PR backlog (this document).
3. Repository-root `ENGINEERING_STANDARDS.md` — coding, testing, review, and definition-of-done contract.
4. Existing code and tests — current behavior only; code is not automatically proof that the behavior is correct or approved.

If documents conflict, do not silently choose. Preserve the explicit strategy rules in `README.md`, identify the conflict, and ask for a focused decision. Update both documents when an approved strategy decision changes the roadmap.

## 3. Target architecture

### Dependency direction

```text
                    app/bot-free-roll
                 strategy orchestration
                           |
                           v
                Coinzilla domain entities
        (Money / Asset / Market / Order / Fill /
          Commission / Balance / TradingRules)
                           ^
                           |
                 Broker capability ports
                           ^
                           |
              CEX-specific broker adapters
          Binance | Bybit | ... (outside strategy)
```

The diagram describes dependency direction, not a requirement to create every named entity as a class. Prefer small plain JavaScript objects and pure functions. Reuse existing Coinzilla entities and interfaces where they already express the required contract; do not create duplicate domain models.

### Strategy may depend on

- Coinzilla-owned entities and stable broker capability interfaces.
- Pure strategy, accounting, validation, and state-transition functions.
- Injected clocks, persistence, logging, and event publication ports where needed.

### Strategy must not depend on

- `@binance/*`, Binance SDK classes, Binance REST/WebSocket payloads, or Binance-specific enums.
- Exchange-specific commission field names (for example, `commissionAsset`) outside the adapter.
- Exchange-specific filter names (for example, `PRICE_FILTER`, `LOT_SIZE`) outside the adapter.
- Exchange-specific status strings or assumptions about execution-report shape.
- Exchange-specific precision/rounding behavior.
- Global network calls or direct CEX access from domain calculations.

### Broker adapter responsibilities

Each adapter translates its exchange into Coinzilla contracts and must:

- Expose supported capabilities explicitly.
- Normalize orders, executions/fills, commissions, balances, market data, and trading rules.
- Preserve source identifiers and exact decimal strings.
- Report unsupported or unavailable information explicitly; never fabricate defaults.
- Handle exchange pagination, reconnects, API errors, rate limits, and exchange-specific quirks.
- Pass the shared broker contract test suite.

A broker capability is optional only when the strategy can safely operate without it. The strategy must check capability availability before starting the affected behavior. Missing required capability means fail closed, not a silent fallback.

## 4. Domain invariants

These are safety invariants. Every implementation PR must preserve them and add tests when it touches related behavior.

### I. Execution truth

- An accepted order is not a fill.
- A fill is an immutable economic event with a stable identity.
- Partial fills are first-class; one order can produce many fills.
- A fill is applied exactly once, even if delivered more than once or discovered through both stream and history.
- Corrections, busts, or trade reversals (if a CEX supports them) must be represented explicitly; never mutate historical fills silently.
- Order status and fill history are separate facts. Terminal order status does not imply zero fills.

### II. Commission truth

Every fill records zero or more commission entries with exact amount and asset identity.

Support, at minimum:

- Quote-asset commission.
- Base-asset commission.
- Third-asset commission is unsupported: reject a pair before startup when its effective fee configuration requires a third asset; if one unexpectedly appears, preserve the reported fill/fee facts, mark accounting incomplete, and pause the pair without conversion or valuation.
- Explicit zero commission.
- Multiple commission entries if a venue can report them.
- Different commission assets/rates on fills belonging to the same order.
- Maker/taker fee differences.
- Discounts, promotions, rebates, and fee adjustments when the adapter can report them.
- Unknown or missing commission asset/amount.

Never replace actual commission with a configured rate. Configured fee rates are estimates/reserves for planning only. Actual fill accounting uses actual reported fees. If a required fee fact is unavailable, the affected accounting must be marked incomplete and trading must fail closed until resolved.

Do not acquire, hold, convert, or spend third assets for fees. Do not value an unexpected third-asset fee; preserve the reported fact, mark accounting incomplete, and pause the affected pair until the discrepancy is resolved.

### III. Exact financial values

- Financial values and increments cross domain/broker boundaries as decimal strings or an equally exact representation.
- No JavaScript `Number` arithmetic for money, quantity, fee, price, notional, or increment decisions.
- No arbitrary floating-point epsilon for profitability, balances, or fill deduplication.
- Decimal helpers validate input, scale/exponent bounds, sign, and overflow/resource limits.
- Rounding direction is explicit and tested for each purpose.
- After rounding, recompute the complete order and profitability constraints.

### IV. Inventory ownership

Maintain separate, reconciled buckets for:

- Active strategy inventory.
- Permanently retained free inventory.
- Inventory reserved by open orders.
- Inventory already executed but awaiting final reconciliation.
- External/unmanaged wallet inventory.

Do not derive strategy sellable quantity from total wallet balance alone. Never sell free or external inventory. Never reserve the same asset units for two live SELL orders.

### V. Profit approval

Every SELL proposal passes one centralized pure profitability decision.

It must include the exact quantity, price, relevant cost basis, already-realized proceeds allocation, all known fees, conservative fee reserves for the new execution, quote-asset valuation policy, and configured minimum net profit.

Approval must be denied when any required input is missing, stale, unsupported, inconsistent, or not exact. A valid limit price is not a fill guarantee; every actual fill is accounted independently and the completed recovery is verified from actual executions.

### VI. Safe lifecycle

- A cancel request is not proof of cancellation.
- A replacement is forbidden until the old order's final status and fills are reconciled.
- A timeout is an unknown outcome, not proof of failure.
- Retries of non-idempotent order creation require a stable client order identity and a reconciliation check first.
- On uncertain state, disconnect, restart, data gap, or reconciliation mismatch, pause the affected pair and do not auto-resume until explicitly reconciled.

## 5. PR execution rules

Each backlog item is intended to be one focused PR. Split further if a PR would change multiple independent invariants.

Every implementation PR must:

1. Reference its roadmap ID (for example, `FR-017`) in title/body.
2. State the invariant(s) it protects.
3. Add deterministic tests for normal, boundary, invalid, and failure cases relevant to the change.
4. Include a regression test for the bug being fixed.
5. Keep pure calculations independent of broker/network/time/logging.
6. Use one object argument for functions and return explicit result objects where that is the established project convention.
7. Avoid mutation of input objects and shared state in pure helpers.
8. Keep side effects at explicit orchestration/adapter boundaries.
9. Update this roadmap status and any affected strategy/interface documentation.
10. Report exactly which checks were run and their results. Never claim a test or CI check passed unless it actually ran and passed.

### Definition of done for each PR

- Behavior and acceptance criteria are explicit.
- Relevant unit and contract tests pass.
- Applicable application/workspace tests pass.
- No financial decision relies on binary floating-point arithmetic.
- No exchange-specific data leaks into strategy code.
- Errors are visible and actionable; unsafe conditions fail closed.
- No unrelated refactor, new dependency, or speculative abstraction.
- Documentation and roadmap status are updated.
- CI results are reported accurately.

## 6. Roadmap overview

| Stage | PR range | Goal | Exit gate |
|---|---:|---|---|
| 0. Roadmap and baseline | FR-001–FR-006 | Establish contracts and capture current behavior | Shared definitions and test baseline agreed |
| 1. Domain contracts | FR-007–FR-016 | Exchange-neutral entities and broker ports | Strategy can compile/test against fake broker only |
| 2. Exact arithmetic and market rules | FR-017–FR-026 | Exact amounts, increments, and validation | No Number-based financial decisions |
| 3. Fills and commissions | FR-027–FR-036 | Correct actual execution and all fee assets | Every fill/fee represented once |
| 4. Ledger and free inventory | FR-037–FR-046 | Correct cost basis, realized P&L, and free coins | Ledger reconciles deterministic scenarios |
| 5. Profitability and order safety | FR-047–FR-056 | Central SELL approval and safe order lifecycle | Every SELL has a proven approval |
| 6. Reconciliation and recovery | FR-057–FR-066 | Startup, live, and restart reconciliation | Mismatch always blocks trading |
| 7. Strategy state machine | FR-067–FR-076 | Robust multi-pair Free-Roll behavior | Model-based lifecycle tests pass |
| 8. Simulation and release gates | FR-077–FR-086 | Adversarial tests, observability, and controlled rollout | Testnet acceptance gates pass |

The roadmap deliberately contains more than 80 PR-sized items. Some may be combined only when implementation and review remain cohesive; do not combine phases just to reduce PR count.

---

## 7. Detailed PR backlog

Status legend: `[ ]` planned · `[~]` in progress · `[x]` completed and verified · `[!]` blocked/decision required.

### Stage 0 — Roadmap and baseline (FR-001–FR-006)

- [x] **FR-001 — Establish this roadmap.** Add this document, target architecture, invariants, PR sequencing, AI instructions, and release gates. Acceptance: roadmap is committed in this application and linked from its README.
- [x] **FR-002 — Capture current behavior and gaps.** Completed in [CURRENT_STATE.md](./CURRENT_STATE.md): file/function gap matrix, severity, existing test map, and recommended implementation order. Runtime test/coverage baseline remains FR-004 and was not claimed by this source audit.
- [ ] **FR-003 — Define strategy decisions that block correctness.** Initial and ongoing price source are approved and recorded in README v0.004: use last traded price for initial entry and ongoing price monitoring; derive subsequent BUY limits from the last qualifying buy price using `priceStepPercent`; round limits down to the valid tick and fail closed when required price/rule data is unavailable. Wait-for-full-fill behavior is approved and recorded in README v0.005: a partially filled order remains in progress; the strategy waits for full fill before advancing or making a new strategy order decision. Free-coin allocation is approved and recorded in README v0.006: allocate only after the recovery SELL is fully filled and actual net profit meets `minProfit`; a SELL canceled after partial execution allocates no free coins and the remaining position stays active. Third-asset commission use is rejected: reject a pair before startup when its effective commission configuration requires a third asset; if a third-asset fee is unexpectedly reported, record it and pause the pair without conversion or further trading. Still resolve market-data quality policy (FR-024) and manual wallet activity. Cost-basis allocation is intentionally left at current behavior for now; do not redesign it without a new discussion. Acceptance: all blocking decisions are recorded in README; no implementation silently chooses.
- [ ] **FR-004 — Establish app test/coverage baseline.** Run and document current app tests and coverage; identify uncovered critical branches. Acceptance: reproducible command and baseline report, no arbitrary coverage target without evidence.
- [ ] **FR-005 — Add roadmap PR template/checklist guidance.** Ensure future PRs state roadmap ID, invariants, tests, and check results. Acceptance: checklist is usable and does not duplicate repository-wide standards unnecessarily.
- [ ] **FR-006 — Define trading readiness states.** Specify pair states such as `INITIALIZING`, `READY`, `ACTIVE`, `RECONCILING`, `PAUSED_UNSAFE`, and `STOPPED`. Acceptance: transition table and allowed actions are documented before code.

### Stage 1 — Exchange-neutral domain contracts (FR-007–FR-016)

- [ ] **FR-007 — Audit existing Coinzilla entities.** Inspect the shared entities package and broker APIs; reuse suitable entities and list only genuine contract gaps. Acceptance: no duplicate Fill/Order/Money model is introduced.
- [ ] **FR-008 — Define canonical Asset and Market identity.** Represent asset identity, base/quote relationship, and symbol identity without parsing exchange-specific symbol strings in strategy code. Acceptance: deterministic validation and tests for ambiguous/invalid markets.
- [ ] **FR-009 — Define exact Money/Quantity value contracts.** Specify decimal-string amount plus asset/unit semantics and validation. Acceptance: amount cannot be confused across assets or dimensions.
- [ ] **FR-010 — Define canonical Order contract.** Include stable broker order ID, client order ID, market, side, type, limit price, original quantity, executed quantity, remaining quantity, status, and timestamps where available. Acceptance: no Binance field names in domain contract.
- [ ] **FR-011 — Define canonical Fill contract.** Include stable fill/trade identity, order identity, market, side, exact base quantity, exact quote quantity, execution price, liquidity role when known, and execution time. Acceptance: partial fills are independently representable.
- [ ] **FR-012 — Define canonical Commission contract.** Include exact amount, asset identity, fee category/source when known, and valuation metadata separately. Acceptance: zero and unknown are distinct; asset is never inferred.
- [ ] **FR-013 — Define canonical Balance and reservation contracts.** Distinguish total, available, locked/reserved, and source timestamp. Acceptance: strategy can identify spendable and sellable amounts without reading CEX payloads.
- [ ] **FR-014 — Define TradingRules contract.** Cover price increment, quantity increment, min/max quantity, min/max notional, supported order types, and other relevant restrictions. Acceptance: unknown rule is not treated as zero/unrestricted.
- [ ] **FR-015 — Define focused broker capability ports.** Separate market data, trading, order queries, trade history, balances, rules, and stream lifecycle where appropriate. Acceptance: strategy requests only required capabilities and checks support explicitly.
- [ ] **FR-016 — Add broker contract test kit and fake broker.** Test behavior independently of any CEX SDK. Acceptance: a fake broker can run strategy tests with deterministic streams, fills, failures, and history.

### Stage 2 — Exact arithmetic and market rules (FR-017–FR-026)

- [~] **FR-017 — Harden decimal parser and formatter.** Reject malformed signs, exponent abuse, whitespace-only values, NaN/Infinity, unsafe scales, and unsupported forms. Acceptance: exhaustive table-driven tests and round-trip properties.
- [ ] **FR-018 — Complete exact decimal operations.** Add exact division with explicit rounding, absolute value, min/max, compare, negate, and scale operations as needed. Acceptance: no hidden Number conversion; all operations tested at scale boundaries.
- [ ] **FR-019 — Exact increment rounding.** Implement price/quantity rounding using decimal strings and integer arithmetic only. Acceptance: round down/up/nearest behavior is explicit; large and tiny increments tested.
- [ ] **FR-020 — Exact percentage and rate calculations.** Implement percentage points, fee rates, and percentage changes without Number arithmetic. Acceptance: examples and boundary tests cover tiny prices and high precision.
- [ ] **FR-021 — Exact notional calculation.** Calculate price × quantity and min-notional checks exactly. Acceptance: values at minNotional - one unit, exactly minNotional, and + one unit.
- [ ] **FR-022 — Trading-rule validator.** Validate tick, step, min/max quantity, notional, price bands, and supported order type from canonical TradingRules. Acceptance: structured rejection reasons, no CEX-specific logic.
- [ ] **FR-023 — Remove financial Number boundaries from strategy.** Prerequisite: first repair the existing PR #228 decimal-string integration regression identified in [CURRENT_STATE.md](./CURRENT_STATE.md) (string concatenation and Number conversions in bot accounting). Then replace Number conversion in position, cost, proceeds, fees, and order-plan paths. Acceptance: regression tests cover repeated accumulation and minimum-profit boundaries; static review finds no Number arithmetic in financial decisions.
- [ ] **FR-024 — Validate market-data freshness and quality.** Define timestamp, sequence/gap, stale, invalid, and crossed/empty quote rules for whichever price source is approved. Acceptance: stale/invalid market data cannot trigger orders.
- [ ] **FR-025 — Add property-based-style deterministic arithmetic tests.** Use native test runner loops/generators with fixed seeds or exhaustive bounded cases; do not add a dependency without justification. Acceptance: identities, monotonicity, rounding bounds, and no mutation.
- [ ] **FR-026 — Add decimal regression corpus.** Include real observed precision/filter cases (including prior tick/step and percent-price failures) as fixtures. Acceptance: regressions remain reproducible without network access.

### Stage 3 — Actual fills and all commission cases (FR-027–FR-036)

- [ ] **FR-027 — Normalize CEX execution events into canonical fills.** Adapter-only mapping from raw exchange event/history records to Fill and Commission entities. Acceptance: raw payloads never enter strategy; adapter tests preserve exact strings and source IDs.
- [ ] **FR-028 — Preserve fill-level commission data.** Capture every actual commission amount and asset, including explicit zero and missing values. Acceptance: quote/base/third asset all survive adapter mapping unchanged.
- [ ] **FR-029 — Deduplicate fills by stable identity.** Define uniqueness scope (broker/account/market/trade ID) and idempotent application. Acceptance: same fill delivered by stream, REST history, and replay changes ledger exactly once.
- [ ] **FR-030 — Handle multiple partial fills per order.** Aggregate fills without treating order cumulative totals as additional fills. Acceptance: one order with N partial fills yields exact summed base, quote, and fees.
- [ ] **FR-031 — Handle mixed commission assets and rates.** A single order may have different commission assets or amounts across fills. Acceptance: no order-level fee assumption; every commission remains attached to its fill.
- [ ] **FR-032 — Account for quote-asset fees.** Correctly adjust quote cash flow/cost or net proceeds. Acceptance: BUY and SELL examples reconcile to exact quote balances.
- [ ] **FR-033 — Account for base-asset fees.** BUY fees reduce received base; SELL fees consume additional base where reported. Acceptance: sellable quantity and free inventory reflect actual base debits.
- [ ] **FR-034 — Reject third-asset commission requirements and handle unexpected fees.** Before a pair becomes ready, inspect the effective broker/account commission configuration and reject the pair if fees must be paid in an asset other than its base or quote. If a third-asset fee is unexpectedly reported, preserve the actual fill/commission facts, mark accounting incomplete, and pause the pair; do not convert or value the fee. Acceptance: startup rejection and unexpected-fee pause are covered by deterministic tests.
- [ ] **FR-035 — Handle zero fees, rebates, discounts, and adjustments.** Distinguish zero commission from absent commission; represent rebates/negative fees only if canonical contract and venue semantics support them. Acceptance: no fictitious configured fee is booked as actual.
- [ ] **FR-036 — Reconcile execution stream with trade history.** Fetch missing trades and merge idempotently; compare order cumulative totals against fills. Acceptance: gaps, duplicates, and inconsistent totals are detected and surfaced.

### Stage 4 — Ledger, cost basis, and free inventory (FR-037–FR-046)

- [ ] **FR-037 — Define immutable per-fill ledger entries.** Store economic events and source references; derive balances from entries. Acceptance: replaying the same ledger produces the same result.
- [ ] **FR-038 — Implement per-market inventory ledger.** Track base quantity and quote cash flows by asset, keeping external/unmanaged activity separate. Acceptance: no cross-pair or cross-asset mixing.
- [ ] **FR-039 — Implement approved cost-basis allocation.** Use the explicitly approved method (initially likely weighted average) for buys, partial sells, and residual inventory. Acceptance: hand-calculated examples and conservation tests.
- [ ] **FR-040 — Allocate quote-denominated buy/sell fees exactly once.** Prevent double counting between trade cost, fee expense, and realized proceeds. Acceptance: ledger balance identities hold.
- [ ] **FR-041 — Allocate base-asset commission exactly.** Keep gross fill quantity, fee quantity, and net inventory delta distinct. Acceptance: repeated base-fee fills reconcile to actual base balance.
- [ ] **FR-042 — Enforce the no-third-asset commission policy.** Validate effective fee-asset configuration before startup and reject ineligible pairs. Preserve any unexpected third-asset commission as an actual reported fact, mark the ledger incomplete, and pause the pair without conversion. Acceptance: no third-asset conversion, valuation, or further trading occurs.
- [ ] **FR-043 — Implement active/free/reserved inventory buckets.** Free inventory is permanently excluded from strategy sell quantity; order reservations cannot overlap. Acceptance: invariants tested through buys, sells, cancel, and restart.
- [ ] **FR-044 — Define recovery-cycle boundaries and allocation.** Implement the approved rule for partial recovery, previous proceeds, free-coin allocation, and subsequent cycles. Acceptance: no free coins are created from order status alone.
- [ ] **FR-045 — Calculate realized P&L and unrealized valuation separately.** Report quote-denominated realized net P&L and clearly labeled marked valuation. Acceptance: free-coin market value is never mislabeled as realized profit.
- [ ] **FR-046 — Add ledger invariant checker.** Validate conservation of quantities, fee accounting, reservations, and cost basis after every event/replay. Acceptance: inconsistency yields structured failure and pair pause.

### Stage 5 — Profitability and safe order lifecycle (FR-047–FR-056)

- [ ] **FR-047 — Define centralized SELL profitability input/output contract.** Pure function accepts position, candidate quantity/price, cost basis, proceeds allocation, fee assumptions, valuation data, trading rules, and minProfit. Acceptance: decision includes approval, reason codes, and exact calculation breakdown.
- [ ] **FR-048 — Calculate conservative SELL fee reserve.** Handle unknown maker/taker outcome and configured schedule, while enforcing that required commission assets are limited to the pair's base or quote asset. Reject pairs requiring third-asset fees. Acceptance: planning reserves are distinct from actual fees.
- [ ] **FR-049 — Calculate exact minimum profitable SELL price.** Account for all remaining cost, fees, prior proceeds, minimum profit, and sell quantity. Acceptance: exact price rounded upward and revalidated after rounding.
- [ ] **FR-050 — Enforce profitability gate at execution boundary.** All SELL intents pass the same validator immediately before submission. Acceptance: no alternate strategy path can submit SELL directly.
- [ ] **FR-051 — Revalidate partial SELL fills.** Apply each actual fill and recalculate remaining position/profitability. Acceptance: a partially filled order cannot cause double recovery or premature free allocation.
- [ ] **FR-052 — Reserve inventory before submitting SELL.** Reserve exact base amount and fee allowance atomically within pair state. Acceptance: simultaneous/repeated events cannot over-reserve inventory.
- [ ] **FR-053 — Make order creation idempotent.** Use canonical client order IDs and reconcile ambiguous timeouts before retry. Acceptance: no duplicate live orders after response loss/retry.
- [ ] **FR-054 — Make cancel/replace lifecycle race-safe.** Reconcile final order and fills after cancellation; handle fill-during-cancel and late stream events. Acceptance: no replacement until old reservation is released with proof.
- [ ] **FR-055 — Normalize order state transitions.** Translate exchange statuses into canonical lifecycle states with explicit unknown/unsupported cases. Acceptance: strategy does not compare CEX status strings.
- [ ] **FR-056 — Add pair-level fail-closed trading guard.** Central guard blocks startup or new orders when the effective commission configuration requires a third asset, an unexpected third-asset fee is reported, market data is stale, rules are invalid, the ledger mismatches, order state is uncertain, or profitability is unproven. Acceptance: every guard reason is observable and tested.

### Stage 6 — Reconciliation and restart recovery (FR-057–FR-066)

- [ ] **FR-057 — Define reconciliation snapshot contract.** Collect balances, open orders, order history, fills/trades, and server time/cursors through broker ports. Acceptance: snapshot carries source timestamps and completeness markers.
- [ ] **FR-058 — Reconcile open orders against local orders.** Detect missing, unexpected, duplicate, changed, and terminal orders. Acceptance: discrepancies block the affected pair.
- [ ] **FR-059 — Reconcile local fills against exchange trade history.** Backfill missed events and detect unknown fills. Acceptance: replay is idempotent and reports unresolved history windows.
- [ ] **FR-060 — Reconcile balances against ledger and reservations.** Account for locked balances, fees, deposits/withdrawals, and external activity. Acceptance: unexplained deltas do not get silently attributed to strategy.
- [ ] **FR-061 — Add explicit reconciliation diagnostics.** Produce per-pair discrepancy codes, amounts, source IDs, and recommended operator action. Acceptance: no opaque “paused” state without reason/context.
- [ ] **FR-062 — Persist ledger and state snapshots.** Use injected persistence port; version schema and make writes atomic/durable. Acceptance: restart can restore exact financial state without floating-point conversion.
- [ ] **FR-063 — Implement deterministic startup recovery.** Load persisted state, fetch broker snapshot, reconcile, then transition to READY only when all invariants hold. Acceptance: no order placement before successful reconciliation.
- [ ] **FR-064 — Handle stream disconnect/reconnect and data gaps.** Track connection health and replay from history/cursor where supported. Acceptance: pair pauses during gap and resumes only after reconciliation.
- [ ] **FR-065 — Implement safe recovery from unknown order-create/cancel outcomes.** Query by client ID/order ID/history before retrying or releasing reservations. Acceptance: timeout never creates duplicate order or frees reserved funds prematurely.
- [ ] **FR-066 — Add explicit operator-controlled resume workflow.** Provide inspectable pause reason and validated resume action; no automatic unpause after unresolved discrepancy. Acceptance: resume requires fresh successful reconciliation.

### Stage 7 — Free-Roll state machine and multi-pair behavior (FR-067–FR-076)

- [ ] **FR-067 — Extract pure Free-Roll transition decisions.** Separate state transition planning from effects in the bot orchestrator. Acceptance: transitions test with plain input/output objects and no broker.
- [ ] **FR-068 — Formalize per-pair state machine.** Model initial entry, active buys, standing orders, recovery sells, free allocation, pause, and recovery. Acceptance: impossible transitions are rejected.
- [ ] **FR-069 — Implement initial entry policy.** Apply the approved initial reference/entry decision and available-capital checks. Acceptance: no accidental immediate or market order.
- [ ] **FR-070 — Implement standing BUY policy.** Apply approved price source and per-pair step; maintain one intended BUY reservation. Acceptance: no duplicate buys on repeated ticks.
- [ ] **FR-071 — Implement standing SELL policy.** Generate only approved SELL intents based on exact active inventory and profitability. Acceptance: free/reserved/external inventory excluded.
- [ ] **FR-072 — Implement buy-fill-driven sell replacement.** Cancel/reconcile old sell, apply all fills, recalculate, and replace safely. Acceptance: multiple buys before sale retain one configured free allocation per recovery cycle.
- [ ] **FR-073 — Implement sell-fill-driven cycle completion.** Verify actual net result and allocate free inventory only when approved completion condition is met. Acceptance: partial/canceled/under-target sale cannot create free coins.
- [ ] **FR-074 — Isolate pair state and concurrency.** Ensure one pair's failure does not corrupt another pair; serialize state changes per pair and protect shared asset balances across pairs. Acceptance: concurrent multi-pair tests pass.
- [ ] **FR-075 — Handle insufficient funds and shared quote-asset budgets.** Respect available balance and reservations across markets. Acceptance: no overspending and no hidden starvation/loop.
- [ ] **FR-076 — Add deterministic event replay tests.** Replay permutations/duplicates/late events for multi-pair order lifecycles. Acceptance: same canonical event history always produces same final state.

### Stage 8 — Simulation, observability, and release readiness (FR-077–FR-086)

- [ ] **FR-077 — Build deterministic fake exchange simulator.** Simulate ticks, fills, partial fills, fee assets, order errors, latency, and reconnects without network. Acceptance: repeatable seeded scenarios.
- [ ] **FR-078 — Add adversarial commission scenario matrix.** Cover quote/base assets, explicit zero, mixed quote/base assets across fills, unexpected third-asset fees, rebates where supported, missing asset, and precision edges. Acceptance: third-asset requirements are rejected before startup and unexpected third-asset fees pause the pair.
- [ ] **FR-079 — Add adversarial price/order-rule matrix.** Cover tick/step/minNotional boundaries, price bands, gaps, stale prices, partial fills, and changed trading rules. Acceptance: no invalid or under-profitable SELL submission.
- [ ] **FR-080 — Add state-machine/model-based scenario suite.** Cover fill/cancel races, restart at every lifecycle point, duplicate events, out-of-order events, and API timeouts. Acceptance: invariants checked after every transition.
- [ ] **FR-081 — Add broker adapter contract suite to every CEX adapter.** Run same canonical fixtures against Binance and future adapters. Acceptance: strategy test suite does not import any CEX package.
- [ ] **FR-082 — Add operational metrics and structured diagnostics.** Report per-pair readiness, ledger completeness, reconciliation status, fee totals by asset, open reservations, and pause reasons. Acceptance: logs never leak credentials and financial metrics are labeled as actual/estimated.
- [ ] **FR-083 — Add testnet end-to-end acceptance scenarios.** Place/cancel only in designated test environment; reconcile all resulting orders, fills, commissions, and balances. Acceptance: tests clean up safely and never use production credentials.
- [ ] **FR-084 — Add controlled rollout and live-trading kill switch.** Default to safe/test mode; require explicit environment/account confirmation and all readiness gates before live order capability. Acceptance: live trading cannot be enabled by accidental config typo.
- [ ] **FR-085 — Run extended soak and recovery validation.** Exercise multiple pairs, long-running streams, restarts, rate limits, API failures, and ledger recovery. Acceptance: no unexplained drift or unresolved state.
- [ ] **FR-086 — Production readiness review.** Audit every invariant, test evidence, adapter contract, persistence/recovery path, security boundary, and operator procedure. Acceptance: explicit human approval; no claim of guaranteed trading profit.

---

## 8. Required commission scenario matrix

The following cases are mandatory. They are not optional “edge cases”; they are normal supported fee outcomes when the broker reports them.

| Fill side | Commission asset | Required accounting effect |
|---|---|---|
| BUY | Quote | Increase quote acquisition cost / cash outflow |
| BUY | Base | Reduce net base inventory received; preserve gross fill |
| BUY | Third asset | Reject pair at startup if required; otherwise record unexpected fee and pause pair |
| SELL | Quote | Reduce net quote proceeds |
| SELL | Base | Increase base inventory consumed / reduce net base balance |
| SELL | Third asset | Reject pair at startup if required; otherwise record unexpected fee and pause pair |
| BUY/SELL | Zero | Record explicit zero; do not estimate it as an actual fee |
| BUY/SELL | Missing/unknown | Mark accounting incomplete; do not claim profitability |
| BUY/SELL | Mixed assets across fills | Account each fill's fee independently |
| BUY/SELL | Different maker/taker rates | Use actual per-fill commission; planning uses conservative estimate |
| BUY/SELL | Discount/rebate/adjustment | Preserve actual reported economic effect and source semantics |

Also test:
- One order with multiple fills and different fee assets.
- One fill with a commission amount of zero and a non-empty fee asset.
- Fee asset missing but fee amount non-zero.
- Fee amount missing but venue indicates commission was charged.
- Pair requires a third-asset commission at startup.
- Third-asset commission unexpectedly appears on an execution.
- Fee discount/token settings change and make the pair require third-asset payment.
- Fee discount token balance depleted mid-order, changing fee asset/rate.
- Commission precision finer than asset transfer/quantity step.
- Fees that cause net base quantity to fall below the intended keep quantity.
- Fees that cause net proceeds to fall below `minProfit` by the smallest representable quote unit.

## 9. Required price, quantity, and execution scenario matrix

- Very small and very large prices; leading/trailing zeros; scientific notation if contract allows it.
- Tick/step values not expressible as powers of ten (for example 0.05, 0.25).
- Exact increment, just below, and just above increment boundaries.
- Minimum/maximum price, quantity, and notional boundaries.
- Percent-price bands / dynamic price constraints where broker reports them.
- Price changes between plan calculation and order submission.
- Price changes while order is open; stale/out-of-order market events.
- Partial fills at different prices and across fee tiers.
- Cancel request racing with partial/full fill.
- Order-create timeout where order may actually exist.
- Duplicate/out-of-order execution messages.
- Trading-rule changes while a bot is running.
- Zero available balance, locked balance, insufficient quote/base, and shared quote asset across pairs.
- Quantity rounding that would consume free inventory or make the target keep quantity impossible.
- Recompute profitability after rounding; reject if rounding invalidates the target.

## 10. AI agent operating prompt

Paste this section into future AI development prompts or provide the full `README.md`, `ROADMAP.md`, and `ENGINEERING_STANDARDS.md`.

> You are contributing to Coinzilla's `apps/bot-free-roll`.
>
> 1. Read the complete strategy README, this roadmap, and root engineering standards before changing code.
> 2. Identify the relevant roadmap ID(s) and state which invariant(s) the change protects.
> 3. Inspect current code, existing Coinzilla entities, broker capability interfaces, and tests. Do not invent interfaces or duplicate entities.
> 4. Keep strategy code CEX-agnostic. Exchange-specific payload mapping belongs in the corresponding broker adapter, outside this app.
> 5. Use exact decimal strings/integer arithmetic for all financial values and exchange increments. Do not convert financial values to JavaScript Number for decisions.
> 6. Prefer small pure functions with one object argument, no mutation, explicit result objects, and deterministic native Node.js tests. Keep I/O and stateful orchestration at boundaries.
> 7. Treat actual fill-level commissions as authoritative. Support quote, base, zero, mixed, and unknown commission cases. Reject pairs configured to require third-asset commissions; if one is unexpectedly reported, preserve the actual fact and pause the pair without conversion. Never replace actual fees with configured estimates.
> 8. Never submit a SELL without the centralized profitability approval. If a required fact is unknown, stale, unsupported, or unreconciled, fail closed and pause the affected pair.
> 9. Preserve active, free, reserved, and external inventory separately. Never sell free inventory or double-reserve assets.
> 10. Handle partial fills, duplicate/out-of-order events, cancel/fill races, ambiguous timeouts, reconnects, and restarts.
> 11. Add tests for normal, boundary, invalid, failure, and regression cases. Do not depend on live exchange services in unit tests.
> 12. Keep the PR small. Update this roadmap's status and related documentation. Report exact test commands/results. Never claim unrun checks passed.
> 13. Do not change approved strategy behavior without discussing the decision first.
>
> **Do not optimize for fewer PRs. Optimize for correctness, reviewability, and recoverability.**

## 11. Current implementation snapshot (2026-10-30)

See [CURRENT_STATE.md](./CURRENT_STATE.md) for the detailed FR-002 source audit, severity-ranked gap matrix, existing test map, and recommended order of work.

This is a snapshot of known repository state when the roadmap was created. Re-check the code before relying on it; it will become stale as PRs merge.

### Existing foundations

- The app is JavaScript ESM and uses Node's built-in test runner.
- The Free-Roll strategy is already separated from the broker package at a high level.
- Per-pair configuration and a keyed per-pair task queue exist.
- Pure helper functions and deterministic unit tests exist for some buy thresholds, decimal operations, and tick/step rounding.
- PR #227 introduced decimal-safe tick/step rounding.
- PR #228 is merged and introduced exact decimal-string quote accounting helpers and exact profit comparison.
- Binance SDK adapter currently exposes raw `getOrderHistory()` and `getMyTrades()` responses; trade history includes fill-level commission amount and asset. These are read-only diagnostics/reconciliation inputs, not yet a complete strategy ledger.
- The strategy currently estimates fill accounting from order quantity/price and a configured fee rate. It does not yet consume canonical fill-level actual commission records as the source of truth.
- The strategy still has Number-based base-quantity accounting and Number conversions at the sell-plan boundary.
- The broker base class is currently a minimal class with a small set of methods; capability contracts need deliberate design.
- The Binance adapter currently owns Binance SDK and raw API integration. This is the correct boundary for exchange-specific mapping.

### Known gaps to validate early

- Execution events currently drive important bot behavior, but order fill accounting is inferred from tracked order values rather than a deduplicated canonical trade ledger.
- Partial-fill and cancel/fill race handling is not yet proven end-to-end.
- Actual commission assets are not yet reflected in the strategy ledger.
- Third-asset commission valuation policy is unresolved.
- Free-coin quantity and cycle completion are currently estimated and need reconciliation against actual fills.
- Restart persistence and startup reconciliation are not yet complete.
- Some broker/market rule details and fallbacks require review against the full canonical TradingRules contract.

### Current status

- [x] Roadmap document created.
- [ ] Current behavior/gap audit (FR-002).
- [ ] Domain contract design (FR-007 onward).
- [ ] Actual fill-level ledger and commission accounting.
- [ ] Centralized SELL profitability gate.
- [ ] Reconciliation, persistence, and release gates.

Do not mark a roadmap item complete because code exists. Mark it complete only when its acceptance criteria and tests are verified.
