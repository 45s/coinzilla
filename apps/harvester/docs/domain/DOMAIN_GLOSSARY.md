# Harvester Conservative Domain Glossary

**Phase:** D0 discovery specification

**Authority:** [CONSERVATIVE_DOMAIN_SPECIFICATION.md](./CONSERVATIVE_DOMAIN_SPECIFICATION.md) is the sole rule source.

**Status:** Vocabulary/reference only; this glossary does not define strategy behavior.

## Purpose and scope

This glossary defines terms used by the Conservative domain. It separates strategy-owned financial facts from exchange/order lifecycle facts. It does not prescribe broker integration or a runtime architecture.

## Terms

| Term | Meaning | Ownership |
|---|---|---|
| Market | Canonical base/quote asset pair, with a stable market identity. | Shared entity supplied to domain |
| Market price | Validated latest traded price used as a strategy input. It is not a fill price. | Application/boundary input |
| Pair configuration | Strategy settings for one market: step percent, order quantity, keep quantity, minimum quote profit, configured maker/taker rates, and per-pair investment limit. | Validated application input; semantics owned by strategy |
| Strategy settings | Global Conservative mode toggles; market economics belong to pair configuration. | Validated application input; semantics owned by strategy |
| BUY intent | Pure proposal to submit a BUY limit order at a calculated price and quantity. It is not an accepted order or an execution. | Domain output |
| SELL intent | Pure proposal to submit a recovery SELL. It is not proof of a sale or proceeds. | Domain output |
| Active order | Application-supplied order state that is pending, open, partially filled, or unknown. It prevents duplicate intents on that side. | Application/broker fact |
| Fill | One confirmed execution, not an order acknowledgement and not an order's cumulative executed quantity. | Canonical broker-normalized input |
| Fill identity | Stable market-scoped identity for one execution. Harvester's canonical `Fill.id` is used with an execution-facts fingerprint. | Shared entity identity; domain deduplication |
| Portfolio | Per-market inventory projection, including strategy quantity and separately retained free quantity. Exact Conservative quantity/spent semantics are defined in the canonical specification. | Domain |
| Active quantity | Strategy-owned base inventory before retained allocation. SELL eligibility and quantity are defined in the canonical specification. | Domain vocabulary |
| Free quantity | Base inventory allocated after successful recovery; allocation conditions are defined in the canonical specification. | Domain vocabulary |
| Total quantity | Active quantity plus free quantity. | Derived domain value |
| RecoveryLedger | Per-market recovery accounting that retains the current position's full spent basis, confirmed net SELL proceeds, and applied fill identities until canonical completion. | Domain |
| Position spent / BUY cost | Entire accumulated BUY quote notional plus actual quote commissions and reliably valued third-asset BUY commissions. Full-cost recovery is defined in the canonical specification. | Domain-derived from fills |
| Gross SELL proceeds | Executed SELL quote notional before quote-asset commission. | Canonical fill fact |
| Net SELL proceeds | Gross SELL proceeds less actual quote-asset SELL commission and reliably valued third-asset SELL commission. See canonical valuation/fail-closed rules. | Domain-derived from fills |
| Base commission | Commission charged in the market base asset. It changes actual base inventory, not quote recovery cost/proceeds. | Canonical fill fact, applied by domain |
| Quote commission | Commission charged in the market quote asset. It changes recovery cost or net proceeds. | Canonical fill fact, applied by domain |
| Third-asset commission | Commission charged in an asset other than the market base or quote asset. It must have a reliable quote-currency valuation; otherwise accounting fails closed. | Canonical fill fact; see canonical specification |
| Outstanding recovery amount | `max(0, buyCost - netSellProceeds)`. It is a quote-currency shortfall, not a base-quantity obligation. | Derived domain value |
| Realized net profit | `netSellProceeds - buyCost`. | Derived domain value |
| `minProfit` | Required minimum quote-currency profit for a completed recovery cycle; configured independently on each pair and denominated in that pair's quote asset. | Pair setting |
| `keepQuantity` | Exact configured base quantity retained after successful recovery. It is the only retained-quantity setting; see canonical specification. | Strategy setting |
| Fee reserve | Order-type-specific planning estimate only; it is never an actual commission debit. Rates and selection are defined in the canonical specification. | Strategy vocabulary |
| Actual commission rate | Effective quote-equivalent commission rate calculated from a confirmed fill. | Derived domain observation |
| Recovery completion | Eligibility decision after terminal SELL reconciliation, exact retained quantity, full accumulated cost recovery, and minimum realized net profit. Dust and lifecycle requirements are defined in the canonical specification. | Domain decision |
| Cycle reset | Clear cycle BUY cost and SELL proceeds after successful completion while preserving fill identities. | Domain state transition |
| Fill replay | Reapplication of a previously seen execution from another event/history source. Identical replay is idempotent; conflicting facts are an error. | Domain/application boundary |
| Out-of-order fill | A valid execution received before an expected earlier event/order status. Execution facts may still be accounted once, but an order cannot be declared complete from status alone. | Boundary sequencing + domain accounting |

## Responsibility boundaries

### Domain-owned

- BUY/SELL eligibility and calculated intents.
- Quote cost/proceeds accounting from confirmed fills.
- Base inventory, free inventory, and retained quantity.
- Recovery target, fee reserve, rounding policy, completion eligibility, and cycle-reset eligibility.
- Fill deduplication and conflict detection.
- Financial invariants and fail-closed outcomes for invalid facts.

### Supplied by the application or broker adapter

- Validated market price and timestamp/freshness assessment.
- Canonical Market, Asset, Money, Quantity, Fill, commission completeness and asset identity.
- Actual order state, broker order identifiers, active orders, and reconciled terminal status.
- Exchange trading increments and supported order type.
- Whether an execution is maker/taker where required by policy.
- Whether fill history is complete and reconciled.
- Submission success/failure and unknown outcomes.

The domain must not import Binance, broker SDKs, WebSockets, application services, timers, or runtime infrastructure.

## Source map

## Related domain documents

- [Conservative Domain Specification](./CONSERVATIVE_DOMAIN_SPECIFICATION.md)
- [Accounting Invariants](./ACCOUNTING_INVARIANTS.md)
- [Conservative Behavior Baseline](./CONSERVATIVE_BEHAVIOR_BASELINE.md)
