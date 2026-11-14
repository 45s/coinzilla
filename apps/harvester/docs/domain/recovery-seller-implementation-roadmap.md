---
title: Recovery Seller Implementation Roadmap
status: active
type: implementation-plan
owner: harvester
created: 2026-11-14
---

# Recovery Seller (RS) — Implementation Roadmap

**Status:** RS-2 domain accounting is in progress; RS policy and runtime execution remain unimplemented.
**Tracking:** [PR #1115](https://github.com/45s/coinzilla/pull/1115).
**Domain contract:** [Recovery Seller Domain Specification](./recovery-seller-domain-specification.md).
**CG baseline:** [Conservative Domain Specification](./CONSERVATIVE_DOMAIN_SPECIFICATION.md).

## Objective and delivery order

Implement RS as an independent strategy policy using Harvester's existing domain and execution/accounting infrastructure. Preserve CG behavior throughout. Avoid speculative refactoring: extract or generalize CG functionality only when RS has a concrete need for it and tests prove the shared contract.

1. [x] Audit CG source, callers and tests; produce a function-by-function reuse map (completed as an audit only; no source code moved).
2. [~] TDD RS domain accounting, custody, attribution and profitability. The shared Portfolio contract now supports independent strategy-owned Positions per market; RS-specific accounting remains in this phase.
3. Implement the pure RS strategy policy.
4. Integrate RS through the shared Trading Engine, Portfolio, broker, order, fill and reconciliation workflows.
5. Prove the full lifecycle with deterministic offline tests and exact-head CI.

**Ongoing reuse rule:** whenever RS needs an existing CG capability, first characterize its current behavior with tests. If its contract is genuinely strategy-neutral, extract the smallest cohesive function into the appropriate shared domain location, add direct shared tests, and retain CG regression coverage in the same change. If it embeds CG policy, keep it in CG and implement an RS-specific rule. Do not create abstractions solely because they might be reusable later.

## Concurrent CG and RS operation

Concurrent operation is a product requirement, not an optional future optimization. RS and CG may be enabled at the same time, including for the same market.

- Each strategy evaluates its own policy and maintains its own cycle/accounting attribution.
- Both use the shared Portfolio, which may contain multiple independently owned Positions for the same market. Neither strategy owns a private wallet or a duplicate copy of actual exchange custody.
- Each Position and order retains stable strategy ownership through canonical order/fill processing; fills are attributed to exactly one Position and its owning strategy.
- The shared Trading Engine serializes order submission and accounting transitions.
- Actual quote/base availability and reservations are aggregated centrally across all Positions, CG, RS and other active strategies before any new order is accepted. Multiple Positions do not multiply the underlying exchange balance.
- When both strategies emit intents for the same scarce resource, deterministic allocation/fairness rules decide which intent can proceed. Deferred intents retain strategy identity and an actionable reason.
- A pause/disable for one strategy does not implicitly pause/disable the other; existing orders remain owned and reconcilable by their originating strategy.
- Same-market concurrent tests must prove multiple independent Positions can coexist, no shared quote is double-spent, no base quantity is reserved/sold twice, and no fill is attributed to multiple Positions or strategies.

The shared Portfolio is actual-accounting truth. Strategy-owned Positions are independent accounting allocations inside that one Portfolio, not separate wallets or duplicated exchange custody. Their aggregate remains bounded by authoritative exchange balances and centrally aggregated reservations. RS-2 now implements stable Position identity, strategy ownership, portfolio-wide fill attribution/deduplication, aggregate market inventory and CG ownership-scoped Portfolio consumers; RS-specific legacy/cycle accounting remains in progress and exact priority/fairness remain RS-4 decisions.

## RS-1 — Conservative source audit and reuse map

**Status: COMPLETE — audit only; no source code changed.**

**Deliverable:** source-verified inventory and extraction proposal. This audit was performed against the PR's `develop` base (`336c2dd078744b8dd2e2c3f471f04b796c2e63a2`). No source code was moved or changed.

### Reuse existing shared domain capabilities

These are already outside the Conservative strategy. RS should consume them rather than create copies:

| Capability | Existing source | Existing test evidence |
|---|---|---|
| Exact decimal arithmetic and comparisons | `@coinzilla/utils` | Existing Utils package tests |
| Canonical execution identity and fill facts | `@coinzilla/entities` (`Fill`) | Existing entity tests |
| Actual Position accounting | `src/domain/portfolio/position.js`, `position-accounting.js` | `position.test.js` |
| Commission validation | `src/domain/fills/validate-fill-commissions.js` | Existing fill/accounting coverage; locate exact direct suite before extraction |
| Exchange order-rule validation | `src/domain/orders/validate-order-against-trading-rules.js` | `validate-order-against-trading-rules.test.js` |
| Shared quote/base commitment allocation | `src/domain/orders/allocate-order-commitments.js` | `allocate-order-commitments.test.js` |
| Canonical pending order creation | `src/domain/orders/create-pending-canonical-order.js` | `create-pending-canonical-order.test.js` |

These capabilities are shared infrastructure, not RS extraction tasks.

### Conservative pure-function candidates

| Function | Current source | RS decision | Reason / condition |
|---|---|---|---|
| `isActiveOrderStatus` | `src/domain/strategies/conservative/helpers.js` | Extract candidate | Generic order lifecycle predicate; verify its blocking-status contract against RS order lifecycle. |
| `hasActiveOrder` | `src/domain/strategies/conservative/helpers.js` | Extract candidate | Market/side duplicate-order predicate; verify strategy ownership filtering before sharing. |
| `hasActivePosition` | `src/domain/strategies/conservative/helpers.js` | Extract candidate | Pure positive-quantity predicate with no CG-specific retained-inventory rule. |
| `calculateSellFeeRate` | `src/domain/strategies/conservative/sell-fee-rate.js` | Conditional extract | Reuse only if RS uses the same maker/taker fee-reserve semantics and order-type assumptions. |
| `calculateInitialBuyPrice` | `src/domain/strategies/conservative/initial-buy-price.js` | Conditional extract | Reuse only if RS uses the same percentage/tick-rounding rule; do not force CG's BUY pricing into RS. |
| `hasOutstandingRecovery` | `src/domain/strategies/conservative/helpers.js` | Conditional reuse | Its spent-versus-net-proceeds predicate may fit the RS recovery tranche, but must receive RS-tranche values only, never combined legacy basis. |

Relevant existing Conservative tests located: `helpers.test.js`, `sell-fee-rate.test.js`, and `initial-buy-price.test.js`. If RS-2 exposes a concrete need for one of these capabilities, add/strengthen characterization tests before extracting it; otherwise leave CG source untouched.

### Keep inside Conservative

| Function / model | Current source | Why it is not shared |
|---|---|---|
| `evaluateConservativeStrategy` | `src/domain/strategies/conservative/strategy.js` | Complete CG policy composition and order-intent rules. |
| `hasSellableInventory` | `src/domain/strategies/conservative/helpers.js` | Defined specifically as inventory above CG's `keepQuantity`. |
| `calculateRecoverySellPlan` | `src/domain/strategies/conservative/recovery-sell-plan.js` | Uses CG active quantity, `keepQuantity`, pooled recovery cost/proceeds and CG fee-reserve assumptions. |
| `evaluateRecoveryCompletion` | `src/domain/strategies/conservative/recovery-completion.js` | Owns CG's full-fill, minimum-profit, retained-inventory and constrained-dust completion semantics. |
| `RecoveryLedger` | `src/domain/strategies/conservative/recovery-ledger.js` | Stores CG-specific recovery-cycle accounting. RS needs separate attribution and legacy basis semantics. |

Relevant tests located include `strategy.test.js`, `recovery-sell-plan.test.js`, `recovery-sell-plan-accounting.test.js`, `recovery-completion.test.js`, and `recovery-completion.dust.test.js`. Preserve these as CG regression coverage; do not rewrite their meaning to fit RS.

### Application workflow boundary — do not copy

- `updateTradingAccounting()` in `src/use-cases/update-trading-accounting.js` commits Portfolio and the Conservative `RecoveryLedger` together. It is not a strategy-neutral accounting function.
- `createPortfolioWorkflow()` in `src/use-cases/create-portfolio-workflow.js` owns serialized fill processing and Conservative recovery-cycle completion/free-inventory behavior. RS should integrate through an explicit application workflow that coordinates shared Portfolio and RS attribution; do not fork or bypass the shared Portfolio.
- The shared Portfolio must support multiple independent Positions for the same market, including strategy-owned Positions. It remains one authoritative accounting aggregate over shared exchange custody; fills update the one correctly identified Position and aggregate Portfolio exactly once. RS must not fork Portfolio or create duplicate custody.

**RS-1 acceptance:** source paths and public exports are identified; existing shared capabilities are separated from extraction candidates; CG-specific behavior is explicitly retained; relevant tests are located; no speculative shared abstraction is approved. RS-1 is complete as an audit only. RS-2 is the first code-changing phase.

## RS-2 — TDD the RS domain

**Deliverable:** independent deterministic RS domain model and pure calculations, tests first.

Before implementing each rule, add a focused test that expresses the agreed business invariant and observe it fail. Reuse existing domain capabilities directly where their contracts fit. If a required CG function is a genuine strategy-neutral capability, characterize it, extract it in the same focused change, add direct shared tests, and prove CG behavior is unchanged. Do not perform a separate speculative extraction pass.

Model only the concepts required by the approved RS contract:

- Multiple independent Positions per market, each with stable identity and strategy ownership; distinct acquisition lots/tranches and strategy accounting must not be collapsed merely because the market symbol matches.
- Original legacy quote investment and original base quantity; RS calculates average historical cost as invested / quantity.
- Legacy attribution: original and remaining quantity, remaining basis, confirmed disposals.
- Custody: Spot-available, EARN/off-Spot and unresolved quantities are distinct; transfers do not change historical cost basis.
- Recovery tranche: canonical BUY-fill quantity, cost basis and actual commissions.
- Active/pending/partial/unknown order reservations.
- Independent recovery-tranche and legacy profitability gates. Recovery profit cannot subsidize a legacy loss.
- Cycle progress and residual handling only after the remaining owner decisions are settled.

Agreed illustrative config shape (proposal only, not runtime configuration):

~~~js
sellQuantity: 0.01,
legacyPosition: {
  invested: 100, // original quote amount invested
  quantity: 50, // original base quantity acquired
},
~~~

For 100 USDT and 50 ZRO, RS calculates 2 USDT/ZRO. A 0.01 ZRO legacy slice per cycle means 0.5 ZRO can support 50 cycles if Spot-available; 49.5 ZRO may be held in EARN. EARN inventory is not Spot-sellable until returned and authoritatively reconciled.

Required test families:

**Deliverable:** independent deterministic RS domain model and pure calculations, tests first.

Model only the concepts required by the approved RS contract:

- Original legacy quote investment and original base quantity; RS calculates average historical cost as invested / quantity.
- Legacy attribution: original and remaining quantity, remaining basis, confirmed disposals.
- Custody: Spot-available, EARN/off-Spot and unresolved quantities are distinct; transfers do not change historical cost basis.
- Recovery tranche: canonical BUY-fill quantity, cost basis and actual commissions.
- Active/pending/partial/unknown order reservations.
- Independent recovery-tranche and legacy profitability gates. Recovery profit cannot subsidize a legacy loss.
- Cycle progress and residual handling only after the remaining owner decisions are settled.

Agreed illustrative config shape (proposal only, not runtime configuration):

~~~js
sellQuantity: 0.01,
legacyPosition: {
  invested: 100, // original quote amount invested
  quantity: 50, // original base quantity acquired
},
~~~

For 100 USDT and 50 ZRO, RS calculates 2 USDT/ZRO. A 0.01 ZRO legacy slice per cycle means 0.5 ZRO can support 50 cycles if Spot-available; 49.5 ZRO may be held in EARN. EARN inventory is not Spot-sellable until returned and authoritatively reconciled.

Required test families:

- Valid/invalid average-cost inputs, exact decimal precision and division behavior.
- Partial legacy disposal and remaining-basis calculation.
- Spot/EARN custody separation, transfers and insufficient Spot quantity.
- Recovery BUY fills, partial fills, actual commissions and cost basis.
- Profitable recovery tranche paired with a loss-making legacy slice.
- Mixed SELL proceeds/fee allocation after the owner-approved rule exists.
- Reservations, partial SELLs, cancellation races, unknown outcomes and exact-once fill identity.
- Exchange quantity-step/minimum-quantity/minimum-notional and residual boundaries.
- Invalid, contradictory, stale or incomplete evidence fails closed.

Never fabricate BUY fills or seed Portfolio from unverified wallet snapshots.

**Acceptance:** plain-English tests, exact decimal strings, meaningful assertion messages, RED before implementation and GREEN after. Pure domain policy has no Binance SDK, I/O, broker, logger, Telegram, timer or runtime-engine dependency.

## RS-3 — Pure RS strategy policy

**Deliverable:** deterministic policy functions producing explicit decisions/order intents from validated domain facts.

Implement eligible recovery/legacy quantity calculations, approved cost/fee/filter-aware SELL planning, both independent profitability gates, explicit wait/submit/pause/reconciliation outcomes, and attribution across partial fills and repeated cycles.

Do not copy CG trailing BUY, next-BUY cadence, retained-inventory or recovery-completion behavior without an explicit decision that the same contract applies to RS.

**Acceptance:** deterministic tests for success, boundaries, invalid state and safety blocks. Policy does not submit orders.

## RS-4 — Concurrent Trading Engine integration

**Deliverable:** RS lifecycle integrated through existing Harvester application workflows, with CG and RS able to run concurrently.

Reuse the existing Trading Engine, broker port/adapter, canonical order/fill identities, multiple independently owned Positions per market within one shared Portfolio, centrally aggregated custody/reservations, reconciliation and safety gates. Keep RS and CG strategy attribution separate from actual Portfolio accounting; all projections must advance consistently for each canonical fill.

**Concurrency is required, not optional:**

- CG and RS may both be enabled and active at the same time.
- They may operate on different markets or on the same market when both pair configurations enable them.
- Do not introduce a global or per-market exclusive strategy lock or require a handoff before RS can run.
- Each strategy owns its own policy state, cycle attribution and submitted order identities.
- The shared Portfolio is the only actual Portfolio aggregate, not one Position per market. It may contain multiple independent Positions for the same market; each canonical fill updates exactly one correctly identified Position and the aggregate Portfolio exactly once and is attributed to the originating strategy.
- The Trading Engine serializes intent allocation, broker submission and fill/accounting commits. Aggregate quote and base reservations across all active strategies before accepting another intent.
- Competing intents must have deterministic allocation/priority behavior. Insufficient shared inventory or quote commitment defers/rejects the relevant intent with its strategy identity preserved.
- One strategy's pause/disable does not implicitly pause/disable the other. Existing orders remain owned by their originating strategy and are reconciled normally.

Preserve manual/external order ownership. EARN/off-Spot quantity is never available for Spot SELL planning. Unknown outcomes retain original order ownership and reservations and require reconciliation; never blindly retry. Add runtime config/registration only after contracts and validation are specified.

**Acceptance:** application tests prove CG and RS run concurrently on different and same markets; fills are applied once to the shared Portfolio and attributed to the correct strategy; shared reservations prevent double-spend/oversell; order lifecycle, pause/disable isolation and broker safety remain correct. No parallel execution engine or strategy-specific broker.

## RS-5 — Offline lifecycle verification and delivery

**Deliverable:** deterministic end-to-end RS lifecycle proof and current documentation.

Cover: 50 ZRO / 100 USDT average-cost calculation; 0.5 Spot / 49.5 EARN custody; 0.01 legacy slice; independent profitability gates; partial/terminal fills and commissions; exact-once reservations/accounting; cycle completion after terminal reconciliation; remaining basis/custody across cycles; EARN redemption and authoritative Spot reconciliation; unknown outcomes, restart, external orders, concurrent CG/RS operation on the same and different markets, shared reservations, strategy-specific attribution and exchange constraints.

Update the canonical RS specification, architecture, runtime config docs only when config is approved, tests index, docs index, Harvester roadmap and PR descriptions.

**Acceptance:** focused tests, full Harvester/workspace checks and all required GitHub Actions pass on the exact PR head. No weakened tests or safety gates. No TESTNET/LIVE operation in this roadmap.

## PR sequence

| PR | Scope | Exit gate |
|---|---|---|
| RS-1 | CG source audit and reuse map | Evidence-backed inventory and reuse decisions |
| RS-2 | RS domain model and TDD; opportunistic shared extraction only when required | Accounting, custody and profitability invariants proven; CG behavior preserved |
| RS-3 | RS pure policy | Deterministic decisions proven |
| RS-4 | Concurrent Trading Engine integration | Existing execution and safety infrastructure reused |
| RS-5 | Offline lifecycle and docs | Full lifecycle and exact-head CI green |

Each phase is a focused PR into develop. Every implementation commit includes tests and documentation. A phase is complete only after merge and required exact-head checks pass.

## Saved architecture diagrams

These Mermaid diagrams are version-controlled, editable source. They describe intended architecture, not current runtime implementation.

~~~mermaid
flowchart TB
  subgraph strategies["Concurrent independent strategy policies"]
    CG["Conservative (CG)"]
    RS["Recovery Seller (RS)"]
  end
  subgraph shared["Strategy-neutral domain functions"]
    CALC["Decimal / fee / quantity calculations"]
    ORDERS["Order eligibility and reservation rules"]
    ACCOUNT["Shared accounting primitives"]
  end
  subgraph app["Existing Harvester application"]
    ENGINE["Shared Trading Engine / serialized workflows"]
    PORTFOLIO["One shared Portfolio; multiple strategy-owned Positions per market"]
    ATTRIBUTION["Independent strategy attribution"]
    RESERVATIONS["Central quote/base reservations across strategies"]
    BROKER["Shared broker port and adapter"]
    RECON["Order, fill and account reconciliation"]
  end
  CG --> shared
  RS --> shared
  ENGINE --> CG
  ENGINE --> RS
  ENGINE --> PORTFOLIO
  ENGINE --> ATTRIBUTION
  ENGINE --> RESERVATIONS
  ENGINE --> BROKER
  BROKER --> RECON
  RECON --> PORTFOLIO
  RECON --> ATTRIBUTION
  RESERVATIONS --> ENGINE
~~~

~~~mermaid
flowchart TD
  A["Legacy basis: original invested quote + quantity"] --> B["RS calculates average historical cost"]
  B --> C["Track logical remaining quantity and basis"]
  C --> D{"Custody?"}
  D -->|"Spot"| E["Check authoritative free balance and reservations"]
  D -->|"EARN / off-Spot"| F["Not Spot-sellable; wait for return and reconciliation"]
  E --> G["Calculate eligible legacy slice"]
  F --> G
  G --> H["Evaluate recovery-tranche profit"]
  H --> I{"Recovery gate passes?"}
  I -->|"No"| X["WAIT / BLOCK"]
  I -->|"Yes"| J["Evaluate legacy profit independently"]
  J --> K{"Legacy gate passes?"}
  K -->|"No"| X
  K -->|"Yes"| L["Shared Trading Engine safety and order gates"]
~~~

The diagrams do not override the [RS Domain Specification](./recovery-seller-domain-specification.md) or resolve its outstanding authorization, accounting, profit allocation, risk, lifecycle and concurrent-resource-allocation decisions.
