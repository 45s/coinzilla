# Harvester Trading Strategies

Harvester is one independent trading process with a shared trading engine and multiple selectable strategy modes.

## Strategy modes

### Conservative — Free-Roll

This mode is based on the existing `apps/bot-free-roll` strategy.

Its defining objective is to recover invested quote capital while accumulating free base-asset quantity from realized net profit.

Key characteristics:

- Maintain the Free-Roll capital-recovery accounting model.
- Sell only when the required net-profit condition is satisfied.
- Keep the configured reserve/free quantity out of subsequent invested-position calculations.
- Use actual fills and commissions for accounting.
- Preserve the existing Free-Roll order lifecycle and safety rules when adapting them to Harvester.

The existing Free-Roll README is the detailed reference for its current strategy rules. Harvester's implementation must be reviewed against that document; copying its config does not implement the strategy.

### Aggressive — grid-style trading

Aggressive is a higher-risk, grid-style strategy. It trades price movements using multiple active BUY and SELL orders. Unlike Conservative, it does not try to consolidate the whole position after every BUY; it can maintain several order opportunities and corresponding exits at the same time.

The rules below record decisions agreed during product discussion. Items explicitly listed under **Still to decide** are not implied by this specification.

#### 1. Starting a trading cycle

When the market has no position to manage and a current market price is received:

- If `makerPercent = 0`, immediately request a post-only BUY at the current market price.
- If `makerPercent != 0`, place the BUY below the current market price using the configured `priceStep`.

The exchange's post-only and price/quantity constraints still apply. The Trading Engine is responsible for validating and executing the strategy's order intent through the broker boundary.

#### 2. Multiple active BUY orders

- Multiple BUY orders may be active simultaneously for the same market.
- A new grid opportunity may create another BUY without waiting for earlier BUY orders to fill.
- There is no configured maximum number of active BUY orders in the agreed design.
- New BUY orders are bounded by the configured maximum total invested quote amount.
- A configured maximum price-drop limit is also a risk boundary. Reaching either the investment limit or the price-drop limit triggers the Conservative fallback described below.

The exact definition and measurement baseline for the maximum price drop still need to be agreed.

#### 3. BUY fills and SELL orders

- A BUY fill makes the actually executed quantity available in the Aggressive strategy's shared inventory.
- A partial BUY fill is actionable immediately: do not wait for the entire BUY order to fill before creating/updating a SELL.
- As additional portions of that BUY execute, update the relevant SELL order quantity to reflect the additional executed quantity.
- Multiple SELL orders may remain active simultaneously.
- SELL orders use the shared inventory pool; they do not own separate, exclusive coin lots tied permanently to individual BUY orders.
- Every active SELL order must reserve its unfilled base quantity from the shared available inventory. The same coins must never be offered for sale by two orders.
- A SELL price must cover all applicable commissions, the configured `minProfit`, and the configured `freeCoin` amount/requirement.

The exact SELL price formula, including how commissions and `freeCoin` are represented and rounded, remains to be specified. Actual fills and actual commissions—not estimates—remain authoritative for accounting.

#### 4. SELL fills and new BUY opportunities

- A partial SELL is measured against that SELL order's original quantity.
- If cumulative executed quantity becomes **strictly greater than 50%** of the original SELL quantity, the strategy may consider placing another BUY.
- At exactly 50% or below, wait; do not create a BUY based on this partial-SSELL threshold.
- Any BUY considered after a partial SELL must still respect the maximum invested quote amount and maximum price-drop risk limit.
- When a SELL is fully filled, Aggressive immediately starts another cycle by placing a post-only BUY at the current market price.

A partial SELL crossing the 50% threshold is permission to consider a BUY, not an unconditional instruction to exceed a risk limit.

#### 5. Risk-limit fallback to Conservative

Aggressive has two agreed risk boundaries:

1. Maximum total invested quote amount.
2. Maximum permitted price drop.

If either boundary is reached:

1. Stop creating new Aggressive BUY orders.
2. Cancel all active BUY orders.
3. Cancel all active SELL orders.
4. Reconcile any executions that occur while cancellation is in progress; cancellations do not undo fills.
5. Combine the remaining available position into one SELL order.
6. Use Conservative behavior to try to sell the entire position with that single order.

The strategy resumes Aggressive immediately after the combined Conservative SELL is fully filled.

This is a strategy-mode transition, not a restart of the Harvester process. Shared execution safety, fill accounting, and broker constraints continue to apply during the transition.

#### 6. Shared inventory and accounting

Aggressive uses one shared inventory pool per market for its BUY/SELL activity:

- Filled BUY quantities increase the pool, net of commissions charged in the base asset.
- SELL orders reserve quantities from the pool.
- SELL fills reduce the pool by the actual executed quantity and applicable base-asset commission.
- Cancelled or rejected orders release their unfilled reservations; actual fills remain accounted for.
- The Portfolio changes only from actual fills.

This shared-pool rule applies within Aggressive. Whether Conservative and Aggressive can share the same market/account inventory concurrently, and how strategy-level allocations would work, remain open domain decisions. The fallback transition must not duplicate or lose inventory when moving from Aggressive to Conservative.

#### 7. Important execution safety

The Trading Engine must coordinate order lifecycle and portfolio updates around partial fills, cancel/replace races, and mode transitions. In particular:

- Do not assume a cancellation succeeded until its result is confirmed.
- Process fills received during cancellation before calculating the remaining quantity for the consolidated SELL.
- Do not release a reservation for a quantity that actually filled.
- Do not submit the consolidated SELL until active SELL reservations and in-flight executions have been reconciled.
- Never submit SELL quantities greater than the unreserved available base inventory.
- Do not bypass exchange precision, minimum-notional, balance, or post-only constraints.

These are required safety outcomes; exact event ordering, retry behavior, and recovery handling are still part of the Trading Engine design.

### Strategy as a domain policy

Conservative and Aggressive are treated as **domain policies**: they express business rules for deciding what trading action should be taken from relevant facts such as market prices, current orders, and Portfolio state.

A strategy policy decides whether to BUY, SELL, wait, or revise its desired orders; determines strategy-specific prices, quantities, and reactions to fills; and may use domain concepts such as Portfolio and Position. It does not communicate with Binance or another exchange directly, and does not own WebSocket subscriptions, broker clients, or shared order-submission mechanics.

A policy is a responsibility, not a prescribed class shape. It may be implemented as a module, function, or object once its contract is designed.

## Shared trading engine

The following are candidates for shared engine capabilities, subject to contract design:

- Market-data subscription and validation.
- Broker abstraction and exchange rule/precision handling.
- BUY/SELL order submission, cancellation, and status tracking.
- Fill ingestion and deduplication.
- A fill-driven Portfolio containing spot positions, updated through `src/use-cases/update-portfolio.js`.
- Actual commission accounting.
- Balance and position visibility.
- Order/fill journal and operational logging.
- Trading readiness, pause, and unsafe-state handling.

The Portfolio changes only when an actual execution is applied. Price updates and order lifecycle events without executions do not change holdings. See [Portfolio Domain](./domain/portfolio.md) for the proposed domain contract and open decisions.

The engine owns reliable execution mechanics and coordinates application workflows. A strategy policy owns decisions such as when, where, and how much to buy or sell. Avoid duplicating broker/order lifecycle code in each strategy.

See [Architecture](./architecture.md) for the full responsibility split and interaction flow.

## Boundaries

- Strategy rules must not depend on a specific exchange SDK.
- Broker adapters must not contain strategy policy.
- Shared accounting must distinguish actual assets, reserved quantities, and strategy-owned inventory.
- Multiple active orders require explicit handling of partial fills, cancel/replace races, stale orders, insufficient balances, and concurrent updates.
- No strategy may bypass shared safety checks or broker constraints.

## Still to decide

The following questions remain open and must be answered before implementation where they affect behavior:

1. What exactly constitutes a new Aggressive grid opportunity after the initial BUY, and how is `priceStep` measured/applied to subsequent BUY levels?
2. What is the exact maximum-price-drop calculation and its reference price/baseline?
3. What is the exact SELL price formula for commissions, `minProfit`, and `freeCoin`, including rounding and commission-asset handling?
4. When a partial BUY adds quantity, should the existing SELL be amended or cancelled/replaced, and how should the strategy behave if amendment is unavailable?
5. When a partial SELL crosses 50%, what price/placement rule applies to the considered BUY? Is the BUY post-only at current market price or based on the initial `makerPercent`/`priceStep` rule?
6. What happens if the 50% threshold is crossed more than once due to multiple partial execution events? The intended behavior must avoid creating duplicate BUY opportunities for the same threshold crossing.
7. What happens if the consolidated Conservative SELL cannot be placed, is partially filled, or is rejected? The fallback/resume behavior for those cases is not yet defined.
8. Can both strategy modes run on the same pair/account simultaneously, or is strategy selection exclusive per market?
9. How are shared quote assets and inventory allocated across different markets and strategy modes?
10. How are third-asset commissions represented and valued?
11. What persistence, restart, and exchange-reconciliation guarantees are required before live operation?

Until these decisions are closed, do not invent defaults in code or configuration. See the [Harvester Roadmap](../ROADMAP.md) for the remaining design and implementation work.
