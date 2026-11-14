---
title: Recovery Seller Domain Specification
status: draft
type: domain-specification
owner: harvester
created: 2026-11-14
---

# Recovery Seller (RS) — Domain Specification

**Status: DRAFT — owner decisions in §12 block executable implementation.**

**Authority:** Canonical RS contract only after the owner decisions below are resolved and this document is accepted. Until then it records the agreed direction, hard safety invariants, accounting boundaries, and unresolved decisions. It does not amend the [Conservative Domain Specification](./CONSERVATIVE_DOMAIN_SPECIFICATION.md).

**Implementation status:** RS is not implemented, registered, configurable at runtime, or executable. The owner has approved the proposed sellQuantity plus legacyPosition.invested / legacyPosition.quantity input shape and RS-calculated average cost. This is a product-level input decision, not an executable runtime schema. Remaining domain decisions still block trading implementation. This draft authorizes no trading or exchange operations.

The phased implementation plan is maintained in the [Recovery Seller Implementation Roadmap](./recovery-seller-implementation-roadmap.md).

## 1. Purpose and vocabulary

Recovery Seller is an independent strategy intended to reduce an explicitly authorized pre-existing spot position through repeated recovery cycles. Each conceptual cycle acquires a new recovery tranche, then sells that tranche together with a configured quantity of legacy inventory when all approved profitability and safety gates pass.

- **Recovery inventory:** net base quantity acquired by BUY fills attributed to the current RS cycle.
- **Legacy inventory:** pre-existing base quantity explicitly authorized for RS liquidation before that cycle. It is not created by that cycle's BUY fills.
- **Cycle SELL:** SELL execution(s) intended to dispose of recovery inventory and an additional legacy quantity, subject to the final approved quantity and profitability rules.
- **sellQuantity:** proposed per-pair base-asset amount of legacy inventory included in addition to newly acquired recovery quantity. It is not the total SELL quantity and is not CG's retained keepQuantity.

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

The original configured quantity and invested amount are historical basis inputs; remaining logical legacy quantity, Spot-available quantity, EARN/externally held quantity, and active reservations are distinct facts. A transfer between Spot and EARN changes custody/availability, not historical cost basis or the original acquisition quantity. RS must not assume EARN balances are observable through the Spot broker or silently claim custody of them.

**Owner decision required:** authorization interface and lifecycle: operator confirmation, evidence source/balance baseline, expiry and revocation behavior, durable provenance, and whether authorization survives process restart. Until specified, no runtime authorization mechanism may be invented.

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
- remaining authorized legacy quantity and unresolved residuals.

It must reference canonical Fill IDs and retain fill-facts fingerprints. A single execution must never be represented as two Portfolio fills.

### 4.3 Portfolio integration blocker

The current Portfolio is fill-driven and has no general opening-balance/manual-inventory seeding operation. A SELL containing legacy units not represented in an appropriately owned Position could make that Position's base quantity inconsistent or negative if applied through the existing accounting path unchanged. Multiple Positions do not remove this opening-inventory accounting blocker.

Therefore, **RS must not submit a SELL consuming legacy inventory until an owner-approved accounting design represents that authorized opening inventory consistently within the shared multi-Position Portfolio and exact-once fill accounting.** An RS attribution ledger alone does not create a sellable Portfolio balance or authorize an oversell.

**Owner decision required:** choose the opening-inventory/accounting boundary and how configured legacy inventory is represented in the appropriate strategy-owned Position(s) within the shared Portfolio, without synthetic fills or balance seeding. The legacy cost-basis input is now agreed at the product level: operator supplies aggregate original quote invested and original base quantity; RS calculates their average. Implementation must still define how that declared historical basis and off-Spot custody are represented without corrupting actual Spot Portfolio quantities. Do not add synthetic fills, seed balances from an unproven wallet snapshot, or bypass Portfolio.

## 5. Profitability — SELL ONLY IN PROFIT

**SELL ONLY IN PROFIT** is a hard safety requirement, not merely a cycle-level target. Two different economic questions must be evaluated independently.

### 5.1 Recovery-cycle profitability

Recovery-tranche cost must include gross executed BUY quote notional, actual quote-asset BUY commissions, and reliable quote valuation of actual third-asset BUY commissions. Base-asset BUY commissions reduce net acquired recovery quantity.

Cycle SELL proceeds must use actual confirmed SELL fills, less actual quote-asset SELL commissions and reliably valued third-asset SELL commissions. Base-asset SELL commissions change the base quantity consumed. Configured maker/taker rates are planning estimates only, never substitutes for actual commission facts.

The owner must specify the cycle's minimum net profit and exact proceeds/cost allocation rule. A profitable recovery tranche does not prove that the legacy units in the same exchange order are profitable.

### 5.2 Legacy historical cost basis

Legacy inventory has a historical acquisition cost separate from the current recovery tranche's BUY cost. A positive cycle result must not silently subsidize a loss on the legacy portion.

**Safety invariant:** RS must not dispose of legacy quantity unless the net proceeds allocated to that legacy quantity cover its approved historical cost basis and applicable selling costs. A positive recovery-cycle result cannot offset a negative legacy result. If legacy cost basis, fee allocation, or proceeds attribution is missing or ambiguous, the legacy portion is not eligible to sell.

Illustration: the recovery tranche earns 0.20 USDT net, but the proposed legacy slice would realize a 0.10 USDT loss against its historical basis. The combined headline result is positive; the legacy sale still fails the legacy-profit gate.

**Agreed legacy cost-basis input:** operator supplies aggregate original quote invested and original base quantity; RS calculates average historical cost as invested quote divided by original quantity. Example: 100 USDT / 50 ZRO = 2 USDT per ZRO. The operator does not configure an average price separately. **Still unresolved:** how the supplied historical values are verified and represented in accounting; how partial legacy disposals reduce remaining basis; allocation of mixed-order proceeds and shared SELL fees; minimum recovery-cycle net profit; and third-asset commission valuation failure behavior. A cycle-level profit calculation alone cannot authorize a combined SELL.

## 6. BUY tranche accumulation and eligibility

The proposal uses orderQuantity as an illustrative recovery BUY tranche size. It does not define whether this means every tranche, the first tranche only, or a maximum.

Hard invariants:

- Only confirmed canonical BUY fills create recovery inventory or recovery cost.
- A submitted/acknowledged BUY creates no inventory; partial fills contribute only actual executed quantity and fees.
- Every BUY commitment counts toward exposure before execution; a fill transfers the corresponding amount from commitment to actual exposure without double counting.
- No duplicate BUY intent while an equivalent BUY is pending, open, partially filled, or unknown.
- An unknown submission retains its commitment and blocks replacement until the original identity is reconciled.
- No new BUY when a risk limit is reached, reconciliation is incomplete, the market is paused, or an order/attribution invariant is unresolved.

**Owner decisions required:** whether multiple recovery tranches accumulate before SELL; when another BUY is allowed; maximum concurrent BUY orders; and whether each tranche uses orderQuantity or a separate setting. Conservative BUY cadence must not be copied into RS by assumption.

## 7. Risk limits

RS must fail closed when a required risk limit is absent, invalid, exceeded, or cannot be calculated from authoritative facts. The eventual contract must define:

- per-tranche quote investment cap;
- maximum cumulative recovery investment per market;
- maximum total RS exposure, including unfilled BUY commitments;
- maximum concurrent/pending BUY and SELL orders;
- maximum drawdown or adverse price movement;
- maximum authorized legacy inventory and legacy quantity released per cycle;
- account-wide quote/base commitment boundary shared with other markets.

**Owner decisions required:** exact values, per-market versus account-wide scope, open-commitment reservation, and behavior when a limit is reached while orders rest. No PR #1115 example value is an approved risk limit.

## 8. sellQuantity, residuals, and exchange constraints

The exact sellQuantity contract remains unresolved.

**Owner decisions required:**

1. Is sellQuantity an exact per-cycle target or a maximum per-cycle cap?
2. If remaining authorized legacy inventory is smaller, may RS sell the smaller remainder, or is explicit final-liquidation authorization required?
3. What happens to positive residuals smaller than the configured amount, below exchange minimum quantity/notional, or otherwise unsellable?
4. May a final residual be sold in a separate cycle without a new recovery BUY? If so, what profit basis applies?
5. Does RS stop when authorized legacy quantity is exhausted, only dust remains, or the operator disables it?

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

Final RS lifecycle states/transitions are not approved. Mandatory safety behavior:

- Pause, disable, or loss of readiness prevents new RS BUYs.
- Disabling RS does not silently cancel, replace, abandon, or market-sell resting orders or inventory.
- Existing orders may fill after pause/disable; fills and commissions continue through canonical accounting and reconciliation.
- In-flight/unknown orders remain owned and reconcilable by their original identities; disable does not erase ownership or reservations.
- Resume cannot create an order until orders, fills, reservations, legacy authorization, accounting, and risk limits are reconciled.
- Abandon cannot erase actual cost, proceeds, fills, or inventory. Remaining recovery/legacy inventory treatment must be specified before an abandon operation exists.
- No automatic loss-making liquidation is permitted as a disable, pause, abandon, or strategy-switch side effect.

**Owner decisions required:** lifecycle states; pause versus disable; cancellation policy for resting orders; abandon behavior; resume preconditions; persistence/restart behavior; and operator-confirmed final liquidation.

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
- One strategy being paused or disabled does not implicitly disable the other. Existing orders remain owned by their originating strategy and continue through canonical fill accounting/reconciliation.
- RS may not adopt, cancel, or modify manual/external orders. Existing external-order policy and canonical broker ownership remain in force.
- Manual trades/external orders may change exchange free/locked balances. This does not make their inventory or executions RS-owned; authoritative available balance and all reservations must be reconciled without attributing external PnL to RS.
- Shared account quote/base commitments remain the Trading Engine's responsibility. RS risk limits are additional constraints and must account for commitments from concurrently active strategies.

The engine must provide deterministic behavior when CG and RS both emit eligible intents for the same market during one evaluation window. Central reservation allocation and serialized submission decide which intents can proceed; a rejected/deferred intent must retain its strategy identity and an actionable reason. The policy must not rely on execution order or race timing to avoid overselling.

**Owner decisions required:** define deterministic priority/fairness when simultaneous CG and RS intents compete for the same scarce quote/base resources; confirm which shared account-level limits apply across strategies; define how strategy-owned orders are attributed during restart/reconciliation. These decisions do not reinstate mutual exclusion.

## 12. Owner decisions required before executable implementation

These decisions are intentionally not guessed. They block implementation, not documentation of the agreed safety invariants.

| Decision | Required owner choice | Why it blocks implementation |
|---|---|---|
| sellQuantity | Exact per-cycle target or maximum cap | Determines legacy amount requested and smaller-remainder eligibility |
| Smaller/final residual | Sell smaller balance, require explicit final authorization, or retain it | Prevents unintended liquidation |
| Legacy authorization | Operator interface, evidence source, expiry/revocation, durable/restart behavior | Prevents silent wallet adoption |
| Legacy accounting | Opening-inventory representation in shared Portfolio and verification of configured invested/quantity inputs | Current Portfolio is fill-driven; configured historical basis is agreed, but Spot holdings and off-Spot custody must be represented safely |
| Legacy profit | Mixed-order proceeds/fee allocation and treatment of remaining aggregate basis after partial legacy sales | Prevents a profitable recovery tranche hiding a legacy loss; input basis is aggregate invested quote / original quantity |
| Cycle profit | Minimum net profit and precise cost/proceeds inclusion | Prevents omitted fees/costs |
| BUY cadence | Tranche size, accumulation, next-BUY eligibility, concurrent-order limits | Determines exposure/order lifecycle |
| Risk policy | Investment, exposure, drawdown, price-movement, and order-count caps | Required before committing capital |
| Residual/dust | Final residual, below-filter, no-new-BUY liquidation behavior | Prevents guessed disposal or hidden inventory |
| Lifecycle | Pause, disable, abandon, resume, restart semantics | Prevents loss of order ownership/accounting |
| Concurrent strategies | Shared Portfolio, independent attribution, centralized reservations and deterministic intent allocation across CG/RS/Aggressive | Prevents double-spend, duplicate attribution and overselling without mutual exclusion |
| Fee valuation | Third-asset valuation failure and proceeds allocation | Prevents fees being treated as zero |

## 13. Required test contract before implementation

No executable RS tests are added in this documentation-only phase. Future implementation must add deterministic offline tests for:

- absent, insufficient, reduced, revoked, duplicated, and stale authorization;
- configured legacy invested quote / original quantity average-cost calculation, including invalid zero/negative/missing inputs;
- Spot-available versus EARN/off-Spot custody separation, transfer/redeem changes, and insufficient Spot reserve for the next legacy slice;
- missing/ambiguous legacy cost basis and a profitable cycle paired with a legacy loss;
- exact sellQuantity, smaller remainder, final residual, and exchange dust after those rules are approved;
- one/multiple BUY tranches, open/partial/unknown BUYs, and each approved next-BUY boundary;
- base, quote, and third-asset commission accounting;
- Portfolio/RS attribution atomicity, identical duplicate fills, and conflicting fill identity;
- active/in-flight SELL reservation conservation, partial fills, cancellation races, unknown outcomes, and reconciliation;
- exact decimal precision and exchange-filter boundaries;
- risk-limit equality/exceedance and pause/disable/resume/abandon transitions;
- CG and RS running concurrently on different markets and the same market, with independent order attribution and centralized reservations; prove no double-spend, duplicate fill attribution or oversell.
- External/manual order isolation while multiple strategies are active.

Use exact decimal strings and meaningful assertion messages. Follow repository TDD: observe each behavior test RED before implementation and GREEN afterward. Never weaken existing Portfolio, Conservative, broker, or safety coverage.

## 14. Conceptual workflow and safety gates

This is the minimum evidence flow, not a finalized order algorithm. The owner decisions above must be resolved before the decision boxes become executable strategy rules.

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

Until this specification is accepted and every blocking owner decision is resolved:

- Do not add RS runtime configuration, strategy registration, operator controls, or executable policy.
- Do not place, cancel, replace, or manage RS orders.
- Do not seed Portfolio with synthetic fills or treat wallet balances as RS inventory.
- Do not change CG_coinGrabber, Conservative accounting, shared Portfolio behavior, or broker safety boundaries.
- Keep future deterministic RS decisions in pure domain functions and use existing execution/accounting workflows through explicit application ports.
- No TESTNET or LIVE operation is authorized.
