# Trading-history API v1

The Harvester trading-history API exposes persisted order, execution, and commission facts through a stable HTTP contract and a local WebSocket invalidation stream. It runs inside the existing Harvester process and reuses its already-open environment-specific relational database connection.

This API is intentionally for a single-user local development setup. It has no authentication or bearer-token configuration. The listener binds to `127.0.0.1` by default; do not bind it to a LAN or public interface. The Angular Dashboard connects automatically.

## Start locally

Harvester prepares and migrates the environment-specific relational database during normal startup. The API reuses that connection; it does not open another SQLite connection, create schema, or own database shutdown.

Start Harvester normally:

```sh
pnpm --filter @coinzilla/harvester dev
```

The API starts with Harvester at `http://127.0.0.1:4201`. It uses Harvester's selected `TRADING_MODE` and `HARVESTER_DATABASE_DIRECTORY`; TESTNET and LIVE remain separate database files. No API token or Dashboard credential is needed.

The `HARVESTER_API_PORT` setting can change the listener port. The host is fixed to `127.0.0.1`. The API starts only when the existing runtime and relational history persistence are available. Harvester closes the API listener before closing the shared database connection.

## Local-only security boundary

The HTTP and WebSocket endpoints have no authentication. This is a deliberate local-only tradeoff for a single-user development machine, not a production or remote-host configuration. The listener is fixed to loopback, HTTP CORS is limited to the local Dashboard origins, and WebSocket upgrades validate the browser Origin. Do not expose this listener through a reverse proxy, container port mapping, LAN interface, or public host.

The API remains read-only: it exposes persisted history and does not submit, cancel, or modify exchange orders.

## Versioned resources

All paths begin with `/api/v1`. Successful responses use:

```json
{
  "ok": true,
  "data": {}
}
```

Errors use a stable code and a safe message:

```json
{
  "ok": false,
  "error": {
    "code": "HARVESTER_TRADING_HISTORY_QUERY_INVALID",
    "message": "Trading-history query parameters are invalid."
  }
}
```

| Method | Resource | Purpose |
| --- | --- | --- |
| GET | `/api/v1/trading/metadata` | Selected environment and local counts for orders, fills, and commissions |
| GET | `/api/v1/trading/orders` | Paginated order records |
| GET | `/api/v1/trading/orders/:id` | One order by its persisted record ID |
| GET | `/api/v1/trading/fills` | Paginated individual execution records |
| GET | `/api/v1/trading/fills/:id` | One execution with its persisted commission facts |
| GET | `/api/v1/trading/commissions` | Paginated commission facts joined to their execution context |
| WS upgrade | `/api/v1/trading/events` | local resource invalidation notifications after persisted history changes |

List resources return `data.items` and `data.pagination`:

```json
{
  "ok": true,
  "data": {
    "items": [],
    "pagination": {
      "limit": 50,
      "offset": 0,
      "total": 0,
      "hasMore": false
    }
  }
}
```

### Pagination and filters

- `limit` defaults to 50 and is bounded from 1 to 100.
- `offset` defaults to 0 and must be a non-negative safe integer.
- Ordering is deterministic: newest exchange timestamp (falling back to local observation time), then persisted ID as a stable tie-breaker.
- Unknown and repeated query parameters are rejected.
- Filter comparisons use exact persisted values.

| Resource | Supported filters |
| --- | --- |
| Orders | `symbol`, `side`, `status`, `providerType`, `providerInstanceId`, `accountId`, `strategyId` |
| Fills | `symbol`, `side`, `providerType`, `providerInstanceId`, `accountId`, `strategyId`, `commissionStatus` |
| Commissions | `symbol`, `side`, `assetCode`, `providerType`, `providerInstanceId`, `accountId`, `strategyId` |

For example:

```http
GET /api/v1/trading/orders?symbol=BTCUSDT&side=BUY&status=FILLED&limit=25&offset=0
GET /api/v1/trading/commissions?assetCode=BNB&limit=50&offset=0
```

Record identifiers are URL path segments and must be percent-encoded by clients when they contain reserved characters.

## Real-time change notifications

Connect to `ws://127.0.0.1:4201/api/v1/trading/events` on the same host and port as the HTTP API (this endpoint is intended for loopback-only local use). The socket is mounted on the existing listener and does not start a second process or database connection.

After connecting, clients may receive resource-only messages:

```json
{
  "type": "trading-history.updated",
  "resources": ["orders"]
}
```

The `resources` array contains one or more of `orders`, `fills`, and `commissions`. Order notifications are published only after an order-history repository upsert succeeds. Fill notifications are published only after the fill and its commission facts have been persisted successfully; they invalidate both `fills` and `commissions`. Failed persistence writes never produce success notifications. The WebSocket does not include financial record values or account identifiers.

These messages are invalidation hints, not a durable event stream:

- EventBus delivery is in-memory and best-effort. Messages can be missed while disconnected or when a process/socket fails.
- There are no replay cursors, acknowledgements, exactly-once guarantees, or client-side event offsets.
- REST list/detail resources remain authoritative.
- Clients must fetch fresh REST snapshots after initial WebSocket connection and every reconnect, and refresh the currently displayed resource when a matching invalidation arrives.
- A reconnect snapshot reconciles any notifications missed while offline. Do not use WebSocket messages as accounting, audit, or exchange evidence.

The server closes active sockets before the HTTP listener and shared database are shut down. The Dashboard implements bounded reconnect backoff and displays live, reconnecting, and offline states independently from HTTP API connectivity.

## Data semantics

- Orders are exchange instructions with their persisted lifecycle facts.
- Fills are individual applied executions. A fill is never reconstructed from an order's cumulative executed quantity.
- Commissions are the actual stored commission facts associated with a fill.
- Decimal financial values are returned as strings. Clients must not convert them to binary floating-point numbers for accounting or comparisons.
- Unknown or unavailable values remain `null`; they are not replaced with zero.
- The persisted `id` is an opaque composite identity key; clients should display exchange order/trade IDs or client order IDs as human-readable references.
- A fill's `orderId` may be `null` until its matching order projection is observed. The fill remains queryable and retains available `exchangeOrderId` and `clientOrderId` values.
- Order average execution price is `null` unless an actual canonical value was persisted.
- Commission quote valuation is `null` unless an actual supplied valuation was persisted. The API does not estimate fees or valuations.
- Strategy, position, and cycle attribution is returned only when the persisted relationship is verified. Missing attribution stays `null`.
- Metadata counts describe rows in the selected local database only. They do not certify exchange-history completeness, account-wide coverage, or delisted-market history.

This first contract intentionally covers only existing `orders`, `fills`, and `fill_commissions` records. It does not introduce `sessions` or `errors` tables, PnL/analytics, account snapshots, order controls, broker calls, or exchange operations.

## Stable error codes

| HTTP status | Code | Meaning |
| --- | --- | --- |
| 400 | `HARVESTER_TRADING_HISTORY_QUERY_INVALID` | Unsupported filter, invalid identifier, or invalid pagination |
| 404 | `HARVESTER_TRADING_HISTORY_RECORD_NOT_FOUND` | The requested persisted record does not exist |
| 404 | `HARVESTER_TRADING_HISTORY_ROUTE_NOT_FOUND` | The API resource is not implemented |
| 405 | `HARVESTER_TRADING_HISTORY_METHOD_NOT_ALLOWED` | The resource does not support the requested method |
| 500 | `HARVESTER_TRADING_HISTORY_QUERY_FAILED` | Application query failed |
| 500 | `HARVESTER_TRADING_HISTORY_API_REQUEST_FAILED` | Unexpected transport failure |

## Architecture boundary

The dependency direction is:

```text
HTTP transport
    |
Harvester application queries
    |
Application query-repository port
    |
Harvester relational query adapter
    |
Existing orders / fills / fill_commissions tables
```

HTTP request handling and response serialization stay in the transport adapter. Query validation and application error codes stay in the application layer. SQL and row mapping stay in Harvester infrastructure. The Harvester domain does not depend on the HTTP framework, route names, UI, or consumer identity.

The HTTP and WebSocket listener runs inside the existing Harvester process and is owned by the process composition root. HTTP exposes the versioned GET resources listed above. The WebSocket adapter subscribes only to the persisted-history invalidation event; order/fill history observers publish that event after successful relational upserts. It does not subscribe directly to pre-persistence broker/trading events, create schema, change trading readiness, or own the shared database connection.

## Verification

The API and WebSocket tests use temporary SQLite files, fake application dependencies, an in-memory EventBus, native WebSocket clients, and ephemeral loopback ports. Persistence notification tests verify that events follow successful upserts and are absent after failed writes. Dashboard tests cover automatic local connections, live updates, reconnect backoff, and REST snapshot resynchronization. Tests do not connect to an exchange or require credentials.

## Operator API

The same local listener exposes the application-level operator facade under `/api/v1/trading/operator`:

- `GET /status`, `GET /markets`, `GET /portfolio`, `GET /orders`, and `GET /balances` return read-only Harvester snapshots.
- `POST /commands` accepts `{ "command": "pause", "symbol": "BTCUSDT", "requestId": "..." }` or the global commands `pauseallbuys` / `resumeallbuys`. `unpause` maps to the existing market resume use case.

Commands delegate to the existing operator application facade and never call the exchange from the Dashboard. The Dashboard presents an explicit confirmation step before sending a mutation. These endpoints are available only through the loopback listener; do not expose this unauthenticated development API outside the local machine.


## Public Bitunix Futures market data

The same loopback-only Harvester HTTP listener exposes a read-only public market-data snapshot for the Dashboard Market Screener:

| Method | Resource | Purpose |
| --- | --- | --- |
| GET | `/api/v1/markets/bitunix/futures` | Bitunix Futures contract metadata joined with public ticker fields |

Harvester requests Bitunix's public HTTPS REST endpoints:

- `GET https://fapi.bitunix.com/api/v1/futures/market/trading_pairs`
- `GET https://fapi.bitunix.com/api/v1/futures/market/tickers`

These requests require no API key and use no authenticated/private endpoints. The adapter applies a bounded request timeout and returns a safe `502 HARVESTER_MARKET_DATA_UPSTREAM_UNAVAILABLE` response when Bitunix is unavailable or returns a malformed response.

The response contains `data.provider`, `data.marketType`, `data.observedAt`, and `data.markets[]`. Each market exposes the exchange's symbol, base/quote assets, contract status, API-trading support, maximum leverage, last/mark/open/high/low prices, and base/quote volumes where returned. Numeric exchange values remain strings.

Movement fields are pass-through only:

- `change24h` is passed through from Bitunix's public Futures WebSocket `tickers` channel field `r`, which is the exchange's rolling 24-hour fluctuation. The value is not rounded or recalculated.
- `change5m`, `change1h`, and `change4h` are populated only if those exact native fields are present in the ticker response. The documented public REST ticker and WebSocket ticker channels do not provide those windows, so they are currently returned as `null` and shown as `N/A`.
- Harvester subscribes to the public `tickers` channel over `wss://fapi.bitunix.com/public/`, in batches respecting Bitunix's 300-channel-per-connection limit. Each connection is a bounded one-shot snapshot and is closed after the initial ticker data or timeout; a stream failure does not hide the REST market snapshot.
- No candle history is fetched, and no percentages are calculated or inferred from open/last prices.

The Dashboard's Market Screener uses this Harvester endpoint; it never calls Bitunix from the browser. Favourites are stored in separate source-specific browser cookies and are not persisted by Harvester. This public market-data capability is independent of Bitunix execution-provider admission tracked by [#1185](https://github.com/45s/coinzilla/issues/1185); it does not register a broker, enable order placement, or change trading behavior.
