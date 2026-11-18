---
title: Conservative strategy audit and Recovery Seller policy blockers
status: active
type: audit
owner: harvester
created: 2026-11-18
last_verified: 2026-11-18
---

# Conservative strategy audit and Recovery Seller policy blockers

## Audit metadata

- Audit started: 2026-11-18 03:22 UTC (GitHub issue creation time; exact completion time not recorded)
- Repository: `45s/coinzilla`
- Branch: `develop`
- Baseline commit reviewed: `40e98f594b00f68cfa11cf6e8ae31c48cc5a0bb6`
- Scope: Conservative (CG) domain policy/source/tests as the behavioral reference; current Recovery Seller (RS) policy, accounting, lifecycle and tests; accepted RS contract and remaining policy blockers.
- Exclusions: implementation, runtime registration/configuration, changing CG behavior, TESTNET/LIVE activity, orders or cancellations.
- Method: inspect canonical specifications, domain source, focused test files and test inventory; inspect RS tracking issue #1127 and merged PR #1379. No local test commands were run for this audit.

## Source revalidation after the original audit baseline

The original policy/source comparison was performed against `develop` at `40e98f594b00f68cfa11cf6e8ae31c48cc5a0bb6`. A read-only comparison to the post-PR-#1383 checkpoint `37aa07ec4c6421bd6c8b10084d734dc4ad9ed47c` found 88 intervening commits. The changed-file set contains provider-registry/bootstrap, environment-example and documentation changes; it does not contain Conservative or Recovery Seller strategy-domain source/spec/test files. The strategy-policy findings below therefore remain scoped to the recorded baseline. This is a source-path comparison, not a claim that the entire repository or all runtime behavior was re-audited.

## Executive result

CG is the implemented reference policy. RS has a substantial pure BUY/lifecycle/accounting foundation, but it does **not** yet have a complete SELL decision policy. RS remains correctly non-executable.

The main blockers are explicit owner decisions and policy composition, not missing accounting foundations. Do not implement defaults by guessing.

## 1. Conservative reference behavior

The canonical CG contract is `CONSERVATIVE_DOMAIN_SPECIFICATION.md`. Current source evidence is in `src/domain/strategies/conservative/`.

- **BUY:** initial price is calculated below the current market reference; the next standing BUY uses the reconciled completed-BUY VWAP. Quantity is rounded down to the quantity step. Minimum/maximum exchange filters and the pair investment limit are checked. Active BUYs suppress duplicates; an unacknowledged recovery SELL prevents unsafe BUY placement.
- **Trailing BUY:** a separate pure repricing policy decides whether the price threshold is reached. Application workflow refreshes exchange rules and preflights a valid replacement before cancellation; cancellation and fill races are reconciled before replacement.
- **SELL quantity:** sellable inventory is active quantity above exact `keepQuantity`; fee-reserved base quantity is rounded down to the quantity step.
- **SELL price:** recovers full accumulated BUY cost plus `minProfit`, less already-confirmed net SELL proceeds. Quote fee reserve is applied and price is rounded up to the tick.
- **Order type/fee role:** `LIMIT_MAKER` reserves maker fee; ordinary `LIMIT` reserves the higher maker/taker rate. Actual fill commissions remain authoritative.
- **Exchange filters:** minimum filters are checked; max quantity/notional cap the candidate; price filters can block it. Exchange-constrained residual dust is classified with exact quantity/filter evidence and retained only under the completion contract. A price-filter or commission-valuation failure is a block, not dust.
- **Lifecycle/accounting:** confirmed partial fills and commissions are applied exactly once. Existing SELLs are not repriced merely because they partially fill. Cancellation/replacement requires terminal reconciliation and complete canonical fills. Recovery completion requires reconciled terminal fill, all actual commissions, full cost recovery plus minimum profit, and preserved retained inventory.

Focused CG evidence files include `helpers.test.js`, `initial-buy-price.test.js`, `sell-fee-rate.test.js`, `recovery-sell-plan.test.js`, `recovery-sell-plan-accounting.test.js`, `recovery-fill-accounting.test.js`, `recovery-ledger.test.js`, `recovery-completion.test.js`, `recovery-completion.dust.test.js`, `strategy.test.js`, and `trailing-buy-repricing.test.js`. The domain test inventory maps the additional application-level engine tests.

## Evidence index

### Conservative source and tests

- [Strategy evaluator](../../src/domain/strategies/conservative/strategy.js)
- [Order helpers](../../src/domain/strategies/conservative/helpers.js)
- [Initial BUY pricing](../../src/domain/strategies/conservative/initial-buy-price.js)
- [SELL fee reserve](../../src/domain/strategies/conservative/sell-fee-rate.js)
- [SELL planner](../../src/domain/strategies/conservative/recovery-sell-plan.js)
- [Trailing BUY policy](../../src/domain/strategies/conservative/trailing-buy-repricing.js)
- [Strategy tests](../../src/domain/strategies/conservative/strategy.test.js)
- [SELL planner tests](../../src/domain/strategies/conservative/recovery-sell-plan.test.js)
- [SELL planner accounting tests](../../src/domain/strategies/conservative/recovery-sell-plan-accounting.test.js)
- [Fill accounting tests](../../src/domain/strategies/conservative/recovery-fill-accounting.test.js)
- [Recovery ledger tests](../../src/domain/strategies/conservative/recovery-ledger.test.js)
- [Completion tests](../../src/domain/strategies/conservative/recovery-completion.test.js)
- [Dust completion tests](../../src/domain/strategies/conservative/recovery-completion.dust.test.js)
- [Trailing BUY tests](../../src/domain/strategies/conservative/trailing-buy-repricing.test.js)
- [Domain test inventory](./DOMAIN_TEST_INVENTORY.md)

### Runtime boundary

- [Harvester bootstrap](../../src/bootstrap/start-harvester.js) composes the Conservative engine and policy; it does not register RS.
- [Isolated RS accounting workflow](../../src/use-cases/create-recovery-seller-accounting-workflow.js) is accounting infrastructure, not an RS trading engine.

### Recovery Seller source and tests

- [BUY evaluator](../../src/domain/strategies/recovery-seller/evaluate-buy-decision.js)
- [Mixed SELL planner](../../src/domain/strategies/recovery-seller/calculate-sell-plan.js)
- [Profitability gates](../../src/domain/strategies/recovery-seller/calculate-profitability.js)
- [Cycle state](../../src/domain/strategies/recovery-seller/cycle-state.js)
- [Lifecycle decisions](../../src/domain/strategies/recovery-seller/lifecycle-decision.js)
- [Global STOP](../../src/domain/strategies/recovery-seller/stop-decision.js)
- [BUY policy tests](../../src/domain/strategies/recovery-seller/evaluate-buy-decision.test.js)
- [SELL planner tests](../../src/domain/strategies/recovery-seller/calculate-sell-plan.test.js)
- [Profitability tests](../../src/domain/strategies/recovery-seller/calculate-profitability.test.js)
- [Legacy position](../../src/domain/strategies/recovery-seller/legacy-position.js) and [tests](../../src/domain/strategies/recovery-seller/legacy-position.test.js)
- [Verified Spot allocation](../../src/domain/strategies/recovery-seller/legacy-spot-allocation.js) and [tests](../../src/domain/strategies/recovery-seller/legacy-spot-allocation.test.js)
- [Mixed fill allocation](../../src/domain/strategies/recovery-seller/mixed-sell-fill-allocation.js) and [tests](../../src/domain/strategies/recovery-seller/mixed-sell-fill-allocation.test.js)
- [Mixed fill accounting](../../src/domain/strategies/recovery-seller/mixed-sell-fill-accounting.js) and [tests](../../src/domain/strategies/recovery-seller/mixed-sell-fill-accounting.test.js)
- [Mixed fill reconciliation](../../src/domain/strategies/recovery-seller/mixed-sell-fill-reconciliation.js) and [tests](../../src/domain/strategies/recovery-seller/mixed-sell-fill-reconciliation.test.js)
- [Cycle-state tests](../../src/domain/strategies/recovery-seller/cycle-state.test.js)
- [Lifecycle state](../../src/domain/strategies/recovery-seller/lifecycle-state.js) and [tests](../../src/domain/strategies/recovery-seller/lifecycle-state.test.js)
- [Lifecycle integration test](../../src/domain/strategies/recovery-seller/recovery-seller-lifecycle.test.js)
- [Lifecycle tests](../../src/domain/strategies/recovery-seller/lifecycle-decision.test.js)
- [STOP tests](../../src/domain/strategies/recovery-seller/stop-decision.test.js)
- [Canonical RS specification](./recovery-seller-domain-specification.md)
- [RS implementation roadmap](./recovery-seller-implementation-roadmap.md)
- [RS tracking issue #1127](https://github.com/45s/coinzilla/issues/1127)
- [Merged RS profitability PR #1379](https://github.com/45s/coinzilla/pull/1379)

## 2. RS implementation compared with CG

| Policy area | CG reference | RS current implementation | Gap / disposition |
|---|---|---|---|
| BUY price and cadence | Initial and next BUY price, step rounding, order suppression, exchange filters and budget | Uses CG `calculateInitialBuyPrice`, configured tranche size, last completed BUY VWAP, filters, investment limit, order ownership and lifecycle checks | Implemented pure BUY foundation; no runtime integration |
| BUY order lifecycle | Shared engine owns order I/O, cancellations and reconciliation | Explicit WAIT/RECONCILE/BLOCK outcomes; unknown and unowned orders fail closed | Policy foundation implemented; application wiring remains RS-4 |
| SELL quantity | Fee-aware quantity above retained `keepQuantity`, rounded down | Mixed recovery + authorized legacy quantity, base-fee gross-up and allocation guards | RS-specific planner implemented; full exchange filter disposition absent |
| SELL economics | One CG recovery target, full cost and `minProfit`, net proceeds accounting | Recovery, legacy and combined targets; planner uses maximum target and explicit fee inputs | RS-specific economics implemented in merged PR #1379; not an evaluator/order policy |
| SELL order type and fee role | CG has order-type and fee-reserve selection | No RS SELL policy selects order type or maker/taker fee role | Owner decision required |
| SELL exchange filters | Min/max quantity, notional, price, quantity-step/tick and dust dispositions | Planner receives tick/step but does not evaluate the full SELL filter set or disposition | Owner decision + policy implementation required |
| SELL partial/terminal outcomes | Reconciled continuation/replacement behavior is defined | One SELL lifecycle per RS cycle; terminal underfill/cancel becomes UNRESOLVED | Resolution policy required; current block is safe but not a completed workflow |
| STOP | CG uses existing pair/order safety gates | Sticky global STOP; WAIT/RECONCILE only while stopped | Safe latch exists; reviewed resolution/resume path is not defined |
| Third-asset fees | CG requires reliable quote valuation and fails closed | Planner accepts explicit quote valuation; accounting remains fail-closed on incomplete valuation | Approved valuation source/timestamp/freshness contract required |
| Accounting and ownership | Canonical fill accounting, Portfolio and RecoveryLedger | RS legacy/recovery allocation, canonical-fill binding, staged partials, terminal reconciliation and atomic dual projections | Foundation implemented; integration proof remains |
| Same-market concurrency | Shared engine/account reservations | Shared-Portfolio architecture contract exists; RS not wired | RS-4 integration and tests required |

## 3. Owner decisions confirmed — 2026-11-18

The strategy owner explicitly resolved three pre-submission SELL policy questions. These are implementation requirements, not remaining blockers:

1. **Profit target:** use only the existing per-pair `minProfit`. Do not add a global setting, percentage, extra threshold or other configuration. Keep the independent recovery, legacy non-loss and combined-cycle gates from PR #1379. Enforce the existing Conservative minimum of `0.01` quote-asset units.
2. **Order type and fee reserve:** `makerPercent === 0` selects `LIMIT_MAKER` and maker fee reserve. A non-zero `makerPercent` selects ordinary `LIMIT` and reserves the higher configured maker/taker percentage. Actual fill commissions remain authoritative.
3. **Exchange filters:** any price/quantity increment, minimum/maximum price, minimum/maximum quantity or minimum/maximum notional violation latches global STOP. Do not adjust, split, increase authorized legacy quantity, retry or classify it as dust.

These rules do not change CG behavior. The RS evaluator is pure and offline; it does not submit orders or enable RS.

## 4. Remaining policy boundaries — fail closed

### Post-fill adverse result

A confirmed SELL fill that fails recovery, applicable legacy or combined profitability is still committed exactly once with actual fees. The cycle remains unresolved and global STOP blocks new trading actions. No follow-up SELL, replacement, additional BUY, cycle reset or automatic recovery is authorized.

### Terminal partial, canceled, rejected or expired SELL

The one-SELL-per-cycle rule remains. A terminal underfill/cancel/reject/expiry leaves the cycle unresolved. Preserve order identity, fills and reservations through canonical reconciliation. Do not create a second SELL or a new BUY cycle.

### Third-asset commission valuation

The planner requires an explicit quote-currency value. A missing value is not zero. No valuation source, timestamp or freshness policy has been approved; until one is available and reliable, fail closed before accounting projections or SELL authorization.

### Sticky STOP resolution

The existing global STOP latch is permanent for its policy instance. Only non-trading WAIT/RECONCILE may proceed while stopped. There is no automatic clear on a later market event or process restart; a reset/resume mechanism is not part of this task.

### Trailing BUY behavior

The RS BUY evaluator currently uses Conservative initial/next tranche pricing but does not invoke trailing repricing. No additional RS trailing behavior is added without an explicit owner decision.

`minProfit` validation is no longer an open policy question: it must follow the existing Conservative `0.01` quote-asset minimum and remains pair-level.

## 5. Decisions already settled — do not reopen

The current canonical RS specification and issue #1127 supersede older comments/draft policy. These decisions are not blockers:

- `sellQuantity` is an additive legacy quantity.
- Legacy average cost is derived once from original quote investment / original base quantity and remains fixed.
- Legacy inventory is operator-authorized and separately verified against Spot custody, Portfolio inventory and reservations.
- A smaller remaining authorized legacy quantity may be sold if filters and all profitability gates pass.
- RS continues recovery-only cycles after legacy inventory is exhausted.
- Dust is bonus inventory only after a fully successful, reconciled cycle; ordinary sellable residual and price/fee failures are not dust.
- One SELL lifecycle per cycle is the current contract; underfill remains unresolved until a policy is approved.
- CG and RS may run concurrently on the same market; shared reservations/custody protect physical resources.

## 6. Test evidence and remaining test gaps

RS focused tests exist for legacy basis and quantity, Spot allocation, mixed fill allocation/accounting/reconciliation, independent profitability, SELL-plan economics/precision, BUY evaluation, cycle state, lifecycle decisions and STOP.

CG focused tests exist for price calculation, fee selection, SELL plan/accounting, fill accounting, ledger, completion/dust, strategy behavior and trailing BUY repricing.

**This audit did not run tests.** Test files were inspected and the repository test inventory was reviewed. PR #1379 is merged. GitHub reports its actual current head `3c25aef4d85c10a7059f3fb741650cb4f71ebb22` with 30 successful check runs and one skipped read-only TESTNET integration; the skipped check performed no exchange operation. The PR description's older verification SHA differs from the current head; the audit used the current head's check-run data. This is evidence of CI, not an independent local rerun.

Missing acceptance coverage/work before execution:

- RS SELL policy decision tests for order-type choice, fee role, all min/max filters, blocked/capped candidate outcomes, and profit revalidation after any filter adjustment.
- Deterministic post-fill adverse-result and terminal-underfill resolution tests after the owner decisions.
- Approved third-asset valuation-source/freshness tests.
- Operator STOP resolution/reset tests after its contract is approved.
- RS-4 integration tests for same-market/different-market CG+RS concurrency, order ownership, shared reservations and exact-once fills.
- RS-5 offline full-cycle tests including EARN return/custody reconciliation, partial fills, fees, unknown outcomes and restart/replay boundaries.

## 7. Recommended implementation sequence

1. Resolve the six P1 policy decisions above (order type, fee role, filters, adverse result, terminal underfill, third-asset valuation) and STOP resolution semantics. Record the approved contract in the canonical RS specification/issue #1127.
2. Complete RS-3: compose a pure SELL evaluator with explicit SUBMIT/WAIT/BLOCK/RECONCILE outcomes, stable reasons, current exchange filters and all profitability gates. Reuse CG-neutral helpers only when their contracts fit; preserve CG behavior.
3. Add the missing RS policy boundary guard for `minProfit >= 0.01` and clarify trailing BUY semantics.
4. Complete RS-4 integration through the existing shared Trading Engine, OrderRegistry, FillLedger, Portfolio and reservation gates. Do not register or enable RS before policy is complete.
5. Complete RS-5 offline end-to-end lifecycle proof and exact-head required CI. Keep all exchange activity outside this audit and separately authorized.

## 8. Current disposition

- CG remains the reference and its behavior must not change as part of RS policy work.
- RS accounting, BUY policy and profitability foundations are implemented; the complete SELL policy is not.
- The P1 decisions above block complete RS-3 SELL policy. RS-4 and RS-5 remain mandatory execution gates, not policy decisions.
- No implementation or exchange operation was performed by this audit.

## 9. Blocker clarification and implementation handoff

Resolve policy decisions with the strategy owner **one blocker at a time** before implementation. For each blocker, present the current CG behavior, RS alternatives, a simple concrete example, risks, and a recommended default. Record the approved decision and rationale in this report and the canonical RS specification/issue #1127. Do not silently choose a policy.

### Owner clarification order

1. SELL order type (LIMIT_MAKER vs LIMIT).
2. Fee role/reserve (maker-only vs worst-case maker/taker).
3. Exchange filters and invalid/adjusted quantity/price behavior.
4. Underfilled terminal order/cancel/reject handling.
5. Loss or insufficient-profit SELL outcomes.
6. Third-asset commission valuation and price freshness.
7. STOP resolution and safe restart/resume semantics.
8. P2 minimum-profit floor and trailing-BUY semantics.

### Implementation handoff

Once decisions are approved, implement RS SELL policy in focused steps using TDD. Read the mandatory repository and Harvester documents first; use CG as the behavioral reference, but do not change CG. Reuse existing pure domain helpers where their contracts fit. Keep RS non-executable until RS-3 policy is complete, RS-4 shared-engine integration is verified, and RS-5 offline lifecycle proof passes. No TESTNET/LIVE orders or exchange actions are authorized by this audit or handoff.
