# Trading-history API v1

The Harvester trading-history API exposes persisted order, execution, and commission facts through a stable HTTP contract. It is an optional HTTP service started and stopped by the existing Harvester process over its already-open environment-specific relational database connection.

The application query layer is independent of HTTP and client identity. Angular, React, mobile clients, Telegram integrations, and other consumers use the same contract; none of them are dependencies of Harvester's domain or persistence model.

## Start locally

Harvester's normal startup prepares and migrates the environment-specific relational database. The API reuses that already-open connection; it does not open another SQLite connection, create schema, or own database shutdown.

Generate a local token:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Put the generated value in `apps/harvester/.env.development` (or `.env` for the normal start command). Do not commit it:

```dotenv
TRADING_MODE=testnet
HARVESTER_API_TOKEN="paste-your-generated-token-here"
HARVESTER_API_HOST="127.0.0.1"
HARVESTER_API_PORT="4201"
```

Start the API in a separate terminal:

```sh
pnpm --filter @coinzilla/harvester history:api:dev
```

The default address is `http://127.0.0.1:4201`. The API uses Harvester's selected `TRADING_MODE` and `HARVESTER_DATABASE_DIRECTORY`; TESTNET and LIVE remain separate database files. If `HARVESTER_API_TOKEN` is empty or absent, the API stays disabled without preventing Harvester startup. Invalid API configuration or an API bind failure is logged and isolated from trading startup.

Check the selected environment and local record counts:

```sh
curl -H "Authorization: Bearer $HARVESTER_API_TOKEN" \
  http://127.0.0.1:4201/api/v1/trading/metadata
```

On Windows PowerShell, use `$env:HARVESTER_API_TOKEN` in place of the shell variable syntax above.

Harvester's normal persistence setup owns database creation, migration, and closure. The API is started only when that relational persistence connection is available. Harvester closes the API listener before closing the shared database connection. The API does not change SQLite connection mode or impose a database-level read-only restriction.

## Authentication and network boundary

Every API resource requires:

```http
Authorization: Bearer <HARVESTER_API_TOKEN>
```

The configured token must contain at least 32 non-whitespace bytes. The token is supplied through the process environment and is never included in responses or logs.

The server binds to `127.0.0.1` by default. `HARVESTER_API_HOST` can explicitly select another host and `HARVESTER_API_PORT` selects the port. Do not expose plain HTTP over an untrusted network. For remote clients, place the service behind a TLS-terminating reverse proxy, restrict network access with a firewall, and manage/rotate the bearer token as a secret.

The API permits browser CORS requests with an Authorization header so independent browser clients can use the same contract. It does not use cookies or credentialed cross-origin requests.

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
| 401 | `HARVESTER_TRADING_HISTORY_AUTHENTICATION_REQUIRED` | Missing or invalid bearer token |
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

HTTP authentication and response serialization stay in the transport adapter. Query validation and application error codes stay in the application layer. SQL and row mapping stay in Harvester infrastructure. The Harvester domain does not depend on the HTTP framework, route names, UI, or consumer identity.

The HTTP listener runs inside the existing Harvester process and is owned by the process composition root. It exposes the initial versioned GET resources listed above. Future operations can be added through explicit application use cases and versioned routes without coupling the domain to HTTP or a client. The listener does not subscribe to trading events, create schema, change trading readiness, or own the shared database connection.

## Verification

The API tests use temporary SQLite files, fake application dependencies, and ephemeral loopback ports. They do not connect to an exchange or require credentials.
