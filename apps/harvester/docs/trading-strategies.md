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

### Aggressive

Aggressive mode is intended to trade price movements using multiple active BUY and SELL orders.

Agreed scope so far:

- More than one BUY order may be active for a market.
- More than one SELL order may be active for a market.
- This mode is distinct from the Conservative / Free-Roll capital-recovery model.
- Exact price-level placement, order sizing, replacement, fill handling, inventory allocation, and risk limits are still undecided.

Do not assume that Aggressive means a particular grid algorithm, that every BUY fill must create a matching SELL, or that orders are independent. Those are design decisions for discussion.

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

The engine owns reliable execution mechanics. A strategy owns decisions such as when, where, and how much to buy or sell. Avoid duplicating broker/order lifecycle code in each strategy.

## Boundaries

- Strategy rules must not depend on a specific exchange SDK.
- Broker adapters must not contain strategy policy.
- Shared accounting must distinguish actual assets, reserved quantities, and strategy-owned inventory.
- Multiple active orders require explicit handling of partial fills, cancel/replace races, stale orders, insufficient balances, and concurrent updates.
- No strategy may bypass shared safety checks or broker constraints.

## Open decisions

Discuss and record these before implementing strategy behavior:

1. How Aggressive mode chooses and maintains its multiple BUY/SELL price levels.
2. Whether BUY fills create corresponding SELL orders or both sides are managed independently.
3. How order quantities and total exposure are bounded.
4. How inventory and quote capital are allocated across active orders and strategies.
5. What triggers order replacement, cancellation, pause, and resume.
6. How partial fills and concurrent fill/cancel events affect the order plan.
7. What risk limits apply per pair and across the process.
8. Whether both modes can run on the same pair/account simultaneously, or selection is exclusive.
9. How the shared Portfolio represents overlapping assets, strategy allocations, commission assets, and duplicate executions; see the [Portfolio Domain](./domain/portfolio.md).

Until these decisions are made, keep Aggressive mode as a documented target only. Do not invent defaults in code or configuration.
