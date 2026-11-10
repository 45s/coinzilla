# Conservative Accounting — Verification Matrix

**Non-authoritative reference only.** All Conservative accounting, SELL economics, commission valuation, fee reserve, retained quantity, lifecycle, dust, and completion rules are defined exclusively in [CONSERVATIVE_DOMAIN_SPECIFICATION.md](./CONSERVATIVE_DOMAIN_SPECIFICATION.md). This file must not define or amend those rules.

The matrix below records implementation/test evidence and gaps only. A test name or status is not a strategy rule. Update the matrix when tests change; update the canonical specification only after an explicit owner decision.

## Implementation regression matrix (evidence only)

Legend: **Existing** = a focused current test exists; **Partial** = related test exists but not all combinations; **Gap** = direct proof is missing. These statuses describe test presence, not execution; exact-head test/CI verification is tracked separately.

| Area | Required case | Current Harvester evidence | Status |
|---|---|---|---|
| Portfolio | BUY adds gross quantity less base commission | `position.test.js` | Existing |
| Portfolio | Same trade ID in different markets preserves exact per-market quantity, spent basis and quote cash flow | `portfolio.test.js` — `keeps exact fill accounting isolated when different markets reuse the same trade ID` | Existing — PR #924 exact head `9b8d4d8a` passed 872/872 Harvester tests and all required checks |
| Portfolio | Conflicting fill identity is rejected without changing position accounting or applied fill identities | `portfolio.test.js` — `rejects a reused Fill ID when execution facts differ without mutating Portfolio accounting` | Existing — PR #924 exact head `9b8d4d8a` passed 872/872 Harvester tests and all required checks |
| Portfolio | BUY quote commission increases quote cash outflow | `position.test.js` | Existing |
| Portfolio | SELL consumes gross quantity plus base commission | `position.test.js` | Existing |
| Portfolio | SELL quote commission reduces quote proceeds | `position.test.js` | Existing |
| Portfolio | SELL cannot consume active + free quantity by dipping into free | `position.test.js` | Existing |
| Portfolio | Total base quantity conserved by free allocation | `position.test.js` | Partial |
| Lifecycle | keepQuantity=0 complete workflow | `completes the full Conservative lifecycle with the supported zero keepQuantity` in `conservative-trading-engine.test.js` | Existing — execution pending |
| Fill identity | Identical replay no-op | `portfolio.test.js`, `recovery-ledger.test.js` | Existing |
| Fill identity | Same ID with changed quantity, commission amount or commission asset rejects without mutating either projection | `portfolio.test.js`, `recovery-ledger.test.js` | Existing |
| Fill identity | Changes in each fingerprint field reject | `fills/fill-fingerprint.test.js` | Existing |
| Order ownership | Multi-market isolation; duplicate fills and stale out-of-order reports do not cross-account | `conservative-trading-engine.multi-market.test.js` | Existing |
| Order lifecycle | NEW, PARTIALLY_FILLED, FILLED, CANCELED, REJECTED, EXPIRED, and unknown states map and drive safe engine behavior | `adapt-canonical-order.test.js`, `order-registry.test.js`, `conservative-trading-engine.test.js` | Existing |
| Cancellation race | A recovery SELL fill returned during cancellation is applied once when its late stream event is replayed | `conservative-trading-engine.test.js` | Existing |
| Fill identity | Same fill applied to Portfolio and ledger atomically | `update-trading-accounting.test.js` | Existing |
| Recovery ledger | Multiple BUY fills accumulate actual cost | Actual multi-BUY DOGE/ZRO fixtures in `conservative-strategy.test.js`; full-cycle engine regression | Existing — execution pending |
| Recovery ledger | Partial SELL fills accumulate net proceeds across replacement | `recovery-ledger.test.js` | Existing |
| Recovery ledger | Base commissions do not alter quote ledger | `recovery-fill-accounting.test.js` | Existing |
| Recovery ledger | Multiple base/quote commission entries aggregate correctly | `recovery-fill-accounting.test.js` aggregated commission validation and per-asset accounting cases | Existing — execution pending |
| Recovery ledger | Third-asset/incomplete/negative commission reject | recovery accounting tests | Partial |
| Recovery ledger | Reset clears cycle amounts but preserves IDs | `recovery-ledger.test.js` | Existing |
| Recovery ledger | Late duplicate after reset stays duplicate | reset test | Existing |
| Fee reserve | Configured maker/taker maximum (zero, maker-higher, taker-higher, equal, invalid) | `sell-fee-rate.test.js`; actual per-fill commission accounting is covered separately by `recovery-fill-accounting.test.js` | Existing |
| Fee reserve | Fee-history reset behavior | reset test documents preserve; differs from Conservative strategy | Decision |
| SELL plan | Keep quantity and rounding | `recovery-sell-plan.test.js` | Existing |
| SELL plan | Partial proceeds lower remaining required proceeds | sell-plan test | Existing |
| SELL plan | Base commission + quantity step edge | `recovery-sell-plan-accounting.test.js` | Existing |
| SELL plan | Quote commission + price tick boundary at minProfit | `recovery-sell-plan-accounting.test.js` | Existing |
| SELL plan | Already recovered proceeds still require full SELL fill | `conservative-strategy.test.js` residual sell-through cases; engine terminal SELL lifecycle | Existing — execution pending |
| Strategy | Initial BUY price and quantity boundaries | `conservative-strategy.test.js` | Partial |
| Strategy | Initial BUY trailing decision/replacement eligibility | `trailing-buy-repricing.test.js`, `conservative-trading-engine.test.js` | Existing |
| Strategy | Standing BUY allowed with active recovery SELL | strategy test creates both intents | Existing |
| Strategy | Recovery SELL acknowledged before next standing BUY | Engine submission-order regression | Existing / reverify |
| Strategy | Investment cap exact equality, immediately-below limit, and committed BUY amounts | `strategy.test.js` — `respects exact investment-cap equality and blocks the next BUY immediately below it` | Existing — PR #922 merged; 872/872 Harvester tests and required CI passed |
| Strategy | SELL submission before next BUY | `conservative-strategy.test.js`, `conservative-trading-engine.test.js` | Existing |
| Completion | Partial/cancelled SELL not complete | `recovery-completion.test.js` | Existing |
| Completion | Fully filled but below minProfit does not allocate | completion test | Existing |
| Completion | Insufficient active inventory does not allocate | completion test | Existing |
| Completion | Exact minProfit equality passes and one tick below fails | `recovery-sell-plan-accounting.test.js` | Existing |
| Completion | Completion invoked exactly once and ledger reset only once | `reconciles one complete Conservative cycle with partial fills, SELL cancel/fill replacement, and exact-once completion` | Existing |
| Sell-through | After recovery profit is secured, continue selling active inventory above `keepQuantity` at a price that does not violate net-profit, exchange-filter, or post-only constraints | `conservative-strategy.test.js` residual sell-through and price/filter boundary cases | Existing — execution pending |
| Sell-through | Repeat evaluation after a residual fill without duplicating an active SELL | `does not create a duplicate residual SELL while one is active` and engine active-order suppression | Existing — execution pending |
| Sell-through | Quantity-step remainder is either sold in a later valid order or explicitly classified as exchange-constrained dust | `conservative-strategy.test.js`, `recovery-completion.dust.test.js`, lifecycle DTO tests, and engine regression for dust completion/event persistence | Existing — execution pending |
| Sell-through | Base-asset SELL commission leaves exactly the configured retained quantity when exchange rules permit | `recovery-sell-plan-accounting.test.js` exact keepQuantity boundary; actual commission fill fixtures | Existing — execution pending |
| Sell-through | Retained `keepQuantity` is never sold; no extra sellable inventory is intentionally retained | Recovery completion predicate, exact fee-reserved planner test, and residual sell-through regressions | Existing — execution pending |
| Ordering | Out-of-order fills with deterministic execution-time policy | Excluded as a separate accounting-order requirement: Portfolio/RecoveryLedger deltas are additive and idempotent by stable fill ID; completed-BUY VWAP uses aggregate executed quote/base totals. Stale/out-of-order order reports are covered by engine lifecycle tests. | Excluded — rationale documented |
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


## Current verification status

This matrix is evidence only; the canonical specification remains the sole rule authority. PR #921 added projection-level commission-conflict regressions: a reused Fill ID with a changed quote-commission amount is rejected by Portfolio, and a changed commission asset is rejected by RecoveryLedger; each test asserts the complete original projection remains unchanged. On exact PR head `c6a8de21cf6f241583ae95ab88d1afb6febc1123`, the full Harvester suite passed 873/873; Harvester coverage was 75.87% lines, 79.13% branches and 74.85% functions. Configured targeted tests, workspace unit tests/coverage, JavaScript syntax and Markdown, Utils tests, production dependency audit and actionlint all passed; the external documentation link check passed. The TESTNET integration probe was skipped. No production code changed. Other rows marked execution pending remain pending and must not be treated as verified by this PR. Restart reconciliation remains explicitly deferred in #654.
