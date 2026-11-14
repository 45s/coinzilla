# Portfolio Domain

## Purpose

A **Portfolio** is the single authoritative in-memory accounting aggregate for Harvester's actual Spot activity. It may contain multiple independent Positions for the same market.

Each Position has a stable `positionId`, a canonical `marketId`, and an explicit `strategyId` owner. For example, `ETHUSDT` may have one Position owned by `CG_coinGrabber` and another owned by `RS_recoverySeller`. A strategy may also own multiple Positions for one market when its domain needs distinct accounting units, such as separately tracked legacy and recovery-cycle exposure.

Strategy-owned Positions are independent accounting allocations, not separate wallets or exchange balances. The sum of their base quantities is the Portfolio's aggregate tracked inventory for that market. Shared exchange custody, account free balances, and active-order reservations remain centrally reconciled across every Position and strategy. Creating another Position never creates more spendable exchange inventory.

The Portfolio changes from **canonical executed fills** and explicitly defined domain transitions such as moving a completed CG keep quantity into its retained-free bucket. Prices, submitted orders, acknowledgements, cancellations, and order-status changes without an execution do not create or remove held quantity.

## Where it belongs

The domain model belongs under:

```text
src/
  domain/
    portfolio/
```

The application use case that coordinates Portfolio updates belongs under:

```text
src/
  use-cases/
    update-portfolio.js
```

The use case is the application boundary between incoming execution facts and the domain model. It must not depend on Binance SDK types, WebSocket message formats, or other exchange-specific structures.

See [Harvester Architecture](../architecture.md) for the distinction between domain entities, strategy policies, use cases, the Trading Engine, and infrastructure adapters.

## Lifecycle and data flow

1. Bootstrap loads and validates `config/index.js`.
2. The configured, enabled trading pairs and strategy registrations are made available to the shared Trading Engine.
3. The market-data adapter subscribes to the broker's market streams.
4. Each enabled strategy evaluates its own policy. A price update may cause an order intent, but it does not modify Portfolio accounting.
5. The broker reports order lifecycle events. Submission, acknowledgement, cancellation, rejection, and expiration alone do not change held quantities.
6. When an order executes, the broker adapter normalizes the execution into a canonical domain Fill.
7. The application resolves the originating order's `positionId` and `strategyId` and applies the Fill to exactly that Position.
8. Portfolio records the fill identity together with its Position/strategy attribution. Identical replays are no-ops; conflicting facts or conflicting ownership fail closed.
9. The shared Portfolio exposes both the independent Positions and aggregate market/asset quantities. Strategy policies read only their own Position; account-level balance and reservation logic reads the aggregate.

```text
Market data -> CG policy -----> CG order (positionId + strategyId) --+
                                                                    |
Market data -> RS policy -----> RS order (positionId + strategyId) --+--> shared Trading Engine
                                                                    |            |
                                                                    +------------+
                                                                                 v
Broker execution -> canonical Fill + originating ownership -> Portfolio
                                                               |        |
                                             independent Positions      aggregate custody
                                                               |        |
                                                        strategy policy  account/reservations
```

## Strategy identifiers

Strategy ownership uses the immutable, named `StrategyId` registry exported from `src/domain/strategies/strategy-ids.js`. Use `StrategyId.COIN_GRABBER` and `StrategyId.RECOVERY_SELLER` rather than repeating serialized identifier strings at call sites. The underlying values (`CG_coinGrabber` and `RS_recoverySeller`) remain stable because they are persisted in Portfolio and Journal state. Adding a strategy means adding its stable identifier to this registry; it does not make the registry a runtime restriction on strategy composition.

## Core concepts

### Portfolio

- Contains zero or more Positions; multiple Positions may refer to the same market.
- Enforces unique stable Position IDs and portfolio-wide canonical fill identity.
- Applies each canonical fill to exactly one Position selected by explicit ownership attribution.
- Exposes aggregate base quantity for a market by summing every Position's active and retained-free quantity.
- Remains one domain object for actual Harvester accounting; it is not a collection of private strategy wallets.
- Must not contain broker clients, sockets, timers, filesystem access, or exchange SDK objects.

### Position

A Position represents one independently owned accounting allocation for exactly one canonical market and one strategy owner. Its stable identity is the caller-supplied `positionId`; `strategyId` records who owns the allocation. A market may have many Positions, including several Positions owned by the same strategy.

A Position's accounting includes:

- active net base quantity attributable to that Position;
- retained/free base quantity, where the owning strategy has an explicit retained-inventory rule;
- total base quantity (active plus retained/free);
- quote amount spent and its recovery basis;
- cumulative quote net cash flow;
- actual base, quote, and reliably valued third-asset commission effects.

A Position does not independently reserve exchange balances. Active order reservations belong to the shared order/commitment workflow and are aggregated centrally across strategies. A strategy may plan only against its own Position allocation and the remaining shared exchange balance after all commitments.

A market price is not part of held-quantity accounting. If valuation is needed (including valuing commissions), it is a separate calculation using an explicitly supplied price and a defined conversion rule. Conservative quantity/spent, actual commission valuation, SELL proceeds, and recovery basis remain defined only in [the canonical Conservative specification](./CONSERVATIVE_DOMAIN_SPECIFICATION.md). RS-specific legacy basis and custody decisions remain in the [RS specification](./recovery-seller-domain-specification.md).

### Coin Grabber strategy modes

Conservative and Aggressive are modes within `CG_coinGrabber`; they continue to use the same CG-owned Position for a market and retain their existing internal control/takeover semantics. This does not prevent the independent Recovery Seller strategy from owning another Position for the same market.

The current Aggressive model uses one shared inventory pool inside the CG-owned Position:

- Filled quantities from different BUY orders contribute to the same CG active base inventory.
- Inventory is not treated as a collection of exclusive coin lots permanently owned by individual BUY orders.
- Multiple SELL orders may coexist, but each SELL order reserves its remaining unfilled quantity from the shared pool.
- The sum of active CG SELL reservations must never exceed the CG Position's available active quantity and the centrally available exchange balance.
- A SELL fill reduces the CG Position by the actual executed quantity and applicable commission.
- A cancelled or rejected SELL releases only its unfilled reservation. Any execution received during cancellation remains a real fill and must be applied.
- Conservative/Aggressive control transitions remain governed by the [Conservative specification](./CONSERVATIVE_DOMAIN_SPECIFICATION.md); they do not grant RS ownership of CG inventory.

### Shared exchange custody and reservations

All strategy Positions share the same underlying exchange account. For a market, aggregate tracked base quantity is the sum of each Position's `totalBaseQuantity`; account-level snapshots aggregate all Positions by canonical asset ID. A separate strategy Position must never increase the balance available for a SELL.

The Trading Engine and `allocate-order-commitments` remain responsible for shared quote/base commitments. They aggregate active and in-flight BUY/SELL reservations across CG, RS, and other active strategies before accepting another intent. A regression verifies that the combined CG and RS SELL reservations exhaust the same shared market/account inventory and reject an additional overcommitting SELL because combined reservations leave only one unit of active market inventory, below the requested SELL quantity. Pair/strategy-specific investment and active-inventory limits are additional constraints, not substitutes for shared account availability.

Snapshot-relative account reconciliation continues to use total Portfolio base quantity, quote cash flow, and active-order commitments by asset. It adjusts exchange free balances only by post-snapshot deltas so existing exchange locks are not subtracted twice. This behavior is covered by the account snapshot baseline implementation and [PR #968](https://github.com/45s/coinzilla/pull/968); [issue #955](https://github.com/45s/coinzilla/issues/955) is closed.

### Fill

A Fill is an execution fact, not an order intention. It carries normalized information required to account for the executed portion of an order:

- canonical market and side (`BUY` or `SELL`);
- actual executed base quantity and quote notional;
- actual commission amount and asset, when charged;
- stable canonical execution identity (market ID plus exchange trade ID).

The application supplies the originating `positionId` and `strategyId` from the order's ownership record. When a strategy has one Position per market, `createPositionId({ marketId, strategyId })` provides its stable default identity; strategies with multiple Positions supply the explicit ID. These attribution facts are not inferred from the market symbol or the Fill's quantity. The same canonical Fill ID can belong to only one Position/strategy attribution in a Portfolio.

The broker adapter translates exchange-specific payloads into the canonical Fill shape and validates them at the boundary. Strategy ownership remains an application/domain fact, not a raw Binance message field.

## Applying a fill

For a Spot fill, before commissions:

| Fill side | Base-asset delta | Quote-asset delta |
| --- | ---: | ---: |
| BUY | increase the attributed Position's base quantity | decrease the attributed Position's quote cash flow |
| SELL | decrease the attributed Position's base quantity | increase the attributed Position's quote cash flow |

Commission is accounted for in the asset in which it was actually charged. A base-asset commission changes that Position's net base quantity; a quote-asset commission changes its quote cash flow and cost/proceeds; a third-asset commission requires reliable quote-currency valuation. If the asset, amount, or valuation is unavailable or unreliable, fail closed atomically; never ignore the debit or invent a conversion rate. Conservative-specific rules remain in the [canonical specification](./CONSERVATIVE_DOMAIN_SPECIFICATION.md).

Only the executed part is applied. A partially filled order updates the attributed Position by that partial execution; a later fill applies only its own newly executed quantities. Never apply the original requested order quantity as if it had all executed.

## Responsibilities and boundaries

- **Market-data adapter:** obtains exchange prices and normalizes market data. It does not mutate Portfolio.
- **Broker adapter:** submits/cancels orders and translates broker execution reports into canonical fills.
- **Order lifecycle handling:** tracks order state and originating strategy/Position ownership. An order is not a Position and an accepted order is not a fill.
- **Application accounting workflow:** resolves the order's stable Position and strategy owner, validates the canonical Fill, and applies it exactly once.
- **Portfolio domain:** enforces Position identity, attribution, fill deduplication, and accounting invariants. It remains deterministic and I/O-free.
- **Strategy policy:** reads its own Positions and emits intents; it does not interpret raw broker messages or bypass Portfolio accounting.
- **Trading Engine:** serializes strategy intents, shared reservation allocation, broker operations, and accounting commits. It does not own strategy-specific economic rules.

Use object-input/object-output functions and `toResult` for use-case outcomes. Keep exact decimal calculations in focused domain modules and reuse `@coinzilla/utils` decimal primitives.

## Reliability requirements

- Apply actual execution quantities and actual commission data, never estimates from order requests.
- Handle partial fills as separate execution increments.
- Deduplicate canonical Fill IDs portfolio-wide and retain the accepted `positionId`/`strategyId` attribution. Identical replays for the same owner are ignored; changed facts or a different owner fail closed.
- Reject unknown Position IDs, market/owner mismatches, invalid quantities, unsupported commission assets, and impossible Position transitions.
- Use exact decimal arithmetic for all quantities and quote/commission calculations.
- A market-only Position lookup must fail closed when multiple Positions match; callers must specify enough identity to select exactly one. Position log summaries accept an explicit `positionId` so multiple same-market Positions owned by one strategy remain individually observable.
- Do not mutate shared Portfolio state concurrently without an explicit serialization/consistency policy.
- Keep durable persistence and process-restart recovery separate from the in-memory domain model. Runtime restoration remains disabled under ADR-0001 until its separate acceptance gates pass.

## Confirmed domain decisions

1. **Multiple Positions per market.** A Position is identified by stable `positionId`, canonical market, and explicit `strategyId`. CG and RS may own independent Positions for the same market. A strategy may own multiple Positions when its domain requires separate accounting units.
2. **Independent strategy accounting, shared custody.** Strategy Positions maintain independent quantities and quote cost/cash-flow accounting. Their aggregate is the one Portfolio view of actual tracked holdings; no strategy gets a private or duplicated exchange balance.
3. **CG mode behavior remains unchanged.** Conservative and Aggressive continue to share the CG-owned Position and their existing internal controller/takeover rules. This is separate from CG/RS coexistence.
4. **Portfolio-wide fill identity.** One canonical Fill ID may be applied exactly once to one Position. A duplicate attributed to another owner is a conflict, not a second application.
5. **Central reservations.** Shared quote/base commitments are aggregated across all Positions by the existing Trading Engine/order-commitment boundary. Position ownership does not bypass exchange free balances or other active reservations.
6. **Third-asset commissions.** Conservative third-asset commissions require reliable quote-currency valuation; otherwise fail closed. See the canonical Conservative specification.

RS-specific opening-inventory representation, legacy authorization, profitability, and resource-allocation decisions remain governed by the draft [RS specification](./recovery-seller-domain-specification.md); this Portfolio document does not resolve them.
