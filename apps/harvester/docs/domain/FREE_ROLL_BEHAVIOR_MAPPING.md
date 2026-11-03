# Free-Roll to Harvester Behavior Mapping

**Phase:** D0 source discovery record  
**Reference commit:** `develop` at `9cbbc9fb1affee8fe671724112d9457c25900a27` (after PR #482 merge)  
**Harvester comparison:** same `develop` commit  
**Purpose:** Record what was actually inspected and classify behavior without treating PR #479 as approved policy.

## 1. Repository and branch baseline

- PR #477 is merged and remains the infrastructure/order-ownership baseline.
- PR #482 is merged and establishes the domain-first delivery plan.
- PR #479 remains open as Draft and paused. It was inspected as reference material only; it was not merged, modified, or used as the D0 branch base.
- D0 work was branched from `develop` commit `9cbbc9fb1affee8fe671724112d9457c25900a27`; the final review branch contains only the four requested domain documents.
- No engine, application, bootstrap, broker, adapter, WebSocket, or TESTNET files were changed for D0.

## 2. Free-Roll source and tests inspected

### Runtime / strategy lifecycle

| File | Functions / structures inspected | Behavior established |
|---|---|---|
| `apps/bot-free-roll/src/bot/bot-free-roll.js` | `FreeRollBot` constructor; pair state initialization; `#handlePrice`; `#handleOrderEvent`; `#handleBuyFilled`; `#placeNextBuy`; `#handleSellFilled`; `#applyExecutionFill`; user-data recovery/reconciliation paths | Initial reference + BUY submission, initial BUY trailing, fixed next BUY, order lifecycle guards, recovery SELL then next BUY, actual fill accounting, completion and reset |
| `apps/bot-free-roll/src/bot/order-execution.js` | `createOrderExecution`, `placeBuy`, `replaceTrailingBuy`, `cancelSell`, `placeSell`, `replaceSell` | Order quantity/price rounding, actual broker submission, cancel/reconcile-before-replace, SELL quantity/price plan, pause on uncertain outcomes |
| `apps/bot-free-roll/src/bot/fill-reconciliation.js` | `toExecutionFill`, `reconcileExecutionFill`, `validateOrderFill`, `reconcileFillHistory`, `replayExecutionFills` | Canonical execution conversion, partial-fill accounting, duplicate/conflict handling, history backfill, market/order validation, replay |
| `apps/bot-free-roll/src/bot/fill-ledger.js` | `createFillLedgerEntry`, `appendFillLedgerEntry` | Immutable fill snapshots, stable IDs, exact-decimal equality, conflict detection |
| `apps/bot-free-roll/src/bot/market-inventory-ledger.js` | `createMarketInventoryLedger`, `applyMarketInventoryFill`, `appendUnmanagedMovement` | Strategy inventory and cash flow kept separate from unmanaged account movements |
| `apps/bot-free-roll/src/bot/inventory-allocation.js` | `allocateFreeInventory` | Move exactly configured keep quantity from active to free inventory |
| `apps/bot-free-roll/src/bot/recovery.js` | `validateRecoveryBalances`, `validateTrackedOrderIdentity`, `reconcileTrackedOrder` | Order/balance reconciliation guards |
| `apps/bot-free-roll/src/bot/helpers/accounting.js` | `getConfiguredSellFeeRateExact`, `calculateFillAccountingExact`, `calculateCommissionRateExact` | Configured fee reserve and actual base/quote commission conversion |
| `apps/bot-free-roll/src/bot/helpers/order-planning.js` | `calculateSellPlanExact` | Recovery SELL quantity, required net proceeds, price and rounding |
| `apps/bot-free-roll/src/bot/helpers/price.js` | `calculateBuyThresholdExact`, `roundPriceDown`, `roundPriceUp`, `roundQuantityDown` | Buy-step price and increments |
| `apps/bot-free-roll/src/index.js` | Static JSON import of `../trading-config.json`; `validateTradingConfig` call before runtime preparation | Loads the configured strategy and validates it before constructing broker/bot runtime |
| `apps/bot-free-roll/trading-config.json` | Strategy settings and pair entries | Actual configured values; no per-pair investment cap |
| `apps/bot-free-roll/src/validate-config.js` | `validateTradingConfig` | Config shape, minProfit, pair values and precision validation |
| `apps/bot-free-roll/src/validate-config.test.js` | Configuration validation tests | Deterministic config acceptance/rejection and validation boundaries |

### Free-Roll tests inspected

| File | Relevant named test coverage |
|---|---|
| `bot-free-roll.test.js` | Duplicate BUY FILLED events; actual BUY/SELL commissions; partial SELL history and stream replay; untracked fills; fee reserve changes; third-asset fees; partial BUY during cancellation; identity mismatch; order submission failures; incomplete aggregate fills; below-minimum-profit completion; base commission consuming keep quantity; oversell prevention; terminal order failures; successful base-fee allocation; reconciliation recovery and buffered events |
| `fill-reconciliation.test.js` | Canonical Fill conversion; incomplete/multiple commission rejection; base BUY and quote SELL commission; duplicate fills; third-asset fees; oversell; history validation/backfill; local/exchange history mismatch; conflicting duplicates; deterministic replay; unmanaged inventory separation |
| `helpers/accounting.test.js` | Exact fill accounting; base/quote commission handling; third-asset and incomplete commission rejection; effective commission rate |
| `helpers/planning.test.js` | Exact SELL quantity-down/price-up rounding; min-profit boundary; invalid values; keep quantity consuming available position |
| `fill-ledger.test.js` | Immutable entries; duplicate equality; decimal normalization; reused trade ID with changed facts |

## 3. Harvester domain source and tests inspected

### Current modules

| File | Functions / structures inspected | Current responsibility and assessment |
|---|---|---|
| `domain/portfolio/portfolio.js` | `Portfolio`, `applyFill`, `allocateFreeQuantity`, `getPosition` | Immutable per-market positions and Portfolio-level fill identity; aligned with projection role |
| `domain/portfolio/position.js` | `Position`, `applyFill`, `allocateFreeQuantity` | Active/free base quantity and quote cash flow; aligned with inventory role |
| `domain/portfolio/position-accounting.js` | `calculatePositionFill` | Pure base/quote commission accounting; supports aggregating commission entries |
| `domain/fills/fill-fingerprint.js` | `createFillFingerprint` | Canonical Fill facts fingerprint; supports conflict detection |
| `domain/strategies/conservative/conservative-strategy.js` | `evaluateConservativeStrategy` | Pure BUY/SELL intent policy; currently permits both sides, includes investment cap, no initial BUY trailing model |
| `domain/strategies/conservative/initial-buy-price.js` | `calculateInitialBuyPrice` | BUY price below supplied last trade price, rounded down |
| `domain/strategies/conservative/recovery-ledger.js` | `RecoveryLedger`, `applyFill`, `resetCycle` | Pooled quote cost/proceeds, fee-rate maximum, fill identity; aligned accounting structure with different reset policy |
| `domain/strategies/conservative/recovery-fill-accounting.js` | `calculateRecoveryFillAccounting` | Quote recovery accounting from actual canonical Fill |
| `domain/strategies/conservative/recovery-sell-plan.js` | `calculateRecoverySellPlan` | Exact quantity/price planning; broadly aligned with Free-Roll |
| `domain/strategies/conservative/recovery-completion.js` | `evaluateRecoveryCompletion` | Pure completion eligibility; relies on caller to supply authoritative fully-reconciled order state |
| `domain/strategies/conservative/fill-commission-rate.js` | `calculateFillCommissionRate` | Converts actual commission into quote-equivalent rate; aggregates base/quote commission entries |
| `domain/strategies/conservative/sell-fee-rate.js` | `calculateSellFeeRate` | Resolves configured and observed fee reserve; differs from Free-Roll activation timing |
| `domain/trading-config.js` | `validateTradingConfig` | Requires positive per-pair investment; accepts non-negative minProfit/keepQuantity; strategy input contract, not a broker fact |

### Existing Harvester domain documentation

The existing [`docs/domain/portfolio.md`](https://github.com/45s/coinzilla/blob/develop/apps/harvester/docs/domain/portfolio.md) describes additional Position capabilities (average entry cost, realized profit, order reservations, and shared Conservative/Aggressive inventory) that are not represented by the inspected current `Position` fields/methods. Current `Position` stores active base quantity, free base quantity, and quote net cash flow. Treat the older document as broader/historical design guidance, not evidence that those capabilities exist in the current domain implementation. D0 does not update that separate document because the requested deliverables are the four domain specification files; reconcile it after the domain contract is approved.

### Harvester tests inspected

- `conservative-strategy.test.js`: initial BUY, active BUY guard, BUY+SELL generation, active SELL guard, invalid context, partial BUY wait, investment cap.
- `portfolio.test.js`: immutable application, duplicate fill, market isolation, free allocation, conflicting fill.
- `position.test.js`: BUY/SELL base and quote commission, active/free separation, oversell prevention.
- `recovery-ledger.test.js`: accumulated BUY cost and partial/replacement SELL proceeds, duplicate, wrong market, conflicting ID, reset preserving fee rate and identities.
- `recovery-fill-accounting.test.js`: quote/base commission treatment, incomplete/third asset, quote commission exceeding proceeds.
- `recovery-sell-plan.test.js`: keep quantity, partial proceeds, fee reserve, no sellable amount, already-covered proceeds, invalid boundaries.
- `recovery-completion.test.js`: full-fill requirement, min profit, inventory sufficiency, exact keep allocation.
- `fill-commission-rate.test.js`: zero fee, quote/base valuation, multiple commission entries, incomplete and third asset.
- `sell-fee-rate.test.js`: zero configured fee, actual fee, configured ceiling and actual fee above ceiling.

## 4. Behavior classification

| Behavior | Free-Roll evidence | Harvester current evidence | Classification |
|---|---|---|---|
| First usable price immediately creates a BUY limit one step below | `#handlePrice` + `placeBuy` | `evaluateConservativeStrategy` + `calculateInitialBuyPrice` | Correctly implemented at basic price level |
| Initial BUY trails upward | `#handlePrice` + `replaceTrailingBuy` | No pure trailing state/decision | Missing |
| Subsequent BUY uses last BUY price minus step | `calculateBuyThresholdExact` + `#placeNextBuy` | `lastBuyPrice` input | Broadly implemented; lifecycle contract not complete |
| Next BUY can coexist with recovery SELL | `#handleBuyFilled` submits SELL then BUY | Strategy can emit both intents | Correct concept; order sequencing differs |
| Recovery SELL before next BUY submission | `#handleBuyFilled` awaits `#replaceSell` before `#placeNextBuy` | Strategy action array appends BUY then SELL | Different / needs decision |
| Investment cap | No equivalent in inspected Free-Roll policy/config | Config validator requires positive `pairConfig.investment`; strategy checks outstanding recovery plus new BUY notional | Harvester-only rule / needs approval |
| Actual fill-driven inventory and cost/proceeds | `reconcileExecutionFill` | Portfolio + RecoveryLedger | Correctly implemented in separate projections |
| Multiple commission entries | Free-Roll converter rejects >1 | Harvester aggregates supported base/quote entries | Different input capability |
| Third-asset commission | Rejected | Rejected | Correctly fail-closed |
| Fill duplicate/conflict | Immutable ledger; identical no-op, changed facts fail | Portfolio and ledger fingerprints | Correctly implemented independently; cross-projection atomicity unproven |
| Partial fill accounting | Incremental; terminal status separately validated | Domain accepts one Fill at a time | Implemented; lifecycle composition needs proof |
| SELL plan retains keep and rounds quantity down / price up | Exact planner | Exact planner | Broadly aligned; base-fee edge needs more proof |
| Actual quote commissions affect recovery | Exact accounting | RecoveryFillAccounting | Correctly implemented |
| Configured fee reserve before first actual fee | Free-Roll initializes `feeRate = configuredFeeRate` | Harvester `calculateSellFeeRate` returns zero until an actual non-zero commission is observed | Different; Harvester may under-reserve first SELL |
| Configured fee reserve after actual fee | Free-Roll max(configured, actual) | Harvester max(configured ceiling, actual) after observation, except maker=0 policy | Broadly aligned after observation |
| Completion requires full SELL, profit, sufficient keep | `#handleSellFilled` | `evaluateRecoveryCompletion` | Correctly implemented as separate checks |
| Completion/reset orchestration | Free-Roll performs allocation and reset in `#handleSellFilled` | Harvester helper returns eligibility; ledger has separate reset method | Decision exists, integration/cross-transition proof absent |
| Keep quantity zero | Free-Roll constructor allows 0 and allocation supports 0 | Harvester completion requires >0; Position allocation rejects <=0 | Different boundary |
| minProfit zero | Config validator permits 0; constructor/planner reject <=0 | Planner/completion reject <=0 | Free-Roll validation inconsistency; behavior is effectively positive-only |
| Commission-rate history after reset | Free-Roll resets actual per-cycle rate | Harvester preserves max observed rate | Different |
| Residual active inventory after keep allocation | Free-Roll leaves surplus active; does not immediately place another SELL | Harvester can produce SELL on next evaluation | Potentially different lifecycle |
| Investment/BUY commitment exposure | No cap in Free-Roll | Harvester cap counts outstanding recovery + new notional; no separate reserved-order amount input | Different / cap semantics unclear |

## 5. PR #479 reference assessment

PR #479's core rule is **recovery-first**: no next BUY until no active recovery SELL and outstanding recovery capital is zero and successful completion/reset has occurred.

That is not the current Free-Roll behavior. Current Free-Roll creates the next standing BUY after successful recovery SELL submission, while that SELL may still be open or partially filled. The two orders can coexist.

PR #479 therefore represents a strategy change, not merely a missing guard or a faithful port. Its tests may still be useful to prove whichever policy is approved, but they cannot establish that the policy matches Free-Roll.

PR #479 was not merged or continued as part of D0.

## 6. Material implementation gaps to address only after D0 approval

1. Resolve D-01 through D-15 in `CONSERVATIVE_DOMAIN_SPECIFICATION.md`.
2. Add a pure representation of initial BUY trailing eligibility if that behavior is approved for Harvester.
3. Define a cross-projection fill transition so Portfolio and RecoveryLedger either both advance or neither advances.
4. Prove lifecycle behavior for partial fills, replacement fills, and terminal order aggregate reconciliation at the application boundary.
5. Reconcile fee reserve activation and reset semantics with the approved policy.
6. Prove actual inventory after base commission and quantity-step rounding.
7. Define what happens to residual active inventory after successful free allocation.
8. Add missing D2 tests listed in `ACCOUNTING_INVARIANTS.md`.

No implementation is authorized by this mapping. These are findings for the D0 review and later D1/D2 planning.
