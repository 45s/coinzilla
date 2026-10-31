# Coinzilla — Free-Roll Strategy

**Document version:** `v0.014`
**Application:** `coinzilla/apps/bot-free-roll`
**Status:** Initial strategy specification
**Principles:** SOLID, stable, simple.

**Engineering roadmap:** [ROADMAP.md](./ROADMAP.md) — long-term architecture, safety invariants, AI contributor instructions, and sequenced PR backlog. Read it together with this strategy specification and the repository-root `ENGINEERING_STANDARDS.md` before implementing changes.\n\n**Optional Grid strategy:** [GRID-README.md](./GRID-README.md) and [GRID-ROADMAP.md](./GRID-ROADMAP.md) define the proposed BUY-cycle Grid mode and its staged migration. These documents do not change the current aggregated strategy or enable Grid behavior; the existing mode remains the default.

> **AI AGENT INSTRUCTIONS**
>
> This document is the source of truth for the current Free-Roll strategy.
>
> When this README is provided in a new conversation:
>
> - Read and understand the entire specification before proposing changes.
> - Preserve all agreed strategy rules.
> - Do not silently invent requirements or change the trading logic.
> - If a requirement is ambiguous or contradictory, identify it and ask a focused question.
> - Discuss strategy changes before implementing them.
> - Prefer simple, maintainable JavaScript and native Node.js APIs with minimal external dependencies.
> - When providing code, make it complete and copy-ready.
> - Do not assume a particular exchange or broker. The strategy must remain broker-independent.

---

## 1. Project context

The application is part of the Coinzilla project:

`coinzilla/apps/bot-free-roll`

The purpose of this application is to implement the Free-Roll trading strategy.

### Technical preferences

- Runtime: Node.js.
- Language: JavaScript.
- Configuration: JSON.
- Dependencies: minimal; prefer native Node.js functionality where practical.
- Architecture: trading strategy separated from broker-specific implementation.
- Trading scope: spot trading.
- Initial testing should use a safe test environment before live trading.
- Keep the implementation SOLID, stable, and simple.
- Avoid unnecessary abstractions, settings, and complexity.

### Broker independence

The strategy must not depend on a specific exchange.

A broker implementation is responsible for providing the required exchange capabilities, such as:

- Reading market prices.
- Reading symbol trading rules.
- Placing limit orders.
- Cancelling orders.
- Reading order status and fills.
- Reading balances.
- Reading actual commission amounts and commission assets, where available.
- Maintaining or restoring the state of its connections.

Different brokers may have different trading fees, zero-fee promotions, supported order types, quantity rules, and commission assets.

The strategy must use the capabilities and fee information available from the configured broker. It must not hardcode exchange-specific assumptions into the strategy.

For example, a broker may charge zero commission for an eligible maker execution, while another broker may charge a fee. The strategy should work correctly in either case.

---

## 2. Strategy purpose

The Free-Roll strategy aims to:

1. Accumulate free coins over time.
2. Recover invested capital as quickly as possible when profitable selling opportunities become available.
3. Cover all applicable trading commissions.
4. Earn at least a configured minimum net profit per completed recovery sale.
5. Maintain standing buy and sell limit orders whenever the strategy state and available inventory allow.
6. Never intentionally sell below the calculated profitability threshold.
7. Keep previously earned free coins permanently excluded from future trading calculations and sell quantities.

The strategy does not guarantee that an order will fill or that the market will reach a profitable price.

Its responsibility is to calculate valid orders, manage them safely, and avoid intentionally selling below the required net-profit threshold.

### Core principle

**Recover capital and earn the minimum required net profit while accumulating free coins. Do not sacrifice profitability to force a sale.**

---

## 3. Configuration

Use a keyed object structure similar to `package.json`.

Strategies are keyed by strategy name. Pairs are keyed by trading symbol.

### Current configuration proposal

```json
{
  "strategies": {
    "free-roll": {
      "enabled": true,
      "settings": {
        "minProfit": 0.01
      },
      "pairs": {
        "DOGEUSDT": {
          "enabled": true,
          "makerPercent": 0.075,
          "takerPercent": 0.075,
          "priceStepPercent": 0.05,
          "orderQuantity": 400,
          "keepQuantity": 1,
          "pricePrecision": 5,
          "quantityPrecision": 0
        },
        "SOLFDUSD": {
          "enabled": false,
          "makerPercent": 0,
          "takerPercent": 0.075,
          "priceStepPercent": 0.05,
          "orderQuantity": 1,
          "keepQuantity": 0.01,
          "pricePrecision": 2,
          "quantityPrecision": 3
        },
        "ZROUSDT": {
          "enabled": false,
          "makerPercent": 0.075,
          "takerPercent": 0.075,
          "priceStepPercent": 0.05,
          "orderQuantity": 5,
          "keepQuantity": 0.01,
          "pricePrecision": 3,
          "quantityPrecision": 1
        }
      }
    }
  }
}
```

The commission values above are examples, not universal defaults. Configure them for the actual broker, account, symbol, and execution conditions.

### Buy-step percentage

`priceStepPercent` is a percentage, not an absolute quote-currency amount. A value of `0.05` means 0.05% (five hundredths of one percent). The strategy calculates the buy limit as `basePrice * (1 - priceStepPercent / 100)`, where `basePrice` is the last buy price when available, otherwise the initial reference price. For example, a base price of `0.07929` and `priceStepPercent: 0.05` produce an unrounded limit of `0.079250355`; the broker's tick-size rules may round the submitted limit down.

### Configuration fields

| Field                       | Meaning                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------- |
| `strategies`                | Object containing all strategy configurations                                         |
| `free-roll`                 | Configuration for this strategy                                                       |
| `enabled`                   | Enables or disables a strategy or individual pair                                     |
| `settings.minProfit`        | Minimum required net profit per completed recovery sale, in the pair's quote currency |
| `makerPercent`             | Expected maker commission percentage for this pair; 0.075 means 0.075%               |
| `takerPercent`             | Expected taker commission percentage for this pair; 0.075 means 0.075%               |
| `pairs`                     | Object containing per-pair settings                                                   |
| `priceStepPercent`                 | Percentage decrease from the reference or last buy price that triggers the next buy; 0.05 means 0.05% |
| `orderQuantity`             | Base-asset quantity for each buy order                                                |
| `pricePrecision`          | Internal price-formatting precision; submitted prices are always rounded to the broker's actual tick size |
| `quantityPrecision`       | Legacy configuration metadata; submitted quantities are always rounded to the broker's actual step size |
| `keepQuantity`              | Base-asset quantity to retain as free coins per completed recovery cycle              |

### Price tick-size resolution

Before subscribing to prices, the bot must fetch each enabled symbol's `PRICE_FILTER.tickSize`, `LOT_SIZE.stepSize`, base asset, quote asset, and supported order types from broker market information. If this metadata is unavailable or incomplete, the pair must fail startup; configured precision values must not be treated as substitutes for exchange trading rules.

Recovery SELL quantities are rounded **down** to the resolved quantity step before calculating the minimum profitable price. This avoids Binance precision errors without selling more than the available strategy quantity. If rounding leaves no valid quantity, the bot does not submit a SELL order.

### Commission rate format

Commission rates are configured **per trading pair** as human-readable percentages.

- `0` means 0%.
- `0.075` means 0.075%.
- `0.1` means 0.1%.

The bot converts percentages to decimal rates by dividing by 100. For example, `0.075` becomes `0.00075` for calculations.

Configured rates are planning assumptions only. Actual BUY and SELL accounting must use the commission amount and asset reported for each executed fill. Never book a configured percentage as an actual fee.

The bot uses the configured maker rate to choose the execution mode, then combines the expected fee ceiling with actual fill data:

- With `makerPercent: 0`, the order is `LIMIT_MAKER`; the configured SELL fee reserve starts at zero, regardless of `takerPercent`. If an actual BUY fill nevertheless reports a fee, its effective rate is used for SELL coverage.
- With `makerPercent > 0`, the order is regular `LIMIT`; the configured SELL fee ceiling is the higher of maker/taker rates because the order may execute as either maker or taker.
- Every actual BUY fill is inspected. Its effective commission rate (amount converted from base/quote asset to quote notional) can raise the SELL fee reserve above the configured ceiling.
- Actual SELL commissions are also recorded and can raise the rate used by subsequent SELL plans.

BUY commissions are never estimated into accounting: each actual BUY fill supplies its own commission amount and asset.

### Order type selection

The configured maker rate also selects the order type for both BUY and SELL:

- `makerPercent: 0` — submit `LIMIT_MAKER` (post-only). Binance must reject an order that would immediately take liquidity. An accepted order can only fill as maker. The expected SELL fee reserve is zero, but actual fill commission is still recorded and checked.
- `makerPercent > 0` — submit regular `LIMIT`. It may execute as maker or taker. The configured maker/taker rate ceiling is used for SELL coverage only after an actual fill reports a non-zero commission. If BUY fills are commission-free, no SELL fee reserve is added.

`LIMIT_MAKER` does not guarantee an order will be accepted or filled. If Binance rejects it because it would immediately match, the pair pauses; the bot must not silently fall back to a regular LIMIT order. Maker execution also does not universally guarantee zero commission. The configured zero maker rate must match the effective account/symbol fee schedule. If the exchange reports an unexpected non-zero fee, actual accounting uses it.

A regular LIMIT order may execute immediately as taker. Its actual commission is read from each fill and included in the recovery calculation.

### Commission-asset restriction

The strategy must reject an enabled trading pair before startup if the broker/account commission configuration requires commissions to be paid in a third asset (an asset other than that pair's base or quote asset). The strategy does not acquire, hold, convert, or spend third assets to pay trading fees. Do not assume a pair is eligible merely because its quote asset is FDUSD or because a zero-fee promotion may exist; verify the effective commission configuration for the account and pair.

If an execution unexpectedly reports a non-zero commission in a third asset despite the pre-start check, record the reported fill and fee facts unchanged, mark accounting incomplete, and pause the affected pair. Do not convert or value the fee, approve further orders, or claim net profitability until the discrepancy is resolved. Explicit zero commission is not a third-asset fee.

### Settings deliberately omitted

Do not add settings such as `profitTarget`, `maxInvestment`, `maxPositionQuantity`, `cooldown`, or `orderTimeout` unless the user requests them or a concrete implementation requirement justifies them.

The current priority is to implement the smallest correct version of the strategy.

---

## 4. Buy trigger and standing buy orders

Each pair maintains its own last qualifying buy price.

`priceStepPercent` is a percentage, not an absolute price amount. The strategy calculates the next buy limit as `basePrice * (1 - priceStepPercent / 100)`, using the last qualifying buy price when available, otherwise the initial reference price.

For example:

- Base price: `0.100`
- Configured `priceStepPercent`: `0.05` (0.05%)
- Next buy limit before tick-size rounding: `0.09995`

When the trigger condition is reached, the strategy must initiate the next buy according to the pair's configured `orderQuantity`.

### Important order-placement rule

The strategy must not wait for a future price trigger before creating the next buy order.

After a buy fills, the bot should normally maintain two orders:

1. A sell limit order at a price that satisfies the net-profit requirement.
2. A buy limit order at the next configured buy price.

Both orders are placed and wait for execution.

The next buy limit order is intended to execute if the market falls to its price. The sell limit order is intended to execute if the market rises to its profitable price.

The buy trigger determines the price of the next standing buy order; it is not a reason to delay placing that order.

### Market-price source

Use the **last traded price** as the market-price source for both initial entry and ongoing price monitoring.

- For the initial BUY, use the last traded price as the reference, then apply the pair's configured `priceStepPercent` using the initial-entry formula below.
- For subsequent BUYs, use the last traded price to monitor the market against the standing BUY limit. The standing BUY limit itself is calculated from the last qualifying buy price (or the initial reference when no qualifying buy exists) using the existing buy-step formula.
- Do not substitute best bid/ask or another market-data source without an explicitly approved strategy decision.

This decision selects the price source; it does not define freshness thresholds, stream-gap handling, or other market-data quality rules. Those remain implementation requirements under FR-024. If the last-trade observation is invalid, stale under the eventual FR-024 policy, or unavailable, the strategy must fail closed rather than make a price-based trading decision.

---

## 5. Standing order lifecycle

The strategy maintains a working position and manages its buy and sell orders as a coordinated state machine.

### Initial state

When a pair has no active trading position and no outstanding orders, the strategy needs a defined initial buy price and sufficient available funds before placing the first buy order.

The initial BUY reference is the last traded price. Apply the pair's configured `priceStepPercent` and round the resulting limit down to the broker's valid price increment. Do not submit if the required last-trade observation or trading rules are unavailable or invalid.

### After a buy order fills

Suppose the strategy buys 100 DOGE.

It should:

1. Record the actual filled quantity, quote cost, commission, and commission asset.
2. Update the active trading position and its cost basis.
3. Calculate the next buy price using `priceStepPercent`.
4. Calculate a profitable sell order for the active position, retaining the configured `keepQuantity` for the current recovery cycle.
5. Place or maintain the next buy limit order.
6. Place or maintain the sell limit order.

Both orders should be standing simultaneously whenever the strategy state permits.

### When another buy fills before the sell

Suppose the bot has bought 100 DOGE and has a sell order for 99 DOGE.

The next buy order fills for another 100 DOGE.

The bot must:

1. Record the new fill and actual commission.
2. Cancel the previous sell order if it remains open.
3. Reconcile the cancellation result and any fills that occurred during cancellation.
4. Recalculate the active position, costs, fees, and sellable quantity.
5. Replace the old sell order with a new order for the recalculated quantity.
6. Ensure the next buy order is still correctly maintained.

For two fully filled buys totalling 200 DOGE, the intended replacement sell quantity is 199 DOGE.

For three fully filled buys totalling 300 DOGE, the intended replacement sell quantity is 299 DOGE.

The strategy retains one DOGE per completed recovery cycle, not one DOGE for every buy order.

### When the sell fills before the next buy

Suppose the bot has bought 100 DOGE and has orders to sell 99 DOGE and buy another 100 DOGE.

The 99 DOGE sell order fills first.

The strategy must:

1. Reconcile the actual sale proceeds and commissions.
2. Verify that the sale satisfies the required net-profit condition.
3. Allocate the remaining 1 DOGE as free coins only after the recovery SELL is fully filled and actual net profit meets `minProfit`.
4. Exclude that free DOGE from all future trading-position calculations and sell quantities.
5. Maintain or place the next buy order as appropriate.
6. Prepare a new recovery sell order for any newly acquired active position.

If the outstanding buy order subsequently fills, the new purchase starts or extends an active trading position. The previously retained free DOGE remains excluded.

### Partial-fill policy

If any order is partially filled, the strategy waits until that order is fully filled before proceeding to the next strategy step. A partial fill does not trigger position recalculation for the purpose of advancing the strategy, a replacement order, or another buy/sell decision. The order remains in progress; the strategy must continue observing and reconciling its status and executions. Fill-level records still need to be captured accurately, including while the order is partially filled.

### Immutable execution records

Each accepted fill is captured as an immutable record containing its trade ID, broker order ID, market, side, exact price/quantity/quote values, and reported commission facts. Repeated identical fills are idempotent; reusing a trade ID with changed execution facts is treated as an accounting discrepancy and pauses the pair.

The current replay projection reconstructs execution-derived accounting for one recovery window. It is not durable storage and does not yet reconstruct completed-cycle, free, reserved, or external inventory events. Those remain separate roadmap work under FR-038–FR-046 and FR-062/FR-063.

### Per-market inventory accounting

Each market now maintains its own strategy-owned base quantity, signed quote cash flow, and commission totals by asset. A fill whose symbol does not match that market ledger is rejected; base and quote values are never mixed across pairs.

Explicitly attributed deposits, withdrawals, or other unmanaged movements are recorded in a separate bucket using stable source IDs. They do not change strategy-owned quantities or cash flow. That bucket remains marked `unreconciled` until account-balance reconciliation can establish the complete external position; the bot does not assume that an exchange balance belongs to the strategy.

### Cancellation and replacement safety

A cancellation request does not guarantee that an order had zero fills.

An order may partially or completely fill while cancellation is in progress.

Before placing a replacement sell order, the strategy must reconcile the old order's final status and actual fills. It must not reuse stale quantities or reserve the same coins for multiple sell orders.

If the strategy cannot establish a safe, consistent position and order state, it should stop placing replacement orders until the state is reconciled.

---

## 6. Free-coin accounting

### Fundamental rule

**Once a coin is earned as free inventory, it must never be included in future active-position calculations or future sell orders.**

Free coins are retained inventory and a reporting metric. They are not working capital for the strategy.

### Meaning of `keepQuantity`

`keepQuantity` is the amount of base asset retained per completed recovery cycle.

It is not the amount retained for every buy order.

Example for DOGE:

- `orderQuantity`: 100 DOGE
- `keepQuantity`: 1 DOGE

If the active position grows to 300 DOGE before its recovery sell executes, the strategy should sell 299 DOGE and retain 1 DOGE.

It must not retain 3 DOGE simply because three buys occurred.

Example for ZRO:

- `orderQuantity`: 5 ZRO
- `keepQuantity`: 0.01 ZRO

A completed recovery cycle involving 5 ZRO allocates exactly 0.01 ZRO to free inventory. The planned SELL may be smaller than 4.99 ZRO when a conservative base-fee allowance or exchange quantity-step rounding is required. Any additional unsold ZRO remains active strategy inventory; it is not silently added to free inventory.

### Important distinction

Free coins are allocated to a completed recovery cycle, not automatically allocated to every buy fill.

A buy fill increases the active position. It does not independently create another free-coin allocation.

For example:

| Event                                        | Total bought | Target sell quantity | Free coins after a successful recovery sale |
| -------------------------------------------- | -----------: | -------------------: | ------------------------------------------: |
| First buy of 100 DOGE                        |          100 |                   99 |                                      1 DOGE |
| Second buy of 100 DOGE before the sell fills |          200 |                  199 |                                      1 DOGE |
| Third buy of 100 DOGE before the sell fills  |          300 |                  299 |                                      1 DOGE |

The free-coin amount shown in this table assumes the corresponding recovery sale subsequently completes and the required accounting conditions are satisfied.

Free coins are allocated only after the recovery SELL is fully filled and the actual net profit meets `minProfit`. At that point, transfer **exactly `keepQuantity`** from the remaining active inventory to the free-inventory bucket. Do not transfer the entire residual position.

If the residual position is larger than `keepQuantity` because of conservative fee allowance, actual fee treatment, or quantity-step rounding, allocate only `keepQuantity`; leave the excess in active strategy inventory for the next recovery cycle. The completed cycle's recovered cost and sale proceeds are reset, so this carry-forward residual has no unrecovered cycle cost. It remains eligible for future strategy SELL planning, while the free-inventory bucket remains permanently excluded.

If the residual position is smaller than `keepQuantity`, pause the pair and allocate nothing. If the SELL is canceled after a partial fill, allocate no free coins: reconcile the actual execution, and keep the remaining position active. A partial fill or order status alone never creates free inventory.

### Separate accounting buckets

The strategy must distinguish:

1. **Active trading position:** Coins whose acquisition costs are currently managed by the strategy.
2. **Free coins:** Coins retained from completed recovery cycles and permanently excluded from future trading orders.
3. **Open-order reservations:** Quantities reserved by active orders or involved in partial fills.
4. **External inventory:** Deposits, transfers, and manual trading activity that do not belong to the strategy. Keep these quantities and their history separate from active-position cost basis and free coins; never automatically adopt them into the strategy position.

Never calculate the active sell quantity by blindly subtracting a fixed amount from the exchange's total wallet balance. Other holdings, fees, open orders, and deposits may affect that balance.

Use the strategy's own reconciled ledger and actual broker data.

---

## 7. Net-profit calculation

`minProfit` is the minimum required **net profit after all applicable trading commissions**.

For example, if `minProfit` is `0.01`, the recovery sale must leave at least 0.01 units of the quote currency in net profit after recovering the relevant invested capital and accounting for fees.

The strategy must not intentionally place a sell order below its calculated profitability threshold.

### Actual execution data

Record at least:

- Actual filled buy quantities.
- Actual quote amounts spent on buys.
- Actual filled sell quantities.
- Actual quote proceeds from sales.
- Actual commission amount and commission asset for every fill, where available.
- Order IDs, statuses, and partial fills.
- Active-position cost basis and relevant realized proceeds.
- Free-coin allocations.

Configured maker/taker rates are planning estimates, not substitutes for actual execution records.

### Simplified calculation when fees are charged in quote currency

Suppose:

- Active buy cost: `19.80 FDUSD`
- Buy commissions: `0.02 FDUSD`
- Minimum net profit: `0.01 FDUSD`
- Expected sell fee rate: `0.001`, or 0.1%

Required net amount before sell commission:

`19.80 + 0.02 + 0.01 = 19.83 FDUSD`

Required gross sale proceeds:

`requiredGrossSellProceeds >= 19.83 / (1 - 0.001)`

`requiredGrossSellProceeds >= 19.849849... FDUSD`

The minimum sell price is:

`minimumSellPrice = requiredGrossSellProceeds / sellQuantity`

The price must then be rounded up to a valid price increment, and the result must be checked again to ensure that the profitability threshold remains satisfied.

This simplified calculation assumes the relevant costs and commissions are denominated in the quote currency and that the entire relevant active-position cost must be recovered by this sale.

### Pooled recovery accounting across sells

Recovery accounting is cumulative for the active recovery cycle. It is separate from the per-coin cost-basis allocation model; this policy does not introduce FIFO lots or redesign how base-asset cost basis is assigned.

- Add each BUY fill's actual quote-denominated acquisition cost and applicable quote-denominated BUY commission to the cycle's recovery cost.
- Credit each SELL fill's actual quote proceeds after applicable quote-denominated SELL commission against that recovery cost. Use confirmed fills only; never count an open order's estimated or expected proceeds.
- The outstanding recovery amount is the cycle's cumulative eligible BUY costs minus cumulative net SELL proceeds, floored at zero. Any realized surplus is tracked separately as realized profit; it is not an unrealized valuation of the remaining coins.
- Preserve this cumulative accounting across partial fills, canceled orders, and replacement SELL orders. Replacing an order must not reset or duplicate previously recorded costs or proceeds.
- A partial SELL fill or a SELL canceled after partial execution credits its actual net proceeds, but allocates no free coins. The unsold strategy inventory remains active, and the outstanding recovery amount carries forward to the next recovery SELL.
- Allocate `keepQuantity` only when the recovery cycle is completed by a fully filled recovery SELL and cumulative actual net profit for that cycle is at least `minProfit`. Never infer completion from order status without reconciling its fills.
- Do not count the market value of unsold coins as recovered capital or realized profit.

Example (quote-currency fees): BUY 100 DOGE for 10.00 FDUSD including BUY fees. A SELL then fills 40 DOGE and produces 4.50 FDUSD net of SELL fees. Credit 4.50 FDUSD; the cycle's outstanding recovery amount becomes 5.50 FDUSD. If that SELL is canceled, the remaining 60 DOGE stay active and no free DOGE is allocated. A later recovery SELL continues from the same 5.50 FDUSD outstanding amount; it does not start a new recovery balance.

This pooled balance is a recovery-cash accounting measure, not a replacement for the active position's quantity or cost-basis records. Actual base-asset commissions still affect inventory quantities under the existing commission rules. Third-asset commission handling remains unchanged: preserve an unexpected fee and pause the pair without converting or valuing it.

### Base-asset commissions and unsupported third assets

The strategy supports commissions charged in the pair's quote asset or base asset, as well as explicit zero commissions. A base-asset commission changes the net base quantity available after a BUY or consumed by a SELL, so it must be recorded and reflected in inventory accounting.

Third-asset commissions are not supported. Reject a pair before startup when its effective account/pair commission configuration requires a third asset. If a non-zero third-asset commission unexpectedly appears on a fill, preserve the reported fill and fee facts unchanged, mark accounting incomplete, and pause the pair. Do not convert or value the fee, claim net profitability, or place further orders until the discrepancy is resolved.

A missing commission amount or asset is not equivalent to zero; mark the affected accounting incomplete and fail closed.

### Zero-fee executions

If the actual applicable commission is zero, the calculation must not add a fictitious commission.

If the configured fee is zero but the broker reports an actual commission, use the actual commission in the accounting ledger and account for any discrepancy in future calculations.

### Maker versus taker

A limit order may execute as maker or taker.

The strategy should use a conservative fee estimate when planning an order if the eventual execution type is unknown. After fills, it must use actual commission data.

The strategy must not assume that placing a limit order guarantees maker treatment.

### Profitability guarantee

No order-price calculation guarantees that an order will fill. Market prices may never reach the target, and execution conditions can change.

The strategy's guarantee is limited to its own behavior: it must not intentionally submit a sell price below the calculated net-profit threshold.

If the required profitable price is not reached, the strategy waits.

---

## 8. Worked examples

These examples illustrate the intended strategy. Actual orders must account for real execution prices, fees, and broker trading rules.

### Example A — first DOGE buy

Configuration:

- `orderQuantity`: 100 DOGE
- `keepQuantity`: 1 DOGE
- `minProfit`: 0.01 FDUSD

Suppose 100 DOGE are bought for 10 FDUSD.

The bot prepares:

- Sell limit order: 99 DOGE.
- Buy limit order: another 100 DOGE at the next configured buy price.

The sell price must recover the relevant invested capital, cover applicable commissions, and earn at least 0.01 FDUSD net profit.

The remaining DOGE becomes free inventory only when the recovery cycle's actual execution and accounting confirm that allocation.

### Example B — second buy before the first sell fills

Suppose:

- First buy: 100 DOGE for 10 FDUSD.
- Current sell order: 99 DOGE.
- Current buy order: another 100 DOGE.
- The second buy order fills for 9.80 FDUSD.

The strategy cancels and reconciles the old sell order.

New position:

- Total bought: 200 DOGE.
- Total acquisition cost before commissions: 19.80 FDUSD.
- Target sell quantity: 199 DOGE.
- Target free inventory after successful recovery: 1 DOGE.

The replacement sell price must account for the total relevant active-position costs and commissions and earn at least 0.01 FDUSD net profit.

### Example C — third buy before the sell fills

Suppose a third buy of 100 DOGE fills before the current recovery sell order completes.

The strategy cancels and reconciles the previous sell order and recalculates the position.

New position:

- Total bought: 300 DOGE.
- Target sell quantity: 299 DOGE.
- Target free inventory after successful recovery: 1 DOGE.

This is the intended behavior. The retained amount is per completed recovery cycle, not per buy.

### Example D — the recovery sell completes

Suppose the 99 DOGE sell order from Example A fills and satisfies the net-profit requirement.

The bot accounts for:

- Actual sale proceeds.
- Actual sell commission.
- Recovered investment.
- Realized net profit.
- The remaining 1 DOGE as free inventory.

The bot then continues operating by maintaining the next buy order and managing the next active position.

The free DOGE is never included in subsequent sell quantities.

### Example E — ZRO

Configuration:

- `orderQuantity`: 5 ZRO
- `keepQuantity`: 0.01 ZRO

For a recovery cycle involving 5 ZRO:

- Target sell quantity: 4.99 ZRO.
- Free inventory after successful recovery: 0.01 ZRO.

If the active position grows to 10 ZRO before the recovery sale completes:

- Target sell quantity: 9.99 ZRO.
- Free inventory after successful recovery: 0.01 ZRO.

The quantities must satisfy the broker's quantity increments, minimum quantities, and minimum notional requirements.

If the configured quantity cannot be traded validly, the strategy must fail safely with a clear error rather than silently changing the intended free-coin amount.

---

## 9. Statistics

The bot should provide useful statistics while running and when it stops.

Example desired report after 10 hours:

```text
Free-Roll Statistics
Runtime: 10h

DOGEFDUSD
  Free coins earned:        17 DOGE
  Average acquisition cost: 0.08 FDUSD / DOGE
  Free-coin cost basis:     1.36 FDUSD
  Total bought:             1700 DOGE
  Total sold:               1683 DOGE
```

This example is illustrative. The simple relationship between total bought, total sold, and free coins is only valid when there are no other holdings, open orders, partial fills, fee deductions in the base asset, or other balance movements that affect the quantities.

### Recommended statistics

For each pair, report:

- Total actual base quantity bought.
- Total actual base quantity sold.
- Free quantity earned.
- Average acquisition cost of free coins.
- Free-coin cost basis in quote currency.
- Active position quantity.
- Remaining active-position cost basis.
- Realized net profit/loss.
- Buy commissions and sell commissions, including fee assets.
- Current buy and sell order statuses.
- Partial fills and outstanding quantities.
- Runtime.

Free-coin statistics must not be used as inputs to future trading calculations.

Do not label the market value of retained coins as realized profit. Report acquisition cost, realized net profit, and current market valuation as distinct concepts.

The cost-basis allocation method for free coins must be documented and consistent with the strategy's actual accounting.

---

## 10. Order and state safety

The strategy must:

- Maintain separate active-position and free-coin accounting.
- Reconcile order status and actual fills before replacing orders.
- Handle partial fills and cancel/fill races.
- Avoid duplicate or overlapping sell orders that could sell the same inventory twice.
- Reconcile state after reconnects or process restarts.
- Avoid assuming that a cancellation request means the order has no fills.
- Respect broker-provided price and quantity rules.
- Validate order quantity, price increments, minimum/maximum quantities, and minimum notional requirements.
- Never intentionally sell below the calculated net-profit threshold.
- Never include previously earned free coins in future sell orders.
- Avoid silently rounding quantities in a way that violates the configured free-coin target.
- Validate configuration before trading starts.

### Trading readiness states (FR-006)

Readiness is tracked **per enabled pair**. The bot process lifecycle (running or stopped) is separate from a pair's trading readiness. Disabled pairs are excluded from this state machine.

A state describes which operations are currently safe; it is not merely a display label.

| State | Meaning | Allowed actions | Forbidden actions |
| --- | --- | --- | --- |
| `INITIALIZING` | The pair is being prepared. Configuration, required broker capabilities, effective commission policy, market rules, connections, and the available local/broker state are being checked. | Validate configuration; inspect broker capabilities and fee policy; load market rules; connect and subscribe; read balances, orders, and fills; reconcile facts. | Submit, cancel, or replace strategy orders. |
| `READY` | All required readiness gates have passed and the pair has a consistent starting state. No strategy order is currently being managed for this pair. | Evaluate the initial strategy action; submit an initial order only after its order-specific validation and profitability/funding checks pass; observe market and account events. | Submit an order with missing, stale, invalid, or unreconciled inputs; bypass order validation. |
| `ACTIVE` | The pair is operating the strategy with a consistent position/order view. Working orders may exist. | Observe events; account and reconcile fills; submit, cancel, or replace strategy orders only through the approved safety and profitability workflows. | Sell free/external inventory; overlap reservations; replace an order before final status/fills are reconciled; act on uncertain inputs. |
| `RECONCILING` | The pair's state may be incomplete or uncertain and is being compared with authoritative broker facts. | Read balances, open orders, order history, fills, and market rules; deduplicate/apply known executions; produce discrepancy diagnostics. | Create, cancel, or replace strategy orders; release reservations without evidence; resume strategy decisions before reconciliation completes. |
| `PAUSED_UNSAFE` | A safety invariant failed, required facts are unknown/inconsistent, or the pair cannot prove that another action is safe. | Preserve diagnostics; inspect state through read-only broker queries; record the pause reason; request an explicit recovery/reconciliation action. | Any automatic strategy order creation, cancellation, replacement, or automatic resume. Existing exchange orders are not implicitly canceled. |
| `STOPPED` | The pair has been explicitly stopped, or the bot process has been stopped. | Read statistics and diagnostics; perform an explicit later start, which begins again at `INITIALIZING`. | New strategy orders or automatic resumption. Existing exchange orders are left untouched unless a separate, explicit and safe operator workflow is approved. |

#### Transition rules

| From | To | Required trigger / guard |
| --- | --- | --- |
| `INITIALIZING` | `READY` | Every required startup gate passes: valid pair configuration; required broker capabilities and fee policy verified; usable trading rules loaded; required connections established; market-data quality accepted under FR-024; and local state, balances, open orders, and fills reconciled to the extent required by the recovery contract. |
| `INITIALIZING` | `PAUSED_UNSAFE` | A required fact is invalid, unavailable, unsupported, or inconsistent and cannot be safely resolved during initialization. |
| `READY` | `ACTIVE` | The pair is explicitly activated for strategy operation. The first order still passes all order-specific validation immediately before submission. |
| `READY` or `ACTIVE` | `RECONCILING` | Disconnect/reconnect, stream gap, ambiguous create/cancel outcome, cancel/fill race, restart, or any other event makes local order, fill, balance, or reservation state uncertain. |
| Any non-`STOPPED` state | `PAUSED_UNSAFE` | A safety invariant fails, including unexpected third-asset commission, unexplained balance/inventory mismatch, invalid trading rules, incomplete accounting, or an unresolvable order/fill discrepancy. |
| `RECONCILING` | `READY` | Reconciliation succeeds and proves there is no active strategy position or working strategy order. |
| `RECONCILING` | `ACTIVE` | Reconciliation succeeds and reconstructs a consistent active position and/or working strategy orders. |
| `RECONCILING` | `PAUSED_UNSAFE` | Required evidence is unavailable or any discrepancy remains unresolved. |
| `PAUSED_UNSAFE` | `RECONCILING` | An operator explicitly requests recovery. This does not itself authorize trading. |
| Any state | `STOPPED` | An explicit stop is requested. The stop operation does not imply cancellation of exchange orders. |
| `STOPPED` | `INITIALIZING` | An explicit start/restart is requested. Startup gates and reconciliation must run again; the pair must never jump directly to `READY` or `ACTIVE`. |

A pair that entered `PAUSED_UNSAFE` must not return to `READY` or `ACTIVE` automatically. It first enters `RECONCILING` through an explicit recovery request. Only a successful reconciliation can select the safe destination state. A failed or incomplete reconciliation returns it to `PAUSED_UNSAFE`.

#### Readiness is a gate, not a claim about current implementation

The state names and rules above define the target contract. They do **not** mean the current bot already enforces these states. The current implementation has a process-level running flag and a per-pair `paused` boolean; it does not yet perform complete startup reconciliation of persisted state, balances, open orders, and fills. Until the relevant readiness and reconciliation work is implemented and tested, the application must not be considered production-ready, and a successful subscription setup alone must not be described as `READY`.

The exact reconciliation snapshot, persistence, stream recovery, and operator-controlled resume mechanisms remain implementation work under FR-057–FR-066. Market-data freshness and gap criteria remain under FR-024. This section defines their required relationship to readiness without prematurely choosing their detailed contracts.

### Configuration validation

At minimum:

- `minProfit` must be positive.
- Per-pair `makerPercent` and `takerPercent` values must be finite percentages in the range `0` (inclusive) to `100` (exclusive). The bot converts them to decimal fractions internally.
- `priceStepPercent` must be greater than 0 and less than 100; it is expressed in percentage points (for example, `0.05` means a 0.05% decrease).
- `orderQuantity` must be positive.
- `keepQuantity` must be non-negative and smaller than `orderQuantity`.
- The intended sell quantity must comply with the broker's trading rules.
- Symbols and broker capabilities must be validated before trading.
- Disabled strategies or pairs must not initiate new trades.

Do not place orders when configuration is invalid or the active position cannot be reconciled safely.

---

## 11. Approved decisions and open design questions

### Approved decision — wait for full order fills

A partially filled order remains in progress. The strategy waits until the order is fully filled before proceeding to its next strategy step. Partial execution alone does not trigger a new buy/sell decision or replacement order. The broker's order status and actual fills must still be observed and reconciled while waiting.

### Approved decision — free-coin allocation

Allocate `keepQuantity` as free coins only after the recovery SELL is fully filled and the actual net profit meets `minProfit`. If the SELL is canceled after a partial fill, allocate no free coins. Reconcile the actual execution and keep the remaining position active. A partial fill, cancellation request, or order status alone does not complete a recovery cycle or create free inventory.

### Approved decision — initial and ongoing price source

Use the **last traded price** as the market-data source for both initial entry and ongoing price monitoring.

For the first BUY, calculate the limit from the last traded price:

`initialBuyLimit = lastTradedPrice * (1 - priceStepPercent / 100)`

For subsequent BUYs, monitor the last traded price against the standing BUY limit. Calculate that limit from the last qualifying buy price (or the initial reference price when no qualifying buy exists):

`nextBuyLimit = lastQualifyingBuyPrice * (1 - priceStepPercent / 100)`

Round BUY limit prices down to the broker's valid price increment. If the required last-trade observation or trading rule is unavailable or invalid, the strategy must not make the corresponding price-based trading decision.

This decision selects the price source only. Freshness thresholds, stream-gap handling, and other market-data quality rules remain open implementation requirements under FR-024.


### Approved decision — manual wallet activity

Wallet activity outside this strategy is external activity and must never be silently incorporated into strategy accounting.

- Deposits and transfers into the trading wallet are classified as **external inventory**. They do not increase the strategy's active position or count as recovered capital.
- Manual buys and sells are recorded as **external activity**, not as strategy executions. They do not change strategy cost basis, realized proceeds, or free-coin allocation.
- If a withdrawal or an unexplained balance change affects, or may affect, strategy-owned inventory, pause the affected pair.
- Resume the pair only after explicit reconciliation establishes a safe, consistent ownership and order state. Never silently adjust the strategy ledger to match the wallet balance.
- Keep external inventory distinct from active trading inventory, free coins, and open-order reservations. If ownership cannot be established confidently, fail closed and require reconciliation.

These questions remain unresolved and must not be silently guessed during implementation.

1. **Order replacement:** When should an existing sell limit order be amended or replaced if market prices move but no new buy has filled?
2. **Available capital:** How should the bot behave when it cannot afford the next standing buy order?
3. **Restart recovery:** Which state must be persisted locally, and which state must be reconstructed from the broker after restart?

Ask only the question that blocks the current design decision. Do not overwhelm the user with every open question at once.

---

## 12. Versioning

Current version: **`v0.010`**

This document is the initial strategy specification. It does not imply that the strategy is implemented, tested, or production-ready.

When the user explicitly approves a meaningful change to the strategy or configuration:

1. Update this README.
2. Increment the version according to the project's chosen versioning convention.
3. Add a changelog entry.
4. Preserve the full strategy context so the README remains usable as a standalone prompt for another AI agent.

Do not change agreed strategy behavior without explicit discussion.

### Changelog

- `v0.011` — Defined per-pair trading readiness states, safe transitions, and allowed/forbidden actions. Clarified that readiness requires reconciliation and is not currently enforced by the existing running/paused flags.
- `v0.010` — Approved pooled recovery accounting: actual net SELL proceeds are credited cumulatively against BUY costs across partial fills, cancellations, and replacement sells; free coins are allocated only after a fully filled recovery SELL and the cumulative net-profit threshold is met.
- `v0.009` — Approved manual wallet activity policy: deposits/transfers and manual buys/sells remain external to strategy accounting; pause when withdrawals or unexplained changes may affect strategy-owned inventory; resume only after explicit reconciliation. Added external inventory as a separate accounting bucket.
- `v0.008` — Approved and documented commission-aware order selection: use `LIMIT_MAKER` when `makerPercent` is zero, regular `LIMIT` otherwise; account actual base/quote commissions from each fill and reserve the configured conservative SELL fee only for regular LIMIT orders.
- `v0.007` — Clarified the approved commission policy: support quote/base/zero commissions, reject pairs requiring third-asset fees, and pause on unexpected third-asset fees without conversion or valuation.
- `v0.006` — Approved free-coin allocation: allocate `keepQuantity` only after the recovery SELL is fully filled and actual net profit meets `minProfit`; a SELL canceled after partial execution allocates no free coins and the remaining position stays active.
- `v0.005` — Approved wait-for-full-fill behavior: a partially filled order remains in progress and the strategy does not advance to its next step or create a replacement/new strategy order based on the partial fill alone.
- `v0.004` — Approved last-traded-price source for both initial entry and ongoing price monitoring; clarified that subsequent BUY limits remain anchored to the last qualifying buy price. Market-data freshness and quality rules remain under FR-024.
- `v0.003` — Approved initial entry pricing: use the last traded price as the reference, apply the configured `priceStepPercent`, and round the BUY limit down to the broker's valid tick size; fail closed when required price/rule data is unavailable.
- `v0.002` — Replaced the absolute `priceStep` setting with `priceStepPercent`; documented percentage semantics and the buy-threshold calculation.
- `v0.001` — Initial Free-Roll specification covering broker-independent design, keyed JSON configuration, standing buy and sell orders, replacement behavior after new buys, net-profit accounting, commissions, free-coin accounting, statistics, safety rules, and unresolved design questions.


## Optional Telegram notifications

The Free-Roll app can send operational alerts through the reusable `@coinzilla/notifiers` package. Telegram is **disabled by default**.

Set both variables in the app's `.env` file to enable it:

```dotenv
TELEGRAM_BOT_TOKEN=123456789:replace_with_your_bot_token
TELEGRAM_CHAT_ID=-1001234567890
```

Create a bot with [@BotFather](https://t.me/BotFather), start a conversation with it (or add it to your group), and use the destination chat ID. Keep the token private; never commit a real token or chat identifier. Leave both variables unset to run without Telegram.

The app sends alerts for completed orders, individual fills, paused trading pairs, failed/completed recovery, and bot start/stop. No raw exchange event payloads or credentials are sent. Notification network failures are isolated from trading behavior and reported through the event-bus subscriber's logger.

On shutdown, the app stops trading, publishes its final lifecycle events, flushes accepted event-bus work, drains/unsubscribes the Telegram notifier, then closes the journal and event bus. Delivery is best-effort, not durable: a process crash can lose messages that were not yet delivered.
