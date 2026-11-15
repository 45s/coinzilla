# Broker package: exchange adapter contracts

## Source layout

The package contains an exchange-neutral compatibility base and separate exchange infrastructure adapters. Binance is the reference implementation; Bitunix Spot is an additional, currently read-only adapter.

```text
packages/brokers/src/
├── index.js
├── broker.core.js
├── domain/
├── application/
└── infrastructure/
    ├── binance/
    │   ├── adapters/
    │   ├── broker-websocket/
    │   └── user-data-client-adapter.js
    └── bitunix/
        ├── adapters/
        ├── api/
        ├── auth/
        ├── config/
        ├── broker.js
        └── broker.test.js
```

## Ownership and conventions

- `CoreBroker` remains a public compatibility base class, not a complete formal cross-exchange port.
- Each exchange adapter owns its protocol, signing, transport, configuration, response adaptation and exchange-specific limitations.
- Shared canonical entities and exact decimal utilities come from `@coinzilla/entities` and `@coinzilla/utils`.
- A matching method name does not imply equal exchange capability. Unsupported operations must fail explicitly. Never fabricate client IDs, timestamps, fill data, account state or stream events.
- Preserve exchange-specific details inside the adapter. Do not import Binance protocol code into Bitunix or vice versa.

## Bitunix Spot capability contract

The public exports are `BitunixSpotBroker` and `BitunixSpotConfig`.

The current implementation supports these read operations through the documented Spot REST API:

| Broker method | Bitunix operation | Constraint |
|---|---|---|
| `getBalances()` | `GET /api/spot/v1/user/account` | Balance endpoint does not expose a source update timestamp. |
| `getExchangeMarkets()` | `GET /api/spot/v1/common/coin_pair/list` | Maps enabled Spot pairs to canonical Markets. |
| `getSymbolFilters({ symbol })` | Spot coin-pair catalog | Returns exchange metadata; do not assume Binance filter shape. |
| `getOpenOrders({ symbol })` | `POST /api/spot/v1/order/pending/list` | Symbol is required; no account-wide pending-orders call is documented. |
| `getOrderHistory({ symbol })` | `POST /api/spot/v1/order/history/page` | Symbol is required; exact order-ID filtering is not documented. |
| `getOrder({ symbol, orderId })` | `GET /api/spot/v1/order/detail` | Response symbol and order ID are checked. |
| `getPrices({ symbol })` | `GET /api/spot/v1/market/last_price` | Request/response lookup, not a subscription. |
| `getFills({ symbol, orderId })` | `POST /api/spot/v1/order/deal/list` | Per-order matching-order response; the caller's order ID is attached only after the response is identity-checked. |

The following methods are intentionally unavailable:

- `createOrder()`: the documented Spot order placement schema has no exchange-side client order ID. A lost response cannot be reconciled using a stable caller-supplied identity.
- `cancelOrder()`: private order/execution push events and a verified cancellation outcome recovery flow are not documented.
- `subscribeForPrices()`: the documented Spot WebSocket methods are request/response RPCs, not continuous subscriptions.
- `getAccountSnapshot()`: the account response has no source update timestamp.
- `getCanonicalOrder()` and `getCanonicalOrderHistory()`: the canonical order entity requires a client order ID not provided by the Spot API.
- `getServerTime()`: no Spot server-time endpoint is documented.

The official Spot docs also disagree about the meaning of the `volume` parameter: the REST place-order page describes limit quantity as quote-currency and market quantity as base-currency, while the WebSocket order page describes the inverse. No order submission is implemented until Bitunix clarifies the REST semantics and the canonical conversion is tested.

No Bitunix Spot TESTNET endpoint is documented. The configuration therefore requires explicit `tradingMode: "live"`; this does not authorize order mutation, which remains disabled in the broker.

Official references:
- [Bitunix Spot REST API](https://www.bitunix.com/api-docs/spots/en_us/)
- [Spot order endpoints](https://www.bitunix.com/api-docs/spots/en_us/order/)
- [Spot WebSocket API](https://www.bitunix.com/api-docs/spots/en_us/ws/)
- [Spot WebSocket order API](https://www.bitunix.com/api-docs/spots/en_us/order-ws/)

## Binance lifecycle

The existing Binance implementation retains the native WebSocket API/Streams split, user-data session, reconciliation acknowledgements, and mutation safety gates. See the [Brokers architecture](../packages/brokers/ARCHITECTURE.md) and [roadmap](../packages/brokers/ROADMAP.md) for its DDD boundaries and verified lifecycle coverage.

## Candle market-data public contract

The Binance broker additionally exposes `getCandles({ symbol, interval, limit = 500, startTime?, endTime? })` and `subscribeForCandles({ symbol, interval, onCandle })`. Both map historical and live Kline data into the same immutable candle shape; OHLCV values remain exact decimal strings. This is a Binance-specific capability until another exchange implements equivalent semantics.
