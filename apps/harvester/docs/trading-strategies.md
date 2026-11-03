# Harvester Trading Strategies

Harvester is one independent trading process with a shared Trading Engine and multiple strategy modes. **Conservative is the first implementation priority and the default strategy for the first executable release. Aggressive is deferred until Conservative is proven end to end on TESTNET.** For each trading pair, exactly one strategy controls its shared Position at a time. A configurable `conservativeTakeoverPercent` setting defaults to `20` (20%). The engine switches from Aggressive to Conservative when actual executed BUY investment exceeds 20% of that pair's planned total quote budget. Unfilled/open BUY orders do not count. Conservative keeps control until the entire position is sold and the invested quote capital has been recovered; Aggressive does not resume merely because exposure falls below 20%.

## Implementation priority

Conservative is not merely the first policy to document: it is the first strategy that must actually produce and submit orders. The immediate deliverable is the complete market-price → Conservative decision → broker order → execution/fill → Portfolio update → next decision/order loop on TESTNET. See [Trading First](./TRADING_FIRST.md). Journal, durable recovery, comprehensive reconciliation, and Aggressive are deferred until this loop works; only minimum immediate execution safety may be added ahead of it.

## Strategy modes

### Conservative

This policy is implemented as a broker-independent pure function in
`src/domain/strategies/conservative/conservative-strategy.js`. It emits order
intents only; the application engine validates and submits them.

The first connected policy behavior is:

The initial BUY is placed one configured step below the first valid market price and trails upward until filled or safely replaced. While the strategy
is in its trailing phase, if the last traded price rises by at least one full
compounded `priceStepPercent` from the last BUY reference, cancel the current
BUY and replace it below the new last trade by the configured percentage.
Round the replacement price down to the exchange tick. If the cancellation
reveals any execution, reconcile those fills and pause instead of placing a
replacement from uncertain inventory. After a BUY fully fills, the next
standing BUY is fixed and does not trail. Trailing becomes active again after
a profitable recovery SELL completes.

The default Harvester config enables only `ZROUSDT` while the first trading
cycle is limited to one pair. `ZROFDUSD` remains configured but disabled until
cross-pair shared-asset allocation is implemented.

- With no active strategy inventory and no active BUY, create one BUY at the
  last traded price reduced by `priceStepPercent`, rounded down to the
  exchange price tick. Quantity is `orderQuantity`, rounded down to the
  exchange quantity step.
- Use `LIMIT_MAKER` when `makerPercent` is zero; otherwise use `LIMIT`, with
  exchange time-in-force and filter requirements handled by the broker adapter.
- When another BUY fully fills while a recovery SELL is open, cancel the old
  SELL, query and account all canonical fills for that order, verify the
  cumulative filled quantity, and then recalculate the recovery SELL. If the
  cancellation or fill history is ambiguous, pause rather than guessing.
- With active inventory, create a recovery SELL when no SELL is already active.
  The existing exact-decimal recovery planner preserves `keepQuantity`, covers
  cumulative BUY cost plus `minProfit`, credits only confirmed net SELL
  proceeds, and rounds the SELL price up to the exchange tick.
- When inventory exists, also maintain the next standing BUY unless one is
  already active. Its reference is the volume-weighted average execution price
  across all fills of the last completed BUY order (total executed quote
  notional divided by total executed base quantity). Do not use the submitted
  limit price or only the final partial fill. Before a completed BUY reference
  exists, the current last traded price is used.
- Active PENDING, OPEN, PARTIALLY_FILLED, and UNKNOWN orders suppress duplicate
  intents on subsequent market events. A new BUY is omitted when outstanding
  recovery capital plus the new order notional would exceed the pair investment cap.
- A strategy decision can therefore request both a BUY and a SELL. The policy
  does not submit orders, mutate Portfolio, or infer fills from acknowledgements.

The domain policy is composed by the Harvester trading engine. Offline
bootstrap and engine tests cover BUY submission, trailing replacement,
BUY-driven recovery-SELL replacement, fill accounting, recovery completion,
and free-inventory allocation. A real Binance TESTNET run is still required
to verify the broker integration against the exchange.


This is Harvester's standing-order accumulation and capital-recovery strategy.

Its defining objective is to recover invested quote capital while accumulating free base-asset quantity from realized net profit.

Key characteristics:

- Maintain cumulative BUY cost, net SELL proceeds, actual commissions, minimum profit, and retained base inventory.
- Sell only when the required net-profit condition is satisfied.
- Keep the configured reserve/free quantity out of subsequent invested-position calculations.
- Use actual fills and commissions for accounting.
- Preserve the order lifecycle and safety rules defined in the Conservative Domain Specification.

The [Conservative Domain Specification](./domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md) is the enduring source of truth for strategy rules. Configuration values alone do not implement the strategy.

### Aggressive — grid-style trading

Aggressive is a higher-risk, grid-style strategy. It trades price movements using multiple active BUY and SELL orders. Unlike Conservative, it does not try to consolidate the whole position after every BUY; while it controls the pair, it can maintain several order opportunities and corresponding exits at the same time. It relinquishes control when actual executed BUY fills push the Position's quote investment above `conservativeTakeoverPercent` of the pair's planned total quote budget. Open/unfilled BUY orders are excluded from this strategy-switch calculation.

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
- If the market rises by at least one `priceStep` from the grid's current reference price, rebuild the grid by shifting its reference upward by the full number of crossed compounded `priceStep` levels. Each upward level is calculated from the previous level. For example, with a 1% step and a reference of 100, the upward levels are 101, 102.01, and 103.0301. At a market price of 103, two complete steps have been crossed, so the new reference advances to 102.01; the third step has not been reached.
- The lower BUY levels within a grid remain calculated directly from that grid's first/reference BUY price, not compounded from the previous lower level. For example, a 1% BUY grid referenced at 100 has levels 100, 99, 98, 97, and so on. This fixed downward grid calculation is separate from the compounded upward steps used to decide when to reprice the grid.
- A grid rebuild preserves the configured grid depth only if the investment limit allows it; otherwise, determine the maximum number of levels the limit would permit. The agreed behavior is to place **no replacement grid** unless the entire configured grid fits.
- There is exactly **one BUY grid per market**. It may contain a mixture of partially filled and unfilled BUY orders. Repricing replaces that grid; it never creates a second, overlapping grid.
- Before replacing the current grid, check whether the complete replacement grid fits within the investment limit. If it does not fit, leave the current grid unchanged. If it fits, cancel/replace the current grid as one logical grid-replacement operation, accounting for fills that arrive during cancellation.
- For the investment-limit check, count already invested quote plus the remaining unfilled quote commitment of the proposed single grid. Existing unfilled orders belong to the current grid and are replaced, not counted as an additional second grid.
- Existing SELL orders are **not** cancelled or recreated during a BUY-grid rebuild; they remain unchanged.
- Multiple BUY orders may be active simultaneously as levels within this one grid. There is no configured maximum number of active BUY orders in the agreed design.
- New BUY orders and rebuilt grids are bounded by the configured maximum total invested quote amount.
- A configured maximum price-drop limit is also a risk boundary. Reaching either the investment limit or the price-drop limit triggers the Conservative fallback described below.

The maximum price drop is measured from the average price of actually filled BUY orders. BUY prices are rounded down to the nearest valid exchange tick; SELL prices are rounded up. Upward repricing steps compound from one level to the next: each next level is the previous level multiplied by `1 + priceStep`. The grid reference advances only by the number of complete compounded levels crossed. Lower BUY levels inside each grid remain fixed percentages from the grid reference. The exact maximum price-drop calculation beyond its agreed average-filled-BUY baseline, and the detailed interaction with exchange filters, remain to be specified.

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

After the fallback, control remains with Conservative until the entire position is sold and the invested quote capital has been recovered. The Trading Engine then returns control to Aggressive. A reduction in position size, including a reduction below the 20% takeover threshold, does not release control. If the position is losing money, stop creating new BUY orders but keep existing SELL orders active. Do not force a sale at a loss merely to close the position or switch strategies. Existing SELL orders may execute; the strategy must wait for a recovery rather than realize a loss.

This is a strategy-mode transition, not a restart of the Harvester process. Shared execution safety, fill accounting, and broker constraints continue to apply during the transition.

#### 6. Shared inventory and accounting

Aggressive uses one shared inventory pool per market for its BUY/SELL activity:

- Filled BUY quantities increase the pool, net of commissions charged in the base asset.
- SELL orders reserve quantities from the pool.
- SELL fills reduce the pool by the actual executed quantity and applicable base-asset commission.
- Cancelled or rejected orders release their unfilled reservations; actual fills remain accounted for.
- The Portfolio changes only from actual fills.

This shared-pool rule describes the Position inventory while Aggressive is active. Conservative and Aggressive use the same Position but never operate it simultaneously: the Trading Engine grants control to one strategy at a time and switches according to `conservativeTakeoverPercent`. The threshold calculation uses actual executed BUY fills only; open/unfilled BUY orders and their reserved quote commitment are excluded. The fallback transition must not duplicate or lose inventory when control moves from Aggressive to Conservative, or back again. No strategy receives a separate coin allocation.

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

The Portfolio changes only when an actual execution is applied. Price updates and order lifecycle events without executions do not change holdings. The pair-level Position is shared by Conservative and Aggressive and is the authoritative source for complete accounting and inventory availability, but only one strategy controls it at a time. The Trading Engine hands control to Conservative when actual executed BUY investment exceeds the configured `conservativeTakeoverPercent` of the pair's planned total quote budget (default 20%); open/unfilled BUY orders are excluded. Conservative retains control until the entire position is sold and the invested quote capital is recovered. If the position is losing money, new BUY orders stop while existing SELL orders remain active; a loss-making sale must never be forced just to switch strategies. See [Portfolio Domain](./domain/portfolio.md) for confirmed decisions and remaining open questions.

The engine owns reliable execution mechanics and coordinates application workflows. A strategy policy owns decisions such as when, where, and how much to buy or sell. Avoid duplicating broker/order lifecycle code in each strategy.

See [Architecture](./architecture.md) for the full responsibility split and interaction flow.

## Boundaries

- Strategy rules must not depend on a specific exchange SDK.
- Broker adapters must not contain strategy policy.
- Shared accounting must distinguish actual assets, reserved quantities, and strategy-owned inventory.
- Multiple active orders require explicit handling of partial fills, cancel/replace races, stale orders, insufficient balances, and concurrent updates.
- No strategy may bypass shared safety checks or broker constraints.

## Still to decide

The remaining questions are not blockers for the implemented Conservative
first-cycle workflow:

1. **Aggressive maximum price drop:** the exact threshold measurement and
   treatment of estimated SELL fees remain undecided.
2. **Aggressive partial-SELL BUY trigger:** placement price and duplicate
   threshold-crossing behavior remain to be specified.
3. **Aggressive fallback:** behavior when the consolidated recovery SELL is
   rejected, partially filled, or cannot be placed remains to be specified.
4. **Multi-pair shared assets:** quote-currency and inventory allocation across
   enabled pairs remains deferred. The first TESTNET configuration enables
   exactly one pair.
5. **Full order reservations:** durable and exchange-reconciled reservation
   behavior for partial fills, cancellations, rejections, and uncertain
   outcomes remains deferred beyond the current in-process single-pair flow.
6. **Restart and reconnect recovery:** persistence, historical exchange
   reconciliation, and unattended operation guarantees remain deferred until
   after the first real TESTNET cycle.
7. **Performance attribution:** strategy-specific attribution is optional and
   must not split the actual shared Position.

Third-asset commissions are explicitly unsupported for now and cause the
affected execution to fail closed. BUY and SELL commissions in the market's
base or quote asset are accounted from actual fills.

## Guidance for continuing the strategy discussion

The user is making product decisions, not taking a trading terminology test. Continue one unresolved decision at a time and use plain everyday English.

- Do not ask a question using unexplained trading or technical terms. Explain the idea in ordinary words first.
- Use a small numerical example with round numbers. Show what would happen under each option, not just the technical difference.
- Offer A/B options only when the alternatives are genuinely distinct and can be explained simply. Keep each option short.
- Ask only one question per turn. Do not bundle several decisions together.
- If the user says they do not understand, do not repeat the same question with slightly different wording. Explain the situation from the beginning, or ask what outcome they want.
- Never interpret confusion or silence as a decision. Record a rule only after the user clearly chooses it.
- After a decision, explain it back in plain English, update this document and the roadmap, then move to the next unresolved decision.

## Current implementation status

Conservative is the first executable strategy. The bootstrap composes it when
TESTNET trading is explicitly enabled. The current implementation includes
initial and standing BUY orders, upward trailing in the initial/post-recovery
phase, fixed next-BUY behavior after a BUY fill, recovery SELL planning,
cancel-and-reconcile replacement of an active SELL after a new BUY fills,
actual fill/commission accounting, profit-gated free-inventory allocation,
and immediate fill-driven reevaluation.

A fake-broker integration scenario covers the complete first recovery cycle,
including a second BUY arriving before the recovery SELL completes. This is
offline evidence only. A real Binance TESTNET run remains outstanding.
Aggressive, multi-pair shared-asset allocation, durable restart recovery,
comprehensive reconnect reconciliation, and Journal remain deferred.
