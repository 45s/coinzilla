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

A market price is not part of the position's held-quantity accounting. If valuation is needed (including valuing commissions), it should be a separate calculation using an explicitly supplied price and a defined conversion rule. Conservative position quantity/spent, actual commission valuation, SELL proceeds, and recovery basis are defined only in [the canonical specification](./CONSERVATIVE_DOMAIN_SPECIFICATION.md).

### Aggressive strategy inventory

The agreed Aggressive strategy model uses **one shared inventory pool per market**:

- Filled quantities from different BUY orders contribute to the same available base-asset inventory.
- Inventory is not treated as a collection of exclusive coin lots permanently owned by individual BUY orders.
- Multiple SELL orders may coexist, but each SELL order reserves its remaining unfilled quantity from the shared pool.
- The sum of active SELL reservations must never exceed the available base quantity.
- A SELL fill reduces the shared inventory by the actual executed quantity and applicable commission.
- A cancelled or rejected SELL releases only its unfilled reservation. Any execution received during cancellation remains a real fill and must be applied.
- When Aggressive switches to Conservative, active SELL reservations are cancelled/reconciled and the remaining available position is consolidated into one SELL order. The transition must not count reserved or in-flight quantities twice.

This defines inventory sharing **inside Aggressive for one market**. Conservative and Aggressive do not operate that market simultaneously: the Trading Engine selects one active controller for the shared Position. Switching controllers requires the outgoing strategy to stop issuing new orders and the engine to reconcile/cancel its outstanding orders before the incoming strategy acts. Account-wide exchange free-balance allocation is shared by asset across markets. Each account snapshot captures the aggregate total Portfolio base quantity (active plus retained free) and all active BUY/SELL commitments by asset ID. The Trading Engine adjusts snapshot free balances only by post-snapshot Portfolio cash-flow, total-base and commitment deltas. Pair-specific investment and active-inventory limits remain separate constraints; this prevents one market from spending funds reserved by another without double-counting locks already represented in exchange free/locked balances. The snapshot-relative implementation and regression evidence were delivered in [PR #968](https://github.com/45s/coinzilla/pull/968); [issue #955](https://github.com/45s/coinzilla/issues/955) is closed.

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

Commission is then accounted for in the asset in which it was actually charged. If commission is charged in the base asset, the net base quantity is reduced. If charged in the quote asset, the net quote quantity is reduced. A commission charged in a third asset (for example, BNB commission on a `BTCUSDT` trade) requires a reliable quote-currency valuation. If the asset, amount, or valuation is unavailable or unreliable, fail closed atomically; never ignore the debit or invent a conversion rate. The Conservative-specific rule is defined in [the canonical specification](./CONSERVATIVE_DOMAIN_SPECIFICATION.md).

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
- Do not apply the same execution twice. The canonical `Fill.id` (market ID plus exchange trade ID) is the process-local deduplication identity; identical replays are ignored and conflicting facts for the same identity fail closed.
- Reject or explicitly report fills for unknown markets, invalid quantities, unsupported commission assets, and impossible position transitions. Never silently discard them.
- Use exact decimal arithmetic for all quantities and quote/commission calculations.
- Do not mutate shared portfolio state concurrently without an explicit serialization/consistency policy.
- Keep durable persistence and process-restart recovery separate from the in-memory domain model. The application now performs bounded reconnect-time reconciliation for orders already in its in-memory registry; this does not restore state after restart or reconcile account balances.

## Implemented in-memory transition — implementation evidence only

The application currently applies canonical fills through paired Portfolio/RecoveryLedger accounting. This section records architecture and code location only; it does not define Conservative accounting or completion rules.

The authoritative Conservative contract, including the quantity/spent model, actual commission valuation, full-cost recovery, per-cycle `keepQuantity` retention (which accumulates in the free-inventory bucket across completed cycles), residual sell-through, dust, cancellation/reconciliation, and completion, is [CONSERVATIVE_DOMAIN_SPECIFICATION.md](./CONSERVATIVE_DOMAIN_SPECIFICATION.md).

## Confirmed domain decisions

The following decisions have been agreed:

1. **Position ownership — one position per trading pair.** `BTCUSDT` and `ETHUSDT` have separate positions. A Position is not account-wide per asset and is not split into separate strategy-owned positions.

**Cross-strategy BUY repricing invariant:** Conservative trailing-BUY repricing eligibility is defined only in the canonical Conservative specification. The shared engine must enforce that gate against active Position quantity; retained free inventory is excluded. Any future Aggressive BUY-grid repricing requires its own approved strategy specification before becoming executable. This paragraph records the engine boundary only; it does not define Conservative behavior.

2. **Cross-strategy control — exclusive, with shared accounting.** Conservative and Aggressive use the same Position and inventory for a pair, but only one strategy controls it at a time. Each pair has a planned total quote budget. A configurable `conservativeTakeoverPercent` setting defaults to `20` (20%). When actual executed BUY investment exceeds that percentage of the pair's planned total quote budget, the Trading Engine automatically hands control from Aggressive to Conservative. Only executed BUY fills count: unfilled/open BUY orders and their reserved quote commitment are excluded. Conservative keeps control until the entire position is sold and the invested quote capital has been recovered; a position becoming smaller than the takeover threshold does not return control to Aggressive. If the position is losing money, stop creating new BUY orders but keep existing SELL orders active. Never force a sale at a loss to switch strategies. Aggressive resumes only after the full position is closed and the invested capital is back. The inactive strategy must not operate the Position.
3. **Accounting — shared pair projection.** Portfolio is the shared source for actual pair holdings and reservations. Conservative quantity/spent and recovery cost/proceeds semantics are defined only in the canonical Conservative specification.
4. **Third-asset commissions.** Conservative third-asset commissions require a reliable quote-currency valuation; otherwise fail closed. The canonical specification defines this rule. Do not silently ignore the debit or invent a conversion.

These decisions define pair-level accounting and exclusive strategy control for each pair. They do **not** yet define how one exchange asset shared by different pairs (for example, USDT used by both `BTCUSDT` and `ZROUSDT`) is globally allocated against the exchange's actual account balance.

## Decisions still required

The remaining questions in this document concern shared Portfolio/Aggressive architecture only. They do not reopen or override Conservative Strategy decisions. For Conservative, see [the canonical specification](./CONSERVATIVE_DOMAIN_SPECIFICATION.md).
