# Harvester Conservative Domain Glossary

**Phase:** D0 discovery specification  
**Authority:** Harvester's approved Conservative domain contract  
**Status:** Proposed vocabulary; business decisions listed in the specification remain unapproved.

## Purpose and scope

This glossary defines terms used by the Conservative (Conservative strategy) domain. It separates strategy-owned financial facts from exchange/order lifecycle facts. It does not prescribe broker integration or a runtime architecture.

## Terms

| Term | Meaning | Ownership |
|---|---|---|
| Market | Canonical base/quote asset pair, with a stable market identity. | Shared entity supplied to domain |
| Market price | Validated latest traded price used as a strategy input. It is not a fill price. | Application/boundary input |
| Pair configuration | Strategy settings for one market: step percent, order quantity, keep quantity, configured maker/taker rates, Harvester's current required per-pair investment limit. | Validated application input; semantics owned by strategy |
| Strategy settings | Global Conservative settings, including quote-denominated `minProfit`. | Validated application input; semantics owned by strategy |
| BUY intent | Pure proposal to submit a BUY limit order at a calculated price and quantity. It is not an accepted order or an execution. | Domain output |
| SELL intent | Pure proposal to submit a recovery SELL. It is not proof of a sale or proceeds. | Domain output |
| Active order | Application-supplied order state that is pending, open, partially filled, or unknown. It prevents duplicate intents on that side. | Application/broker fact |
| Fill | One confirmed execution, not an order acknowledgement and not an order's cumulative executed quantity. | Canonical broker-normalized input |
| Fill identity | Stable market-scoped identity for one execution. Harvester's canonical `Fill.id` is used with an execution-facts fingerprint. | Shared entity identity; domain deduplication |
| Portfolio | Per-market inventory and cash-flow projection, including active strategy quantity and separately retained free quantity. | Domain |
| Active quantity | Base inventory owned by the strategy and available for strategy recovery SELL planning. Excludes free/retained inventory. | Domain |
| Free quantity | Base inventory allocated after successful recovery and excluded permanently from future strategy sell quantities. | Domain |
| Total quantity | Active quantity plus free quantity. | Derived domain value |
| RecoveryLedger | Per-market pooled quote-currency recovery accounting: cumulative BUY cost, confirmed net SELL proceeds, observed fee-rate history, and applied fill identities. | Domain |
| BUY cost / cycle cost | Sum of executed BUY quote notional plus applicable quote-asset BUY commissions. It is not the BUY order's requested notional. | Domain-derived from fills |
| Gross SELL proceeds | Executed SELL quote notional before quote-asset commission. | Canonical fill fact |
| Net SELL proceeds | Gross SELL proceeds less applicable quote-asset SELL commission. | Domain-derived from fills |
| Base commission | Commission charged in the market base asset. It changes actual base inventory, not quote recovery cost/proceeds. | Canonical fill fact, applied by domain |
| Quote commission | Commission charged in the market quote asset. It changes recovery cost or net proceeds. | Canonical fill fact, applied by domain |
| Third-asset commission | Commission charged in an asset other than the market base or quote asset. Current Conservative strategy execution accounting rejects it; Harvester recovery accounting also rejects it. | Canonical fill fact; unsupported by current policy |
| Outstanding recovery amount | `max(0, buyCost - netSellProceeds)`. It is a quote-currency shortfall, not a base-quantity obligation. | Derived domain value |
| Realized net profit | `netSellProceeds - buyCost`. | Derived domain value |
| `minProfit` | Required minimum quote-currency profit for a completed recovery cycle. | Strategy setting |
| `keepQuantity` | Configured base quantity to allocate to free inventory after successful recovery. It is excluded from recovery SELL planning. | Strategy setting |
| Fee reserve | Conservative assumed rate used only to plan SELL quantity and price. It is not an accounting debit. | Strategy policy |
| Actual commission rate | Effective quote-equivalent commission rate calculated from a confirmed fill. | Derived domain observation |
| Recovery completion | Eligibility decision after the current recovery SELL order is fully reconciled, actual net proceeds meet BUY cost plus minimum profit, and sufficient active inventory remains for keep allocation. | Domain decision |
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
