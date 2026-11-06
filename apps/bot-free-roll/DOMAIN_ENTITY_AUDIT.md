# Free-Roll domain entity and broker contract audit

**Roadmap:** FR-007  
**Audited against:** `main` at the base commit of this PR  
**Scope:** `packages/entities`, `packages/brokers`, and `apps/bot-free-roll/package.json`  
**Purpose:** identify reusable shared contracts and genuine gaps before defining new domain contracts. This is an audit, not an implementation proposal.

## Executive summary

The repository has a small shared entity package, but it does not yet provide the complete exchange-neutral financial model required by Free-Roll. The existing `Order` is a useful historical/shared order representation, but its Number-based financial fields and incomplete lifecycle data make it unsafe as the canonical strategy order. `ExecutedOrder` is not a Fill: it represents one order plus a single commission pair and status, not independently identifiable executions.

Do not create parallel `Fill`, `Order`, or `Money` classes inside `apps/bot-free-roll`. Evolve or extend the shared `@coinzilla/entities` package in the later FR-008–FR-016 contract work, preserving compatibility where feasible. Keep Binance-specific translation in `packages/brokers`.

## Existing shared entities

### `Coin` — reuse with limits

Location: `packages/entities/src/coins/coin.js`

- Represents a ticker and quantity, with a non-negative finite JavaScript `Number`.
- Normalizes ticker capitalization and exposes a `value` object.
- Does not model a canonical asset identity, network/venue identity, precision, or an exact decimal quantity.
- The constructor permits zero quantity and rejects negative/non-finite values.

**Decision:** retain it for existing consumers and non-financial/display use where Number semantics are explicitly acceptable. Do not use it for financial ledger balances, order quantities, commission amounts, or exact trading decisions. A future exact `Quantity`/balance contract must not silently change `Coin` semantics.

### `Order` — reuse concept, not as the canonical strategy contract

Location: `packages/entities/src/orders/order.js`

Existing fields: broker `id`, optional `clientOrderId`, exchange `symbol`, `type`, `side`, `quantity`, and `price`.

Gaps:
- Financial quantity and price are JavaScript Numbers.
- `quantity` does not distinguish original, executed, remaining, net, or reserved quantity.
- No canonical market/base/quote identity; a single symbol string is exchange-specific.
- No normalized order lifecycle status, timestamps, time-in-force, or explicit unknown status.
- Constructor requires an `id`, which is not suitable for a locally proposed order before broker acknowledgement.
- `value` serializes only constructor fields; adapter-added properties are not included.

**Decision:** preserve this entity for compatibility. Define the canonical order contract in FR-010 by extending the shared entity model or introducing a clearly versioned replacement there—not a second app-local `Order`.

### `ExecutedOrder` — not a Fill

Location: `packages/entities/src/orders/executed-order.js`

It extends `Order` and adds `status`, one `commission`, and one `commissionAsset`.

Gaps:
- No stable execution/trade ID, so individual fills cannot be deduplicated.
- One commission amount/asset cannot represent multiple commission entries or different fee assets across fills.
- Does not model exact executed base quantity, quote quantity, execution price, execution time, or maker/taker role per fill.
- Inherits Number-based quantity and price.
- Status is accepted without canonical validation.

**Decision:** do not repurpose it as a fill or use it as the ledger event. Keep compatibility and define a separate canonical Fill contract in the shared entities package under FR-011, with Commission entries under FR-012.

## Broker API audit

### Shared `CoreBroker`

Location: `packages/brokers/src/broker.core.js`

- Provides a logger and in-memory Maps for open orders, prices, and price subscriptions.
- Declares throwing placeholders for `getAssets`, `cancelOrder`, `getOpenOrders`, `getPrice`, `createOrder`, `subscribeForPrices`, `getSymbolFilters`, and `getMyTrades`.
- It is a lightweight base class, not yet a complete capability contract. The method list does not express required/optional capabilities, result schemas, pagination/completeness, connection health, or normalized error/unknown-outcome semantics.
- Names are inconsistent with the Binance SDK implementation in places: base `getPrice` vs adapter `getPrices`; history/status methods such as `getOrderHistory` and `getOrder` are not declared in the base.

**Decision:** use this class as the existing broker extension point, but do not assume it already guarantees the canonical broker port. FR-013–FR-016 must define capability contracts and their normalized inputs/outputs before strategy code relies on them.

### Binance legacy and SDK adapters

Relevant locations:
- `packages/brokers/src/binance/broker/broker.js`
- `packages/brokers/src/binance/broker-sdk/broker.js`
- `packages/brokers/src/binance/shared/adapt-order.js`
- `packages/brokers/src/binance/shared/adapt-fill.js`
- `packages/brokers/src/binance/shared/adapt-spot-asset.js`

The legacy adapter maps Binance methods through `CoreBroker`; the SDK adapter provides account balances, open orders, order status/history, trades, create/cancel, prices, and market/user-data subscriptions.

Observed contract issues to address in the relevant later roadmap items:
- `adaptOrder` subtracts `origQty` and `executedQty` using Number arithmetic, converts price to Number, and attaches original/executed quantities and status as ad-hoc properties. Those properties are not part of `Order.value`.
- `adaptTrade` already preserves trade/order IDs and decimal values as strings, maps buyer/seller to canonical side, and carries commission amount/asset. This is a useful adapter-boundary starting point, but its output is a plain object rather than a shared Fill/Commission entity; fee amount/asset completeness and time semantics need an explicit contract.
- `adaptSpotAsset` sums free and locked balances using Number and creates a `Coin`; exact balances and locked/free distinction are lost.
- `getSymbolFilters` currently returns symbol/base/quote, tick size, step size, and supported order types. It does not yet provide a complete normalized TradingRules contract (for example, quantity/price/notional bounds and dynamic price constraints).
- SDK broker methods generally return the repository's result wrapper, but the base class does not specify consistent result shapes, capabilities, or whether a returned collection is complete.

**Decision:** all exchange field names and transformations remain in the Binance adapter. Later domain contracts must not import Binance SDK types or expose Binance filter/status names.

## Free-Roll dependency audit

`apps/bot-free-roll/package.json` currently depends on `@coinzilla/brokers`, `@coinzilla/event-bus`, `@coinzilla/journal`, and `@coinzilla/utils`; it does not directly depend on `@coinzilla/entities`.

This means the strategy currently has no direct compile-time dependency on the shared entity package. Before adding canonical entity imports, establish the intended package dependency direction and export surface. The target direction is strategy/domain code depending on shared Coinzilla entities and broker capability ports, while broker adapters depend on those contracts—not the strategy depending on a concrete Binance adapter.

## Genuine contract gaps and roadmap ownership

| Gap | Required shared contract / work | Roadmap |
| --- | --- | --- |
| Asset identity separate from exchange symbol | Canonical Asset and Market identity; base/quote relationship | FR-008 |
| Exact amounts with units | Decimal-string Money and Quantity semantics and validation | FR-009 |
| Full canonical order lifecycle | Broker/client identity, original/executed/remaining quantities, status, timestamps, order intent vs acknowledged order | FR-010 |
| Independently identifiable executions | Canonical Fill with stable trade identity and exact amounts | FR-011 |
| Multiple/unknown/zero fee facts | Commission entries and explicit completeness semantics | FR-012 |
| Exact free/locked/total balances | Balance contract with asset identity and exact quantities | FR-013 |
| Complete market rules | Exchange-neutral TradingRules and explicit unsupported constraints | FR-014 |
| Broker capability/result contracts | Explicit required/optional capabilities and normalized outcomes | FR-015–FR-016 |

No new domain class is prescribed by this audit beyond identifying these contract responsibilities. FR-008–FR-016 should first inspect existing exports and consumers, then make the smallest compatible shared-package changes. Do not implement all contracts in one PR.

## FR-008 canonical identity contract

Implemented in the shared `@coinzilla/entities` package:

- `Asset.id` is the stable canonical identity; `Asset.code` is the normalized uppercase display/trading code. The code is not assumed globally unique, so equal codes with different canonical IDs remain distinct assets.
- `Market` requires explicit base and quote `Asset` instances. It never derives either asset by splitting or otherwise parsing the venue symbol.
- `Market.venue` is normalized to lowercase; `Market.symbol` is retained as an opaque, trimmed venue-provided identifier.
- `Market.id` is the deterministic composite `venue:symbol`, distinguishing identical symbols listed on different venues.
- Both entities expose independent `value` snapshots and immutable instances. Existing `Coin`, `Order`, and `ExecutedOrder` contracts remain unchanged.

The venue symbol is adapter metadata carried by the market contract, not a strategy parsing format. A broker adapter is responsible for mapping its exchange symbol to the explicit base/quote Asset references.

## Explicit non-goals

- No changes to runtime trading behavior.
- No migration or deletion of `Coin`, `Order`, or `ExecutedOrder`.
- No new duplicate app-local `Fill`, `Order`, or `Money` model.
- No Binance adapter refactor in this audit.
- No decisions about unresolved strategy policies.

## FR-007 acceptance

- [x] Inspected the shared entities and their tests/exports.
- [x] Inspected the shared broker base and both Binance adapter entry points.
- [x] Identified reusable entities and their limitations.
- [x] Listed only contract gaps and assigned them to later roadmap items.
- [x] Confirmed no duplicate financial domain model was introduced.
