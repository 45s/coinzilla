# Binance WebSocket broker operations

The active Binance implementation is `BinanceWebSocketBroker`. It uses two independent native Node.js WebSocket connections:

- **WebSocket API** (`wss://ws-api...`): signed RPC for account, order, history, metadata, and the signature-based user-data subscription.
- **WebSocket Streams** (`wss://stream...`): public market-data subscriptions such as aggregate trades.

The package does not use the Binance REST API or a third-party Binance SDK. Do not add REST fallbacks or automatically retry a state-changing request after an uncertain disconnect.

## Package exports

The `@coinzilla/brokers` entry point exports:

- `BinanceWebSocketBroker` — the concrete Binance WebSocket API/Streams broker.
- `BinanceWebSocketConfig` — validated Binance broker configuration.
- `CoreBroker` — the existing compatibility base class; it is not a formal application-owned broker port.
- `normalizeBinanceId` — exact non-negative Binance identifier normalization, also used by the Harvester infrastructure adapter.

Keep exchange-specific operations behind the Binance adapter. Consumers should depend on their own narrow application port rather than treating `CoreBroker` as a complete cross-exchange contract.

## Runtime and configuration

- Node.js **24 or newer** is required. The native transport also checks the bundled Undici version at runtime.
- Construct the broker with non-empty `apiKey` and `apiSecret`.
- The default endpoint pair is selected by the repository's `isProdMode` setting: production endpoints in production mode, TESTNET endpoints otherwise.
- `websocketApiUrl` and `websocketStreamsUrl` can be supplied explicitly for controlled environments. Do not point integration tests at production.
- `reconnectDelay` defaults to 5,000 ms and must be a non-negative integer.

Example:

```js
import { BinanceWebSocketBroker } from "@coinzilla/brokers"

const broker = new BinanceWebSocketBroker({
  apiKey: process.env.BINANCE_API_KEY,
  apiSecret: process.env.BINANCE_API_SECRET_KEY,
})

await broker.connect()
try {
  const result = await broker.getOpenOrders({ symbol: "BTCUSDT" })
  if (!result.ok) throw result.errors[0]
  // Use result.data.
} finally {
  await broker.disconnect()
}
```

Keep credentials in environment variables or a secret manager. Never commit real credentials or log API secrets, signatures, or authenticated request payloads.

## API permissions

Use a dedicated Binance Spot TESTNET API key, never a production key. The signed account, order-status, history, and user-data subscription checks in the read-only TESTNET workflow need the relevant account-read access and a valid API key/secret pair. They do **not** need Spot trading permission.

**For the current GitHub Actions read-only workflow, keep Spot trading and withdrawals disabled.** The workflow sets `BINANCE_TESTNET_ALLOW_ORDER_MUTATIONS=0`; its integration checks do not create, cancel, or modify orders. Giving this key Spot trading permission does not make the workflow trade, but it grants capability the workflow does not need and increases the impact of an accidental future code/configuration change. If the key you created has trading permission enabled, edit its Binance TESTNET API restrictions and disable Spot trading before using it for this read-only acceptance run. Never enable withdrawals.

A separate, explicitly authorized local TESTNET order-lifecycle test is different: it creates and then cancels a test order, requires TESTNET Spot trading permission, and must additionally set `BINANCE_TESTNET_ALLOW_ORDER_MUTATIONS=1`. Do not add that permission or enable that flag for the GitHub Actions read-only workflow. The package cannot grant permissions or determine an account's Binance-side restrictions.

## Connection and subscription lifecycle

`connect()` opens the WebSocket API connection. The public Streams connection is opened on demand when `subscribeForPrices()` or `subscribeForBookTicker()` is called.

`disconnect()` stops user-data recovery, disconnects both clients, and is safe to call during shutdown. Applications should await it during graceful shutdown.

For user data:

1. Call `subscribeForUserData({ onEvent, onStatus })` after `connect()`.
2. The broker uses `userDataStream.subscribe.signature` on the WebSocket API connection. It uses the existing HMAC API key/secret flow; it does not require Ed25519 or `session.logon`.
3. Multiple local subscribers share one remote subscription on the API connection.
4. The returned subscription data provides `disconnect()` and `acknowledgeRecovery()`.
5. A `terminated` or `connectionClosed` status means the event history has a gap. The broker reconnects and resubscribes, then emits `recovered` with `reconciliationRequired: true`.
6. The consumer must reconcile current account/order/trade state before calling `acknowledgeRecovery()`. Trading remains fail-closed until every active subscriber acknowledges.
7. A `reconciled` status indicates that all active subscribers acknowledged the recovery.

The recommended reconciliation inputs are:

- `getAccountSnapshot()` for current balances and the account snapshot's source timestamp.
- `getOpenOrders()` for the current open-order set.
- `getExchangeMarkets()` for the complete symbol catalog returned by Binance `exchangeInfo`; this read-only method returns canonical `Market` values and primes the broker's canonical market cache. It includes the symbols in the current exchange catalog, not delisted symbols.
`getOpenOrders({ symbol? })` accepts an omitted symbol to retrieve the account-wide open-order set. Its normalized `Order` values retain `id`, `symbol`, optional `clientOrderId`, `originalPrice`, `originalQuantity`, `executedQuantity`, and `status`. `price` remains the legacy numeric convenience field; use `originalPrice` when exact decimal fidelity is required for audit/reconciliation. `originalPrice`, original quantity, and executed quantity preserve the exchange's decimal strings.

- `getMyTrades()` and `getOrderHistory()` for available symbol-scoped history, using pagination where required.

These snapshots and query results do **not** reconstruct every intermediate event or balance delta missed during an outage. Event timestamps are not a global replay cursor. Consumers must reconcile their own durable state and must not assume that reconnecting replays missed events.

The `onEvent` callback contract remains `onEvent({ event })`. Status notifications are delivered separately through the optional `onStatus(status)` callback. Callback exceptions are isolated and logged.

## Order safety and uncertain outcomes

The broker blocks new order-changing calls while user data is unavailable or recovery is awaiting acknowledgement. This includes `createOrder()`, `cancelOrder()`, and `cancelAllOpenOrders()`.

A timeout or connection loss during a state-changing RPC can mean Binance accepted the operation but the response was lost. Such an outcome is **unknown**, not proof of failure. Do not blindly submit the same order or cancellation again. `getCanonicalOrder({ symbol, orderId })` and `getCanonicalOrder({ symbol, clientOrderId })` perform read-only `order.status` lookups and return an exact-decimal `CanonicalOrder`; the client-ID form maps to Binance's `origClientOrderId` request parameter. A lookup result is only an identity/status observation: callers must still reconcile canonical order history and actual fills. A not-found response or lookup failure is not permission to retry.

`getOrder({ symbol, orderId })` preserves broker-order-ID lookup. `getOrder({ symbol, clientOrderId })` performs the same signed `order.status` query using Binance's `origClientOrderId`. Exactly one identifier is required. A definitive Binance `-2013` (`NO_SUCH_ORDER`) response returns `{ ok: true, data: null }`; authentication, transport, rate-limit, malformed-response, and other API failures remain errors. This null result is not permission to retry an uncertain state-changing request without reconciling the surrounding order and fill state.

The RPC client uses a 10,000 ms default request timeout and a 5,000 ms default `recvWindow`. These are client defaults, not guarantees about Binance processing time or rate-limit capacity. Binance rate limits and account restrictions remain authoritative; handle rate-limit and API errors explicitly and do not add unbounded retry loops.

## Public market-data streams

`subscribeForPrices({ symbol, onPrice })` subscribes to the symbol's `aggTrade` stream and returns an unsubscribe function in its result data. The Streams client reconnects desired subscriptions after unexpected disconnection, paces control messages, limits a connection to 1,024 streams, batches subscribe/unsubscribe requests in groups of at most 200, and rotates a connection before the documented 24-hour connection lifetime.

`subscribeForBookTicker({ symbol, onBookTicker })` subscribes to the symbol's `bookTicker` stream and returns an unsubscribe function. Its immutable callback payload contains `symbol`, `bestBidPrice`, `bestBidQuantity`, `bestAskPrice`, `bestAskQuantity` (all price/quantity values remain exact decimal strings), and a local receipt `timestamp`. Malformed events and events for a different symbol are rejected; the timestamp records local receipt time because Binance's bookTicker event does not include an event timestamp.

These reconnect guarantees apply to the public stream subscription set; they do not imply user-data event replay or reconciliation.

## Offline tests and coverage

The default broker test suite is deterministic and offline:

```sh
pnpm --filter @coinzilla/brokers test
pnpm --filter @coinzilla/brokers test:coverage
```

The coverage command enforces minimums of **90% lines, 80% branches, and 80% functions** for the active Binance WebSocket runtime and shared Binance adapters. It deliberately excludes TESTNET integration suites, test files, and test-only fixtures/helpers: skipped live integrations and test scaffolding are not evidence of production-source coverage. These are risk-based broker-runtime floors, not a blanket workspace percentage.

## TESTNET integration tests

Default package tests are offline. Live integration suites require **both** an explicit opt-in and non-placeholder credentials:

- `BINANCE_TESTNET_INTEGRATION=1`
- `BINANCE_API_KEY`
- `BINANCE_API_SECRET_KEY`

Order placement/check/cancel coverage has an additional independent safety gate: set `BINANCE_TESTNET_ALLOW_ORDER_MUTATIONS=1` only when you explicitly intend the integration suite to create and cancel a TESTNET order. The general integration opt-in alone enables read-only checks and leaves the order lifecycle test skipped. The mutation flag does not bypass the general integration opt-in or the non-placeholder credential requirement.

The sample environment file is `packages/brokers/.env.example`. Copy it to `.env.development` and replace placeholders only with Binance TESTNET credentials. Do not use production credentials.

Commands from the repository root:

```sh
pnpm --filter @coinzilla/brokers test
pnpm --filter @coinzilla/brokers test:websocket
pnpm --filter @coinzilla/brokers test:user-data-integration
```

The default test command does not load `.env.development` or access the network. The two integration commands load it, but still skip unless the explicit opt-in and valid-looking credentials are present. The broker integration suite creates, checks, and cancels a TESTNET order; only run it when that action is intended. The user-data suite is read-only; optional event-receipt coverage additionally requires `BINANCE_TESTNET_EXPECT_USER_DATA_EVENT=1` and externally generated TESTNET activity while the test is running.

Both integration suites assert TESTNET WebSocket endpoints before connecting. Never change these tests to use production endpoints.

## TESTNET integration

The existing **Unit Tests** GitHub Actions workflow includes an opt-in `run_broker_testnet_read_only` manual-dispatch input. Select the `develop` branch, enable that input, and run the workflow using repository secrets `BINANCE_TESTNET_API_KEY` and `BINANCE_TESTNET_API_SECRET_KEY`. The job requires non-placeholder TESTNET credentials and asserts the TESTNET WebSocket endpoints.

The job explicitly sets `BINANCE_TESTNET_ALLOW_ORDER_MUTATIONS=0` and `BINANCE_TESTNET_EXPECT_USER_DATA_EVENT=0`. It performs read-only account, order-status, trade-history, market-data, and user-data reconnect/reconciliation checks; it never places, cancels, or modifies orders and does not wait for externally generated user-data events. The API key's server-side Spot trading permission is not needed and should remain disabled. Order-mutation and live-event checks remain separate, explicitly gated operations.

### GitHub Actions secret names and scope

Create these as **repository-level Actions secrets** in `45s/coinzilla` → Settings → Secrets and variables → Actions → Repository secrets:

| Secret name | Value |
|---|---|
| `BINANCE_TESTNET_API_KEY` | Dedicated Binance Spot TESTNET API key |
| `BINANCE_TESTNET_API_SECRET_KEY` | Matching Binance Spot TESTNET API secret |

The workflow maps these repository secrets to the broker's existing environment-variable names `BINANCE_API_KEY` and `BINANCE_API_SECRET_KEY`. Do not create a GitHub Environment for this workflow; it does not reference one. Never put secret values in source files, workflow YAML, issue/PR text, logs, screenshots, or chat. Never print or inspect secret values while troubleshooting.

**Permission matrix**

| Use case | Required API capability | Allowed mutations |
|---|---|---|
| Current manual GitHub Actions acceptance workflow | Signed account-read access and valid TESTNET key/secret | None; workflow forces mutation flag to `0` |
| External user-data event validation | Same read-only TESTNET key/secret; external activity is generated separately | No order mutations by the test |
| Separate local order create/check/cancel integration case | TESTNET account-read plus Spot trading | Creates and cancels a TESTNET order only when both opt-in flags are set |

If the key was created with Spot trading enabled, disable that permission before the read-only workflow. The fact that a key has extra permission does not mean this workflow uses it; it means the key is more powerful than necessary.

## Operational checklist

- Confirm the deployed Node.js version is at least 22.23.4.
- Confirm the API key has only the required account-read and/or Spot trading permissions.
- Confirm the process is using the intended environment and Binance endpoint pair.
- Monitor user-data status notifications; treat `connectionClosed` and `terminated` as reconciliation-required events.
- Keep order placement disabled until recovery has been reconciled and acknowledged.
- On shutdown, stop accepting new work and await `broker.disconnect()`.
- Treat state-changing RPC timeouts/disconnects as uncertain and reconcile before retrying.
- Do not infer that unit tests prove live Binance protocol behavior. Record opt-in TESTNET results separately.


## Binance order identifiers

The public `normalizeBinanceId(value, name?)` helper validates Binance identifiers as exact non-negative integers and returns their string representation. Decimal strings are accepted only when they contain digits and fit within JavaScript's safe-integer range; numeric inputs must already be safe integers. Use this shared normalizer at Binance adapter boundaries rather than reimplementing exchange ID parsing.


## Canonical Binance execution fill timestamps

For user-data `executionReport` TRADE events, canonical Fill execution time is Binance transaction time `T`. Event publication time `E` remains event/order-update metadata and must not be used as the execution timestamp. This matches REST `myTrades.time` so the same exchange trade has identical canonical facts regardless of whether REST or WebSocket delivers it first. Preserve strict duplicate-fill conflict detection: identical facts are idempotent; conflicting facts reusing a Fill ID remain errors.
