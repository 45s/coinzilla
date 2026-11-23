---
title: Repository Test Scenario Catalog
status: active
type: testing
owner: repository
created: 2026-11-23
---

# Test scenario catalog

This is the single human-readable entry point for understanding the important behavioral scenarios the Coinzilla automated tests are intended to prove.

It is organized around **what the application must do**, not around test filenames. Each scenario describes the business behavior, preconditions, inputs, expected outcomes, important subcases, implementation ownership, and the automated test cases that prove it.

> **Initial catalog:** this is the first repository-wide pass, not a claim of exhaustive coverage. Some entries are mapped to existing test cases; others are specified but still need scenario tests or a more precise test mapping. Gaps are explicit. Expand this file as the scenario inventory improves.

## How to use this catalog

1. Find the domain and scenario ID that match the behavior you care about.
2. Read the behavior, input, expected output, and subcases before opening any source or test file.
3. Use the implementation links to understand where the behavior belongs.
4. Use the named test links to jump directly to executable evidence.
5. Check the status and evidence note. A test filename, test count, or coverage percentage alone does not prove that a scenario is covered.

The catalog is a navigation and traceability layer. Domain specifications, accepted decisions, API contracts, and configuration remain authoritative for exact product behavior. The test files remain the executable verification. This catalog connects the two; it does not replace either.

## Quick scenario index

### Harvester — shared account, order, and portfolio behavior

- [HARV-ACC-001 — Account-wide commitments](#harv-acc-001--account-wide-commitments-are-counted-exactly-once)
- [HARV-ACC-002 — Canonical fill idempotency and conflict rejection](#harv-acc-002--canonical-fills-are-applied-once-and-conflicting-replays-are-rejected)
- [HARV-MKT-001 — Exchange trading-rule boundaries](#harv-mkt-001--exchange-trading-constraints-are-enforced-at-exact-boundaries)

### Harvester — Conservative (CG)

- [CG-001 — Confirmed BUY, recovery SELL, and next-BUY gating](#cg-001--a-confirmed-buy-creates-recovery-work-but-the-next-buy-waits-for-sell-acknowledgement)
- [CG-002 — Recovery completion and constrained dust](#cg-002--recovery-completion-preserves-required-inventory-and-does-not-misclassify-dust)

### Harvester — Recovery Seller (RS)

- [RS-001 — Legacy basis versus Spot custody](#rs-001--legacy-basis-is-not-proof-of-current-spot-custody)
- [RS-002 — Recovery BUY accounting](#rs-002--recovery-buy-accounting-uses-confirmed-net-fills-and-actual-commissions)
- [RS-003 — Additive mixed SELL quantity](#rs-003--a-mixed-recoverylegacy-sell-uses-the-additive-legacy-slice)
- [RS-004 — Independent profitability gates](#rs-004--recovery-legacy-and-combined-profitability-gates-are-independent)
- [RS-005 — One SELL lifecycle per cycle](#rs-005--a-recovery-cycle-may-submit-only-one-sell-lifecycle)
- [RS-006 — Atomic mixed SELL accounting](#rs-006--mixed-sell-accounting-commits-both-allocations-atomically)
- [RS-007 — Unknown outcome and no blind retry](#rs-007--unknown-submission-outcome-preserves-identity-and-forbids-blind-retry)
- [RS-008 — CG/RS shared account availability](#rs-008--cg-and-rs-share-account-availability-without-sharing-strategy-ownership)
- [RS-009 — Terminal STOP and continued reconciliation](#rs-009--stop-is-terminal-visible-and-does-not-suppress-reconciliation)
- [RS-010 — Deferred restart and fee valuation](#rs-010--unsupported-restart-and-fee-valuation-capabilities-remain-blocked)

### Shared packages

- [BRK-001 — Unknown broker mutation outcome](#brk-001--unknown-broker-mutation-outcome-is-not-treated-as-failure)
- [DB-001 — Database transaction atomicity](#db-001--a-failed-database-transaction-leaves-no-partial-write)
- [EVT-001 — Publish versus subscriber completion](#evt-001--publish-acceptance-is-distinct-from-subscriber-completion)
- [JRN-001 — Journal durability boundary](#jrn-001--journal-flush-is-the-durability-boundary)
- [NTF-001 — Bounded notification delivery](#ntf-001--notification-delivery-remains-bounded-and-failure-isolated)
- [ENT-001 — Exact financial values and asset identity](#ent-001--financial-values-preserve-exact-decimal-and-asset-identity)
- [UTL-001 — Exact shared decimal helpers](#utl-001--shared-decimal-helpers-produce-exact-deterministic-results)
- [IND-001 — Valid contiguous indicator history](#ind-001--indicator-calculations-reject-discontinuous-or-insufficient-candle-history)

## Status vocabulary

| Status | Meaning |
| --- | --- |
| `SPECIFIED` | The intended behavior is documented, but no accepted test mapping is recorded yet. |
| `TEST-MAPPED` | The catalog names existing test cases that appear to exercise the behavior. This is a navigation claim, not fresh verification. |
| `VERIFIED` | The named assertions were reviewed against the intended behavior and passed on the exact cited commit/PR head. |
| `PARTIAL` | Some dimensions are proved; the missing assertions or subcases are listed. |
| `MISSING` | No accepted scenario test currently proves this behavior. |
| `BLOCKED` | The expected behavior cannot be safely specified until a decision, evidence source, or prerequisite is resolved. |
| `UNSUPPORTED` | The behavior is explicitly outside the current product contract. Do not write a test that invents support for it. |

A scenario may have more than one status across its subcases. State that distinction explicitly.

## Scenario entry format

New or materially changed behavior should receive a stable scenario ID and an entry with these fields:

- **Behavior:** the business outcome in plain language.
- **Given / preconditions:** relevant initial state and invariants.
- **Input / When:** concrete commands, fills, events, requests, or state changes.
- **Expected output / Then:** exact observable result and important state changes.
- **Must not happen:** safety and negative assertions.
- **Subcases:** boundary, invalid, duplicate, reordered, concurrent, timeout, and failure variants as relevant.
- **Implementation:** production paths that own the behavior.
- **Automated tests:** exact test file and test case title. Use `not mapped` rather than guessing.
- **Status / evidence:** current disposition and exact verification reference when one exists.

Keep each scenario focused on one business behavior. A scenario can have multiple subcases, and a single test can prove more than one assertion, but the mapping must say exactly what it proves. Prefer named test titles over a bare list of filenames.

## Repository-wide scenario map

This map is deliberately incomplete. It gives the reader a starting point across the active application and package domains. The detailed entries below are the initial cataloged scenarios; unexpanded domains remain visible as discovery work rather than being silently omitted.

| Domain | Scenario families in this initial pass | Current catalog state | Authoritative starting point |
| --- | --- | --- | --- |
| Harvester — shared account/order/portfolio | Account-wide commitments, canonical fill identity, exchange filters | TEST-MAPPED | [Harvester domain test inventory](../../apps/harvester/docs/domain/DOMAIN_TEST_INVENTORY.md) |
| Harvester — Conservative (CG) | Initial BUY, recovery SELL, next-BUY gating, partial fills, residual/dust completion | TEST-MAPPED | [Conservative Domain Specification](../../apps/harvester/docs/domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md) |
| Harvester — Recovery Seller (RS) | Legacy authorization/custody, BUY accounting, mixed SELL, profitability, one-SELL lifecycle, STOP, concurrency | MISSING — fresh scenario suite required | [RS scenario issue #1780](https://github.com/45s/coinzilla/issues/1780) and [RS domain specification](../../apps/harvester/docs/domain/recovery-seller-domain-specification.md) |
| Brokers | Canonical request/response contracts, unknown mutation outcomes, provider capability boundaries | SPECIFIED / mapping incomplete | [Broker API contract](../../packages/brokers/BROKER_API.md) |
| Entities | Exact financial values, canonical market/order/fill identity, immutable domain contracts | SPECIFIED / mapping incomplete | [Entities roadmap](../../packages/entities/ROADMAP.md) |
| Database | CRUD conformance, transaction rollback, persistence across connections, locking | SPECIFIED / mapping incomplete | [Database CRUD decision](../../packages/db/docs/decisions/0001-provider-neutral-record-crud-api.md) |
| Event Bus | Bounded fan-out, subscriber failure isolation, flush/close lifecycle | SPECIFIED / mapping incomplete | [Event Bus roadmap](../../packages/event-bus/ROADMAP.md) |
| Journal | Ordered append, flush durability, malformed records, failed sync and cleanup | SPECIFIED / mapping incomplete | [Journal roadmap](../../packages/journal/ROADMAP.md) |
| Notifiers | Bounded delivery, malformed events, transport failure, redaction and shutdown | SPECIFIED / mapping incomplete | [Notifiers roadmap](../../packages/notifiers/ROADMAP.md) |
| Utils | Exact decimal primitives, validation, structured logging and bounded async helpers | SPECIFIED / mapping incomplete | [Utils roadmap](../../packages/utils/ROADMAP.md) |
| Indicators | Candle validation, contiguous history, ATR/NATR and invalid-history behavior | SPECIFIED / mapping incomplete | [Indicators package](../../packages/indicators/README.md) |
| Dashboard / Market Simulator | UI behavior and simulator behavior | Discovery not started | [Domain ownership map](../engineering/DOMAIN_OWNERSHIP.md) |

The repository-wide method for designing domain scenarios is being established separately in [issue #1779](https://github.com/45s/coinzilla/issues/1779). Strategy-specific rules and scenario matrices belong to their owning domains and issues.

---

## Harvester — shared account, order, and portfolio behavior

### HARV-ACC-001 — Account-wide commitments are counted exactly once

**Status:** TEST-MAPPED — named existing cases identified; this catalog task did not rerun the suite.

**Behavior:** New trading actions must be allocated against the current account snapshot and all commitments without double-counting locks already reflected in the snapshot. CG and RS share physical account availability, but each strategy keeps its own budget and ownership.

**Given / preconditions:**

- An authoritative account snapshot contains free quote and base balances.
- Some active-order commitments may already be reflected in that snapshot.
- Other commitments may have been created after the snapshot.
- Multiple strategies may reserve the same quote or base asset.

**Input / example:**

- Snapshot free quote: 100 USDT.
- An existing BUY lock of 20 USDT is already reflected in that free-balance snapshot.
- A new BUY commitment of 10 USDT is created after the snapshot.
- The allocator evaluates another BUY.

**Expected output:**

- The already-reflected 20 USDT is not subtracted a second time.
- The new 10 USDT commitment is subtracted.
- The remaining quote availability for the next allocation is 90 USDT.
- Shared base reservations similarly prevent aggregate SELL allocation from exceeding account-available inventory.
- Strategy budgets remain separate; unused RS budget is not borrowed by CG and vice versa.

**Must not happen:**

- Do not count the same Portfolio inventory or exchange lock twice.
- Do not let aggregate SELL commitments exceed shared base inventory.
- Do not let one strategy's allocation bypass another strategy's account-wide reservation.

**Subcases represented by the mapped tests:**

- BUY and SELL commitments already reflected in account snapshots.
- Commitments created after snapshots.
- Partial BUY fill credit and partial SELL lock release.
- Shared quote/base reservations across pairs.
- Combined CG + RS SELL reservations and verified Spot custody.

**Implementation:**

- `apps/harvester/src/domain/orders/allocate-order-commitments.js`
- Account snapshot and Portfolio allocation collaborators under `apps/harvester/src/domain/`

**Automated tests:**

- [`allocate-order-commitments.test.js`](../../apps/harvester/src/domain/orders/allocate-order-commitments.test.js)
  - `does not subtract a BUY commitment already reflected in the exchange free-balance snapshot`
  - `subtracts only a new BUY commitment created after the account snapshot`
  - `does not count Portfolio base inventory twice when the exchange snapshot already reflects it`
  - `rejects a SELL that exceeds shared inventory after combined CG and RS reservations`
  - `rejects a mixed SELL when verified free Spot custody is smaller than tracked recovery plus legacy inventory`

**Evidence note:** Existing test titles were inspected to create a navigation mapping. The assertions have not yet been reviewed against every listed subcase, and the tests were not executed as part of this documentation-only catalog change; do not treat this mapping as VERIFIED.

### HARV-ACC-002 — Canonical fills are applied once and conflicting replays are rejected

**Status:** TEST-MAPPED — named existing cases identified; this catalog task did not rerun the suite.

**Behavior:** The same canonical execution may arrive through more than one delivery path, such as REST history and a user-data stream. It must affect accounting once. Reusing the same identity with changed execution facts must be rejected without partially mutating the accepted Portfolio.

**Given / preconditions:**

- A Position is owned by a specific strategy and market.
- A canonical Fill has a stable market-scoped identity and exact execution facts.

**Input / example:**

- Apply a DOGEUSDT BUY Fill with a canonical ID, quantity, price, and commission.
- Deliver the identical Fill again through another event path.
- Separately, attempt to reuse the same Fill ID with a changed quantity or commission.

**Expected output:**

- Identical replay is an immutable no-op.
- A conflicting replay is rejected.
- Position quantity, cost basis, cash flow, and applied-fill identity remain unchanged after the rejected conflict.
- Same raw trade IDs in different markets remain independent when their canonical market-scoped identities differ.
- A fill cannot be applied to a Position owned by another strategy.

**Must not happen:**

- No duplicate accounting.
- No partial Portfolio mutation on conflict.
- No ambiguous strategy or market attribution.

**Subcases represented by the mapped tests:**

- Same fill delivered through history and stream in either order.
- Same ID with changed execution facts.
- Same ID with changed commission amount.
- Same trade ID reused across markets.
- Multiple strategy-owned Positions for one market.
- Rejected cross-Position allocation.

**Implementation:**

- `apps/harvester/src/domain/portfolio/portfolio.js`
- `apps/harvester/src/domain/portfolio/position.js`
- `apps/harvester/src/domain/fills/`

**Automated tests:**

- [`portfolio.test.js`](../../apps/harvester/src/domain/portfolio/portfolio.test.js)
  - `deduplicates a fill by canonical market-scoped identity`
  - `keeps exact fill accounting isolated when different markets reuse the same trade ID`
  - `rejects a reused Fill ID when execution facts differ without mutating Portfolio accounting`
  - `rejects a reused Fill ID when commission amount differs without mutating Portfolio`
  - `deduplicates equivalent history-response and user-data stream fills in either delivery order`
  - `keeps independent strategy-owned Positions for the same market`
  - `rejects applying one canonical fill to a different strategy Position`

**Evidence note:** Existing test titles were inspected to create a navigation mapping. The assertions have not yet been reviewed against every listed subcase, and the tests were not executed as part of this documentation-only catalog change; do not treat this mapping as VERIFIED.

### HARV-MKT-001 — Exchange trading constraints are enforced at exact boundaries

**Status:** TEST-MAPPED — named existing cases identified; this catalog task did not rerun the suite.

**Behavior:** An order is eligible only when the market metadata and configured order type are valid and the exact price, quantity, and notional satisfy the exchange's declared constraints.

**Given / preconditions:**

- A canonical market and validated trading-rule metadata are available.
- The strategy configuration requests an order type supported by the market.

**Input / example:**

- Submit a candidate quantity exactly at the configured minimum notional.
- Compare it with a candidate one meaningful increment below that minimum.
- Repeat for quantity and price boundaries where the exchange declares them.

**Expected output:**

- Exact inclusive boundaries are accepted where the rule is inclusive.
- Values outside the permitted range are rejected.
- Missing or malformed required rule metadata fails closed.
- The selected order type respects maker-commission configuration and exchange support.

**Must not happen:**

- Do not treat missing constraints as an empty rule set.
- Do not silently round or alter an invalid business intent into a different order.
- Do not submit an unsupported order type.

**Subcases represented by the mapped tests:**

- Missing increments and unsupported order type.
- Exact MIN/MAX price and quantity boundaries.
- MIN_NOTIONAL equality and immediately-below behavior.
- Malformed or incomplete metadata.
- LIMIT versus LIMIT_MAKER selection.

**Implementation:**

- `apps/harvester/src/domain/market/validate-market-trading-readiness.js`
- `apps/harvester/src/domain/orders/validate-order-against-trading-rules.js`

**Automated tests:**

- [`validate-market-trading-readiness.test.js`](../../apps/harvester/src/domain/market/validate-market-trading-readiness.test.js)
  - `fails closed when a required trading rule is missing or unsupported`
  - `enforces exchange quantity limits at exact boundaries and immediately outside them`
  - `enforces MIN_NOTIONAL at exact equality and immediately below the configured investment`
  - `rejects malformed unvalidated constraint metadata instead of treating it as an empty list`

**Evidence note:** Existing test titles were inspected to create a navigation mapping. The assertions have not yet been reviewed against every listed subcase, and the tests were not executed as part of this documentation-only catalog change; do not treat this mapping as VERIFIED.

---

## Harvester — Conservative strategy (CG)

The [Conservative Domain Specification](../../apps/harvester/docs/domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md) remains the authority for Conservative business rules. The following entries are an initial readable map of important existing behaviors, not a declaration that the full Conservative scenario matrix is complete.

### CG-001 — A confirmed BUY creates recovery work, but the next BUY waits for SELL acknowledgement

**Status:** TEST-MAPPED — named existing cases identified; full scenario-matrix completeness is not claimed.

**Behavior:** Conservative must base recovery work on actual filled inventory. It can plan a recovery SELL and the next standing BUY from the actual BUY fill, but it must not advance the next BUY while the recovery SELL is pending or unknown.

**Given / preconditions:**

- A valid market, strategy configuration, and exchange trading constraints.
- No duplicate active BUY for the same strategy/market.
- A confirmed BUY fill establishes actual recovery inventory.

**Input / example:**

- A price event causes an initial BUY to be planned.
- The BUY receives an actual fill.
- The strategy evaluates recovery SELL and next standing BUY.
- The recovery SELL acknowledgement is delayed or its outcome is unknown.

**Expected output:**

- Initial BUY is priced and rounded according to the market tick.
- Repeated price events do not duplicate an active BUY.
- Actual filled inventory drives recovery SELL planning.
- The next standing BUY is allowed only after the recovery SELL is acknowledged.
- A pending or unknown SELL acknowledgement blocks the next BUY.

**Must not happen:**

- Do not use requested BUY quantity as if it were confirmed filled quantity.
- Do not submit a duplicate active BUY.
- Do not submit the next BUY while the required recovery SELL is pending or unknown.

**Subcases represented by the mapped tests:**

- Initial BUY tick rounding.
- Duplicate suppression.
- Actual fill-driven recovery SELL and standing BUY.
- Acknowledged versus pending/unknown recovery SELL.
- Partial BUY fill behavior.
- Investment cap equality and just-below behavior.

**Implementation:**

- `apps/harvester/src/domain/strategies/conservative/strategy.js`
- `apps/harvester/src/domain/strategies/conservative/recovery-sell-plan.js`

**Automated tests:**

- [`strategy.test.js`](../../apps/harvester/src/domain/strategies/conservative/strategy.test.js)
  - `creates the initial BUY below last traded price and rounds down to tick`
  - `does not duplicate an already active BUY on repeated price events`
  - `creates a recovery SELL and the next standing BUY from actual filled inventory`
  - `allows the next BUY only after the recovery SELL is acknowledged`
  - `blocks the next BUY while the recovery SELL acknowledgement is pending or unknown`
  - `keeps the partial BUY active while continuing recovery SELL planning`

**Evidence note:** Existing test titles were inspected to create a navigation mapping. The assertions have not yet been reviewed against every listed subcase, and the tests were not executed as part of this documentation-only catalog change; do not treat this mapping as VERIFIED.

### CG-002 — Recovery completion preserves required inventory and does not misclassify dust

**Status:** TEST-MAPPED — named existing cases identified; scenario-matrix completeness is not claimed.

**Behavior:** A recovery cycle completes only when the actual remaining inventory satisfies the configured keep-quantity and exchange constraints. Partial or canceled SELLs do not count as completed recovery. Residual inventory that cannot currently be sold must be classified rather than submitted as an invalid order.

**Given / preconditions:**

- A Position with accumulated BUY cost basis and actual SELL proceeds.
- A configured keep quantity and current exchange filters.

**Input / example:**

- Apply one or more partial SELL fills.
- Evaluate completion with remaining inventory above, equal to, or below keep quantity.
- Evaluate residual quantities below the quantity step or minimum notional.

**Expected output:**

- Only a profitable, fully eligible recovery SELL may complete the cycle.
- Partial/canceled SELLs do not allocate retained free inventory as if the cycle completed.
- Residuals above the keep quantity remain sell-through work.
- Quantity-step and MIN_NOTIONAL dust are classified and do not become invalid SELL submissions.
- A later BUY can make a previously constrained residual sellable without losing accumulated basis or proceeds.

**Must not happen:**

- Do not complete a cycle while a partial or canceled SELL remains unresolved.
- Do not release inventory that should remain active.
- Do not discard prior recovery cost basis or net SELL proceeds when residual inventory is carried forward.

**Subcases represented by the mapped tests:**

- Exact keep-quantity allocation after profitable recovery.
- Partial/canceled SELL completion rejection.
- Actual SELL missing the configured profit floor.
- Residual above keep quantity.
- Zero keep quantity.
- Quantity-step and MIN_NOTIONAL dust.
- Later BUY with previously constrained residual inventory.

**Implementation:**

- `apps/harvester/src/domain/strategies/conservative/recovery-completion.js`
- `apps/harvester/src/domain/strategies/conservative/recovery-sell-plan.js`
- `apps/harvester/src/domain/strategies/conservative/recovery-ledger.js`

**Automated tests:**

- [`recovery-completion.test.js`](../../apps/harvester/src/domain/strategies/conservative/recovery-completion.test.js)
  - `allocates exactly keepQuantity after a profitable recovery SELL`
  - `does not allocate free coins for a partial or cancelled recovery SELL`
  - `pauses when a fully filled recovery SELL misses minProfit`
  - `defers completion while any active residual remains above keepQuantity`
  - `fails closed when exchange-constrained dust evidence contains non-positive filter values or negative evaluations`
- [`recovery-sell-plan.test.js`](../../apps/harvester/src/domain/strategies/conservative/recovery-sell-plan.test.js)
  - `plans a recovery SELL that retains keepQuantity and covers cost plus minProfit`
  - `continues cumulative recovery after confirmed partial SELL proceeds`
  - `reserves base quantity for the configured fee ceiling`
  - `rounds the minimum SELL price up only when the exact fee-adjusted price exceeds a tick`

**Evidence note:** Existing test titles were inspected to create a navigation mapping. The assertions have not yet been reviewed against every listed subcase, and the tests were not executed as part of this documentation-only catalog change; do not treat this mapping as VERIFIED.

---

## Harvester — Recovery Seller (RS)

**Scenario source:** [Build Recovery Seller domain scenario coverage from scratch — issue #1780](https://github.com/45s/coinzilla/issues/1780).

**Important evidence rule:** Every RS row below starts at **MISSING** for the new scenario initiative. Existing RS tests continue to run as ordinary regression tests, but they receive no scenario-coverage credit. Do not map, grade, or certify those existing tests as a shortcut. New RS scenario tests must be designed from the approved domain contract and the matrix in #1780.

The [Recovery Seller Domain Specification](../../apps/harvester/docs/domain/recovery-seller-domain-specification.md) and owner-approved decisions remain the behavior authority. Where the contract is draft, unresolved, or deferred, the scenario must remain blocked rather than inventing behavior.

### RS-001 — Legacy basis is not proof of current Spot custody

**Status:** MISSING — fresh scenario test required.

**Behavior:** Operator-declared historical cost basis and legacy quantity must remain distinct from current Spot custody and sellable inventory. RS may sell only verified, unreserved Spot quantity; EARN or other off-Spot holdings are not available for a Spot order.

**Given / preconditions:**

- The operator explicitly declares an original legacy position.
- Current Spot availability is obtained through the approved account evidence path.
- Any EARN/off-Spot balance is separate from Spot free quantity.

**Input / example:**

- Declared legacy basis: 100 USDT invested for 50 ZRO.
- Configured legacy release per completed cycle: 0.01 ZRO.
- Verified Spot free quantity: 0.50 ZRO.
- Remaining logical legacy quantity may be held outside Spot (for example, in EARN).

**Expected output:**

- Historical average cost is calculated as 100 / 50 = 2 USDT per ZRO using exact decimal arithmetic.
- The declared original quantity and basis are preserved.
- At most the verified, unreserved 0.50 ZRO in Spot can support current Spot execution; off-Spot quantity is not counted as immediately sellable.
- Spot/EARN transfers affect custody/availability, not historical acquisition basis.
- No synthetic Portfolio fill or ownership claim is created from configuration alone.

**Must not happen:**

- Do not infer authorization or RS ownership from the wallet's total balance.
- Do not adopt external/manual inventory or orders.
- Do not treat EARN quantity as Spot-available.
- Do not rewrite historical basis when custody changes.

**Subcases:**

- Missing, zero, negative, malformed, or contradictory basis inputs.
- Spot quantity below the required legacy slice.
- Stale or conflicting custody evidence.
- External/manual order or inventory isolation.
- Existing CG/other-strategy allocations and reservations reduce physical availability without becoming RS-owned.

**Implementation:**

- `apps/harvester/src/domain/strategies/recovery-seller/legacy-position.js`
- `apps/harvester/src/domain/strategies/recovery-seller/legacy-spot-allocation.js`
- Shared account snapshot and order-commitment allocation under `apps/harvester/src/domain/`

**Automated tests:** No new RS scenario test accepted yet. Existing RS tests are deliberately not credited under #1780.

### RS-002 — Recovery BUY accounting uses confirmed net fills and actual commissions

**Status:** MISSING — fresh scenario test required.

**Behavior:** Recovery inventory and cost basis come only from canonical confirmed BUY fills attributed to the current RS cycle. Requested quantity and acknowledgements are not executions.

**Given / preconditions:**

- A valid RS cycle and recovery Position identity exist.
- The BUY order is explicitly owned by RS.
- Canonical fills contain exact quantity, price, and actual commission facts.

**Input / example:**

- RS BUY fill: 10 ZRO at 2 USDT per ZRO.
- Variant A: 0.01 ZRO base-asset commission.
- Variant B: 0.02 USDT quote-asset commission.

**Expected output:**

- Variant A adds 9.99 ZRO net recovery quantity; quote cost remains the actual 20 USDT execution cost.
- Variant B adds 10 ZRO net base quantity and 20.02 USDT actual quote cost.
- Multiple fills accumulate exact net quantity, cost, and execution VWAP.
- Only fills attributed to the correct RS strategy, Position, cycle, order, and market affect RS accounting.

**Must not happen:**

- Do not account unfilled requested quantity.
- Do not silently treat third-asset commission with missing/ambiguous quote valuation as zero.
- Do not attribute a CG, external, or wrong-Position fill to RS.

**Subcases:**

- Full and partial BUY fills.
- Multiple fills at equal and different prices.
- Base, quote, zero, and multiple commission records.
- Duplicate identical fill and conflicting same-ID fill.
- Fill before acknowledgement and acknowledgement before fill.
- Unknown BUY submission outcome and an active/unknown BUY blocking the next BUY.
- Investment cap below, exactly at, and above the boundary.

**Implementation:**

- `apps/harvester/src/domain/strategies/recovery-seller/` accounting modules.
- RS accounting workflow and shared Portfolio/Fill ownership boundaries.

**Automated tests:** No new RS scenario test accepted yet. Existing RS tests are deliberately not credited under #1780.

### RS-003 — A mixed recovery/legacy SELL uses the additive legacy slice

**Status:** MISSING — fresh scenario test required.

**Behavior:** A cycle SELL combines the actual net recovery quantity with the configured legacy `sellQuantity`. The legacy slice is additive; it is not a cap or the total order quantity.

**Given / preconditions:**

- The cycle has a reconciled net recovery allocation.
- The configured legacy slice is explicitly authorized and verified available in Spot.
- Account-wide reservations, market filters, and independent profitability gates permit the action.

**Input / example:**

- Net recovery quantity: 400 DOGE.
- Configured `sellQuantity`: 1 DOGE of legacy inventory.
- Verified unreserved Spot quantity is sufficient for both allocations.

**Expected output:**

- The conceptual combined SELL target is 401 DOGE before exchange-step rounding and any fee-reserve gross-up.
- The order plan and final fill allocation must identify which quantity belongs to recovery and which belongs to legacy.
- Actual canonical fills and commissions determine the final quantities/proceeds committed to each allocation.
- The final order remains subject to the independent recovery, legacy, and combined profitability gates and current exchange filters.

**Must not happen:**

- Do not interpret `sellQuantity` as total SELL quantity or a maximum cap.
- Do not assume gross BUY quantity equals net recovery quantity.
- Do not sell unverified or reserved legacy inventory.
- Do not silently round across allocation ownership boundaries.

**Subcases:**

- Full and partial mixed SELL fills.
- Base-, quote-, and supported third-asset commission cases.
- Mixed commission assets.
- Quantity step, tick size, min/max quantity, and min/max notional boundaries.
- Insufficient verified Spot custody.
- Allocation precision ambiguity.

**Implementation:**

- `apps/harvester/src/domain/strategies/recovery-seller/calculate-sell-plan.js`
- `apps/harvester/src/domain/strategies/recovery-seller/mixed-sell-fill-allocation.js`
- `apps/harvester/src/domain/strategies/recovery-seller/mixed-sell-fill-accounting.js`

**Automated tests:** No new RS scenario test accepted yet. Existing RS tests are deliberately not credited under #1780.

### RS-004 — Recovery, legacy, and combined profitability gates are independent

**Status:** MISSING — fresh scenario test required.

**Behavior:** A mixed SELL is eligible only when every independently required profitability gate passes. A profitable allocation cannot subsidize a loss-making allocation.

**Given / preconditions:**

- Recovery and legacy allocations have independent exact cost/proceeds projections.
- Actual fees and commission valuation are available under the approved contract.
- The combined-cycle projection is calculated independently.

**Input / cases:**

- Recovery profitable, legacy loss-making, combined profitable.
- Legacy profitable, recovery loss-making, combined profitable.
- Both allocations individually profitable and combined profitable.
- One or more allocations exactly at or just below its threshold.

**Expected output:**

- Any required failing allocation blocks SELL eligibility, even when combined profit is positive.
- A SELL is eligible only when recovery, applicable legacy, and combined gates all pass.
- Decisions use actual net proceeds and supported fee valuation, not gross order value.

**Must not happen:**

- Do not replace the independent gates with one aggregate profit calculation.
- Do not submit a SELL when any required gate fails.

**Subcases:**

- Equality, just-below, and just-above each configured threshold.
- Maker and taker fee reserve selection.
- Missing fee configuration or unsupported third-asset valuation.
- Exact tick/step rounding and net-proceeds gross-up.

**Implementation:**

- `apps/harvester/src/domain/strategies/recovery-seller/calculate-profitability.js`
- `apps/harvester/src/domain/strategies/recovery-seller/calculate-sell-plan.js`

**Automated tests:** No new RS scenario test accepted yet. Existing RS tests are deliberately not credited under #1780.

### RS-005 — A recovery cycle may submit only one SELL lifecycle

**Status:** MISSING — fresh scenario test required.

**Behavior:** Once the cycle's one SELL identity is recorded, repeated evaluation cannot create another SELL, replacement SELL, continuation SELL, or a new BUY cycle while the outcome remains active or unresolved.

**Given / preconditions:**

- A stable cycle ID and recovery Position ID exist.
- The SELL intent has crossed the approved durable submission boundary and has one recorded identity.

**Input / cases:**

- Re-evaluate while SELL is open.
- Deliver partial fills.
- End with FILLED, CANCELED, REJECTED, EXPIRED, or unknown outcome.
- Repeat the terminal event.

**Expected output:**

- Repeated evaluation while active returns the allowed wait/reconcile behavior for the original order.
- The reservation remains held until successful terminal mixed-SELL accounting.
- A fully filled and reconciled SELL closes the cycle only when all accounting and profitability gates pass.
- A terminal partial/canceled/rejected/expired SELL leaves the cycle unresolved and triggers the specified STOP behavior.
- Duplicate terminal delivery does not close or release the cycle twice.

**Must not happen:**

- No second SELL or new BUY cycle while the first SELL is active or unresolved.
- No blind retry or replacement after an unknown outcome.
- No reservation release before successful terminal accounting.

**Subcases:**

- Pending/open repeated evaluation.
- Partial fill followed by terminal cancellation/rejection/expiry.
- Complete fill with incomplete history.
- Duplicate and conflicting terminal facts.
- Successful terminal full fill with complete accounting.

**Implementation:**

- RS accounting workflow and cycle reservation modules under `apps/harvester/src/domain/strategies/recovery-seller/`.
- Shared engine order submission and terminal reconciliation orchestration.

**Automated tests:** No new RS scenario test accepted yet. Existing RS tests are deliberately not credited under #1780.

### RS-006 — Mixed SELL accounting commits both allocations atomically

**Status:** MISSING — fresh scenario test required.

**Behavior:** Complete terminal mixed-SELL history is reconciled before recovery and legacy projections are committed. Both projections commit together or neither does.

**Given / preconditions:**

- The SELL has a canonical order identity.
- The complete distinct REST/stream fill set is available.
- Actual commission facts and allocation inputs are valid.

**Input / cases:**

- A mixed SELL has multiple streamed and REST-reported fills.
- The same canonical fill appears through both channels.
- One projection commit is forced to fail.
- A conflicting replay changes execution or allocation facts.

**Expected output:**

- The complete canonical fill set is reconciled to the terminal order quantity.
- Recovery and legacy projections commit atomically.
- Identical replay is an immutable no-op.
- A conflicting replay is rejected.
- A failed/incomplete commit preserves both prior projections and retains the cycle reservation while latching the required STOP.

**Must not happen:**

- Do not apply streamed partial RS SELL fills as standalone Conservative fills.
- Do not partially mutate one allocation when the other fails.
- Do not release the reservation before both projections commit.

**Subcases:**

- Stream-before-REST and REST-before-stream.
- Duplicate fill, conflicting duplicate, missing history, and incomplete quantity.
- Base/quote/mixed commission allocation.
- Failure before commit, during commit, and after successful commit before registry publication where covered by the contract.

**Implementation:**

- `apps/harvester/src/domain/strategies/recovery-seller/mixed-sell-fill-reconciliation.js`
- `apps/harvester/src/domain/strategies/recovery-seller/mixed-sell-fill-accounting.js`
- `apps/harvester/src/use-cases/record-recovery-seller-mixed-sell-reconciled.js`
- Shared Portfolio and order-event workflow boundaries.

**Automated tests:** No new RS scenario test accepted yet. Existing RS tests are deliberately not credited under #1780.

### RS-007 — Unknown submission outcome preserves identity and forbids blind retry

**Status:** MISSING — fresh scenario test required.

**Behavior:** A timeout or disconnect after a state-changing request may mean the exchange accepted it. RS must retain the original order identity and reservation and reconcile that order without submitting a duplicate.

**Given / preconditions:**

- A durable order intent and client order identity exist.
- The broker request has been dispatched.
- The acknowledgement is lost or its outcome is unknown.

**Input / example:**

- Submit the cycle SELL with client order ID `rs-cycle-001-sell`.
- The transport times out before a definitive acknowledgement.
- The evaluator runs again before canonical order history is available.

**Expected output:**

- The original client identity and reservation remain attached to the order lifecycle.
- RS latches the required global STOP and returns the non-trading reconciliation path for the original order.
- Existing order/fill facts continue to be reconciled.
- No new trading action is authorized.

**Must not happen:**

- Do not blindly resubmit the SELL.
- Do not create a new client order ID to evade the unknown result.
- Do not release the original reservation because the response was lost.

**Subcases:**

- Unknown BUY submission outcome.
- Unknown SELL submission outcome.
- Order lookup not found or lookup failure.
- Later authoritative order/fill evidence.
- Conflicting order identity or unsupported exchange status.

**Implementation:**

- RS action authorizer, order submitter, and shared engine order reconciliation boundary.

**Automated tests:** No new RS scenario test accepted yet. Existing RS tests are deliberately not credited under #1780.

### RS-008 — CG and RS share account availability without sharing strategy ownership

**Status:** MISSING — fresh scenario test required.

**Behavior:** CG and RS may operate concurrently, including on the same market, while maintaining separate strategy Positions, order ownership, and budgets. Physical quote/base availability and reservations remain account-wide.

**Given / preconditions:**

- One provider account has both strategies enabled for supported markets.
- Each strategy has its own configured pair and budget.
- Both strategies use the shared Portfolio, order registry, and account-level reservation coordinator.

**Input / example:**

- CG and RS each request a BUY using the same account quote balance.
- Alternatively, both request SELL against the same market's base asset.
- Repeat with the strategies on the same market and on different markets.

**Expected output:**

- Account-level allocation serializes competing requests and prevents double-spend or oversell.
- Each order and fill remains attributed to exactly one strategy and Position.
- Shared Portfolio custody is represented once; strategy Positions do not duplicate wallet balance.
- Each strategy remains within its own budget.

**Must not happen:**

- Do not borrow another strategy's unused budget.
- Do not allocate one fill to two Positions.
- Do not treat same-market subscription deduplication as shared strategy ownership.

**Subcases:**

- Same market and different markets.
- Concurrent BUY quote reservations.
- Concurrent SELL base reservations.
- Same raw trade ID across markets/accounts where identity scope differs.
- One strategy paused/STOPped while the other continues only within its own approved policy and account safety constraints.

**Implementation:**

- `apps/harvester/src/domain/orders/allocate-order-commitments.js`
- `apps/harvester/src/application/providers/account-runtime-registry.js`
- Shared engine transition queue and provider/strategy routing.

**Automated tests:** No new RS scenario test accepted yet. Existing RS tests are deliberately not credited under #1780.

### RS-009 — STOP is terminal, visible, and does not suppress reconciliation

**Status:** MISSING — fresh scenario test required.

**Behavior:** Unexpected, contradictory, unsupported, or unmodeled conditions latch global STOP. STOP prevents new trading actions but does not abandon reconciliation of orders already submitted or confirmed fills.

**Given / preconditions:**

- RS runtime is active.
- A covered lifecycle boundary receives invalid or contradictory evidence.

**Input / cases:**

- An invalid filter, missing custody evidence, conflicting fill, failed accounting commit, or unknown order outcome occurs.
- Later market data appears healthy.
- An operator queries STOP status.

**Expected output:**

- New BUY/SELL/replacement/retry actions remain blocked.
- STOP remains latched after later healthy observations.
- Existing submitted orders and confirmed fills remain eligible for non-trading reconciliation.
- Operator status is read-only.

**Must not happen:**

- No automatic or operator clear/reset/unpause/resume.
- No loss of confirmed fills, commissions, order ownership, or reservations.
- No new trading action while STOP is latched.

**Subcases:**

- STOP after invalid input and after external submission.
- Reconciliation continues while STOP is active.
- Repeated STOP evidence preserves the first authoritative reason.
- Operator query cannot mutate STOP.

**Implementation:**

- RS STOP decision and durable STOP workflow.
- Shared engine order-event and reconciliation boundary.
- CC-operator read-only status facade.

**Automated tests:** No new RS scenario test accepted yet. Existing RS tests are deliberately not credited under #1780.

### RS-010 — Unsupported restart and fee-valuation capabilities remain blocked

**Status:** BLOCKED / UNSUPPORTED — do not invent a runtime path.

**Behavior:** Process restart/replay restoration and third-asset commission conversion without an authoritative execution-time quote source are not accepted capabilities in the current RS contract.

**Given / preconditions:**

- A process restart would require reconstructing RS cycle, reservation, STOP, and order/fill ownership.
- A commission is charged in a third asset without an authoritative quote value/rate/timestamp.

**Input / cases:**

- Restart at each interruption point in a cycle.
- A third-asset fee is observed with no supported valuation evidence.

**Expected output:**

- Restart/replay remains outside current acceptance and must not be claimed as supported.
- Missing or ambiguous third-asset fee valuation fails closed; it is not treated as zero.
- The catalog retains these gaps until a separate approved contract and implementation exist.

**Must not happen:**

- Do not add automatic restart restoration, STOP clearing, or resume behavior through tests.
- Do not fabricate fee conversion from a current market price or an unverified source.

**Subcases:**

- Restart after durable intent, broker acceptance, partial fill, terminal reconciliation, projection commit, and STOP.
- Third-asset commission with missing, stale, ambiguous, or conflicting valuation source.

**Implementation:** Future work only after explicit product/architecture decisions.

**Automated tests:** Not applicable as supported behavior today. Any fail-closed test for the existing boundary must be tracked separately and must not imply that the deferred capability is implemented.

---

## Shared packages — initial discovery entries

The package entries below make the repository-wide scope visible, but their exact test-case mapping is not yet complete. They are not marked VERIFIED. Expand them into the same Given / Input / Expected output / Subcases format as the source and test suites are reviewed.

### BRK-001 — Unknown broker mutation outcome is not treated as failure

**Status:** SPECIFIED — exact test mapping pending.

**Behavior:** A timeout or connection loss during a state-changing broker request may occur after the exchange accepted the request. The caller must treat the result as unknown and reconcile the original order identity.

**Input:** A state-changing request is dispatched; the transport loses the response before a definitive exchange result is received.

**Expected output:** The mutation outcome is `OUTCOME_UNKNOWN` where the provider contract can establish dispatch uncertainty. The caller looks up and reconciles the original order identity and actual fills before any further action.

**Must not happen:** No blind order or cancellation retry; no interpretation of a failed lookup as permission to retry.

**Subcases:** Request not sent; exchange rejection; confirmed success; timeout after dispatch; disconnect; not-found lookup; malformed order history.

**Implementation:** `packages/brokers/src/` provider mutation and canonical order lookup boundaries.

**Automated tests:** Exact files and named cases not yet mapped. Start from [Broker API contract](../../packages/brokers/BROKER_API.md) and [Brokers package README](../../packages/brokers/README.md).

### DB-001 — A failed database transaction leaves no partial write

**Status:** SPECIFIED — exact test mapping pending.

**Behavior:** A synchronous transaction either commits its complete write set or rolls it back. Transaction-scoped handles must not remain usable after the callback ends.

**Input:** A transaction performs multiple writes and then throws; variants retain a transaction handle or attempt an async callback.

**Expected output:** The failed transaction leaves no partial write. Async callbacks are rejected rather than allowing a premature commit. Handles/statements are invalid after commit or rollback.

**Must not happen:** No partial transaction state; no SQL execution through an expired transaction handle.

**Subcases:** Successful commit; thrown callback rollback; nested transaction rejection; async callback rejection; post-transaction handle use; file-backed reconnect persistence; writer lock contention.

**Implementation:** `packages/db/src/` transaction boundary and SQLite provider.

**Automated tests:** Exact files and named cases not yet mapped. See [provider-neutral CRUD decision](../../packages/db/docs/decisions/0001-provider-neutral-record-crud-api.md).

### EVT-001 — Publish acceptance is distinct from subscriber completion

**Status:** SPECIFIED — exact test mapping pending.

**Behavior:** Event publication admits work to subscribers; it does not mean all asynchronous handlers have completed. The explicit flush boundary waits for pending deliveries, including transitively published events.

**Input:** Publish an event to multiple subscribers, including a slow or failing subscriber; invoke flush; close while work is pending.

**Expected output:** One subscriber failure is isolated from unrelated subscribers. Pending work remains bounded and observable. Flush waits for accepted deliveries under the documented contract. Close drains or reports its documented timeout/failure outcome.

**Must not happen:** Do not treat publish return as durable completion. Do not silently drop critical events or leave pending work after close.

**Subcases:** No subscribers; throwing/rejecting handler; slow handler; re-entrant publish; queue capacity; unsubscribe during delivery; close while pending; repeated close.

**Implementation:** `packages/event-bus/src/event-bus.js` and delivery/lifecycle helpers.

**Automated tests:** Exact files and named cases not yet mapped. See [Event Bus roadmap](../../packages/event-bus/ROADMAP.md).

### JRN-001 — Journal flush is the durability boundary

**Status:** SPECIFIED — exact test mapping pending.

**Behavior:** Recording an event queues an append; a successful flush waits for event delivery and queued writes, then syncs the backing store. A record acknowledgement alone is not proof of durability.

**Input:** Record ordered events, then flush. Variants inject a partial write or sync failure and retry flush on the same Journal instance.

**Expected output:** Records retain append order. A successful sync is reported as durable. A failed sync is reported as non-durable; a later successful flush can durably preserve the completed write and retry record in order.

**Must not happen:** Do not claim `record()` is durable before flush succeeds. Do not reorder or silently lose completed writes after a transient sync failure.

**Subcases:** Ordered append; malformed record; partial write; sync failure; retry flush; close/flush ordering; cleanup after failure.

**Implementation:** `packages/journal/src/journal.js`, filesystem store adapter, and record reader/validator.

**Automated tests:** Exact files and named cases not yet mapped. See [Journal roadmap](../../packages/journal/ROADMAP.md).

### NTF-001 — Notification delivery remains bounded and failure-isolated

**Status:** SPECIFIED — exact test mapping pending.

**Behavior:** Supported notifications are validated, queued within configured bounds, and delivered through the transport. One malformed event or failed request must not corrupt queue state or leak credentials.

**Input:** Publish supported and malformed events, saturate the delivery queue, then inject a transport error and close.

**Expected output:** Unsupported/malformed events are rejected safely; queue overflow is reported; delivery failures are classified and logged with redacted diagnostics; later valid deliveries and orderly shutdown behave according to the package contract.

**Must not happen:** No unbounded queue growth, credential leakage, or unrecoverable queue state after one failed delivery.

**Subcases:** Missing/partial credentials; setup failure; malformed payload; queue saturation; timeout/HTTP/API failure; redaction; partial subscription setup failure; shutdown.

**Implementation:** `packages/notifiers/src/telegram/` formatter, subscriber, delivery queue, and transport boundary.

**Automated tests:** Exact files and named cases not yet mapped. See [Notifiers roadmap](../../packages/notifiers/ROADMAP.md).

### ENT-001 — Financial values preserve exact decimal and asset identity

**Status:** SPECIFIED — exact test mapping pending.

**Behavior:** Financial quantities, prices, fees, and increments use exact decimal representations and explicit asset/market identity. Invalid or ambiguous values fail at the domain boundary.

**Input:** Construct and compare values using decimal strings, including values that cannot be represented exactly as binary floating point; provide malformed, negative, zero, or mismatched-asset inputs where disallowed.

**Expected output:** Valid values preserve their canonical exact representation and asset identity. Invalid construction or incompatible operations fail according to the public entity contract.

**Must not happen:** No binary floating-point rounding in financial expectations; no inference of asset identity from an exchange symbol alone.

**Subcases:** Normalization; equality; arithmetic boundaries; invalid decimal strings; zero/negative constraints; asset mismatch; order/fill identity.

**Implementation:** `packages/entities/src/` value objects, market, order, fill, and commission contracts.

**Automated tests:** Exact files and named cases not yet mapped. See [Entities roadmap](../../packages/entities/ROADMAP.md).

### UTL-001 — Shared decimal helpers produce exact, deterministic results

**Status:** SPECIFIED — exact test mapping pending.

**Behavior:** Shared decimal arithmetic and scaling helpers return exact deterministic values for valid decimal-string inputs and reject unsupported values rather than silently coercing them.

**Input:** Multiply, compare, rescale, round to a step, and calculate percentage values using decimal strings at ordinary and precision-boundary values.

**Expected output:** Results match independently calculated exact decimal expectations; rounding direction is explicit and stable.

**Must not happen:** No floating-point approximation, hidden input coercion, or accidental change of rounding direction.

**Subcases:** Positive/negative values where supported; zero; differing scales; repeating-looking decimal fractions; tick/step rounding up/down; malformed values; maximum supported precision.

**Implementation:** `packages/utils/src/decimal.js` and percentage helpers.

**Automated tests:** Exact files and named cases not yet mapped. See [Utils roadmap](../../packages/utils/ROADMAP.md).

### IND-001 — Indicator calculations reject discontinuous or insufficient candle history

**Status:** SPECIFIED — exact test mapping pending.

**Behavior:** Exchange-neutral indicators operate on normalized caller-supplied candle data. They must reject malformed, unsorted, duplicate, discontinuous, unfinished, or insufficient history according to the indicator contract.

**Input:** Supply valid contiguous candles, then vary order, timestamps, gaps, duplicate candles, missing fields, invalid prices, and insufficient lookback.

**Expected output:** Valid history produces the documented indicator value after its warm-up period. Invalid or incomplete history produces the documented validation/failure result rather than a misleading numeric value.

**Must not happen:** Do not calculate from silently skipped gaps, unsorted candles, or invalid reference values.

**Subcases:** ATR/NATR warm-up; UTC alignment; contiguous series; duplicate/out-of-order candles; invalid OHLC; zero/invalid close; unfinished candle; insufficient history.

**Implementation:** `packages/indicators/src/` candle normalization and indicator calculations.

**Automated tests:** Exact files and named cases not yet mapped. See [Indicators package](../../packages/indicators/README.md).

---

## Catalog maintenance

- Add a scenario when introducing a meaningful new business behavior, changing a public/domain contract, fixing a correctness defect, or adding a critical lifecycle/safety guarantee.
- Update the existing scenario when its expected behavior changes; do not create a second ID for the same behavior.
- Add new subcases when a boundary, failure mode, event ordering, concurrency condition, or safety invariant is discovered.
- Link the exact production owner and named test cases. If the test mapping is not known or not inspected, say so.
- Move a scenario to VERIFIED only with reviewed assertions and exact-head test evidence. Record the PR/commit or workflow link and the exact SHA.
- Keep unresolved requirements BLOCKED or UNSUPPORTED. Do not turn assumptions, existing test names, or historical CI results into proof.
- Keep domain-specific matrices and detailed evidence in their owning issues/specifications when that is their established home. Link them here instead of copying their full checklists.

## Related canonical sources

- [Engineering standards — testing requirements](../../ENGINEERING_STANDARDS.md)
- [Shared Domain Scenario Testing methodology — issue #1779](https://github.com/45s/coinzilla/issues/1779)
- [Recovery Seller from-scratch scenario matrix — issue #1780](https://github.com/45s/coinzilla/issues/1780)
- [Harvester domain test inventory](../../apps/harvester/docs/domain/DOMAIN_TEST_INVENTORY.md)
- [Harvester reliability acceptance and critical behavior inventory — issue #1639](https://github.com/45s/coinzilla/issues/1639)
