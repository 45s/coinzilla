---
title: Recovery Seller Domain Specification
status: draft
type: domain-specification
owner: harvester
created: 2026-11-14
---

# Recovery Seller (RS) — Domain Specification

**Status: DRAFT — first-implementation owner decisions are recorded; remaining work is implementation and verification.**

**Authority:** This draft becomes the canonical RS contract after formal acceptance. Until then it records the agreed direction, hard safety invariants, accounting boundaries, and remaining implementation requirements. It does not amend the [Conservative Domain Specification](./CONSERVATIVE_DOMAIN_SPECIFICATION.md).

**Implementation status:** The shared Portfolio/multi-Position foundation is merged in [PR #1118](https://github.com/45s/coinzilla/pull/1118); logical legacy-position accounting is merged in [PR #1131](https://github.com/45s/coinzilla/pull/1131); verified Spot snapshot/reservation plumbing is merged in [PR #1137](https://github.com/45s/coinzilla/pull/1137); immutable order ownership is merged in [PR #1144](https://github.com/45s/coinzilla/pull/1144); and the pure verified legacy Spot allocation calculation is merged in [PR #1152](https://github.com/45s/coinzilla/pull/1152). The verified source remains injectable with an empty default and does not wire RS execution. Canonical-Fill-referenced mixed SELL allocation metadata is merged in [PR #1153](https://github.com/45s/coinzilla/pull/1153). Immutable partial-fill staging, terminal reconciliation, recovery-side Portfolio allocation and legacy realized-P&L projection are merged in [PR #1203](https://github.com/45s/coinzilla/pull/1203). Draft [PR #1212](https://github.com/45s/coinzilla/pull/1212) adds one immutable cross-projection commit after complete terminal reconciliation and extends the shared account-snapshot/allocator path to include verified base inventory and signed quote cash flow tracked outside Portfolio. The updated legacy Position feeds the existing verified Spot-allocation calculation; no configured legacy quantity is inserted into Portfolio. The remaining RS-2b work is reservation release/custody transition integration and exact-once verification around the shared allocator. The repository-standard SystemCustomError base is tracked separately in [issue #1208](https://github.com/45s/coinzilla/issues/1208); new RS work must follow that shared error contract when the Utilities capability is available. RS-3 profitability gates, RS policy, registration and runtime execution remain unimplemented. The remaining RS-specific domain accounting and later policy/integration phases are tracked in [issue #1127](https://github.com/45s/coinzilla/issues/1127). The owner has approved the sellQuantity plus legacyPosition.invested / legacyPosition.quantity input shape. RS calculates the legacy average once from the original values; that average remains fixed after disposals. This is a product-level input decision, not an executable runtime schema. Owner decisions for the first implementation are recorded; remaining blockers are engineering/accounting implementation and verification, not additional product-policy questions for the opening-inventory boundary. This draft authorizes no trading or exchange operations.

The phased implementation plan is maintained in the [Recovery Seller Implementation Roadmap](./recovery-seller-implementation-roadmap.md).

## 1. Purpose and vocabulary

Recovery Seller is an independent strategy intended to reduce an explicitly authorized pre-existing spot position through repeated recovery cycles. Each conceptual cycle acquires a new recovery tranche, then sells that tranche together with a configured quantity of legacy inventory when all approved profitability and safety gates pass.

- **Recovery inventory:** net base quantity acquired by BUY fills attributed to the current RS cycle.
- **Legacy inventory:** pre-existing base quantity explicitly authorized for RS liquidation before that cycle. It is not created by that cycle's BUY fills.
- **Cycle SELL:** SELL execution(s) intended to dispose of recovery inventory and an additional legacy quantity, subject to the final approved quantity and profitability rules.
- **sellQuantity:** configured per-pair base-asset quantity of legacy inventory added to the recovery tranche in each cycle SELL. It is an additive legacy slice, not the total SELL quantity, not a maximum cap, and not CG's retained `keepQuantity`. The conceptual SELL target is the cycle's actual net recovery quantity plus `sellQuantity`.

Illustrative examples only; these are not approved trading defaults:

| Market | New BUY tranche | sellQuantity | Conceptual combined SELL |
|---|---:|---:|---:|
| DOGEUSDT | 400 DOGE | 1 DOGE | 401 DOGE |
| ZROUSDT | 10 ZRO | 0.01 ZRO | 10.01 ZRO |
| LINKUSDT | 2 LINK | 0.01 LINK | 2.01 LINK |

No independent fixed 1% market-rise wait is required merely to release the configured legacy quantity. This does not relax the requirement that every SELL satisfy all approved profitability gates.

## 2. Authority and responsibility boundaries

- RS owns strategy decisions, cycle attribution, legacy authorization state, and RS-specific risk policy.
- The shared Harvester Trading Engine owns serialized evaluation, order submission/cancellation, broker interaction, order identity, reservations, reconciliation, and execution safety.
- The broker adapter supplies canonical orders, canonical fills, actual commission facts, and current exchange filters. RS domain code must not import Binance SDK types or raw exchange messages.
- The shared Portfolio is the authoritative actual-accounting aggregate, but it is not limited to one Position per market. It may contain multiple independent Positions for the same market, including Positions owned by different strategies. RS must not create duplicate representations of the same strategy Position or mutate Portfolio outside established fill/accounting workflows.
- Actual holdings change only from confirmed canonical fills. A price, order intent, acknowledgement, cancellation request, or operator authorization is not an execution.
- RS is independent of CG_coinGrabber. It must not change Conservative behavior or its canonical specification.

## 3. Legacy inventory and authorization

Legacy inventory is a specifically identified quantity of a market's base asset that existed before RS was authorized to manage it. It must not be inferred from an exchange free balance, Portfolio total/free quantity, manual/external order, prior process state, or unowned execution.

Hard invariants:

1. Without explicit authorization, RS-authorized legacy quantity is zero.
2. Authorization is market-scoped and denominated in the canonical base asset.
3. RS never silently adopts the whole wallet balance or an external/manual order.
4. Authorized quantity must be bounded by independently verified, unreserved, actually available base inventory before submission.
5. Authorization cannot override profitability, exchange filters, reservations, risk limits, or reconciliation gates.
6. Revoking/reducing authorization cannot erase fills, reverse accounting, or pretend a submitted order did not exist.

**Configured legacy position and average cost (agreed direction):**

The operator supplies the original aggregate quote investment and the corresponding original base quantity. RS calculates the average historical acquisition cost; the operator does not need to calculate or enter an average price.

Example for ZROUSDT:

- `legacyPosition.invested = 100` USDT
- `legacyPosition.quantity = 50` ZRO
- RS-calculated average historical cost = `100 / 50 = 2` USDT per ZRO.
- `sellQuantity = 0.01` ZRO per successfully completed cycle.

The names above describe the proposed configuration shape, not a runtime schema. The existing recovery-tranche `investment` setting is separate and must not be confused with the legacy position's historical `invested` amount. The configured legacy invested amount and original quantity establish the aggregate historical basis; they do not assert that the full quantity is currently in the Spot wallet.

**Spot custody is separate from logical legacy ownership and cost basis.** The operator may keep only 0.5 ZRO in Spot to support 50 cycles of 0.01 ZRO legacy releases and hold/transfer the remaining 49.5 ZRO to EARN. RS retains the configured logical legacy position and its $2 average cost basis; it must not infer that only 0.5 ZRO was originally acquired merely because that is the amount currently in Spot. Conversely, EARN-held quantity is not Spot-available inventory and must never be counted as immediately sellable or used to satisfy an exchange order's balance check. Each cycle may consume only the configured legacy slice that is actually available and unreserved in Spot, alongside its recovery inventory. Further cycles requiring legacy quantity must wait until the required quantity is again available in Spot (for example, after the operator redeems/transfers it from EARN).

The original configured quantity and invested amount establish one fixed original average cost; remaining logical legacy quantity, Spot-available quantity, EARN/externally held quantity, and active reservations are distinct facts. A transfer between Spot and EARN changes custody/availability, not historical cost basis or the original acquisition quantity. RS must not assume EARN balances are observable through the Spot broker or silently claim custody of them.

**Decision recorded — authorization model: explicit operator authorization (Question 1, accepted).**

RS must not infer authorization from a wallet balance, Portfolio quantity, deposit, manual/external order, or historical process state. The operator must explicitly authorize the market's pre-existing legacy position before RS may manage any legacy quantity. The configured original quote investment and original base quantity are historical-basis inputs; they do not by themselves establish Spot custody or immediately sellable quantity. Authorization is permission, not proof of custody, Portfolio accounting, or available balance. Actual Spot availability and reservations must be independently verified before each SELL. EARN/off-Spot inventory remains unavailable for Spot execution until returned and authoritatively reconciled. No authorization may bypass profitability, exchange filters, risk limits, or reconciliation gates.

**Decision recorded — legacy evidence/configuration (Question 2, accepted):** the operator will declare the legacy position directly in configuration by supplying its original aggregate quote investment and original base quantity. No exchange trade-history import or other historical proof is required. These configured values are the operator's declared historical basis, not proof of current ownership, Spot custody, Portfolio quantity, or sellable balance. Current Spot availability and reservations must still be independently verified before execution.

**Agreed configuration/authorization workflow:** the operator manually enters the legacy position's original quote investment and original base quantity in the RS configuration before starting the application. This explicit configuration is the operator's authorization; RS does not need an exchange trade-history import, a runtime authorization UI, or a separate approval step. The configuration is loaded at application startup. These values establish declared historical basis and authorization only—not proof of current Spot custody, Portfolio quantity, or sellable balance. Current Spot availability and reservations must still be authoritatively verified before every SELL. Invalid/missing configuration must fail closed. Advanced runtime authorization editing, revocation workflows, expiry, and durable authorization lifecycle are deferred under FITDIB; do not invent them for the first implementation.

## 4. Attribution and shared Portfolio accounting

### 4.1 Non-negotiable accounting invariants

Harvester has one shared Portfolio per account, with support for multiple independent Positions per market. A Position is an independently owned accounting/lifecycle unit (for example, a strategy-owned position or separately tracked acquisition exposure), not a wallet or custody balance. Portfolio.applyFill applies each canonical fill exactly once to the Position identified by canonical order ownership and the application's attribution rules. updateTradingAccounting currently coordinates the Portfolio and Conservative RecoveryLedger projections; RS integration must preserve CG behavior while adding an explicit RS attribution/Position workflow. Position quantities, quote cash flow, and spent basis are fill-driven. Applied-fill IDs and fingerprints prevent duplicate or conflicting executions.

RS must preserve these facts:

- Multiple independent Positions may exist for the same market. Each Position has a stable caller-assigned `positionId`, canonical `marketId`, and explicit `strategyId` owner; a strategy may own more than one Position when its domain requires it.
- Every canonical fill changes actual Portfolio accounting exactly once, using actual execution and commission facts, and is attributed to the one `positionId`/`strategyId` resolved from its originating order ownership.
- RS-owned Positions and attribution are part of the shared Portfolio accounting model; they do not create a second wallet, duplicate custody, or double-apply Portfolio accounting.
- RS attribution references the same canonical market/order/fill identities used by shared broker and Portfolio workflows.
- Portfolio and RS attribution commit as one logical accounting transition. If either rejects a fill or identity, neither projection advances.
- Identical duplicate fills for the same Position owner are no-ops; changed execution facts or a different `positionId`/`strategyId` under the same canonical fill ID fail closed.
- No synthetic BUY Fill may be fabricated to seed legacy inventory or represent operator authorization.

### 4.2 Required attribution facts

The RS attribution projection must distinguish:

- authorized legacy quantity and its approved historical cost-basis evidence;
- recovery BUY quantity and quote cost attributed to each cycle;
- actual base, quote, and third-asset commissions for each canonical fill;
- recovery and legacy quantities consumed by confirmed SELL fills;
- active order reservations and unresolved/unknown order quantities;
- remaining authorized legacy quantity and unresolved residuals; the original legacy average cost remains fixed.

It must reference canonical Fill IDs and retain fill-facts fingerprints. A single execution must never be represented as two Portfolio fills.

### 4.3 Portfolio integration blocker

The current Portfolio is fill-driven and has no general opening-balance/manual-inventory seeding operation. A SELL containing legacy units not represented in an appropriately owned Position could make that Position's base quantity inconsistent or negative if applied through the existing accounting path unchanged. Multiple Positions do not remove this opening-inventory accounting blocker.

Therefore, **RS must not submit a SELL consuming legacy inventory until a safe accounting design represents that authorized opening inventory consistently within the shared multi-Position Portfolio and exact-once fill accounting.** An RS attribution ledger alone does not create a sellable Portfolio balance or authorize an oversell.

**Implementation requirement (not an owner question):** represent the manually configured legacy opening inventory and its historical basis within the appropriate RS-owned accounting model and shared Portfolio without synthetic fills, unverified wallet seeding, duplicate custody, or bypassing Portfolio. The operator fills `legacyPosition.invested` and `legacyPosition.quantity` manually before application startup; RS calculates average cost. Actual Spot holdings and off-Spot custody remain separately verified facts. The implementation must define a safe opening-inventory accounting boundary while preserving exact-once canonical fill accounting.

**Confirmed implementation blocker — opening inventory must not be confused with Spot custody:** the current `Position.baseQuantity` is fill-derived active inventory and `Position.freeBaseQuantity` is retained inventory; `Position.totalBaseQuantity` is their sum. `Portfolio.getTotalBaseQuantity()`, account-snapshot baselines, recovered-account audits, and shared Trading Engine balance/commitment calculations consume that total as tracked actual Spot inventory. Seeding either bucket with the operator-configured original legacy quantity would therefore assert unverified custody, inflate shared sellable/tracked balance, and corrupt snapshot-relative reconciliation. Creating a separate legacy Position does not avoid this because Portfolio aggregates every Position.

The opposite shortcut is also unsafe: keeping the operator-declared legacy quantity outside the Position leaves the current `calculatePositionFill()` SELL path subtracting from a fill-derived Position quantity that may not contain the legacy slice; it rejects a negative result. The canonical Fill carries execution facts and Portfolio ownership, but no explicit allocation identifying how much of a mixed SELL consumed recovery versus legacy inventory. An RS-only counter cannot make the shared Portfolio SELL transition valid or prove that the legacy quantity was decremented exactly once.

The first safe boundary therefore needs two distinct facts: (1) operator-declared legacy authorization and fixed historical basis, which do not establish custody; and (2) an independently verified, account-wide Spot custody allocation, which must respect other strategy Positions and all active reservations. A canonical SELL must debit the actual shared Spot allocation. Its RS accounting transition must also receive explicit, validated legacy/recovery allocation metadata tied to the canonical Fill ID and originating order ownership, so the legacy quantity is decremented exactly once. Keep the canonical Fill as exchange-neutral execution facts; do not add strategy-specific allocation to broker Fill data or fabricate a BUY Fill. The existing Portfolio has no operation or contract for this split today, so implementation must first add and test that explicit boundary rather than populate existing quantity buckets from configuration or an unverified wallet snapshot. This is an implementation blocker within RS-2b, not a new owner-policy question.

### 4.4 Proposed accounting boundary — separate facts, one execution

The next implementation slice must introduce an application-owned allocation boundary without changing the exchange-neutral `Fill` contract or pretending that the configured legacy quantity is already in Spot.

1. **Order ownership:** retain immutable Harvester-owned metadata beside the canonical order, keyed by its registered `clientOrderId` and attached `brokerOrderId`. It identifies the originating `strategyId`, `positionId`, and RS cycle/purpose. Do not add these fields to `CanonicalOrder` or `Fill`; do not infer ownership from symbol, side, or a reserved client-ID prefix alone.
2. **Verified Spot allocation:** derive the amount available to RS legacy from the authoritative account snapshot for the canonical base asset, after accounting for every existing Portfolio Position and all account-wide active/in-flight SELL reservations. Cap this by the operator-authorized remaining legacy quantity. A configured legacy quantity, an EARN balance, an unrelated wallet balance, or a stale/unavailable snapshot is never evidence of Spot availability.
3. **Separate SELL allocation:** create immutable Harvester application metadata referencing the original canonical `fill.id` and the resolved order-ownership record. It carries the exact recovery and legacy gross quantities and the allocation of actual base, quote, and third-asset commission/proceeds facts. Its allocations must sum exactly to the canonical Fill facts; it must not construct or persist two synthetic broker Fills.

4. **Single shared custody debit:** the account-level Spot allocation records the full actual base debit (executed base plus actual base commission) once. The Portfolio recovery Position receives only its explicitly allocated recovery share; the RS legacy projection receives only its explicitly allocated legacy share. The updated legacy Position is used to recalculate the separately tracked Spot quantity; never add configured legacy quantity to Portfolio. The same verified additional-base provider must feed both account-snapshot baseline capture and the shared allocator, which applies the current-minus-snapshot delta alongside the Portfolio base delta. Net legacy quote proceeds are included in the shared quote-cash-flow baseline and current allocator delta, not legacy historical cost basis or realized profit.
5. **Exact-once reconciliation:** key allocation identity and duplicate detection by canonical Fill ID plus immutable allocation fingerprint. Stage each partial fill against its originating order/cycle. Do not commit the cycle's legacy decrement until complete terminal order/fill reconciliation proves the aggregate execution quantity and all allocation facts. Replays are no-ops only when both canonical facts and allocation metadata are identical; conflicting or missing attribution fails closed.
6. **Independent economics:** calculate recovery-tranche net proceeds/profit and legacy net proceeds against the fixed original legacy average cost from their own allocated quantities and actual fees. A profitable recovery share cannot subsidize a legacy loss. Missing/incomplete commission facts or third-asset quote valuation reject the whole accounting transition before any projection commits.
7. **Central reservation gate:** reserve the full mixed SELL quantity against shared exchange Spot availability before broker submission, while separately preventing the same recovery or legacy slice from being reserved by another order. Release only the unfilled reservation after authoritative terminal reconciliation.

A standalone legacy-only SELL is not part of the current RS cycle contract. While legacy remains, a cycle SELL contains the recovery tranche plus its permitted legacy slice; once legacy is exhausted, subsequent cycles are recovery-only. The shared allocator remains generic, but RS policy must reject a legacy-only action.

The shared snapshot/allocator plumbing is merged in PR #1137. The pure verified legacy Spot allocation calculation is merged in PR #1152: it aggregates every Portfolio Position by canonical base-asset ID, subtracts that total from the authoritative Spot account total, and caps the remainder at original/remaining operator authorization. Missing authorized balances and account custody below aggregate Portfolio quantity fail closed. The calculation remains outside Portfolio and injectable only, with an empty default; active/in-flight reservations remain separately reconciled by the shared allocator. It does not infer EARN/off-Spot quantity or adopt unrelated wallet assets, and it does not enable RS runtime execution.

The intended application flow is:

```mermaid
flowchart TD
  A[Canonical SELL Fill + registered order] --> B[Resolve immutable order ownership]
  B --> C[Verify account-wide Spot allocation and reservations]
  C --> D[Validate one Fill allocation by canonical Fill ID]
  D --> E{All quantities, fees and ownership reconcile?}
  E -->|No| X[Fail closed; pause affected market]
  E -->|Yes| F[Stage full shared custody debit]
  F --> G[Stage recovery Position share]
  F --> H[Stage legacy accounting share]
  G --> I[Terminal order/fill reconciliation]
  H --> I
  I --> J{Cycle complete and both profit gates pass?}
  J -->|No| X
  J -->|Yes| K[Commit projections and decrement legacy once]
```

The diagram describes the proposed RS boundary, not current runtime behavior. Immutable order-ownership metadata is implemented in merged PR #1144, and the pure verified legacy Spot allocation calculation is implemented in merged PR #1152; the latter remains injectable only with an empty default. Merged [PR #1153](https://github.com/45s/coinzilla/pull/1153) adds immutable application metadata bound to the original Fill ID/fingerprint and registered order ownership, carrying exact recovery/legacy gross quantities, quote proceeds and actual commission allocations. Immutable partial-fill staging, terminal exact-once reconciliation, and separate recovery Portfolio and legacy inventory/P&L projections are implemented in merged PR #1203. Draft [PR #1212](https://github.com/45s/coinzilla/pull/1212) adds the immutable terminal-order cross-projection commit and shared account-snapshot/allocator support for externally tracked base inventory and quote cash flow. The updated legacy remainder feeds the existing verified Spot allocation provider; its current base allocation is compared with the account-snapshot baseline, and legacy quantity is never seeded into Portfolio. Reservation release and runtime wiring remain separate work. RS remains non-executable.

## 5. Profitability — SELL ONLY IN PROFIT

**SELL ONLY IN PROFIT** is a hard safety requirement, not merely a cycle-level target. Two different economic questions must be evaluated independently.

### 5.1 Recovery-cycle profitability

Recovery-tranche cost must include gross executed BUY quote notional, actual quote-asset BUY commissions, and reliable quote valuation of actual third-asset BUY commissions. Base-asset BUY commissions reduce net acquired recovery quantity.

Cycle SELL proceeds must use actual confirmed SELL fills, less actual quote-asset SELL commissions and reliably valued third-asset SELL commissions. Base-asset SELL commissions change the base quantity consumed. Configured maker/taker rates are planning estimates only, never substitutes for actual commission facts.

The recovery cycle must satisfy the existing pair-level `minProfit` configuration value, measured as net profit in the pair's quote asset after applicable commissions. RS must reuse this configured threshold rather than introduce a duplicate minimum-profit setting or ask the operator to choose it again. A profitable recovery tranche does not prove that the legacy units in the same exchange order are profitable. Exact proceeds/cost allocation remains a separate implementation requirement.

### 5.2 Legacy historical cost basis

Legacy inventory has a historical acquisition cost separate from the current recovery tranche's BUY cost. A positive cycle result must not silently subsidize a loss on the legacy portion.

**Safety invariant:** the legacy slice must independently pass its profitability gate against the fixed original average acquisition cost and applicable selling costs. Recovery profit cannot subsidize a legacy loss. Keep the calculation simple: use the SELL execution price and actual applicable commission facts; do not introduce proportional re-basing or a changing remaining cost basis.

Illustration: the recovery tranche earns 0.20 USDT net, but the proposed legacy slice would realize a 0.10 USDT loss against its historical basis. The combined headline result is positive; the legacy sale still fails the legacy-profit gate.

**Agreed legacy cost-basis input:** operator supplies aggregate original quote invested and original base quantity; RS calculates average historical cost as invested quote divided by original quantity. Example: 100 USDT / 50 ZRO = 2 USDT per ZRO. The operator does not configure an average price separately. The existing pair-level `minProfit` setting governs minimum net recovery-cycle profit; it does not replace the independent legacy rule that each legacy slice must recover its own historical basis and applicable selling costs. **Simple legacy-quantity rule (owner-approved):** calculate the legacy average acquisition cost once from the configured original invested amount and original quantity. Keep that average fixed; never recalculate it after a disposal. After each successfully completed RS cycle, reduce the remaining legacy quantity by the legacy quantity actually sold (normally one `sellQuantity` lot; use a smaller remaining quantity when the approved smaller-remainder rule applies). Do not recalculate or maintain a changing average/remaining cost basis. Recovery-tranche accounting remains separate. Mixed SELL accounting must identify the legacy quantity actually disposed of so that this fixed legacy quantity can be decremented exactly once. For third-asset commissions, RS must use the same rule as Conservative: accept a commission only when its asset, amount, and reliable quote-currency valuation are available; if any are missing, stale, ambiguous, or unavailable, do not treat the fee as zero—fail closed before committing either accounting projection.

## 6. BUY tranche accumulation and eligibility

The proposal uses orderQuantity as an illustrative recovery BUY tranche size. It does not define whether this means every tranche, the first tranche only, or a maximum.

Hard invariants:

- Only confirmed canonical BUY fills create recovery inventory or recovery cost.
- A submitted/acknowledged BUY creates no inventory; partial fills contribute only actual executed quantity and fees.
- Every BUY commitment counts toward exposure before execution; a fill transfers the corresponding amount from commitment to actual exposure without double counting.
- No duplicate BUY intent while an equivalent BUY is pending, open, partially filled, or unknown.
- An unknown submission retains its commitment and blocks replacement until the original identity is reconciled.
- No new BUY when a risk limit is reached, reconciliation is incomplete, the market is paused, or an order/attribution invariant is unresolved.

**Implementation follows Conservative where applicable:** reuse Conservative's established BUY cadence, tranche sizing/configuration, and pending-order safeguards rather than inventing a second policy. Any RS-specific difference must be justified by the approved RS contract and tested. The existing hard invariants above still apply: only canonical BUY fills create inventory, commitments count before execution, and unknown submissions block replacement until reconciled.

**Owner decision — independent strategy investment allocations:** each strategy has its own configured per-pair investment budget and tracks its own used/committed investment. For the same market, CG spending is charged only to the CG allocation; RS spending is charged only to the RS allocation. One strategy cannot consume unused budget from the other. Example: CG budget 500 USDT with 300 used has 200 available; RS budget 1,000 USDT with 700 used has 300 available. A CG BUY requiring 250 USDT is blocked by CG's 200 remaining even though RS has 300; an RS BUY requiring 250 USDT is allowed. RS reaching its own investment limit stops new RS BUYs while any already-open RS recovery SELL remains alive and unchanged until fill/terminal reconciliation. No cross-strategy budget priority or fairness policy is needed.

**Shared custody remains account-wide:** separate strategy budgets are accounting/risk limits, not separate wallets. Actual exchange free quote/base balances and active order reservations are shared physical resources. The shared allocator must aggregate reservations across CG and RS and prevent either strategy from spending the same quote balance or selling the same base inventory twice. An intent must pass both its originating strategy's remaining budget and the shared account's actual available-balance/reservation checks. Preserve originating strategy ownership when an intent is deferred or rejected.

## 7. Risk limits

RS must fail closed when a required risk limit is absent, invalid, exceeded, or cannot be calculated from authoritative facts. The eventual contract must define:

- per-tranche quote investment cap;
- maximum cumulative recovery investment per market;
- maximum total RS exposure, including unfilled BUY commitments;
- maximum concurrent/pending BUY and SELL orders;
- maximum drawdown or adverse price movement;
- maximum authorized legacy inventory and legacy quantity released per cycle;
- account-wide quote/base commitment boundary shared with other markets.

**Agreed risk policy:** reuse the existing Conservative strategy's configured investment-limit model and its configuration source; do not introduce a second RS-only investment-limit setting or invent new limits. When the configured investment limit is reached, RS must stop placing new BUY orders. Any already-open recovery SELL remains live and untouched—do not cancel, replace, or reprice it merely because the BUY limit was reached. Continue canonical fill/order reconciliation and wait for that SELL to reach its terminal filled state before considering another cycle. The exact Conservative configuration field and accounting boundary must be confirmed from source during implementation; no example value is an approved default.

## 8. sellQuantity, residuals, and exchange constraints

**Agreed sellQuantity contract:** `sellQuantity` is the configured legacy base-asset quantity to add to each cycle's recovery SELL. It is the opposite kind of control from Conservative's `keepQuantity`: Conservative retains a configured quantity, while RS disposes of the configured legacy slice in addition to the newly acquired recovery tranche. `sellQuantity` is neither the total SELL quantity nor a maximum cap.

For example, with `orderQuantity: 5` ZRO and `sellQuantity: 0.01` ZRO, when the BUY tranche has produced 5 ZRO of net recovery inventory, the conceptual combined SELL target is 5.01 ZRO. Actual canonical BUY fills and base-asset commissions determine the recovery quantity available; configured order quantity or an order acknowledgement must never be treated as executed inventory. The SELL execution must independently satisfy the recovery-tranche investment/commission gate and the legacy slice's fixed-original-average-cost/selling-cost gate. The 0.01 ZRO slice is deducted from the remaining authorized, Spot-available legacy quantity after the cycle succeeds.

**Agreed dust contract:** RS uses the same constrained-dust principle as Conservative. After a cycle has successfully completed and all canonical fills, terminal order state, commissions, proceeds, reservations, and both profitability gates are fully reconciled, any precisely identified residual that cannot be sold solely because of current exchange quantity/notional filters is classified as retained bonus dust. That dust remains in the account but is permanently excluded from all future RS cycle calculations: it is not recovery inventory, is not part of a later cycle's SELL target, does not contribute to later recovery or legacy profitability, and is never counted again as available RS inventory. It is not carried forward as a new cycle's starting balance.

Only an exchange-filter-constrained quantity qualifies. The exact residual quantity and the specific limiting filter must be recorded. Ordinary sellable residual is not dust and cannot be discarded or hidden by cycle completion. Price-filter failures, unavailable commission valuation, incomplete fill/order reconciliation, active reservations, or other unresolved accounting/risk conditions are not dust and must block successful completion. Dust classification is permitted only after the cycle's SELL is terminal and fully reconciled; it must not be used to bypass either profitability gate.

**Agreed smaller-remainder contract:** If the remaining authorized legacy inventory is positive but smaller than configured `sellQuantity`, RS may sell that smaller remainder as the legacy component of the current cycle SELL. The legacy quantity is therefore bounded by the lesser of configured `sellQuantity` and the remaining authorized, Spot-available, unreserved legacy quantity. No separate final-liquidation authorization is required solely because the remainder is smaller. The smaller quantity must independently satisfy the legacy historical-basis/selling-cost profitability gate and all current exchange quantity/notional filters, while the recovery tranche independently satisfies its recovery-profit gate. If either gate or any execution/reconciliation constraint fails, RS retains the remainder and must not force, round up, silently discard, or classify an ordinary sellable remainder as dust.

**Final residual without a new BUY remains unresolved:** this concerns a leftover quantity from an already completed recovery cycle. It does not limit the normal repeated recovery-cycle behavior defined below.

**Agreed — continue recovery cycles after legacy inventory is exhausted.** Exhaustion of authorized legacy inventory only removes the legacy component from future SELLs; it does not pause RS or require reauthorization. RS continues its normal recovery cycle until the operator stops it: for example, BUY 5 ZRO, then SELL the actual net recovery quantity (5 ZRO in the fully filled/no-base-fee illustration) when the recovery tranche's net proceeds meet the existing pair-level `minProfit` after applicable commissions. With no legacy quantity in that SELL, the legacy historical-cost gate does not apply. While authorized legacy inventory remains, add the eligible legacy slice and enforce its independent historical-basis/selling-cost gate as well. Existing orders, fills, reservations, and accounting remain owned and subject to canonical reconciliation.

Until decided:

- Never sell more legacy quantity than the operator-authorized, unreserved amount.
- Never round a requested quantity upward if that could consume unauthorized inventory.
- Never silently classify ordinary residual inventory as dust or sold.
- Apply current exchange tick, step, minimum/maximum quantity, and minimum/maximum notional filters to the actual candidate order.
- Dust must identify the exact residual and limiting filter. Price-filter or commission-valuation failure is not dust.
- If a valid order requires guessing residual policy, block and surface the reason.

## 9. Partial fills, commissions, reservations, and broker outcomes

- Apply each canonical Fill exactly once to Portfolio and RS attribution using the same stable identity/fingerprint. Identical replay is a no-op; conflicting reuse fails closed.
- Apply partial fills as actual increments. Never account the original order quantity before execution.
- Base commissions reduce net BUY inventory and increase base consumed by SELL accounting. Quote commissions change quote cost/proceeds. Third-asset commissions require reliable quote valuation; missing/ambiguous valuation is not zero.
- Fee reserves are estimates only. Actual commission amount and asset from each canonical fill are authoritative.
- Every active SELL reserves its remaining unfilled base quantity. Aggregate active/in-flight SELL reservations cannot exceed verified unreserved base inventory.
- A partial SELL does not close a cycle. Its fill is accounted and its remaining reservation stays until authoritative order state changes.
- A cancellation request does not release a reservation. Release only the unfilled remainder after confirmed terminal cancellation and complete fill reconciliation.
- A fill racing with cancellation is applied exactly once before replacement quantity is calculated.
- A pending order without broker acknowledgement is not cancellable. Unknown submission/cancellation outcomes retain the original identity and commitment, pause the market, and require reconciliation; never blindly retry with a new order.
- A terminal order is not proof of complete fill history. Reconcile canonical order state and all distinct fills before planning another order or closing a cycle.
- Validate exact decimal quantities against current exchange filters. Never oversell by ignoring Portfolio quantity, reservations, in-flight fills, base fees, or account commitments.

## 10. Cycle lifecycle and strategy disable

Advanced RS lifecycle functionality is deliberately deferred under FITDIB (first implement the safe minimum, then improve it). The first implementation must support the normal repeat-until-operator-stops cycle and the safety blocks defined below; do not add speculative pause/disable/abandon/resume workflows or automatic liquidation. Mandatory safety behavior:

- The operator's stop of RS and any normal readiness, investment-limit, order-safety, or reconciliation block prevent new BUYs. Exhaustion of authorized legacy inventory alone does not pause RS: subsequent cycles continue as recovery-only BUY/SELL cycles, subject to the recovery `minProfit` gate and all normal risk, order, and reconciliation controls. Reaching the configured investment limit blocks new BUYs but does not cancel, replace, or reprice an already-open recovery SELL; keep it alive and reconcile until filled/terminal.
- The first implementation must not cancel, replace, abandon, or market-sell resting orders or inventory as a side effect of the operator stopping RS or a safety block.
- Existing orders may fill after the operator stops RS or a safety block prevents new BUYs; fills and commissions continue through canonical accounting and reconciliation.
- In-flight/unknown orders remain owned and reconcilable by their original identities; stopping RS does not erase ownership or reservations.
- Advanced resume/restart lifecycle semantics are deferred; no new order may be created while existing orders, fills, reservations, authorization, accounting, or risk state are unresolved.
- No abandon operation or automatic final liquidation is part of the first implementation.
- No automatic loss-making liquidation is permitted as a disable, pause, abandon, or strategy-switch side effect.

**Deferred under FITDIB:** advanced lifecycle states, pause-versus-disable semantics, user-facing resume, abandon, persistence/restart lifecycle, and final-residual liquidation without a new BUY. Implement the minimal safe cycle first; improve these workflows only after the initial end-to-end behavior is proven.

## 11. Concurrent strategies and external orders

RS and CG are allowed to run at the same time. This includes concurrent operation on the same market when both strategies are enabled for that market. There is no blanket global or per-market exclusive strategy lock.

Concurrency must preserve multiple independently owned Positions per market and one authoritative view of actual exchange custody and available inventory:

- CG and RS keep independent strategy policies, cycle state, attribution and strategy-specific accounting projections.
- The shared Portfolio may contain multiple Positions for the same market. A canonical fill updates exactly one correctly identified Position and the aggregate Portfolio exactly once, and is attributed to the strategy that owns the canonical order.
- The Trading Engine coordinates both strategies through the same broker, order registry, canonical order/fill identities, account commitments and inventory reservations.
- Strategy intents are evaluated independently, but order submission and accounting transitions are serialized through the shared application boundary.
- Every active or in-flight order reserves its remaining quote/base commitment centrally. Reservations from CG, RS and other Harvester strategies must be aggregated before another order is submitted.
- Two strategies must never reserve or sell the same base quantity, double-spend the same quote commitment, or attribute one fill to both strategies.
- Strategy-specific profit, recovery and legacy attribution remains separate even though actual exchange custody and account balances are shared. Each Position's accounting identity is independent; its available-to-sell quantity is still constrained by centrally verified account inventory and reservations.
- If future strategy-specific lifecycle controls are introduced, they must not implicitly disable another strategy. Advanced pause/disable/abandon/resume/restart controls are deferred under FITDIB; existing order ownership and canonical fill reconciliation remain mandatory.
- RS may not adopt, cancel, or modify manual/external orders. Existing external-order policy and canonical broker ownership remain in force.
- Manual trades/external orders may change exchange free/locked balances. This does not make their inventory or executions RS-owned; authoritative available balance and all reservations must be reconciled without attributing external PnL to RS.
- Shared account quote/base commitments remain the Trading Engine's responsibility. RS risk limits are additional constraints and must account for commitments from concurrently active strategies.

The engine must provide deterministic behavior when CG and RS both emit eligible intents for the same market during one evaluation window. Each intent is first checked against its own strategy/pair's remaining investment budget; no strategy may borrow another strategy's unused allocation. The shared allocator then serializes submission and checks actual account-wide quote/base availability and reservations. A deferred/rejected intent retains its strategy identity and an actionable reason. No cross-strategy investment-budget priority or fairness policy is required; shared physical-resource safety remains mandatory.

## 12. Agreed decisions and remaining implementation requirements

The first-implementation product decisions below are recorded. Items marked as implementation requirements are engineering work, not questions for the owner. Advanced lifecycle behavior and separate final-residual liquidation are explicitly deferred under FITDIB; do not expand the first implementation to include them.

| Decision | Settled decision / implementation requirement | Implementation consequence |
|---|---|---|
| sellQuantity | **Agreed:** additive legacy quantity per cycle, added to actual net recovery quantity while authorized legacy inventory remains; not a total quantity or cap. Smaller-remainder behavior is agreed. Once legacy inventory is exhausted, continue recovery-only cycles governed by `minProfit`. | Defines both mixed recovery/legacy and recovery-only cycle SELL targets |
| Smaller/final residual | **Agreed:** sell the smaller remaining authorized legacy quantity within the current cycle if it is Spot-available/unreserved and passes both independent profitability gates and exchange filters; otherwise retain it. Separate final-residual liquidation without a new BUY remains unresolved. | Prevents unintended liquidation or forced loss-making disposal |
| Legacy authorization | **Agreed:** operator manually configures original quote investment and original base quantity before application startup; this configuration is the explicit authorization and historical-basis declaration. Runtime authorization UI, exchange-history import, expiry/revocation workflow and advanced provenance lifecycle are deferred under FITDIB. Spot availability remains independently verified. | Prevents silent wallet adoption while keeping first implementation simple |
| Legacy accounting | **Implementation requirement:** safely represent configured opening inventory and historical basis in RS/shared Portfolio accounting without synthetic fills or unverified balance seeding; verify actual Spot custody separately. | Prevents overselling, double counting, and corrupted fill-driven accounting |
| Legacy profit | Compare the legacy slice against the fixed original average cost and applicable SELL costs; decrement only remaining legacy quantity after successful cycles | Prevents a profitable recovery tranche hiding a legacy loss without maintaining a changing basis |
| Cycle profit | Reuse the existing pair-level `minProfit`; implement exact cost/proceeds and commission accounting. Third-asset valuation failures follow Conservative and fail closed before either accounting projection commits. | Prevents omitted fees/costs or treating unknown fees as zero |
| BUY cadence | Reuse Conservative's established cadence, tranche sizing/configuration, and pending-order safeguards where applicable; verify exact source contract during implementation. | Avoids inventing a second BUY policy |
| Risk policy | **Agreed:** use Conservative's configured investment-limit logic. At the limit, stop new BUYs; keep any active recovery SELL alive and unchanged until filled/terminal. | Prevents additional investment without disrupting an existing recovery SELL |
| Residual/dust | **Agreed:** only exact exchange-filter-constrained residual after fully reconciled successful cycle is retained as bonus dust and excluded permanently from future RS calculations, matching Conservative's constrained-dust principle. Ordinary sellable residual is not dust. Final residual/no-new-BUY liquidation remains open. | Prevents guessed disposal, repeated counting, or hidden sellable inventory |
| Lifecycle | **Agreed:** repeat cycles until operator stop; legacy exhaustion switches to recovery-only cycles. Investment-limit/safety/readiness/reconciliation blocks prevent new BUYs while existing SELLs remain live and reconciled. Advanced pause/disable/abandon/resume/restart behavior and separate final-residual liquidation are deferred under FITDIB. | Keeps the first implementation safe and focused |
| Concurrent strategies and budgets | Independent configured investment budgets and used/committed investment per strategy; no cross-strategy budget borrowing. Shared Portfolio, independent attribution, centralized account reservations and serialized intent allocation remain mandatory. | Prevents one strategy consuming another's allocation, double-spend, duplicate attribution and overselling without mutual exclusion |
| Fee valuation | Third-asset valuation failure and proceeds allocation | Prevents fees being treated as zero |

## 13. Required test contract before implementation

No executable RS tests are added in this RS contract update; RS remains non-executable. Future implementation must add deterministic offline tests for:

- missing/invalid startup legacy configuration and insufficient verified Spot availability; runtime authorization revocation/expiry is deferred under FITDIB;
- configured legacy invested quote / original quantity average-cost calculation, including invalid zero/negative/missing inputs;
- Spot-available versus EARN/off-Spot custody separation, transfer/redeem changes, and insufficient Spot reserve for the next legacy slice;
- a legacy slice that fails its fixed-original-average-cost profitability gate;
- the agreed additive `sellQuantity` calculation (actual net recovery quantity + configured legacy slice), smaller-remainder/final-residual behavior, and constrained-dust classification after successful reconciliation; prove retained bonus dust is permanently excluded from every later RS cycle;
- one/multiple BUY tranches, open/partial/unknown BUYs, and each approved next-BUY boundary;
- base, quote, and third-asset commission accounting;
- Opening-inventory declaration preserves operator-provided historical basis and provenance without changing verified Spot custody or canonical fill identities; SELL consumes only separately verified/allocated Spot quantity and explicitly attributed legacy quantity; missing or unverified custody fails closed;
- Portfolio/RS attribution atomicity, identical duplicate fills, and conflicting fill identity;
- active/in-flight SELL reservation conservation, partial fills, cancellation races, unknown outcomes, and reconciliation;
- exact decimal precision and exchange-filter boundaries;
- investment-limit behavior: block new BUYs while an existing recovery SELL remains unchanged and reconciled; advanced pause/disable/resume/abandon transitions are deferred under FITDIB;
- CG and RS running concurrently on different markets and the same market, with independent order attribution and investment budgets; prove one strategy cannot consume the other's unused budget, shared reservations prevent double-spend, and no fill is duplicated or inventory oversold.
- External/manual order isolation while multiple strategies are active.

Use exact decimal strings and meaningful assertion messages. Follow repository TDD: observe each behavior test RED before implementation and GREEN afterward. Never weaken existing Portfolio, Conservative, broker, or safety coverage.

## 14. Conceptual workflow and safety gates

This is the minimum evidence flow, not a finalized order algorithm. The agreed contract and implementation requirements above govern the eventual executable policy.

~~~mermaid
flowchart TD
  A[Operator authorizes market and legacy quantity] --> B[Verify authorization, cost basis, balance and reservations]
  B --> C{Evidence and risk limits valid?}
  C -- No --> X[Block RS; preserve inventory and orders]
  C -- Yes --> D[Evaluate RS recovery BUY tranche]
  D --> E[Apply canonical BUY fills to shared Portfolio and RS attribution]
  E --> F[Reconcile orders, fills, fees and reservations]
  F --> G{Cycle and legacy profit gates both pass?}
  G -- No --> H[Wait or follow approved accumulation rule]
  G -- Yes --> I[Validate SELL against authorization and exchange filters]
  I --> J{Submission and ownership gates pass?}
  J -- No --> X
  J -- Yes --> K[Submit through shared Trading Engine and broker]
  K --> L[Apply partial/terminal fills; reconcile unknown outcomes]
  L --> M{Close conditions and both profit gates proven?}
  M -- No --> F
  M -- Yes --> N[Commit Portfolio and RS attribution; update authorization]
~~~

The prose is authoritative. The diagram does not authorize a tranche cadence, order type, cancellation policy, residual policy, or lifecycle transition.

## 15. Implementation boundary

Until this specification is formally accepted and the RS-2b accounting boundary is implemented:

- Do not add RS runtime configuration, strategy registration, operator controls, or executable policy.
- Do not place, cancel, replace, or manage RS orders.
- Do not seed Portfolio with synthetic fills or treat wallet balances as RS inventory.
- Preserve existing CG_coinGrabber and Conservative behavior and all shared Portfolio/broker safety invariants. Any required shared Portfolio extension must be focused, test-first, and preserve canonical exact-once fill accounting.
- Keep future deterministic RS decisions in pure domain functions and use existing execution/accounting workflows through explicit application ports.
- No TESTNET or LIVE operation is authorized.
