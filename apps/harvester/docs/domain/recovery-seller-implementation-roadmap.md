---
title: Recovery Seller Implementation Roadmap
status: active
type: implementation-plan
owner: harvester
created: 2026-11-14
---

# Recovery Seller (RS) — Implementation Roadmap

**Status:** RS-1, RS-2a and RS-2b are COMPLETE. RS-2b includes the isolated application accounting workflow merged in [PR #1276](https://github.com/45s/coinzilla/pull/1276) as `9276b6c01bec62b743727548786c5af4a04b7908` from exact head `19448d63d117f563c31d8ab9422ac73623974782`. The PR reports 1,847/1,847 Harvester tests and all required checks passed; no TESTNET/LIVE operation was performed. The workflow commits terminal recovery/legacy projections atomically, calculates separate recovery/legacy allocation-level profitability results and publishes the terminal OrderRegistry only after success; RS-3 now calculates one combined cycle-level eligibility result and a fee-aware mixed-SELL price/quantity plan; allocation-level results remain accounting diagnostics only. The policy remains isolated from bootstrap and cannot submit orders. RS-3 pure policy is in progress: combined cycle eligibility and fee-aware mixed-SELL price/quantity planning are implemented; the owner-approved global STOP invariant is documented and its pure BLOCK decision primitive is being added; order-type/fee-role selection and broader deterministic policy outcomes remain. RS-4 shared Trading Engine integration and RS-5 offline lifecycle proof follow. RS is still non-executable.
**Tracking:** [issue #1127](https://github.com/45s/coinzilla/issues/1127) tracks the remaining RS work. [PR #1118](https://github.com/45s/coinzilla/pull/1118), [PR #1131](https://github.com/45s/coinzilla/pull/1131), [PR #1137](https://github.com/45s/coinzilla/pull/1137), [PR #1144](https://github.com/45s/coinzilla/pull/1144) and [PR #1152](https://github.com/45s/coinzilla/pull/1152) are merged.
**Domain contract:** [Recovery Seller Domain Specification](./recovery-seller-domain-specification.md).
**CG baseline:** [Conservative Domain Specification](./CONSERVATIVE_DOMAIN_SPECIFICATION.md).

## Objective and delivery order

Implement RS as an independent strategy policy using Harvester's existing domain and execution/accounting infrastructure. Preserve CG behavior throughout. Avoid speculative refactoring: extract or generalize CG functionality only when RS has a concrete need for it and tests prove the shared contract.

1. [x] Audit CG source, callers and tests; produce a function-by-function reuse map (completed as an audit only; no source code moved).
2. [x] **RS-2a — Shared Portfolio foundation:** merged in [PR #1118](https://github.com/45s/coinzilla/pull/1118). One Portfolio now supports multiple independently owned Positions per market and multiple Positions per strategy; canonical fill ownership/deduplication, aggregate market inventory, centralized custody/reservation boundaries and CG ownership-scoped consumers are covered.
3. [x] **RS-2b — RS-specific domain accounting:** complete through merged PRs #1131, #1137, #1144, #1152, #1153, #1203, #1212, #1213, #1262 and #1276. The application workflow now coordinates exact-once terminal accounting, verified external custody/quote-flow providers, separate allocation diagnostics, one combined cycle-level profitability result and reservation release. No RS runtime registration or order submission is included.
4. [ ] **RS-3 — Pure RS strategy policy:** resolve the explicit policy contract gaps below, then implement deterministic quantity, BUY/SELL planning and wait/block decisions with RED/GREEN tests.
5. [ ] **RS-4 — Shared Trading Engine integration:** register RS through the existing engine and shared order/broker/accounting workflows; prove same-market CG/RS concurrency.
6. [ ] **RS-5 — Offline lifecycle verification:** prove the complete lifecycle and exact-head CI without TESTNET/LIVE activity.
4. Implement the pure RS strategy policy.
5. Integrate RS through the shared Trading Engine, Portfolio, broker, order, fill and reconciliation workflows.
6. Prove the full lifecycle with deterministic offline tests and exact-head CI.

**Ongoing reuse rule:** whenever RS needs an existing CG capability, first characterize its current behavior with tests. If its contract is genuinely strategy-neutral, extract the smallest cohesive function into the appropriate shared domain location, add direct shared tests, and retain CG regression coverage in the same change. If it embeds CG policy, keep it in CG and implement an RS-specific rule. Do not create abstractions solely because they might be reusable later.

## Concurrent CG and RS operation

Concurrent operation is a product requirement, not an optional future optimization. RS and CG may be enabled at the same time, including for the same market.

- Each strategy evaluates its own policy and maintains its own cycle/accounting attribution.
- Both use the shared Portfolio, which may contain multiple independently owned Positions for the same market. Neither strategy owns a private wallet or a duplicate copy of actual exchange custody.
- Each Position and order retains stable strategy ownership through canonical order/fill processing; fills are attributed to exactly one Position and its owning strategy.
- The shared Trading Engine serializes order submission and accounting transitions.
- Actual quote/base availability and reservations are aggregated centrally across all Positions, CG, RS and other active strategies before any new order is accepted. Multiple Positions do not multiply the underlying exchange balance.
- Each strategy has its own configured per-pair investment budget and used/committed investment. An intent is checked against its originating strategy/pair's remaining budget; unused budget cannot be borrowed by another strategy. No cross-strategy investment-budget priority or fairness policy is required.
- The shared allocator serializes order submission and checks actual account-wide quote/base availability and reservations. If physical balance or reservations are insufficient, defer/reject the intent with its strategy identity and an actionable reason.
- A pause/disable for one strategy does not implicitly pause/disable the other; existing orders remain owned and reconcilable by their originating strategy.
- Same-market concurrent tests must prove multiple independent Positions can coexist, no shared quote is double-spent, no base quantity is reserved/sold twice, and no fill is attributed to multiple Positions or strategies.

The shared Portfolio is actual-accounting truth. Strategy-owned Positions are independent accounting allocations inside that one Portfolio, not separate wallets or duplicated exchange custody. Their aggregate remains bounded by authoritative exchange balances and centrally aggregated reservations. Each strategy's investment budget is independent; the shared allocator protects the common physical balances. RS-2a/2b now implement stable Position identity, immutable order ownership, verified external legacy Spot allocation, canonical mixed-fill attribution, exact-once terminal reconciliation, atomic recovery/legacy accounting, snapshot-relative base/quote flow and combined cycle-level profitability calculation. RS policy and runtime integration remain separate phases.

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

**RS-2b — COMPLETE (merged PR #1276):** the shared Portfolio, verified legacy Spot source, immutable order ownership, canonical mixed SELL allocations, partial-fill staging, terminal reconciliation, atomic recovery/legacy projections and snapshot-relative external base/quote-flow accounting are merged in PRs #1118, #1131, #1137, #1144, #1152, #1153, #1203 and #1212. PR #1213 adds the pure allocation-level profitability calculation; PR #1262 supplies the shared structured-error base. PR #1276 completes the application boundary: it stages terminal OrderRegistry updates, reconciles complete canonical fill history, commits both projections, calculates separate allocation diagnostics plus one combined cycle-level profitability result and publishes the registry only after success. Failed reconciliation/commit retains the old state and SELL reservation; duplicate terminal replay is a no-op. Confirmed fills are committed even when profitability is false. The verified Spot and quote-cash-flow providers remain injectable with empty defaults. PR #1276 merged as `9276b6c01bec62b743727548786c5af4a04b7908` from exact head `19448d63d117f563c31d8ab9422ac73623974782`; 1,847/1,847 Harvester tests and all required checks passed. No TESTNET/LIVE operation was performed. Bootstrap, runtime configuration, policy registration and order submission remain excluded; RS is non-executable.

**Deliverable:** independent deterministic RS domain model and pure calculations, tests first.

**First RS-2b logical-accounting slice implemented in merged PR #1131:** `src/domain/strategies/recovery-seller/legacy-position.js` now creates the operator-declared logical legacy position, calculates its original average cost once (36 decimal places, rounded away from zero), caps each cycle's configured legacy slice at the remaining quantity, and records the actual legacy quantity sold while preserving the original invested amount and average cost. Focused tests cover the initial basis, fixed basis after disposal, smaller final remainder, exhausted legacy quantity, and invalid inputs.

That PR's original scope was pure logical accounting. Subsequent merged RS-2b slices completed the verified custody, canonical allocation, terminal reconciliation and application commit boundaries described above. The resulting workflow still does not register RS or submit orders; RS remains non-executable.

Before implementing each rule, add a focused test that expresses the agreed business invariant and observe it fail. The mixed SELL allocation, partial-fill reconciliation, atomic cross-projection accounting, account-snapshot baseline and shared quote-allocation regression suites are registered in `apps/harvester/package.json` `targetedTestFiles` so focused Harvester CI exercises these boundaries directly. Reuse existing domain capabilities directly where their contracts fit. If a required CG function is a genuine strategy-neutral capability, characterize it, extract it in the same focused change, add direct shared tests, and prove CG behavior is unchanged. Do not perform a separate speculative extraction pass.

Model only the concepts required by the approved RS contract:

- Multiple independent Positions per market, each with stable identity and strategy ownership; distinct acquisition lots/tranches and strategy accounting must not be collapsed merely because the market symbol matches.
- Explicit operator authorization is required before RS may manage pre-existing legacy inventory; wallet balances or external/manual activity never grant authorization automatically. Authorization permission, Portfolio accounting, and verified Spot availability are separate facts. The operator manually enters original quote investment and original base quantity in configuration before application startup; this is the explicit authorization and declared historical basis. Historical exchange evidence and a runtime authorization UI are not required. Advanced runtime editing, expiry/revocation and authorization lifecycle are deferred under FITDIB.
- Original legacy quote investment and original base quantity; RS calculates average historical cost once as invested / quantity and keeps it fixed.
- Legacy attribution: original and remaining legacy quantity, confirmed disposals; original average cost remains fixed.
- Custody: Spot-available, EARN/off-Spot and unresolved quantities are distinct; transfers do not change historical cost basis.
- Recovery tranche: canonical BUY-fill quantity, cost basis and actual commissions.
- Active/pending/partial/unknown order reservations.
- Use the existing pair-level `minProfit` as the minimum net profit for the entire cycle SELL. For a mixed SELL, net proceeds after all applicable fees must recover the full recovery BUY investment plus the historical cost allocated to the legacy quantity sold, then earn at least `minProfit`. Do not apply separate profitability gates to recovery and legacy allocations; retain their separate accounting and cost-basis tracking.
- Reuse Conservative's configured investment-limit logic. At the limit, stop submitting new BUYs but leave an already-open recovery SELL live and unchanged until it is filled/terminal; continue reconciliation.
- Follow Conservative's third-asset commission rule: require a reliable quote-currency valuation; missing, stale, ambiguous or unavailable valuation is not zero and fails closed before either accounting projection commits.
- Reuse Conservative BUY cadence, tranche sizing/configuration and pending-order safeguards where applicable, rather than introducing parallel RS-only behavior.
- When authorized legacy inventory is exhausted, continue normal recovery-only BUY/SELL cycles until the operator stops RS. Each recovery-only SELL must recover the recovery BUY investment and applicable fees, then earn at least the existing pair-level `minProfit`; when a legacy slice is included, its allocated historical cost is added to the same cycle-level recovery target. Exhaustion alone does not pause RS or require reauthorization. Existing orders/fills/reservations remain owned and reconciled.
- Exchange-filter-constrained dust may be classified only after a fully reconciled successful cycle; retain it as bonus inventory and permanently exclude it from all later RS cycle quantity, cost, proceeds, profitability, and availability calculations. Ordinary sellable residual must not be classified as dust.
- If remaining authorized legacy inventory is smaller than `sellQuantity`, use the smaller available/unreserved quantity in the current cycle SELL only when exchange filters and the combined cycle-level profitability gate pass; otherwise retain it. No extra final-liquidation authorization is needed solely because the remainder is smaller.

Agreed illustrative config shape (proposal only, not runtime configuration):

~~~js
orderQuantity: 5, // illustrative recovery BUY order quantity
sellQuantity: 0.01, // additional legacy quantity included in each cycle SELL
legacyPosition: {
  invested: 100, // original quote amount invested
  quantity: 50, // original base quantity acquired
},
~~~

For 100 USDT and 50 ZRO, RS calculates 2 USDT/ZRO. With an illustrative `orderQuantity: 5` ZRO and `sellQuantity: 0.01` ZRO, a fully netted 5 ZRO recovery tranche produces a 5.01 ZRO combined SELL target; the extra 0.01 ZRO is deducted from the authorized legacy position. A 0.01 ZRO legacy slice per cycle means 0.5 ZRO can support 50 cycles if Spot-available; 49.5 ZRO may be held in EARN. EARN inventory is not Spot-sellable until returned and authoritatively reconciled.

Required test families:

**Deliverable:** independent deterministic RS domain model and pure calculations, tests first.

Model only the concepts required by the approved RS contract:

- Original legacy quote investment and original base quantity; RS calculates average historical cost once as invested / quantity and keeps it fixed.
- Legacy attribution: original and remaining legacy quantity, confirmed disposals; original average cost remains fixed.
- Custody: Spot-available, EARN/off-Spot and unresolved quantities are distinct; transfers do not change historical cost basis.
- Recovery tranche: canonical BUY-fill quantity, cost basis and actual commissions.
- Active/pending/partial/unknown order reservations.
- One combined cycle-level profitability gate: mixed SELL net proceeds after all fees must recover recovery BUY cost plus allocated legacy historical cost and earn at least `minProfit`; recovery-only SELLs omit the legacy cost. Keep recovery and legacy allocations separate for accounting, not separate eligibility gates.
- Apply the smaller-remainder rule: legacy SELL quantity is capped downward to the remaining authorized, Spot-available, unreserved quantity; sell that smaller amount only when exchange filters and the combined cycle-level profitability gate pass, otherwise retain it. After legacy inventory is exhausted, continue recovery-only cycles (e.g. BUY 5 ZRO → SELL 5 ZRO) subject to the same combined cycle-level formula with zero legacy cost.

Agreed illustrative config shape (proposal only, not runtime configuration):

~~~js
orderQuantity: 5, // illustrative recovery BUY order quantity
sellQuantity: 0.01, // additional legacy quantity included in each cycle SELL
legacyPosition: {
  invested: 100, // original quote amount invested
  quantity: 50, // original base quantity acquired
},
~~~

For 100 USDT and 50 ZRO, RS calculates 2 USDT/ZRO. With an illustrative `orderQuantity: 5` ZRO and `sellQuantity: 0.01` ZRO, a fully netted 5 ZRO recovery tranche produces a 5.01 ZRO combined SELL target; the extra 0.01 ZRO is deducted from the authorized legacy position. A 0.01 ZRO legacy slice per cycle means 0.5 ZRO can support 50 cycles if Spot-available; 49.5 ZRO may be held in EARN. EARN inventory is not Spot-sellable until returned and authoritatively reconciled.

Required test families:

- Valid/invalid average-cost inputs, exact decimal precision and division behavior.
- Successful-cycle legacy quantity decrement by the actual legacy quantity sold; original average cost is never recalculated.
- Spot/EARN custody separation, transfers and insufficient Spot quantity.
- Recovery BUY fills, partial fills, actual commissions and cost basis.
- Mixed-cycle profitability where the recovery and legacy allocation-level results differ, but the combined SELL either does or does not recover both costs and earn `minProfit`.
- After each successful cycle, deduct the actual legacy quantity sold from the remaining legacy quantity exactly once; never recalculate the original average cost.
- Reservations, partial SELLs, cancellation races, unknown outcomes and exact-once fill identity.
- Exchange quantity-step/minimum-quantity/minimum-notional and residual boundaries, including remaining legacy quantity below `sellQuantity`; verify smaller remainder is sold only when the combined cycle-level profitability gate and exchange filters pass, otherwise retained. Constrained dust is retained only after successful full reconciliation and never re-enters later cycle accounting, while ordinary sellable residual remains actionable.
- Invalid, contradictory, stale or incomplete evidence fails closed.

Never fabricate BUY fills or seed Portfolio from unverified wallet snapshots.

**Acceptance:** plain-English tests, exact decimal strings, meaningful assertion messages, RED before implementation and GREEN after. Pure domain policy has no Binance SDK, I/O, broker, logger, Telegram, timer or runtime-engine dependency.

## RS-3 — Pure RS strategy policy

**Deliverable:** deterministic policy functions producing explicit decisions/order intents from validated domain facts. RS-3 must not submit orders, call a broker, mutate Portfolio/accounting, or register runtime configuration.

Implement:

- a global fail-closed decision primitive: any missing, contradictory, unexpected, or unmodeled condition produces a stable BLOCK/STOP decision, prevents all new trading actions, preserves accounting and reservations, and requires reconciliation plus operator review before any resumption;
- recovery-tranche and eligible legacy quantity decisions from actual net fills, fixed legacy basis, verified Spot availability and shared reservations;
- BUY planning within the RS strategy/pair investment budget, reusing only the explicitly approved Conservative-neutral cadence and fee rules;
- mixed SELL planning whose quantity never exceeds actual net recovery inventory plus the authorized, verified, unreserved legacy slice;
- one combined cycle-level gate requiring net mixed-SELL proceeds to cover recovery BUY cost, allocated legacy historical cost, all applicable fees, and pair-level `minProfit`, with exact decimal arithmetic and exchange-filter validation;
- explicit SUBMIT, WAIT, BLOCK, and RECONCILE outcomes with stable reason codes;
- state transitions for pending/open/partial/unknown/terminal orders without releasing reservations or starting another cycle on uncertain evidence.

### RS-3 policy contract gate — remaining implementation details

The combined cycle-level economic target and SELL commission allowance are owner-approved. The remaining items below are implementation details to be specified against Conservative source behavior and exchange filters before policy code is written; they must not alter the approved combined target.

**Settled BUY contract (not a blocker):** issue #1127 explicitly adopts Conservative's established BUY cadence, tranche sizing/configuration, pending-order safeguards and investment-limit model. Treat orderQuantity as the size of each RS BUY tranche and use the current Conservative source as the behavioral reference for initial/next-BUY pricing. At the RS investment limit, stop new BUYs while leaving an existing SELL live and reconciled to terminal filled state before considering another cycle. Do not invent RS-specific trailing/replacement behavior outside this inherited contract.

| Policy area | Owner-approved contract / remaining implementation work | Status |
|---|---|---|

| Mixed SELL price, quantity and order type | One SELL combines the recovery quantity and eligible legacy slice. Net quote target is `recovery BUY investment + legacy historical cost + minProfit`. Quote fees are grossed up by `1 / (1 - r)`; base fees gross up base quantity; third-asset fees require explicit quote valuation. Price rounds upward to the price tick; quantity rounds upward to the quantity step and fails closed if the full combined inventory cannot fit without overspending. Configured rates/valuations are planning assumptions; actual fill commissions govern accounting. | **PARTLY IMPLEMENTED:** combined target and pure fee-aware plan are covered by RS domain tests. Order-type/fee-role selection and full min/max filter policy remain separate RS-3 work. |
| Combined cycle profitability | Recovery and legacy allocations remain separately attributed for accounting, but eligibility is decided once for the whole SELL. | **IMPLEMENTED:** `net SELL proceeds after all fees >= recovery BUY cost + allocated legacy historical cost + pair-level minProfit`. Recovery-only cycles use zero legacy cost. Allocation-level profitability fields are diagnostics only. |
| Unexpected or unmodeled condition (formerly Question 4) | **OWNER-APPROVED GLOBAL STOP:** if reality does not match an explicitly approved RS scenario, stop all new trading actions. Preserve and exactly-once account confirmed fills/actual fees; retain order ownership, inventory and reservations; reconcile already-submitted orders; emit a stable BLOCK reason and require operator review. No guessing, workaround, blind retry, or automatic resume. | **DECIDED — GLOBAL INVARIANT.** Applies across the complete RS lifecycle, not only SELL profitability. |
| Terminal partial / canceled SELL and cycle-level proceeds | The owner chose one terminal SELL lifecycle per recovery cycle; there is no second/continuation SELL and no cumulative proceeds ledger in this phase. A terminal partial/canceled result leaves the cycle unresolved. | **DECIDED (Question 5):** one SELL order lifecycle per cycle. No second SELL and no new BUY after a terminal underfill/cancel until the separate unresolved-cycle policy is approved. |

The final-residual-without-a-new-BUY liquidation remains explicitly deferred under FITDIB and is not an RS-3 deliverable. Advanced pause/disable/abandon/resume/restart semantics also remain deferred.

**Acceptance:** deterministic tests cover success, exact boundaries, invalid state, combined cycle-profit calculations with differing recovery/legacy allocation results, partial/terminal/unknown order states, commission and filter constraints, and every explicit wait/block/reconcile outcome. The pure policy does not submit orders or perform I/O. Preserve all existing CG regression behavior.

## RS-4 — Concurrent Trading Engine integration

**Deliverable:** RS lifecycle integrated through existing Harvester application workflows, with CG and RS able to run concurrently.

Reuse the existing Trading Engine, broker port/adapter, canonical order/fill identities, multiple independently owned Positions per market within one shared Portfolio, centrally aggregated custody/reservations, reconciliation and safety gates. Keep RS and CG strategy attribution separate from actual Portfolio accounting; all projections must advance consistently for each canonical fill.

**Concurrency is required, not optional:**

- CG and RS may both be enabled and active at the same time.
- They may operate on different markets or on the same market when both pair configurations enable them.
- Do not introduce a global or per-market exclusive strategy lock or require a handoff before RS can run.
- Each strategy owns its own policy state, cycle attribution and submitted order identities.
- The shared Portfolio is the only actual Portfolio aggregate, not one Position per market. It may contain multiple independent Positions for the same market; each canonical fill updates exactly one correctly identified Position and the aggregate Portfolio exactly once and is attributed to the originating strategy.
- Each strategy has an independent configured per-pair investment budget and used/committed investment accounting. CG spend is charged only to CG's budget for that pair; RS spend only to RS's budget for that pair. Unused budget is never transferable between strategies. For example, with CG budget 500 / used 300 and RS budget 1,000 / used 700, a 250 USDT CG BUY is blocked (only 200 remains) while a 250 USDT RS BUY is within RS's 300 remaining.
- Reaching a strategy's own investment limit blocks only that strategy's new BUYs; it does not cancel or alter that strategy's already-open recovery SELL, which remains alive through fill/terminal reconciliation.
- The Trading Engine serializes intent allocation, broker submission and fill/accounting commits. Aggregate actual exchange quote/base availability and active reservations across all strategies before accepting another intent; these physical resources are shared even though investment budgets are separate.
- Competing intents that exceed a strategy's own budget are deferred/rejected against that strategy's budget. Intents that exceed shared account availability/reservations are deferred/rejected by the shared allocator. Preserve originating strategy identity. No cross-strategy budget priority or fairness policy is required.
- Advanced pause/disable/abandon/resume/restart lifecycle functionality is deferred under FITDIB. Existing orders remain owned by their originating strategy and are reconciled normally; no strategy may adopt or mutate another strategy's orders.

Preserve manual/external order ownership. EARN/off-Spot quantity is never available for Spot SELL planning. Unknown outcomes retain original order ownership and reservations and require reconciliation; never blindly retry. Add runtime config/registration only after contracts and validation are specified.

**Acceptance:** application tests prove CG and RS run concurrently on different and same markets; fills are applied once to the shared Portfolio and attributed to the correct strategy; shared reservations prevent double-spend/oversell; order lifecycle and broker safety remain correct. Advanced pause/disable/abandon/resume/restart lifecycle functionality is deferred under FITDIB. No parallel execution engine or strategy-specific broker.

## RS-5 — Offline lifecycle verification and delivery

**Deliverable:** deterministic end-to-end RS lifecycle proof and current documentation.

Cover: 50 ZRO / 100 USDT average-cost calculation; 0.5 Spot / 49.5 EARN custody; 0.01 legacy slice; combined cycle-level cost-recovery-plus-`minProfit` gate; partial/terminal fills and commissions; exact-once reservations/accounting; cycle completion after terminal reconciliation; fixed original average cost and decreasing remaining legacy quantity/custody across cycles; EARN redemption and authoritative Spot reconciliation; unknown outcomes, external orders, concurrent CG/RS operation on the same and different markets, shared reservations, strategy-specific attribution and exchange constraints.

Update the canonical RS specification, architecture, runtime config docs only when config is approved, tests index, docs index, Harvester roadmap and PR descriptions.

**Acceptance:** focused tests, full Harvester/workspace checks and all required GitHub Actions pass on the exact PR head. No weakened tests or safety gates. No TESTNET/LIVE operation in this roadmap.

## PR sequence

| PR | Scope | Exit gate |
|---|---|---|
| RS-1 | CG source audit and reuse map | Evidence-backed inventory and reuse decisions |
| RS-2a | Shared Portfolio/multi-Position accounting foundation | **COMPLETE** — merged in [PR #1118](https://github.com/45s/coinzilla/pull/1118); exact-head required CI passed |
| RS-2b | RS-specific domain accounting, custody and profitability | **COMPLETE** — PR #1276 merged as `9276b6c01bec62b743727548786c5af4a04b7908` from exact head `19448d63d117f563c31d8ab9422ac73623974782`; full Harvester suite 1,847/1,847 and all required checks passed. No exchange operations. |
| RS-3 | RS pure policy | PR #1213 adds the pure profitability foundation; the current RS-3 slice implements combined cycle-level eligibility and fee-aware mixed-SELL price/quantity planning with direct domain tests; order-type selection and broader deterministic policy outcomes remain pending |
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
  I -->|"Yes"| J["Validate combined cycle cost recovery and minProfit"]
  J --> K{"Legacy gate passes?"}
  K -->|"No"| X
  K -->|"Yes"| L["Shared Trading Engine safety and order gates"]
~~~

The diagrams do not override the [RS Domain Specification](./recovery-seller-domain-specification.md). RS-2b application accounting, verified custody and profitability integration are merged in PR #1276; RS remains non-executable. RS-3 policy must first resolve the contract gaps above; RS-4 then wires the policy into the shared engine, and RS-5 proves the offline lifecycle. Advanced lifecycle functionality remains deferred under FITDIB.
