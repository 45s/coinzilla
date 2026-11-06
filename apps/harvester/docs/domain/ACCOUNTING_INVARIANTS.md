# Conservative Accounting Invariants

**Phase:** Conservative domain specification  
**Purpose:** Define accounting truths that D1 implementation and D2 tests must preserve.  
**Status:** Approved Conservative accounting contract. Owner-approved policy: minimum realized net profit is at least 0.01 quote currency after actual commissions; sell all sellable active inventory except configured `keepQuantity`. Implementation gaps are tracked explicitly below and in parent audit #645.

## 1. Units and representation

- All financial arithmetic uses exact decimal-safe operations. Domain financial values are decimal strings, never binary floating-point calculations.
- Base quantities are expressed in the market base asset.
- Quote costs, proceeds, profit and investment limits are expressed in the market quote asset.
- Commission amounts retain their actual asset identity.
- Market price, configured fee percentages, fee-rate fractions, requested order quantity and executed fill quantity are different facts and must not be conflated.
- An order intent or broker acknowledgement is not an execution and must not change Portfolio or RecoveryLedger accounting.

## 2. Per-fill accounting

For each confirmed fill, define:
- `q`: gross executed base quantity;
- `v`: gross executed quote notional (`Fill.quoteQuantity`);
- `c_b`: sum of commission amounts charged in base asset;
- `c_q`: sum of commission amounts charged in quote asset.

Zero commission is zero. Negative commissions, incomplete commission facts, unsupported third-asset commissions, non-positive execution quantity/notional, or commissions that exceed the corresponding fill amount are invalid under the current policy. Base and quote commission limits apply to the aggregate of all commission entries in that asset: `c_b <= q` and `c_q <= v`. Reject before either accounting projection is committed.

### BUY

$$
\Delta ActiveBase = q-c_b
$$
$$
\Delta QuoteCashFlow = -(v+c_q)
$$
$$
\Delta BuyCost = v+c_q
$$

Base commission reduces the base quantity actually received. Quote commission increases the cost of acquiring it.

### SELL

$$
\Delta ActiveBase = -(q+c_b)
$$
$$
\Delta QuoteCashFlow = v-c_q
$$
$$
\Delta NetSellProceeds = v-c_q
$$

Base commission is additional base inventory consumed by the SELL. Quote commission reduces proceeds.

### Third-asset commission

Current Conservative strategy and Harvester policies do not value a commission paid in a third asset. Such a fill must not be silently treated as fee-free. Reject it or pause at the appropriate boundary until a valuation rule is approved.

## 3. Portfolio invariants

For each market:

1. `activeBaseQuantity >= 0`.
2. `freeBaseQuantity >= 0`.
3. `totalBaseQuantity = activeBaseQuantity + freeBaseQuantity`.
4. Applying a BUY fill increases active base quantity by gross quantity less base commission.
5. Applying a SELL fill decreases active base quantity by gross quantity plus base commission.
6. A SELL cannot consume more than active base quantity. Free base quantity is never available to strategy orders.
7. Fill application does not change free quantity.
8. Free allocation is a non-execution inventory transfer: active decreases by exactly the allocated amount, free increases by exactly the same amount, and total base quantity is unchanged.
9. A free allocation must be positive and no greater than active quantity. Whether zero `keepQuantity` should be a valid no-op is unresolved (D-06).
10. One canonical fill ID can change a Portfolio at most once. Identical replay leaves it unchanged; conflicting facts under the same ID are rejected.

Harvester implementation references: `Position.applyFill`, `Position.allocateFreeQuantity`, `Portfolio.applyFill`, `Portfolio.allocateFreeQuantity`, and `calculatePositionFill`.

## 4. RecoveryLedger invariants

For all unique accepted fills in a market:

$$
BuyCost = \sum_{BUY}(v+c_q)
$$
$$
NetSellProceeds = \sum_{SELL}(v-c_q)
$$
$$
OutstandingRecovery = \max(0, BuyCost-NetSellProceeds)
$$
$$
RealizedNetProfit = NetSellProceeds-BuyCost
$$

1. BUY fills increase `buyCost`; SELL fills increase `netSellProceeds`. A fill cannot change both.
2. Base commission changes Portfolio inventory, not quote recovery cost/proceeds.
3. Quote commission changes recovery cost/proceeds in the direction of the trade.
4. `buyCost` and `netSellProceeds` are non-negative.
5. `outstandingRecoveryAmount` is never negative.
6. `realizedNetProfit` may be negative while recovery remains incomplete.
7. Partial fills contribute their actual executed amounts immediately.
8. Cancellation/replacement does not reset or erase the accumulated ledger.
9. A duplicate fill does not change any amount or fee observation.
10. A conflicting duplicate or wrong-market fill is rejected.
11. Successful cycle reset clears only `buyCost` and `netSellProceeds`. Fill identities must survive reset so a late replay cannot be booked into the new cycle.
12. Commission-rate history is not tracked or persisted. Fill identities survive cycle reset for duplicate protection; only `buyCost` and `netSellProceeds` are reset.

## 5. Recovery SELL planning invariants

Let `A` be active base quantity, `K` keep quantity, `f` the approved fee reserve, `s` the quantity step, `t` the price tick, `C` BUY cost, `P` confirmed net SELL proceeds, and `m` minimum profit.

$$
SellableBase = \max(0,A-K)
$$
$$
Q = \operatorname{floorToStep}\left(\frac{SellableBase}{1+f},s\right)
$$
$$
RequiredNetProceeds = \max(0,C+m-P)
$$
$$
MinimumPrice = \frac{RequiredNetProceeds}{Q(1-f)}
$$

When `Q > 0`, the limit price is rounded up to a valid tick. If the required net proceeds are already covered, the plan still uses a positive price (at least one tick in the current Harvester planner) so that the SELL order can finish and recovery completion can be confirmed.

Planning fee policy (current implementation):
- `makerPercent = 0` selects POST-ONLY `LIMIT_MAKER`; non-zero `makerPercent` selects regular `LIMIT`.
- The SELL planning reserve is `max(makerPercent, takerPercent) / 100`, regardless of the eventual liquidity role. `sell-fee-rate.js` implements this maximum and its tests cover zero, maker-higher, taker-higher, equal, and invalid rates.
- Actual commission amounts/assets on each confirmed fill remain authoritative for accounting; the configured maximum is only a planning reserve.
- The same order-type and planning rule is intended for Conservative and future Aggressive planning; Aggressive remains deferred.

Required properties:
- `Q ≥ 0` and `Q` is an exact multiple of `s`.
- The plan never intentionally includes the configured keep quantity.
- Quantity rounds down; price rounds up.
- Prior confirmed net proceeds reduce the remaining required proceeds.
- Planning fee reserve is not recorded as actual commission.
- Actual fills and actual commissions always determine accounting.
- A plan with no sellable quantity produces no SELL intent.
- Price/quantity increments must be valid positive normalized rules; the domain does not discover exchange rules.

**Fee-boundary:** the planner reserves for possible base-asset commission by dividing sellable inventory by `1 + feeRate` and rounds down to the exchange quantity step. Actual base commission is applied to Portfolio on each fill. Residual quantity caused by step rounding must be explicitly classified as sellable follow-through or exchange-constrained dust; the current post-completion strategy does not yet prove sell-through.

## 6. Recovery completion invariants

A recovery cycle is eligible to complete only if all are true:

1. The recovery SELL order is authoritatively terminal FILLED.
2. The application has reconciled canonical fill history for that order.
3. The sum of actual executed quantities exactly equals the order quantity.
4. `netSellProceeds - buyCost >= minProfit`.
5. Actual active base inventory is at least `keepQuantity`.

On successful completion:
- Allocate exactly `keepQuantity` from active to free inventory.
- Do not alter total base quantity.
- Reset the recovery ledger's cycle cost and proceeds exactly once.
- Preserve all fill identity records across reset.
- Do not treat a merely open/partial/cancelled/rejected/unknown SELL as completion.

On failed or ineligible completion:
- Do not allocate free inventory.
- Do not reset recovery cost/proceeds or erase fill identities.
- Keep the cycle outstanding and pause/block new cycle progression according to the approved strategy policy.
- Do not convert a failed profit target into an estimated success.

## 7. Cross-projection consistency

Portfolio and RecoveryLedger are separate projections of the same canonical fill. For one accepted fill:
- Both must use the same Fill identity and commission facts.
- Both must agree on market identity.
- Portfolio updates inventory/cash flow; RecoveryLedger updates quote recovery cost/proceeds.
- The application transition must not commit one projection and silently discard a failure from the other.

**Implemented application invariant:** `updateTradingAccounting` computes both immutable projections and returns them together only when both accept the same fill identity. The bootstrap commits both values in one serialized workflow step; any failure returns neither updated projection. Deterministic tests cover a failure after Portfolio can independently calculate an update but RecoveryLedger rejects the market.

## 8. Worked accounting examples

### A. Partial BUYs and partial SELLs with quote commissions

BUY:
- Fill 1: 40 base, 4.00 quote, 0.01 quote commission.
- Fill 2: 60 base, 6.00 quote, 0.01 quote commission.

Then:
- Active base = 100 (no base commission).
- Buy cost = (4.00+0.01+6.00+0.01=10.02).

SELL:
- Fill 1: 40 base, 4.50 quote gross, 0.01 quote commission → 4.49 net.
- Fill 2: 59 base, 6.00 quote gross, 0.01 quote commission → 5.99 net.

Then:
- Active base = 1.
- Net proceeds = 10.48.
- Realized net profit = (10.48-10.02=0.46).
- Outstanding recovery = 0.
- If the final SELL order is fully reconciled and `minProfit <= 0.46`, completion is eligible; 1 base can be allocated to free inventory.

### B. Base-asset commissions

BUY: gross 100 base, 10 quote, 0.1 base commission.
- Active base increases by 99.9.
- Buy cost increases by 10 quote.

SELL: gross 98.9 base, 10.2 quote, 0.0989 base commission and 0.02 quote commission.
- Active base decreases by 98.9989.
- Net proceeds increase by 10.18 quote.
- The quote recovery ledger does not deduct the base commission as quote cost; Portfolio inventory records it.

### C. Failed recovery completion

- Buy cost = 10.02 quote.
- Net SELL proceeds = 10.05 quote.
- `minProfit` = 0.10 quote.
- Realized profit = 0.03 quote, so completion is false.
- Even if the SELL order is fully filled, no free allocation and no cycle reset occur. Recovery accounting remains available for diagnosis/reconciliation.

### D. Partial SELL with insufficient cumulative proceeds

- Buy cost = 10.02 quote.
- First partial SELL nets 4.49 quote.
- Outstanding recovery = 5.53 quote.
- The SELL order is still partially filled, so no cycle completion is possible.
- Replacement SELL planning uses cumulative `saleProceeds = 4.49`; it does not restart the target at 10.02.

### E. Duplicate and conflicting fill

- A canonical BUY fill `market:DOGEUSDT/trade:42` adds 10 quote to cost once.
- Replaying identical trade 42 leaves cost at 10.
- Reusing trade 42 with changed quantity, quote notional, commission asset/amount, side, order, or market is a conflict. Reject; do not apply a second amount.

## 9. Domain test matrix

Legend: **Existing** = a focused current test exists; **Partial** = related test exists but not all combinations; **Gap** = direct proof is missing and should be added in D2.

| Area | Required case | Current Harvester evidence | Status |
|---|---|---|---|
| Portfolio | BUY adds gross quantity less base commission | `position.test.js` | Existing |
| Portfolio | BUY quote commission increases quote cash outflow | `position.test.js` | Existing |
| Portfolio | SELL consumes gross quantity plus base commission | `position.test.js` | Existing |
| Portfolio | SELL quote commission reduces quote proceeds | `position.test.js` | Existing |
| Portfolio | SELL cannot consume active + free quantity by dipping into free | `position.test.js` | Existing |
| Portfolio | Total base quantity conserved by free allocation | `position.test.js` | Partial |
| Portfolio | Zero keep quantity policy | completion rejects zero; approval pending | Gap / decision |
| Fill identity | Identical replay no-op | `portfolio.test.js`, `recovery-ledger.test.js` | Existing |
| Fill identity | Same ID with changed financial facts rejects | both identity tests | Existing |
| Fill identity | Changes in each fingerprint field reject | `fills/fill-fingerprint.test.js` | Existing |
| Order ownership | Multi-market isolation; duplicate fills and stale out-of-order reports do not cross-account | `conservative-trading-engine.multi-market.test.js` | Existing |
| Order lifecycle | NEW, PARTIALLY_FILLED, FILLED, CANCELED, REJECTED, EXPIRED, and unknown states map and drive safe engine behavior | `adapt-canonical-order.test.js`, `order-registry.test.js`, `conservative-trading-engine.test.js` | Existing |
| Cancellation race | A recovery SELL fill returned during cancellation is applied once when its late stream event is replayed | `conservative-trading-engine.test.js` | Existing |
| Fill identity | Same fill applied to Portfolio and ledger atomically | `update-trading-accounting.test.js` | Existing |
| Recovery ledger | Multiple BUY fills accumulate actual cost | ledger test uses BUY then multiple sells; add multi-BUY explicit case | Partial |
| Recovery ledger | Partial SELL fills accumulate net proceeds across replacement | `recovery-ledger.test.js` | Existing |
| Recovery ledger | Base commissions do not alter quote ledger | `recovery-fill-accounting.test.js` | Existing |
| Recovery ledger | Multiple base/quote commission entries aggregate correctly | commission-rate test; recovery accounting tests not all combinations | Partial |
| Recovery ledger | Third-asset/incomplete/negative commission reject | recovery accounting tests | Partial |
| Recovery ledger | Reset clears cycle amounts but preserves IDs | `recovery-ledger.test.js` | Existing |
| Recovery ledger | Late duplicate after reset stays duplicate | reset test | Existing |
| Fee reserve | Configured maker/taker maximum (zero, maker-higher, taker-higher, equal, invalid) | `sell-fee-rate.test.js`; actual per-fill commission accounting is covered separately by `recovery-fill-accounting.test.js` | Existing |
| Fee reserve | Fee-history reset behavior | reset test documents preserve; differs from Conservative strategy | Decision |
| SELL plan | Keep quantity and rounding | `recovery-sell-plan.test.js` | Existing |
| SELL plan | Partial proceeds lower remaining required proceeds | sell-plan test | Existing |
| SELL plan | Base commission + quantity step edge | `recovery-sell-plan-accounting.test.js` | Existing |
| SELL plan | Quote commission + price tick boundary at minProfit | `recovery-sell-plan-accounting.test.js` | Existing |
| SELL plan | Already recovered proceeds still require full SELL fill | planner test exists; lifecycle test needed | Partial |
| Strategy | Initial BUY price and quantity boundaries | `conservative-strategy.test.js` | Partial |
| Strategy | Initial BUY trailing decision/replacement eligibility | `trailing-buy-repricing.test.js`, `conservative-trading-engine.test.js` | Existing |
| Strategy | Standing BUY allowed with active recovery SELL | strategy test creates both intents | Existing |
| Strategy | Recovery-first blocking alternative | PR #479 only; decision unresolved | Decision |
| Strategy | Investment cap exact boundary and committed BUY amounts | one investment test | Partial |
| Strategy | SELL submission before next BUY | `conservative-strategy.test.js`, `conservative-trading-engine.test.js` | Existing |
| Completion | Partial/cancelled SELL not complete | `recovery-completion.test.js` | Existing |
| Completion | Fully filled but below minProfit does not allocate | completion test | Existing |
| Completion | Insufficient active inventory does not allocate | completion test | Existing |
| Completion | Exact minProfit equality passes and one tick below fails | `recovery-sell-plan-accounting.test.js` | Existing |
| Completion | Completion invoked exactly once and ledger reset only once | `reconciles one complete Conservative cycle with partial fills, SELL cancel/fill replacement, and exact-once completion` | Existing |
| Sell-through | After recovery profit is secured, continue selling active inventory above `keepQuantity` at a price that does not violate net-profit, exchange-filter, or post-only constraints | Current strategy suppresses SELL when the ledger resets; existing test explicitly asserts suppression | Gap / FAIL against owner-approved contract |
| Sell-through | Repeat evaluation after a residual fill without duplicating an active SELL | No regression proving repeated evaluation and duplicate-order prevention for residual sell-through | Gap |
| Sell-through | Quantity-step remainder is either sold in a later valid order or explicitly classified as exchange-constrained dust | No complete residual/dust regression | Gap |
| Sell-through | Base-asset SELL commission leaves exactly the configured retained quantity when exchange rules permit | Existing planner reserves a fee but no end-to-end exact-retained-quantity proof | Gap |
| Sell-through | Retained `keepQuantity` is never sold; no extra active inventory is intentionally retained | Existing completion allocates exact `keepQuantity` but leaves additional active inventory | Gap / FAIL against owner-approved contract |
| Ordering | Out-of-order fills with deterministic execution-time policy | no explicit test | Gap |
| Failure | Invalid fill quantity/notional/commission, unsupported asset, wrong market | several focused tests | Partial |
| Failure | Cross-projection partial failure leaves neither projection committed | `update-trading-accounting.test.js` | Existing |
| Lifecycle | Full BUY → partial fills → SELL partial/cancel-fill replacement → completion → next BUY | `reconciles one complete Conservative cycle with partial fills, SELL cancel/fill replacement, and exact-once completion` | Existing |

## 10. D2 exit criteria

Before D2 can pass:
- All **Gap** rows are covered or explicitly excluded with rationale.
- Financial equality boundaries are tested using exact decimal strings.
- Fee-reserve calculations are tested against actual post-fill inventory and net proceeds.
- Portfolio + RecoveryLedger application is proven atomic.
- Every completion/reset path is idempotent.
- No test uses broker connectivity, TESTNET, network calls, or exchange credentials as proof of domain correctness.


## 11. Additional lifecycle invariants — 2026-11-06 audit

### Residual sell-through
- After the recovery target is reached, preserve the original cycle cost and actual net proceeds until every exchange-sellable active unit above `keepQuantity` is sold.
- A residual SELL must not reduce aggregate realized net profit below `0.01` after actual commissions.
- Base-asset SELL commission consumes additional base inventory; quote-asset SELL commission reduces proceeds. Apply actual commission facts, not estimates, to accounting.
- Enforce current minimum quantity/notional, quantity increment, post-only, and fee-reserve constraints for every residual order.
- Keep exactly the configured `keepQuantity`; do not classify an order-rounding remainder as dust unless it is proven unsellable under the applicable exchange filters.
- Repeated evaluation with an active residual SELL must not create another SELL. A confirmed residual fill is applied once; only then may the remaining quantity be replanned.

### Restart reconciliation
- A process may be offline while exchange orders continue to fill. In-memory state not changing while stopped is expected.
- On restart, replay durable Journal state before activating the trading engine; backfill all owned exchange fills since the last durable checkpoint.
- Reconcile actual commissions, partial/terminal orders, open-order reservations, and free/locked/total account balances before readiness.
- Identical fill replay is idempotent across both Portfolio and RecoveryLedger; conflicting facts for a reused fill ID fail closed.
- Incomplete trade-history pagination, incomplete market universe, unknown ownership, missing commission facts, or balance/order mismatch prevents new order submission.
- Persist the reconciled checkpoint before enabling trading; never rewrite the prior shutdown snapshot.

### Current verification status

The current strategy still suppresses residual SELLs after ledger reset, and the existing strategy test asserts that suppression. The current bootstrap explicitly disables durable Journal replay and starts with fresh in-process state. These are implementation gaps, not satisfied invariants. Required regression coverage is tracked in ROADMAP and audit issue #645; TESTNET acceptance remains separate.
