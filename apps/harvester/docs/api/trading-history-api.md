# Trading-history API v1

The Harvester local API exposes persisted order, execution, and commission facts, runtime operator queries, public market data, and live exchange-account snapshots. It runs inside the existing Harvester process and reuses its already-open environment-specific relational database connection when available, plus the runtime's provider-account readers.

This API is intentionally for a single-user local development setup. It has no authentication or bearer-token configuration. The listener binds to `127.0.0.1` by default; do not bind it to a LAN or public interface. The Angular Dashboard connects automatically.

## Start locally

Harvester prepares and migrates the environment-specific relational database during normal startup. The API reuses that connection; it does not open another SQLite connection, create schema, or own database shutdown.

Start Harvester normally:

```sh
pnpm --filter @coinzilla/harvester dev
```

### Fetch one market's order and fill history from Bash

The API does not use a `/api/trading-history` route and does not default to port 3000. With the default port, use these read-only requests from the repository root or `apps/harvester`:

```sh
# Default port is 4201; replace it if HARVESTER_API_PORT is configured differently.
API_URL="http://127.0.0.1:4201"

# Orders (including open, partially filled, filled, and terminal order records)
curl --fail-with-body -sS "${API_URL}/api/v1/trading/orders?symbol=DOGEUSDT&limit=100" \
  | node -e 'let s=""; process.stdin.on("data", d => s += d); process.stdin.on("end", () => console.log(JSON.stringify(JSON.parse(s), null, 2)))'

# Executed trades/fills and their persisted commission facts
curl --fail-with-body -sS "${API_URL}/api/v1/trading/fills?symbol=DOGEUSDT&limit=100" \
  | node -e 'let s=""; process.stdin.on("data", d => s += d); process.stdin.on("end", () => console.log(JSON.stringify(JSON.parse(s), null, 2)))'
```

No `jq` dependency is required; Node.js formats the JSON. Each response is paginated (maximum `limit=100`); inspect `data.pagination.hasMore` and increment `offset` to retrieve later pages.

The local runtime API starts whenever the Harvester runtime and EventBus are available. If relational history persistence is unavailable, runtime status, operator snapshots, market data, and provider-account WebSocket snapshots remain available. Persisted order, fill, commission, and metadata resources return HTTP 503 with `HARVESTER_TRADING_HISTORY_PERSISTENCE_UNAVAILABLE`; they never return a fabricated empty history. Diagnose the database failure tracked by [#1854](https://github.com/45s/coinzilla/issues/1854) before expecting persisted history to recover. Do not interpret HTTP 503 or connection refusal as an empty DOGE history.

The API starts with Harvester at `http://127.0.0.1:4201`. It uses Harvester's selected `TRADING_MODE` and `HARVESTER_DATABASE_DIRECTORY`; TESTNET and LIVE remain separate database files. No API token or Dashboard credential is needed.

The `HARVESTER_API_PORT` setting can change the listener port. The host is fixed to `127.0.0.1`. The API starts when the active runtime and EventBus are available; relational history persistence is required only for persisted-history resources. The Dashboard may be served from any valid HTTP port on `localhost` or `127.0.0.1`. Harvester closes the API listener before closing the shared database connection.

## Local-only security boundary

The HTTP and WebSocket endpoints have no authentication. This is a deliberate local-only tradeoff for a single-user development machine, not a production or remote-host configuration. The listener is fixed to loopback, HTTP CORS, WebSocket upgrades, and operator commands accept only HTTP origins on exact `localhost` or `127.0.0.1` hosts, on any valid port. External and LAN origins remain rejected. Do not expose this listener through a reverse proxy, container port mapping, LAN interface, or public host.

Persisted-history resources are read-only. The same local server also exposes the existing operator-control contract, limited to explicit BUY pause/resume commands; it does not submit or cancel exchange orders.

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
| WS upgrade | `/api/v1/trading/events` | live provider account/order snapshots and persisted-history invalidation notifications |

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

## Real-time WebSocket messages

Connect to `ws://127.0.0.1:4201/api/v1/trading/events` on the same host and port as the local API. The socket is mounted on the existing loopback listener and does not start a second process, database connection, or broker connection.

### Live exchange-account snapshots

Every new WebSocket client receives an initial `exchange-accounts.snapshot` message. Harvester reads only the account readers composed from provider runtimes that are already running; it never constructs a broker or opens a new exchange connection for Dashboard clients.

```json
{
  "type": "exchange-accounts.snapshot",
  "observedAt": "2026-11-22T10:00:00.000Z",
  "accounts": [{
    "providerInstanceId": "binanceTestnet",
    "providerType": "binance",
    "accountId": "binance-primary",
    "environment": "testnet",
    "connected": true,
    "accountSnapshot": { "sourceTime": "2026-11-22T09:59:59.000Z", "balances": [] },
    "openOrders": [],
    "errors": {}
  }]
}
```

Each account includes provider/account identity, environment and connection state, the current balance snapshot, the current account-wide open-order list, and an `errors` object. Financial values are passed through without binary floating-point conversion. A successful empty `balances` or `openOrders` array means the reader successfully reported no rows. If a read fails or returns a malformed result, its corresponding snapshot is `null` and `errors.accountSnapshot` or `errors.openOrders` contains a safe explanation; Harvester never turns a failed read into an empty list. One provider's read failure does not hide successful snapshots from other providers.

After `account.snapshot_captured` or `account.open_orders_captured`, connected clients receive an `exchange-accounts.updated` message containing a fresh snapshot of every configured account reader. The initial snapshot is also sent when the provider list is empty, allowing clients to show an honest no-provider state. Every successful reconnect receives a new initial snapshot; clients do not need to send a request frame.

These are current runtime observations, not persisted history, accounting evidence, or durable replay. Messages can be missed while disconnected; the next connection's initial snapshot reconciles the current account view. No account/order mutation command is accepted over this socket.

### WebSocket framing and resource limits

Server-to-client messages use RFC 6455 unmasked final frames and the protocol's three payload-length forms: inline 7-bit lengths (0–125 bytes), 16-bit extended lengths (126–65,535 bytes), and 64-bit extended lengths (65,536 bytes and above). Lengths are calculated from the UTF-8 encoded payload bytes, not JavaScript string characters. Large snapshots are sent as complete messages; the server never truncates a snapshot to fit a frame header.

The local API applies explicit outbound resource limits:

- A serialized JSON WebSocket message may contain at most **1 MiB** of UTF-8 payload. A larger application message is rejected by closing only that client with WebSocket status **1009 (message too big)**. The server does not split, truncate, or publish a partial snapshot.
- The per-client socket write queue is bounded at **2 MiB**. If another complete frame would exceed that queue budget, the slow client is closed with status **1013 (try again later)**.
- A JSON serialization, frame-encoding, or synchronous socket-write failure closes only the affected client with status **1011 (internal error)**. Client cleanup removes its heartbeat and subscription membership; the HTTP listener, Harvester process, and other clients remain available.
- Client close, heartbeat, and pong control-frame writes use the same protocol encoder and contain synchronous socket failures at the client boundary.

These limits are transport safeguards, not limits on exchange account contents or trading data. If a valid snapshot exceeds the application message cap, the client must reconnect after the source payload is corrected or the documented contract is deliberately revised; the server never reports a truncated snapshot as complete.

### Live Bots operator snapshots

The same socket streams the authoritative runtime, configured-market, and Portfolio read models used by the Bots workspace. A new client receives a complete `bots.snapshot` message; every relevant application/runtime notification produces a newer full `bots.state.updated` message. The server subscribes before accepting upgrades. If an invalidation arrives during a read, the captured revision is sent first and the latest invalidation is coalesced into a follow-up read/update, so the initial snapshot and subsequent state change are both observable without losing the newer state.

```json
{
  "type": "bots.snapshot",
  "version": 1,
  "revision": 12,
  "observedAt": "2026-11-24T09:00:00.000Z",
  "data": {
    "status": {
      "ok": true,
      "data": {
        "observedAt": 120000,
        "runtimeState": "RUNNING",
        "tradingEnabled": true,
        "userData": { "ready": true, "status": "READY" },
        "readiness": { "state": "READY", "blockers": [] },
        "markets": { "configured": 0, "enabled": 0, "blocked": 0 }
      }
    },
    "markets": {
      "ok": true,
      "data": {
        "observedAt": 120000,
        "tradingEnabled": true,
        "userDataReady": true,
        "userDataStatus": "READY",
        "markets": []
      }
    },
    "portfolio": {
      "ok": true,
      "data": { "observedAt": 120000, "positions": [] }
    }
  }
}
```

The versioned envelope contains a monotonically increasing server-process revision and a sampling timestamp. `bots.state.updated` carries the same complete status/markets/portfolio data shape as `bots.snapshot`; it is not a partial delta. A Harvester process restart begins a new revision epoch; after the socket reconnects, the Dashboard accepts the new connection's full snapshot before comparing later revisions. The stream intentionally does not publish every market-price tick; `latestPrice` and `priceFresh` reflect the read model at the time of the latest state-triggered snapshot. Resource values are the existing application query DTOs: runtime status from `getStatus`, market readiness/control state from `getMarkets`, and Portfolio positions/recovery accounting from `getPositions`. Decimal financial values remain strings. The WebSocket adapter does not query the broker, construct an exchange connection, derive strategy registrations, or calculate financial values.

If any required read fails or is malformed, the server sends `bots.snapshot.unavailable` for the initial read or `bots.state.updated.unavailable` for a follow-up update, with the same versioned envelope and an explicit per-resource `ok: false` error. A failed read is never converted into an empty market or Portfolio list. The Dashboard retains its last complete snapshot as stale (or unavailable before the first complete snapshot) and disables commands until a complete snapshot is received again.

Snapshots are sampled after the explicit `harvester.operator_buy_control_completed` application event and relevant process/configuration, broker connection/subscription, user-data-readiness, market-rule, fill/accounting, recovery-cycle, and account-audit notifications. The operator event is published only after the existing BUY-control application use case succeeds. Its payload distinguishes `scope: "MARKET"` with a symbol from `scope: "GLOBAL"` without a symbol, and records `action: "PAUSE"` or `"RESUME"`. Strategy safety pauses are not operator BUY-control events and are not represented as operator commands.

The socket remains read-only: no command frame is accepted. Market/global BUY controls still use the existing confirmation-gated HTTP `POST /api/v1/trading/operator/commands` endpoint. After a successful command, the application event triggers a new full snapshot. The Dashboard tracks WebSocket connection health separately from snapshot freshness, ignores duplicate/out-of-order revisions, uses bounded reconnect backoff, and receives a fresh complete snapshot on every reconnect. No REST polling or manual refresh is required for the Bots workspace.

### Persisted-history invalidations

The same socket may receive resource-only `trading-history.updated` messages:

```json
{
  "type": "trading-history.updated",
  "resources": ["orders"]
}
```

The `resources` array contains one or more of `orders`, `fills`, and `commissions`. Order notifications are published only after an order-history repository upsert succeeds. Fill notifications are published only after the fill and its commission facts have been persisted successfully; they invalidate both `fills` and `commissions`. Failed persistence writes never produce success notifications.

These messages are invalidation hints, not a durable event stream:

- EventBus delivery is in-memory and best-effort. Messages can be missed while disconnected or when a process/socket fails.
- There are no replay cursors, acknowledgements, exactly-once guarantees, or client-side event offsets.
- HTTP trading-history list/detail resources remain authoritative for persisted Orders, Fills, and Commissions.
- Clients of persisted-history resources must fetch fresh HTTP snapshots after initial WebSocket connection and every reconnect, and refresh the currently displayed resource when a matching invalidation arrives.
- Do not use invalidation messages as accounting, audit, or exchange evidence.

The Exchanges and Open Orders Dashboard pages consume full account snapshots over WebSocket only and make no HTTP requests. The Bots workspace consumes versioned operator snapshots over WebSocket and sends confirmed commands over HTTP; the legacy Operator page retains its existing REST contract. The server closes active sockets before the HTTP listener and shared database are shut down. Dashboard WebSocket clients use bounded reconnect backoff and display live, reconnecting, and offline states.

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

This persisted-history contract intentionally covers only existing `orders`, `fills`, and `fill_commissions` records. It does not persist account snapshots, introduce `sessions` or `errors` tables, add order controls, or perform broker/exchange operations. Current account and open-order snapshots are runtime-only WebSocket observations.

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

The HTTP and WebSocket listener runs inside the existing Harvester process and is owned by the process composition root. HTTP exposes the versioned GET resources listed above. The WebSocket adapter subscribes to persisted-history invalidations, account-monitor update notifications, and application/runtime events that invalidate the Bots operator snapshot. It reads account snapshots only through the already-composed provider-account reader functions; it does not create schema, change trading readiness, construct brokers, or own the shared database connection.

## Verification

The API and WebSocket tests use temporary SQLite files, fake application dependencies, account-reader stubs, an in-memory EventBus, native WebSocket clients, and ephemeral loopback ports. Tests verify initial account snapshots, per-provider read-failure isolation, refreshed snapshots after account-monitor notifications, versioned Bots snapshots, snapshot-read race protection, reconnect synchronization, operator BUY-control event scope, persisted-history invalidation ordering, and socket lifecycle. Dashboard Exchanges/Open Orders tests prove WebSocket-only snapshot consumption, filters, favourites, details, and reconnect refresh. Tests do not connect to an exchange or require credentials.

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
