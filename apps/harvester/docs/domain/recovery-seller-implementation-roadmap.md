---
title: Recovery Seller Implementation Roadmap
status: active
type: implementation-plan
owner: harvester
created: 2026-11-14
---

# Recovery Seller (RS) — Implementation Roadmap

**Status:** RS-1, RS-2a and RS-2b are COMPLETE. RS-3 foundations include the fee-aware mixed-SELL planner, sticky global STOP, deterministic lifecycle outcomes, Conservative-compatible BUY-tranche evaluation, immutable cycle state and one SELL per cycle. PRs #1325 and #1379 are merged. On 2026-11-18 the owner confirmed the existing per-pair `minProfit` only, Conservative-compatible order type/fee reserve, and STOP on any exchange-filter violation. The existing `minProfit >= 0.01` quote-asset floor is enforced by the pure planner. The pure pre-submission SELL evaluator is implemented and verified on code head `96315757e74a4851770716b04d8dae5cf9580ece`: Conservative-compatible order type/fee reserve, supported min/max exchange-filter checks, pair-configured `minProfit`, and sticky STOP on missing required filters, planning failures or filter violations. The evaluator suite passes 13/13; the full Harvester suite passes 2,101/2,101. Full workspace Unit Tests, Test Coverage, strict ESLint, workspace JavaScript quality/syntax, actionlint, Utils tests and dependency audit pass. Post-fill adverse outcomes, terminal partial/canceled SELL resolution, third-asset valuation source, and STOP reset/resume remain fail-closed; see the [policy blocker audit](./RECOVERY_SELLER_POLICY_BLOCKERS.md). RS-4 shared Trading Engine integration is in progress under [issue #1475](https://github.com/45s/coinzilla/issues/1475); RS remains non-executable until RS-4 and RS-5 offline acceptance are complete.
**Tracking:** RS-3 pure policy is completed in [PR #1127](https://github.com/45s/coinzilla/pull/1127). RS-4 shared-engine integration and RS-5 offline lifecycle proof remain separate phases. [PR #1118](https://github.com/45s/coinzilla/pull/1118), [PR #1131](https://github.com/45s/coinzilla/pull/1131), [PR #1137](https://github.com/45s/coinzilla/pull/1137), [PR #1144](https://github.com/45s/coinzilla/pull/1144) and [PR #1152](https://github.com/45s/coinzilla/pull/1152) are merged.
**Domain contract:** [Recovery Seller Domain Specification](./recovery-seller-domain-specification.md).
**CG baseline:** [Conservative Domain Specification](./CONSERVATIVE_DOMAIN_SPECIFICATION.md).

## Current RS-4 checkpoint — provider route handoff

The exact `{ strategyId, symbol }` assignments now survive provider-account startup and are returned in provider runtime metadata, separately from deduplicated `executionSymbols`. This preserves both owners when CG and RS share a market while subscribing once. The Harvester option resolver now filters those routes to CG-owned symbols before constructing the Conservative engine's pair map; RS-only provider startup fails closed with an explicit message until RS dispatch is implemented. This prevents an RS-only market from being evaluated as a CG market. This is still routing metadata only: it does not register RS, create an RS engine, or authorize execution. RS remains disabled/non-executable.

The strict ESLint findings in the already changed route and Telegram test fixtures were corrected as formatting-only changes; no test coverage or lint rules were weakened, and runtime behavior is unchanged.

The latest routing guard and regression tests ensure that a provider account's RS-only symbol is never passed into the CG Conservative pair map. Until the RS runtime is registered, a provider account with no CG-owned route fails startup explicitly rather than silently running an idle or misattributed strategy. This guard is temporary and must be replaced by actual RS strategy dispatch, not relaxed or removed without the dispatch implementation.

### Shared transition queue integration regression

The first full-workspace run after the queue wiring exposed one stale test fixture: `shared-order-registry.integration.test.js` manually constructed account state without the newly required queue. The fixture now uses the production `createAccountRuntimeRegistry` factory, so the integration test exercises the real account-state contract rather than duplicating it. No production behavior was changed to accommodate the test.

## RS order-event accounting ownership — implementation checkpoint

Canonical streamed RS BUY fills now dispatch through the RS accounting workflow based on immutable OrderRegistry ownership. RS BUYs do not enter Conservative accounting or Conservative execution totals. RS SELL fills remain fail-closed in the streamed-fill path and must be handled by terminal mixed-SELL reconciliation; they are not applied as standalone CG fills.

## RS-4 production evaluator dispatch — callback path connected

- `createLatestTransitionEvaluator` already supports a strategy-owned RS transition callback after Conservative evaluation.
- The production Conservative engine now injects that callback into the evaluator, and bootstrap/runtime composition preserves it from startup options to the engine.
- The callback is optional and validated when supplied; existing CG-only startup remains unchanged.
- The integration regression verifies the callback is invoked once for the market transition under the shared account runtime.
- This connects the production dispatch seam. The concrete RS policy/lifecycle evaluator and order/fill routing still must be composed before RS execution is permitted.

## RS-4 account transition queue — shared coordinator foundation

- The provider-account runtime now owns one serialized `runTransition({ task })` queue.
- The Conservative engine uses that account-owned queue whenever it is composed with a provider-account runtime from `createAccountRuntimeRegistry`. Standalone and legacy test-only shared-state fixtures without the new queue retain their local serialized queue for compatibility.
- The queue recovers after a rejected task without allowing later transitions to overlap or remain blocked.
- The offline regression verifies ordered execution and result preservation for two strategy transitions.
- This establishes the shared serialization primitive; RS evaluation, order/fill routing and reservations still must be wired into the same coordinator before RS can execute.

## Approved RS-4 architecture direction — 2026-11-19

The owner approved the architecture direction recorded in [Strategy extensibility architecture](../architecture/strategy-extensibility-audit-roadmap.md): one shared provider-account execution coordinator, explicit `{ strategyId, symbol }` dispatch, and one serialized account-level decision/order-transition path across CG and RS. Strategy policies, lifecycle semantics, accounting attribution and budgets remain independent; Portfolio custody, canonical order/fill processing, broker submission and quote/base reservations are coordinated account-wide. This is the implementation direction for #1475 / PR #1476, not a pending design question.

Do not interpret the shared accounting queue as satisfying the coordinator requirement: strategy decisions, intent allocation, submissions/acknowledgements and canonical order/fill transitions must also be serialized. Preserve CG behavior. RS remains disabled/non-executable until RS-4 integration and RS-5 offline acceptance pass; no broker-package changes or exchange mutations are part of this work.

## Next RS-4 checkpoint — shared account workflow state

The account-workflow state is shared by the Conservative Portfolio workflow and the RS accounting workflow. Both accounting workflows serialize fill/accounting updates through the same queue and expose the same immutable Portfolio snapshot. The live OrderRegistry is also reachable from this account state, and the Conservative engine now publishes each registry replacement through its validated accessor. The engine's broader event/decision queue is still separate; one cross-strategy dispatcher must serialize CG and RS decisions and order transitions before RS can execute. A regression covers shared Portfolio visibility and independent strategy-owned Positions. No RS order submission is enabled by this checkpoint.

Bootstrap now creates the Conservative Portfolio workflow and RS accounting workflow over the provider account's same state object. The shared state owns one immutable Portfolio snapshot, one OrderRegistry, one legacy-position map, and one serialized update queue; the account-runtime regression proves both workflows receive the same Portfolio and OrderRegistry while validated Portfolio, RecoveryLedger-map, OrderRegistry, legacy-position-map and queue accessors preserve a frozen state interface. This is accounting-state composition only: RS is not registered with the execution engine, and no RS order can be submitted. Strategy-aware engine dispatch, canonical RS order lifecycle, reservations, and RS-5 acceptance remain open.

Shared-state constructor validation is isolated in small helpers to keep the use-case entry points within the repository's complexity/length standards. The same commit also removes strict-lint violations from changed bootstrap/provider and notification fixtures without disabling rules.

The Conservative Trading Engine now binds its internal OrderRegistry to the account runtime's validated shared `orderRegistry` accessor. Pending registration, acknowledgement, cancellation and terminal reconciliation replace the shared registry snapshot through that accessor, so the RS accounting workflow sees the same current registry rather than a startup-only copy. A dedicated deterministic offline integration test in `shared-order-registry.integration.test.js` seeds the engine from the account registry and proves that a submitted Conservative BUY is visible through the RS accounting workflow's shared registry accessor. The legacy Conservative engine test file remains untouched so this focused coverage does not pull unrelated historical lint debt into the PR's changed-file checks. The dedicated test fixture follows Harvester's multiline object-property formatting rules; the exact-head lint check exposed one final object-property formatting finding, corrected in the follow-up commit. No legacy test files or lint rules were changed. This closes the shared-registry foundation only; strategy-owned RS dispatch and RS order/fill lifecycle are still outstanding.

The RS order-submission adapter now converts one approved RS lifecycle `SUBMIT` decision into the existing `makeExecuteStrategyDecision` workflow. It attaches immutable RS strategy/Position/cycle/purpose ownership, registers PENDING before broker I/O through the shared OrderRegistry callbacks, persists submission intent/outcome, and retains UNKNOWN plus a durably acknowledged sticky-STOP callback on uncertain outcomes. A BLOCK/WAIT/RECONCILE decision never reaches the broker. Offline tests cover pending-before-network ordering, acknowledged RS ownership, unknown acknowledgement timeout with no retry, and non-SUBMIT suppression. This adapter is not yet wired into Harvester bootstrap or user-data fill/terminal reconciliation; RS remains disabled/non-executable until those paths are complete.

The strategy-owned route filter is kept in a small resolver helper so the public startup option function remains within the repository's 60-line function standard. Exact-head CI caught this size regression and it is corrected here; no lint rule is suppressed.

The order-submission factory delegates shared executor construction to a focused helper so both the route resolver and submitter stay within the 60-line function standard. Exact-head CI exposed these size findings; they are fixed without suppressing lint rules.

Configuration evidence publication/logging is isolated in a helper so provider route filtering and effective pair selection remain within the 60-line startup-function limit. The order-submission executor construction is likewise extracted; these are structural quality fixes only.

The initial evidence-helper extraction accidentally left the public resolver calling the helper body recursively and did not shorten the caller. This was caught during exact-head source review before accepting the change; the helper now owns the publish/log operations and the resolver delegates to it. CI must verify this corrected revision.

The first full Harvester run confirmed the shared OrderRegistry ownership record also carries the canonical `clientOrderId`; the submitter integration assertion now checks that identity explicitly alongside RS strategy, Position, purpose, cycle and broker IDs. The unknown-submission and non-SUBMIT cases passed in that run.

A durable RS STOP workflow now restores an unresolved account-scoped RS blocker from the Operational State Store, persists the first STOP before exposing the in-memory STOPPED state, keeps the first evidence sticky, and clears it only through the existing explicit operator-resolution use case after full reconciliation/accounting evidence. It fails startup closed if multiple unresolved RS STOP blockers are present rather than choosing one. Offline tests cover persistence-before-latch, restart restoration/idempotency, durable operator resolution, and persistence failure. The submitter's required `onUnresolvedSubmission` callback can now be wired directly to this workflow's `latch`; Harvester bootstrap wiring remains outstanding.

Strict changed-file ESLint caught one prefer-destructuring warning in the submitter integration assertion; it now uses array destructuring. No lint rules or warning thresholds were changed.

The RS submitter integration test now uses the real durable STOP workflow instead of a stub: a broker acknowledgement timeout leaves the order UNKNOWN, appends one `SAFETY_BLOCKER_RAISED` fact, and latches STOP; no retry occurs. This proves the submission adapter's unresolved callback contract against the persisted STOP implementation. Bootstrap still needs to construct and inject this workflow for the live RS runtime.

The STOP workflow's blocker-ID extraction now follows the repository's destructuring rule. The prior exact-head lint run also included the submitter-test warning already corrected in the immediately following commit; this follow-up removes the remaining STOP-workflow warning without relaxing lint.

The real-STOP integration test now records the unresolved order identity in a multiline object literal to satisfy the use-case ESLint suite. This is a test-only formatting correction; the assertions still require one durable STOP fact and an UNKNOWN registered order.

The RS submission adapter now refuses SELL when no durable sole-cycle reservation callback is supplied. When supplied, it runs that reservation before pending-order registration and broker I/O. Any post-reservation deferral, rejection, or unknown outcome latches durable STOP; BUY known rejection remains distinct. Offline coverage proves SELL cannot bypass reservation and that a reserved SELL deferred by failed durable submission intent is removed from active orders and STOPped. The callback still must be wired to the durable cycle-state transition in the eventual runtime; the adapter does not invent that transition itself.

## Objective and delivery order

Implement RS as an independent strategy policy using Harvester's existing domain and execution/accounting infrastructure. Preserve CG behavior throughout. Avoid speculative refactoring: extract or generalize CG functionality only when RS has a concrete need for it and tests prove the shared contract.

1. [x] Audit CG source, callers and tests; produce a function-by-function reuse map (completed as an audit only; no source code moved).
2. [x] **RS-2a — Shared Portfolio foundation:** merged in [PR #1118](https://github.com/45s/coinzilla/pull/1118). One Portfolio now supports multiple independently owned Positions per market and multiple Positions per strategy; canonical fill ownership/deduplication, aggregate market inventory, centralized custody/reservation boundaries and CG ownership-scoped consumers are covered.
3. [x] **RS-2b — RS-specific domain accounting:** complete through merged PRs #1131, #1137, #1144, #1152, #1153, #1203, #1212, #1213, #1262 and #1276. The application workflow now coordinates exact-once terminal accounting, verified external custody/quote-flow providers, separate allocation diagnostics, one independent recovery, legacy and combined-cycle profitability result and reservation release. No RS runtime registration or order submission is included.
4. [x] **RS-3 — Pure RS strategy policy:** independent profitability gates, mixed-SELL planning, pair-configured `minProfit` floor, Conservative-compatible order type/fee reserve, min/max filter validation and sticky fail-closed STOP are implemented and verified in PR #1127. Adverse/terminal/third-asset/STOP-resume cases remain explicitly fail-closed; RS is not registered or executable.
5. [ ] **RS-4 — Shared Trading Engine integration:** register RS through the existing engine and shared order/broker/accounting workflows; prove same-market CG/RS concurrency.
6. [ ] **RS-5 — Offline lifecycle verification:** prove the complete lifecycle and exact-head CI without TESTNET/LIVE activity.

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

The shared Portfolio is actual-accounting truth. Strategy-owned Positions are independent accounting allocations inside that one Portfolio, not separate wallets or duplicated exchange custody. Their aggregate remains bounded by authoritative exchange balances and centrally aggregated reservations. Each strategy's investment budget is independent; the shared allocator protects the common physical balances. RS-2a/2b now implement stable Position identity, immutable order ownership, verified external legacy Spot allocation, canonical mixed-fill attribution, exact-once terminal reconciliation, atomic recovery/legacy accounting, snapshot-relative base/quote flow and independent recovery, legacy and combined-cycle profitability calculation. RS policy and runtime integration remain separate phases.

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

**RS-2b — COMPLETE (merged PR #1276):** the shared Portfolio, verified legacy Spot source, immutable order ownership, canonical mixed SELL allocations, partial-fill staging, terminal reconciliation, atomic recovery/legacy projections and snapshot-relative external base/quote-flow accounting are merged in PRs #1118, #1131, #1137, #1144, #1152, #1153, #1203 and #1212. PR #1213 adds the pure allocation-level profitability calculation; PR #1262 supplies the shared structured-error base. PR #1276 completes the application boundary: it stages terminal OrderRegistry updates, reconciles complete canonical fill history, commits both projections, calculates separate allocation diagnostics plus one independent recovery, legacy and combined-cycle profitability result and publishes the registry only after success. Failed reconciliation/commit retains the old state and SELL reservation; duplicate terminal replay is a no-op. Confirmed fills are committed even when profitability is false. The verified Spot and quote-cash-flow providers remain injectable with empty defaults. PR #1276 merged as `9276b6c01bec62b743727548786c5af4a04b7908` from exact head `19448d63d117f563c31d8ab9422ac73623974782`; 1,847/1,847 Harvester tests and all required checks passed. No TESTNET/LIVE operation was performed. Bootstrap, runtime configuration, policy registration and order submission remain excluded; RS is non-executable.

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
- Apply three independent gates: recovery net profit must be at least pair-level `minProfit`; legacy net profit must be non-negative against its fixed historical cost; and combined net profit must be at least pair-level `minProfit`. Overall eligibility requires all applicable gates. A recovery profit cannot subsidize a legacy loss, and a legacy profit cannot subsidize a recovery loss.
- Reuse Conservative's configured investment-limit logic. At the limit, stop submitting new BUYs but leave an already-open recovery SELL live and unchanged until it is filled/terminal; continue reconciliation.
- Follow Conservative's third-asset commission rule: require a reliable quote-currency valuation; missing, stale, ambiguous or unavailable valuation is not zero and fails closed before either accounting projection commits.
- Reuse Conservative BUY cadence, tranche sizing/configuration and pending-order safeguards where applicable, rather than introducing parallel RS-only behavior.
- When authorized legacy inventory is exhausted, continue normal recovery-only BUY/SELL cycles until the operator stops RS. Each recovery-only SELL must recover the recovery BUY investment and applicable fees, then earn at least the existing pair-level `minProfit`; when a legacy slice is included, its allocated historical cost is added to the same cycle-level recovery target. Exhaustion alone does not pause RS or require reauthorization. Existing orders/fills/reservations remain owned and reconciled.
- Exchange-filter-constrained dust may be classified only after a fully reconciled successful cycle; retain it as bonus inventory and permanently exclude it from all later RS cycle quantity, cost, proceeds, profitability, and availability calculations. Ordinary sellable residual must not be classified as dust.
- If remaining authorized legacy inventory is smaller than `sellQuantity`, use the smaller available/unreserved quantity in the current cycle SELL only when exchange filters and the all applicable recovery, legacy and combined-cycle profitability gates pass; otherwise retain it. No extra final-liquidation authorization is needed solely because the remainder is smaller.

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
- One all applicable recovery, legacy and combined-cycle profitability gates: mixed SELL net proceeds after all fees must recover recovery BUY cost plus allocated legacy historical cost and earn at least `minProfit`; recovery-only SELLs omit the legacy cost. Keep recovery and legacy allocations separate for accounting, not separate eligibility gates.
- Apply the smaller-remainder rule: legacy SELL quantity is capped downward to the remaining authorized, Spot-available, unreserved quantity; sell that smaller amount only when exchange filters and all applicable recovery, legacy and combined-cycle profitability gates pass, otherwise retain it. After legacy inventory is exhausted, continue recovery-only cycles (e.g. BUY 5 ZRO → SELL 5 ZRO) subject to the recovery and combined-cycle gates with zero legacy cost.

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
- Mixed-cycle profitability in both cross-subsidy directions: recovery profitable / legacy loss-making, and recovery loss-making / legacy profitable; both must reject even when the combined cycle passes. Also cover both allocations profitable, break-even legacy, combined minProfit boundaries and recovery-only continuation.
- After each successful cycle, deduct the actual legacy quantity sold from the remaining legacy quantity exactly once; never recalculate the original average cost.
- Reservations, partial SELLs, cancellation races, unknown outcomes and exact-once fill identity.
- Exchange quantity-step/minimum-quantity/minimum-notional and residual boundaries, including remaining legacy quantity below `sellQuantity`; verify smaller remainder is sold only when the all applicable recovery, legacy and combined-cycle profitability gates and exchange filters pass, otherwise retained. Constrained dust is retained only after successful full reconciliation and never re-enters later cycle accounting, while ordinary sellable residual remains actionable.
- Invalid, contradictory, stale or incomplete evidence fails closed.

Never fabricate BUY fills or seed Portfolio from unverified wallet snapshots.

**Acceptance:** plain-English tests, exact decimal strings, meaningful assertion messages, RED before implementation and GREEN after. Pure domain policy has no Binance SDK, I/O, broker, logger, Telegram, timer or runtime-engine dependency.

## RS-3 — Pure RS strategy policy

**Deliverable:** deterministic policy functions producing explicit decisions/order intents from validated domain facts. RS-3 must not submit orders, call a broker, mutate Portfolio/accounting, or register runtime configuration.

**Implemented pure policy in merged PRs #1325, #1379 and #1127:**

- a global fail-closed decision primitive: any missing, contradictory, unexpected, or unmodeled condition produces a stable BLOCK/STOP decision, prevents all new trading actions, preserves accounting and reservations, and requires reconciliation plus operator review before any resumption;
- recovery-tranche and eligible legacy quantity decisions from actual net fills, fixed legacy basis, verified Spot availability and shared reservations;
- BUY planning within the RS strategy/pair investment budget, reusing only the explicitly approved Conservative-neutral cadence and fee rules;
- mixed SELL planning whose quantity never exceeds actual net recovery inventory plus the authorized, verified, unreserved legacy slice;
- independent recovery, legacy and combined-cycle profitability gates, with exact decimal arithmetic and actual allocated commissions;
- explicit SUBMIT, WAIT, BLOCK, and RECONCILE outcomes with stable reason codes;
- state transitions for pending/open/partial/unknown/terminal orders without releasing reservations or starting another cycle on uncertain evidence.

### RS-3 policy contract — implemented decisions and fail-closed boundaries

The current owner contract requires three independent profitability gates: recovery net profit >= minProfit, legacy net profit >= 0, and combined net profit >= minProfit. The mixed-SELL planner calculates the total net quote proceeds needed by each allocation and uses the maximum target. The owner-confirmed order-type, fee-reserve and exchange-filter disposition are implemented by the pure evaluator: `makerPercent === 0` selects `LIMIT_MAKER` with maker reserve; non-zero selects `LIMIT` with the higher configured maker/taker reserve; any supported min/max price, quantity or notional violation latches global STOP. Do not change or infer a different policy.

**Settled BUY contract (not a blocker):** PR #1127 records the explicit adoption of Conservative's established BUY cadence, tranche sizing/configuration, pending-order safeguards and investment-limit model. Treat orderQuantity as the size of each RS BUY tranche and use the current Conservative source as the behavioral reference for initial/next-BUY pricing. At the RS investment limit, stop new BUYs while leaving an existing SELL live and reconciled to terminal filled state before considering another cycle. Do not invent RS-specific trailing/replacement behavior outside this inherited contract.

| Policy area | Owner-approved contract / remaining implementation work | Status |
|---|---|---|

| Mixed SELL price, quantity, order type and filters | For total gross quantity Q, recovery quantity Qr, legacy quantity Ql, recovery cost Cr, legacy cost Cl and minProfit P, calculate recovery target `(Cr + P) * Q / Qr`, legacy target `Cl * Q / Ql` when Ql > 0, and combined target `Cr + Cl + P`; use `max(recoveryTarget, legacyTarget, combinedTarget)`. Add explicit third-asset quote valuation, gross up quote fees by `1 / (1 - r)`, gross up base quantity for base fees, and round price upward to the price tick. Fail closed if quantity precision would omit or overdraw either Position. Apply the owner-confirmed order type/fee reserve; STOP on supported filter violations without adjustment or splitting. Actual fill commissions govern final accounting. | **IMPLEMENTED in PR #1379 + PR #1127:** profitability/price planning and pre-submission order-type/fee/filter policy have deterministic offline tests. |
| Independent profitability gates | Recovery and legacy allocations remain separately attributed for accounting and must each pass their own gate; the combined cycle must also pass. | **IMPLEMENTED in PR #1379; exact-head tests passed:** recovery net profit `>= minProfit`; legacy net profit `>= 0`; combined net profit `>= minProfit`. Overall eligibility requires every applicable gate. Recovery-only cycles omit the legacy gate. |
| Unexpected or unmodeled condition (formerly Question 4) | **OWNER-APPROVED GLOBAL STOP:** if reality does not match an explicitly approved RS scenario, stop all new trading actions. Preserve and exactly-once account confirmed fills/actual fees; retain order ownership, inventory and reservations; reconcile already-submitted orders; emit a stable BLOCK reason and require operator review. No guessing, workaround, blind retry, or automatic resume. | **DECIDED — GLOBAL INVARIANT.** Applies across the complete RS lifecycle, not only SELL profitability. |
| Terminal partial / canceled SELL and cycle-level proceeds | The owner chose one terminal SELL lifecycle per recovery cycle; there is no second/continuation SELL and no cumulative proceeds ledger in this phase. A terminal partial/canceled result leaves the cycle unresolved. | **DECIDED (Question 5):** one SELL order lifecycle per cycle. No second SELL and no new BUY after a terminal underfill/cancel until the separate unresolved-cycle policy is approved. |

### Remaining fail-closed policy register

| Policy area | Current contract | Status |
|---|---|---|
| Order type and fee reserve | `makerPercent === 0` -> `LIMIT_MAKER` + maker reserve; otherwise `LIMIT` + `max(maker,taker)` reserve. Actual fill fees remain authoritative. | **OWNER-DECIDED + IMPLEMENTED in PR #1127.** |
| Exchange filters | Check supported tick/step, min/max price, min/max quantity and min/max notional. Any violation or missing required filter latches global STOP; never adjust, split, retry or classify as dust. | **OWNER-DECIDED + IMPLEMENTED in PR #1127.** |
| Profit target | Existing per-pair `minProfit` only; enforce `>= 0.01` quote-asset units. No global setting or extra threshold. Keep all three independent profitability gates. | **OWNER-DECIDED + IMPLEMENTED in PR #1127.** |
| Post-fill adverse result | Account confirmed fills/fees exactly once, leave cycle unresolved and STOP all new trading actions. No automatic recovery SELL/BUY or cycle reset. | **FAIL-CLOSED; no automatic resolution policy approved.** |
| Terminal partial/canceled/rejected/expired SELL | One SELL lifecycle per cycle. Keep unresolved and reconcile; no second SELL or next BUY. | **FAIL-CLOSED; operator resolution path remains outside this policy slice.** |
| Third-asset fee valuation | Explicit reliable quote value required. Missing value is not zero; no valuation source/timestamp/freshness policy approved. | **FAIL-CLOSED; source policy remains open.** |
| Sticky STOP reset/resume | No automatic clear on market event or restart. Only non-trading WAIT/RECONCILE may proceed while stopped. | **FAIL-CLOSED; no reset path in this task.** |
| Trailing BUY repricing | Current RS BUY behavior remains initial/next tranche pricing only. | **Not changed; no new behavior inferred.** |

The final-residual-without-a-new-BUY liquidation remains explicitly deferred under FITDIB and is not an RS-3 deliverable. Advanced pause/disable/abandon/resume/restart semantics also remain deferred.

**Acceptance:** deterministic tests cover both cross-subsidy directions, all-gates-pass, break-even legacy, recovery-only continuation, exact boundaries, invalid state, partial/terminal/unknown order states, commission and filter constraints, and every explicit wait/block/reconcile outcome. The pure policy does not submit orders or perform I/O. Preserve all existing CG regression behavior.

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

Cover: 50 ZRO / 100 USDT average-cost calculation; 0.5 Spot / 49.5 EARN custody; 0.01 legacy slice; independent recovery, legacy and combined-cycle profitability gates and max-of-allocation SELL price target; partial/terminal fills and base/quote/third-asset commissions; exact-once reservations/accounting; cycle completion after terminal reconciliation; fixed original average cost and decreasing remaining legacy quantity/custody across cycles; EARN redemption and authoritative Spot reconciliation; unknown outcomes, external orders, concurrent CG/RS operation on the same and different markets, shared reservations, strategy-specific attribution and exchange constraints.

Update the canonical RS specification, architecture, runtime config docs only when config is approved, tests index, docs index, Harvester roadmap and PR descriptions.

**Acceptance:** focused tests, full Harvester/workspace checks and all required GitHub Actions pass on the exact PR head. No weakened tests or safety gates. No TESTNET/LIVE operation in this roadmap.

## PR sequence

| PR | Scope | Exit gate |
|---|---|---|
| RS-1 | CG source audit and reuse map | Evidence-backed inventory and reuse decisions |
| RS-2a | Shared Portfolio/multi-Position accounting foundation | **COMPLETE** — merged in [PR #1118](https://github.com/45s/coinzilla/pull/1118); exact-head required CI passed |
| RS-2b | RS-specific domain accounting, custody and profitability | **COMPLETE** — PR #1276 merged as `9276b6c01bec62b743727548786c5af4a04b7908` from exact head `19448d63d117f563c31d8ab9422ac73623974782`; full Harvester suite 1,847/1,847 and all required checks passed. No exchange operations. |
| RS-3 | RS pure policy | **COMPLETE** — merged PR #1127 adds the pure pre-submission SELL evaluator: independent profitability gates, pair-configured `minProfit`, Conservative-compatible order type/fee reserve, supported min/max filter validation and sticky fail-closed STOP; exact-head evaluator and Harvester tests passed |
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
  G --> H["Calculate recovery, legacy and combined proceeds targets"]
  H --> I["Compare against recovery BUY cost + allocated legacy historical cost + pair minProfit"]
  I --> J{"All applicable profitability gates pass?"}
  J -->|"No"| X["WAIT / BLOCK"]
  J -->|"Yes"| K["Shared Trading Engine safety and order gates"]
~~~

The diagrams do not override the [RS Domain Specification](./recovery-seller-domain-specification.md). RS-2b application accounting, verified custody and profitability integration are merged in PR #1276; PR #1379 adds independent profitability gates and allocation-safe SELL price planning; PR #1127 completes the pure pre-submission SELL evaluator and owner-approved filter/order-type/fee policy. RS remains non-executable. RS-4 must wire the policy into the shared engine, and RS-5 must prove the offline lifecycle before runtime registration or exchange operations. Advanced lifecycle functionality remains deferred under FITDIB.

## RS-4 configuration boundary — PR #1476

- [x] Add a separate operator-owned `recoverySellerPairs` map; keep it empty by default.
- [x] Register `RS_recoverySeller` in the single application config with `enabled: false`.
- [x] Validate explicit per-market legacy historical basis, additive `sellQuantity`, strategy BUY sizing/budget, fee and environment settings.
- [x] Resolve RS exchange precision from the same token specification registry as CG.
- [x] Preserve strategy identity in provider execution routes while keeping market subscriptions deduplicated (resolver contract only).
- [x] Resolve strategy-owned CG/RS execution routes into separate effective pair maps and a deduplicated market subscription set; RS-only provider accounts remain fail-closed.
- [x] Validate RS markets against canonical exchange trading rules and initialize explicitly configured legacy basis in the shared provider-account state before engine activation.
- [x] Wire RS additional tracked Spot-base and realized quote-cash-flow providers into account snapshots and CG account-baseline evaluation; authoritative unreserved Spot custody is still required before SELL planning.
- [x] Correct the exact-head validator-ordering regression and align offline bootstrap/notification fixtures with the explicit execution-route contract; retain fail-closed route validation.\n- [ ] Route RS strategy/market intents into the shared serialized Trading Engine.
- [ ] Share account Portfolio, OrderRegistry, snapshot, reservations and canonical fill processing without sharing strategy budgets/Positions.
- [ ] Prove same-market and different-market CG+RS concurrency offline.
- [ ] Complete RS-5 full lifecycle, failure, replay and STOP-reset acceptance tests.

RS configuration is not execution permission by itself. Keep RS disabled until the full RS-4/RS-5 acceptance is complete.

### Canonical fill ownership dispatch — checkpoint

The order-event workflow now resolves immutable OrderRegistry ownership before accounting. RS BUY fills are routed through the RS accounting workflow and are excluded from CG execution totals. Individual RS SELL fill events fail closed until the terminal mixed-SELL reconciliation workflow can atomically allocate the complete canonical fill set and release the reservation. Regression coverage verifies both paths. This is an integration slice only; it does not satisfy production RS policy dispatch, shared reservation submission, or RS-5 lifecycle acceptance.

### Runtime wiring correction — checkpoint

The first callback composition attempt placed the callback in the options destructuring and caused a startup-module syntax error. GitHub Actions exposed this before delivery. The callback is now composed in the returned engine options, and exact-head targeted verification is rerunning. RS BUY accounting dispatch remains an integration slice; no production RS order execution is enabled.

### Engine callback composition correction — checkpoint

The RS BUY accounting callback is now exposed from the engine-options return object, not the input destructuring. GitHub Actions caught and verified the startup syntax error from the prior attempt. The exact corrected head is under remote targeted and full verification.

### Unsupported strategy fill attribution — test-first checkpoint

The order-event workflow must not treat an explicitly registered non-CG/non-RS order as Conservative-owned. Unsupported strategy ownership must fail closed before any accounting projection is mutated. The regression test is committed before the production dispatch change.

### Explicit unsupported strategy ownership — implementation checkpoint

Canonical fill accounting now distinguishes RS ownership, explicit CG ownership, legacy unowned orders, and unsupported registered strategy ownership. Explicit non-CG/non-RS owners fail closed before any Conservative accounting mutation. Legacy orders without recorded ownership retain the established CG accounting fallback. The regression test covers this unsupported-owner boundary.

### Production evaluator registration — regression checkpoint

A configured Recovery Seller market must never be silently treated as a successful no-op when the shared engine has no production RS transition evaluator. The shared evaluator now has a required fail-closed regression contract for this wiring boundary. This is an integration safety gate, not RS runtime completion: RS remains disabled until a real production evaluator, submission lifecycle, shared reservations, terminal mixed-SELL reconciliation and RS-5 acceptance are implemented.

### Startup registration guard — regression checkpoint

Configured RS execution routes are now rejected before process-start facts or broker connection when the production RS transition evaluator is missing. A runtime market-event guard remains as defense in depth. This is a startup safety boundary, not production evaluator composition: RS remains non-executable until the actual evaluator and remaining RS-4/RS-5 acceptance work are complete.
