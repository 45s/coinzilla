# Portfolio Domain

## Purpose

A **Portfolio** is the domain representation of the bot's spot positions. It contains one position for each configured spot market (trading pair).

For example, a portfolio may contain separate positions for `BTCUSDT`, `ETHUSDT`, and `ZROFDUSD`. A position describes the bot's holdings and trading activity for that pair. Conservative and Aggressive use the same position and inventory, but **only one strategy controls that position at a time**. The position is not duplicated or split by strategy. It is not a market-price snapshot and it is not an order.

The portfolio is updated from **executed fills**. Prices, submitted orders, open orders, and order-status changes without an execution do not change held quantities.

## Where it belongs

The domain model belongs under:

```text
src/
  domain/
    portfolio/
```

The application use case that coordinates portfolio updates belongs under:

```text
src/
  use-cases/
    update-portfolio.js
```

The use case is the application boundary between incoming execution facts and the domain model. It must not depend on Binance SDK types, WebSocket message formats, or other exchange-specific structures.

See [Harvester Architecture](../architecture.md) for the distinction between domain entities, strategy policies, use cases, the Trading Engine, and infrastructure adapters.

## Lifecycle and data flow

1. Bootstrap loads and validates `trading-config.json`.
2. The configured, enabled trading pairs are made available to the trading engine.
3. The market-data adapter subscribes to the broker's market streams.
4. Incoming prices are normalized and delivered to the selected strategy. A price update may cause the strategy to request an order, but it does not modify the portfolio.
5. The broker reports order lifecycle events. Submission, acknowledgement, cancellation, rejection, and expiration alone do not change portfolio holdings.
6. When an order executes, the broker adapter normalizes the execution into a domain-level fill.
7. The application calls `use-cases/update-portfolio.js` with the current portfolio and the normalized fill.
8. The use case applies the fill to the matching position and returns the updated portfolio (or an explicit failure). The strategy/engine then observes the updated portfolio when making subsequent decisions.

```text
trading-config.json
       |
       v
    Bootstrap
       |
       v
  Broker market stream -----> normalized prices -----> Strategy
                                                       |
                                                       v
                                                  order request
                                                       |
                                                       v
                                                     Broker
                                                       |
                                                execution / fill
                                                       |
                                                       v
                                           normalized domain Fill
                                                       |
                                                       v
                                      use-cases/update-portfolio.js
                                                       |
                                                       v
                                                   Portfolio
                                                       |
                                                       v
                                             updated Positions
```

## Core concepts

### Portfolio

- Contains multiple spot positions.
- Provides a single domain object for the bot's current position state.
- Is updated by applying fills, not by polling or copying ticker prices.
- Must not contain broker clients, sockets, timers, filesystem access, or exchange SDK objects.

### Position

A position is associated with exactly one spot market/pair (for example, `ZROUSDT`) and is shared by all strategy modes operating on that pair.

The agreed Position accounting responsibility includes:

- actual net base and quote quantities, represented with exact decimal arithmetic;
- quote capital invested and average entry cost;
- realized profit and actual commissions;
- base inventory reserved for open orders and the remaining available inventory.

These are shared pair-level accounting facts, not separate Conservative and Aggressive copies. The active strategy must consult and respect this accounting and its reservations. Strategy-specific decision state may remain separate, but it must not contradict the shared accounting. The Trading Engine grants operational control to only one strategy for a pair at a time; the inactive strategy must not submit or manage orders for that Position.

A market price is not part of the position's held-quantity accounting. If valuation is needed (including valuing commissions), it should be a separate calculation using an explicitly supplied price and a defined conversion rule.

### Aggressive strategy inventory

The agreed Aggressive strategy model uses **one shared inventory pool per market**:

- Filled quantities from different BUY orders contribute to the same available base-asset inventory.
- Inventory is not treated as a collection of exclusive coin lots permanently owned by individual BUY orders.
- Multiple SELL orders may coexist, but each SELL order reserves its remaining unfilled quantity from the shared pool.
- The sum of active SELL reservations must never exceed the available base quantity.
- A SELL fill reduces the shared inventory by the actual executed quantity and applicable commission.
- A cancelled or rejected SELL releases only its unfilled reservation. Any execution received during cancellation remains a real fill and must be applied.
- When Aggressive switches to Conservative, active SELL reservations are cancelled/reconciled and the remaining available position is consolidated into one SELL order. The transition must not count reserved or in-flight quantities twice.

This defines inventory sharing **inside Aggressive for one market**. Conservative and Aggressive do not operate that market simultaneously: the Trading Engine selects one active controller for the shared Position. Switching controllers requires the outgoing strategy to stop issuing new orders and the engine to reconcile/cancel its outstanding orders before the incoming strategy acts. Allocation of balances shared across different markets remains a separate open decision.

### Fill

A fill is an execution fact, not an order intention. It must carry enough normalized information to account for the executed portion of an order, including:

- market/pair and side (BUY or SELL);
- actual executed base quantity;
- actual executed quote quantity (or an exact execution price and quantity from which it can be derived);
- commission amount and commission asset, when charged;
- stable execution identity where the broker provides one, so duplicate delivery can be handled safely.

The broker adapter is responsible for translating exchange-specific payloads into this domain shape and validating them at the boundary.

## Applying a fill

For a spot fill, before commissions:

| Fill side | Base-asset delta | Quote-asset delta |
| --- | ---: | ---: |
| BUY | increase by executed base quantity | decrease by executed quote quantity |
| SELL | decrease by executed base quantity | increase by executed quote quantity |

Commission is then accounted for in the asset in which it was actually charged. If commission is charged in the base asset, the net base quantity is reduced. If charged in the quote asset, the net quote quantity is reduced. A commission charged in a third asset (for example, BNB commission on a `BTCUSDT` trade) is currently unsupported and the fill must be rejected as unsupported. Do not ignore the debit or invent a conversion rate. Supporting third-asset commissions requires a future explicit accounting and valuation decision.

Only the executed part is applied. A partially filled order updates the portfolio by that partial execution; a later fill applies only its own newly executed quantities. Never apply the original requested order quantity as if it had all executed.

## Responsibilities and boundaries

- **Market-data adapter:** obtains exchange prices and normalizes market data. It does not mutate the portfolio.
- **Broker adapter:** submits/cancels orders and translates broker execution reports into normalized fills.
- **Order lifecycle handling:** tracks order state. An order is not a position and an accepted order is not a fill.
- **`update-portfolio` use case:** validates the normalized fill's applicability, finds the matching position, delegates the domain update, and returns the result. It coordinates; it must not own strategy policy or exchange-specific parsing.
- **Portfolio domain:** enforces position/accounting invariants and calculates the state transition from a fill. It remains deterministic and I/O-free.
- **Strategy policy:** decides what to do using prices, orders, and portfolio state. It does not directly interpret raw broker messages or bypass portfolio accounting.
- **Trading Engine:** coordinates the workflow between market data, the selected strategy policy, broker operations, and fill processing. It does not own strategy-specific trading rules.

Use the repository's object-input/object-output function convention and `toResult` for use-case outcomes. Keep meaningful pure calculations in focused domain modules.

## Reliability requirements

- Apply actual execution quantities and actual commission data, never estimates from order requests.
- Handle partial fills as separate execution increments.
- Do not apply the same execution twice. The stable fill identity and deduplication boundary must be defined before live processing is enabled.
- Reject or explicitly report fills for unknown markets, invalid quantities, unsupported commission assets, and impossible position transitions. Never silently discard them.
- Use exact decimal arithmetic for all quantities and quote/commission calculations.
- Do not mutate shared portfolio state concurrently without an explicit serialization/consistency policy.
- Keep persistence, restart recovery, and exchange reconciliation separate from the initial in-memory domain model; do not claim those guarantees until designed and implemented.

## Implemented in-memory transition

Position and Portfolio are implemented under src/domain/portfolio/. Position stores a canonical Market, net base Quantity, and signed quote-net-cash-flow Money. Applying BUY/SELL fills accounts for commissions charged in the base or quote asset using exact decimal-string arithmetic.

Portfolio.applyFill({ fill }) creates or replaces the Position for fill.market.id and tracks canonical fill IDs for process-lifetime duplicate protection. A duplicate returns the unchanged Portfolio. A SELL that would make base holdings negative fails. The domain accepts only COMPLETE commission data and rejects third-asset commissions rather than ignoring an asset debit. This matches the agreed current product behavior: third-asset commission fills are unsupported and must fail visibly.

makeUpdatePortfolio() exposes this transition through a toResult application use case. Bootstrap owns the latest immutable Portfolio snapshot, serializes fill updates, and supplies the latest snapshot to strategy evaluation. The implementation does not yet calculate cost basis, invested quote, realized P/L, free inventory, or SELL reservations. Fill deduplication is not durable, and no restart recovery or exchange reconciliation is provided.

The broker user-data stream is not yet normalized into canonical Fill events. runtime.updatePortfolio({ fill }) is therefore an application integration point, not evidence that live broker fills are already ingested.

## Confirmed domain decisions

The following decisions have been agreed:

1. **Position ownership — one position per trading pair.** `BTCUSDT` and `ETHUSDT` have separate positions. A Position is not account-wide per asset and is not split into separate strategy-owned positions.
2. **Cross-strategy control — exclusive, with shared accounting.** Conservative and Aggressive use the same Position and inventory for a pair, but only one strategy controls it at a time. Each pair has a planned total quote budget. A configurable `conservativeTakeoverPercent` setting defaults to `20` (20%). When actual executed BUY investment exceeds that percentage of the pair's planned total quote budget, the Trading Engine automatically hands control from Aggressive to Conservative. Only executed BUY fills count: unfilled/open BUY orders and their reserved quote commitment are excluded. Conservative keeps control until the entire position is sold and the invested quote capital has been recovered; a position becoming smaller than the takeover threshold does not return control to Aggressive. If the position is losing money, stop creating new BUY orders but keep existing SELL orders active. Never force a sale at a loss to switch strategies. Aggressive resumes only after the full position is closed and the invested capital is back. The inactive strategy must not operate the Position.
3. **Accounting — complete shared accounting.** Position is the authoritative source for actual holdings, invested quote, average entry cost, realized profit, commissions, reserved inventory, and available inventory. Both strategies use this shared accounting.
4. **Third-asset commissions — reject for now.** A fill whose commission is charged in an asset other than the pair's base or quote asset is unsupported and must be rejected visibly. It must never be silently ignored or valued using an invented conversion.

These decisions define pair-level accounting and exclusive strategy control for each pair. They do **not** yet define how one exchange asset shared by different pairs (for example, USDT used by both `BTCUSDT` and `ZROUSDT`) is globally allocated against the exchange's actual account balance.

## Decisions still required

2. **Order reservation lifecycle:** when exactly is quantity reserved for a submitted BUY or SELL, and when is it released after rejection, cancellation, expiration, partial fill, or an uncertain exchange response? The shared Position must expose reserved and available inventory, but the lifecycle and race-handling contract still needs to be specified.
3. **Cross-pair asset coordination:** how does the engine prevent separate pair positions from spending or selling the same underlying account balance? Pair-level positions do not by themselves solve account-wide balance contention.
4. **Duplicate fills:** which broker execution identifiers and retention/persistence rules provide durable deduplication?
5. **Persistence/reconciliation:** when and how will the in-memory portfolio be restored and reconciled with exchange balances and executions?
6. **Profit attribution:** if both strategies trade the same pair and share the same inventory, is strategy-specific performance reporting required, and if so, how should it be attributed without creating separate competing positions?

Until these remaining decisions are closed, do not invent reservation timing, cross-pair allocation, recovery, or profit-attribution rules.