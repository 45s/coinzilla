# Binance WebSocket broker operations

The active Binance implementation is `BinanceWebSocketBroker`. It uses two independent native Node.js WebSocket connections:

- **WebSocket API** (`wss://ws-api...`): signed RPC for account, order, history, metadata, and the signature-based user-data subscription.
- **WebSocket Streams** (`wss://stream...`): public market-data subscriptions such as aggregate trades.

The package does not use the Binance REST API or a third-party Binance SDK. Do not add REST fallbacks or automatically retry a state-changing request after an uncertain disconnect.

## Runtime and configuration

- Node.js **22.23.4 or newer** is required. The native transport also checks the bundled Undici version at runtime.
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

The key must be authorized for the account operations the application actually uses. Read-only account and history operations require the relevant account-read permission. Order placement/cancellation requires Spot trading permission. User-data signature subscription requires an API key/secret accepted by Binance for the account.

Use the least privilege that supports the workload. The package cannot grant permissions or determine an account's Binance-side restrictions. The broker's TESTNET order integration test places and then cancels a test order, so credentials used for that test need TESTNET Spot trading permission. The user-data integration suite is read-only and does not place orders.

## Connection and subscription lifecycle

`connect()` opens the WebSocket API connection. The public Streams connection is opened on demand when `subscribeForPrices()` is called.

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
- `getMyTrades()` and `getOrderHistory()` for available symbol-scoped history, using pagination where required.

These snapshots and query results do **not** reconstruct every intermediate event or balance delta missed during an outage. Event timestamps are not a global replay cursor. Consumers must reconcile their own durable state and must not assume that reconnecting replays missed events.

The `onEvent` callback contract remains `onEvent({ event })`. Status notifications are delivered separately through the optional `onStatus(status)` callback. Callback exceptions are isolated and logged.

## Order safety and uncertain outcomes

The broker blocks new order-changing calls while user data is unavailable or recovery is awaiting acknowledgement. This includes `createOrder()`, `cancelOrder()`, and `cancelAllOpenOrders()`.

A timeout or connection loss during a state-changing RPC can mean Binance accepted the operation but the response was lost. Such an outcome is **unknown**, not proof of failure. Do not blindly submit the same order or cancellation again. Reconcile with Binance using a client order ID, order status, open orders, and available order/trade history before deciding what action is safe.

The RPC client uses a 10,000 ms default request timeout and a 5,000 ms default `recvWindow`. These are client defaults, not guarantees about Binance processing time or rate-limit capacity. Binance rate limits and account restrictions remain authoritative; handle rate-limit and API errors explicitly and do not add unbounded retry loops.

## Public market-data streams

`subscribeForPrices({ symbol, onPrice })` subscribes to the symbol's `aggTrade` stream and returns an unsubscribe function in its result data. The Streams client reconnects desired subscriptions after unexpected disconnection, paces control messages, limits a connection to 1,024 streams, batches subscribe/unsubscribe requests in groups of at most 200, and rotates a connection before the documented 24-hour connection lifetime.

These reconnect guarantees apply to the public stream subscription set; they do not imply user-data event replay or reconciliation.

## TESTNET integration tests

Default package tests are offline. Live integration suites require **both** an explicit opt-in and non-placeholder credentials:

- `BINANCE_TESTNET_INTEGRATION=1`
- `BINANCE_API_KEY`
- `BINANCE_API_SECRET_KEY`

The sample environment file is `packages/brokers/.env.example`. Copy it to `.env.development` and replace placeholders only with Binance TESTNET credentials. Do not use production credentials.

Commands from the repository root:

```sh
pnpm --filter @coinzilla/brokers test
pnpm --filter @coinzilla/brokers test:websocket
pnpm --filter @coinzilla/brokers test:user-data-integration
```

The default test command does not load `.env.development` or access the network. The two integration commands load it, but still skip unless the explicit opt-in and valid-looking credentials are present. The broker integration suite creates, checks, and cancels a TESTNET order; only run it when that action is intended. The user-data suite is read-only; optional event-receipt coverage additionally requires `BINANCE_TESTNET_EXPECT_USER_DATA_EVENT=1` and externally generated TESTNET activity while the test is running.

Both integration suites assert TESTNET WebSocket endpoints before connecting. Never change these tests to use production endpoints.

## Operational checklist

- Confirm the deployed Node.js version is at least 22.23.4.
- Confirm the API key has only the required account-read and/or Spot trading permissions.
- Confirm the process is using the intended environment and Binance endpoint pair.
- Monitor user-data status notifications; treat `connectionClosed` and `terminated` as reconciliation-required events.
- Keep order placement disabled until recovery has been reconciled and acknowledged.
- On shutdown, stop accepting new work and await `broker.disconnect()`.
- Treat state-changing RPC timeouts/disconnects as uncertain and reconcile before retrying.
- Do not infer that unit tests prove live Binance protocol behavior. Record opt-in TESTNET results separately.
