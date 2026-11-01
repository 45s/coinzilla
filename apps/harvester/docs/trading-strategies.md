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

#### 2. BUY grid placement and repricing

- When the first BUY of a new Aggressive cycle is triggered, place the **entire configured BUY grid immediately**; do not wait for one BUY to fill before placing the remaining grid orders.
- The first BUY level follows the cycle-start rule above: with `makerPercent = 0`, request a post-only BUY at the current market price; with nonzero `makerPercent`, place the first BUY below market using `priceStep`.
- Further BUY levels are calculated as a fixed grid from the first level. For example, with a 1% step and a first level at 100, the grid levels are 100, 99, 98, 97, and so on.
- While the market moves down or remains within the current grid's upward-repricing threshold, existing BUY orders remain at their original prices. The grid does not trail the market downward.
- If the market rises by at least one `priceStep` from the grid's current reference price, rebuild the grid by shifting its reference upward by the full number of crossed `priceStep` levels. For example, a grid referenced at 100 with a 1% step that is repriced after the market reaches 103 is rebuilt around 103.
- Every lower BUY level is calculated directly from the grid's first/reference BUY price, not compounded from the previous level. For example, a 1% grid referenced at 100 has levels 100, 99, 98, 97, and so on.
- A grid rebuild preserves the configured grid depth only if the investment limit allows it; otherwise, determine the maximum number of levels the limit would permit. The agreed behavior is to place **no replacement grid** unless the entire configured grid fits.
- There is exactly **one BUY grid per market**. It may contain a mixture of partially filled and unfilled BUY orders. Repricing replaces that grid; it never creates a second, overlapping grid.
- Before replacing the current grid, check whether the complete replacement grid fits within the investment limit. If it does not fit, leave the current grid unchanged. If it fits, cancel/replace the current grid as one logical grid-replacement operation, accounting for fills that arrive during cancellation.
- For the investment-limit check, count already invested quote plus the remaining unfilled quote commitment of the proposed single grid. Existing unfilled orders belong to the current grid and are replaced, not counted as an additional second grid.
- Existing SELL orders are **not** cancelled or recreated during a BUY-grid rebuild; they remain unchanged.
- Multiple BUY orders may be active simultaneously as levels within this one grid. There is no configured maximum number of active BUY orders in the agreed design.
- New BUY orders and rebuilt grids are bounded by the configured maximum total invested quote amount.
- A configured maximum price-drop limit is also a risk boundary. Reaching either the investment limit or the price-drop limit triggers the Conservative fallback described below.

The maximum price drop is measured from the average price of actually filled BUY orders. BUY prices are rounded down to the nearest valid exchange tick; SELL prices are rounded up. The grid reference moves upward by the full number of crossed steps; lower levels are calculated from that reference. The exact maximum price-drop calculation beyond this baseline, and the detailed interaction between percentage steps and exchange filters, remain to be specified.

#### 3. BUY fills and SELL orders

- A BUY fill makes the actually executed quantity available in the Aggressive strategy's shared inventory.
- SELL creation depends on the **cumulative filled percentage of each individual BUY order**:
  - If that BUY order is **more than 50% filled**, create a separate SELL for newly filled, unreserved quantity when that sellable quantity has a notional value **strictly greater than $5 USD equivalent**.
  - If that BUY order is **50% filled or less**, do not create a SELL from that partial fill; wait until the BUY order is fully filled.
  - The $5 threshold is a minimum for creating the SELL, not a target order size. If eligible filled quantity is not yet worth more than $5, keep it available in the shared inventory and wait until enough unreserved quantity accumulates to meet the threshold.
- When eligible quantity is ready to sell, create a **separate SELL order**. Do not increase or amend an existing SELL order to absorb this BUY fill.
- Multiple SELL orders may remain active simultaneously.
- SELL orders use the shared inventory pool; they do not own separate, exclusive coin lots tied permanently to individual BUY orders.
- Every active SELL order must reserve its unfilled base quantity from the shared available inventory. The same coins must never be offered for sale by two orders.
- Preserve the configured `freeCoin` quantity in the shared market inventory; it is a retained base-asset reserve, not an amount to subtract repeatedly from every separate SELL.
- Price each SELL so the trade recovers its BUY cost and all applicable BUY/SELL commissions, earns the configured `minProfit`, and preserves the configured `freeCoin` reserve in base-asset inventory.

The exact SELL price formula, including fee-asset conversion and price/quantity rounding, remains to be specified. Actual fills and actual commissions—not estimates—remain authoritative for accounting. The broker's own minimum-notional and precision filters must also be respected.

#### 4. SELL fills and new BUY opportunities

- A partial SELL is measured against that SELL order's original quantity.
- If cumulative executed quantity becomes **strictly greater than 50%** of the original SELL quantity, the strategy may consider placing another BUY.
- At exactly 50% or below, wait; do not create a BUY based on this partial-SELL threshold.
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

1. What exact percentage-step calculation and market-price observation should be used when determining crossed grid levels? BUY tick rounding down and SELL tick rounding up are agreed.
2. What is the exact maximum-price-drop calculation, using the average price of actually filled BUY orders as its baseline?
3. What exact SELL price formula, fee-asset conversion, and price/quantity rounding guarantee recovery of BUY cost and all BUY/SELL commissions while earning configured `minProfit` and preserving the retained `freeCoin` quantity?
4. When a partial SELL crosses 50%, what price/placement rule applies to the considered BUY? Is the BUY post-only at current market price or based on the initial `makerPercent`/`priceStep` rule?
5. What happens if the 50% threshold is crossed more than once due to multiple partial execution events? The intended behavior must avoid creating duplicate BUY opportunities for the same threshold crossing.
6. What happens if the consolidated Conservative SELL cannot be placed, is partially filled, or is rejected? The fallback/resume behavior for those cases is not yet defined.
7. Can both strategy modes run on the same pair/account simultaneously, or is strategy selection exclusive per market?
8. How are shared quote assets and inventory allocated across different markets and strategy modes?
9. How are third-asset commissions represented and valued?
10. What persistence, restart, and exchange-reconciliation guarantees are required before live operation?

Until these decisions are closed, do not invent defaults in code or configuration. See the [Harvester Roadmap](../ROADMAP.md) for the remaining design and implementation work.
