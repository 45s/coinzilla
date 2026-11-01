# Portfolio Domain

## Purpose

A **Portfolio** is the domain representation of the bot's spot positions. It contains multiple positions, normally one position for each configured spot market (trading pair).

For example, a portfolio may contain positions for `BTCUSDT`, `ETHUSDT`, and `ZROFDUSD`. A position describes the bot's holdings and trading activity for that market. It is not a market-price snapshot and it is not an order.

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

A position is associated with a spot market/pair (for example, `ZROUSDT`) and tracks the bot's position for that market.

At minimum, the domain contract needs to distinguish the base asset and quote asset and represent their quantities using exact decimal arithmetic. The position may later expose strategy-relevant accounting such as invested quote, average entry cost, realized profit, reserved quantity, and free inventory, but those meanings must be agreed before they become fields or invariants.

A market price is not part of the position's held-quantity accounting. If valuation is needed, it should be a separate calculation using an explicitly supplied price.

### Aggressive strategy inventory

The agreed Aggressive strategy model uses **one shared inventory pool per market**:

- Filled quantities from different BUY orders contribute to the same available base-asset inventory.
- Inventory is not treated as a collection of exclusive coin lots permanently owned by individual BUY orders.
- Multiple SELL orders may coexist, but each SELL order reserves its remaining unfilled quantity from the shared pool.
- The sum of active SELL reservations must never exceed the available base quantity.
- A SELL fill reduces the shared inventory by the actual executed quantity and applicable commission.
- A cancelled or rejected SELL releases only its unfilled reservation. Any execution received during cancellation remains a real fill and must be applied.
- When Aggressive switches to Conservative, active SELL reservations are cancelled/reconciled and the remaining available position is consolidated into one SELL order. The transition must not count reserved or in-flight quantities twice.

This defines inventory sharing **inside Aggressive for one market**. It does not yet define whether Conservative and Aggressive may trade the same market simultaneously, or how balances shared across different markets are allocated.

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

Commission is then accounted for in the asset in which it was actually charged. If commission is charged in the base asset, the net base quantity is reduced. If charged in the quote asset, the net quote quantity is reduced. A commission charged in a third asset must not be silently ignored; the portfolio/accounting contract must explicitly represent that asset debit or reject the fill as unsupported.

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

## Decisions still required

The following are deliberately not implied by the initial definition and must be agreed before implementation:

1. **Position ownership:** is a position strictly pair-scoped, account-asset-scoped, or split by strategy as well as pair? Aggressive uses one shared inventory pool per market, but cross-strategy ownership is not yet defined.
2. **Shared assets:** how should balances be represented when the same asset participates in multiple configured pairs (for example, USDT across BTCUSDT and ZROUSDT)?
3. **Strategy allocation:** how are actual holdings divided between Conservative/Free-Roll and Aggressive strategies, especially if both can trade the same pair?
4. **Accounting fields:** which cost-basis, invested-quote, realized-profit, reserved-quantity, and free-inventory values belong in the shared position versus strategy-specific state?
5. **Third-asset commission:** should the portfolio track account-wide asset debits, or should unsupported commission assets fail the update until that capability exists?
6. **Duplicate fills:** which broker execution identifiers and retention/persistence rules provide the required deduplication?
7. **Order reservations:** where are balances reserved for open BUY orders and SELL orders represented? The Aggressive SELL-reservation invariant is agreed, but the full shared reservation model is not yet designed.
8. **Persistence/reconciliation:** when and how will the in-memory portfolio be restored and reconciled with exchange balances and executions?

Until these decisions are closed, implement only the agreed fill-driven portfolio boundary and avoid inventing strategy accounting semantics.
