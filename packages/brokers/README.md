# Broker integrations

For the package's target DDD structure, dependency rules, responsibility map, and migration phases, see [Architecture](./ARCHITECTURE.md) and the execution status in [Roadmap](./ROADMAP.md).

## Package exports

The `@coinzilla/brokers` entry point exports:

- `BinanceWebSocketBroker` and `BinanceWebSocketConfig` — the native Binance Spot WebSocket API/Streams integration.
- `BitunixSpotBroker` and `BitunixSpotConfig` — the Bitunix Spot REST integration.
- `CoreBroker` — the existing compatibility base class; it is not a formal application-owned broker port.
- `normalizeBinanceId` — exact non-negative Binance identifier normalization, also used by the Harvester infrastructure adapter.

Consumers should depend on their own narrow application port rather than treating `CoreBroker` as a complete cross-exchange contract.

## Bitunix Spot integration

The Bitunix implementation is deliberately **read-only** at this stage. It currently supports:

- Spot market catalog and per-symbol market metadata.
- Spot balances.
- Latest price lookup (request/response).
- Per-symbol pending orders and paginated order history.
- Order detail lookup by Bitunix broker order ID.
- Per-order canonical fill lookup.

It does not claim parity with Binance yet. The documented Bitunix Spot API has material lifecycle gaps:

1. Spot order placement does not accept an exchange-side client order ID. If a placement response is lost, the broker cannot reliably locate the accepted order by the caller's stable identity.
2. The documented private Spot WebSocket API is request/response and does not document a continuous user order/execution event stream. The public market WebSocket methods are also request/response, not a subscription stream.
3. The Spot account response has no source update timestamp, so `getAccountSnapshot()` fails rather than inventing one.
4. Pending orders require a symbol. Open orders cannot be fetched account-wide using the documented endpoint.
5. The published REST and WebSocket order documentation contradicts each other about limit/market `volume` units. The current adapter does not submit orders, so no ambiguous quantity conversion is attempted.
6. The public Spot documentation lists the production REST endpoint; no Spot TESTNET endpoint is documented.

For those reasons `createOrder()`, `cancelOrder()`, canonical order lookup/history, server-time lookup and price subscriptions are explicitly unsupported. Unsupported mutation methods do not send a request. Do not remove these guards or enable Bitunix for Harvester trading until exchange-side client identity, order lifecycle reconciliation, and quantity semantics are verified.

The integration uses the official [Bitunix Spot REST documentation](https://www.bitunix.com/api-docs/spots/en_us/) and [Spot WebSocket documentation](https://www.bitunix.com/api-docs/spots/en_us/ws/). Keep API credentials in environment variables or a secret manager. Never commit credentials or log signatures/authenticated request payloads.

Example read-only construction:

```js
import { BitunixSpotBroker } from "@coinzilla/brokers"

const broker = new BitunixSpotBroker({
  apiKey: process.env.BITUNIX_API_KEY,
  apiSecret: process.env.BITUNIX_API_SECRET,
  tradingMode: "live",
})

await broker.connect()
try {
  const result = await broker.getBalances()
  if (!result.ok) throw result.errors[0]
  // Use result.data.
} finally {
  await broker.disconnect()
}
```

Bitunix Spot currently requires explicit `tradingMode: "live"` because no Spot TESTNET environment is documented. Do not use production credentials for automated mutation tests; order mutation is disabled in this adapter.

## Binance WebSocket integration

The active Binance implementation is `BinanceWebSocketBroker`. It uses two independent native Node.js WebSocket connections:

- **WebSocket API**: signed RPC for account, order, history, metadata, and signature-based user-data subscription.
- **WebSocket Streams**: public market-data subscriptions such as aggregate trades.

The Binance package does not use the Binance REST API or a third-party Binance SDK. Do not add REST fallbacks or automatically retry a state-changing request after an uncertain disconnect.

### Canonical order placement response

The canonical `createCanonicalOrder()` contract requires the complete exchange order facts (exchange order ID, client order ID, type, side, original/executed quantities, price and status) to construct a `CanonicalOrder`. Binance Spot defaults `LIMIT` and `MARKET` to `FULL`, but defaults other order types such as `LIMIT_MAKER` to the minimal `ACK` response. ACK contains identifiers and transaction time only; it is not sufficient for canonical ownership tracking.

Canonical placement therefore explicitly sends `newOrderRespType: "RESULT"`. RESULT returns the order facts required by the canonical adapter without requesting the additional `fills` array. This applies to canonical placement regardless of order type; the ordinary `createOrder()` compatibility method retains its existing response contract.

Do not infer a successful canonical order from a minimal ACK, synthesize missing order facts, or automatically retry a state-changing placement after an uncertain response. If the request outcome is ambiguous, Harvester must resolve the original client order ID through authoritative user-data or broker reconciliation before any further order action.

## JavaScript editor types

The public broker methods, configuration options, exchange adapters, RPC/Streams clients, and user-data boundaries use JSDoc to describe inputs, outputs, callbacks, and important value constraints. VS Code and other JavaScript language servers read these annotations for hover information, parameter hints, and IntelliSense without a TypeScript build step.

The package remains plain JavaScript. JSDoc improves editor type information; it does not add runtime validation or enable project-wide static type checking. Keep runtime validation and the existing offline tests as the correctness boundary. Do not add `checkJs`, `@ts-check`, TypeScript declarations, or a TypeScript toolchain as part of routine JSDoc maintenance; follow the repository-wide [JavaScript and JSDoc standard](../../docs/engineering/JAVASCRIPT_JSDOC_STANDARD.md).

## Binance runtime and configuration

- The broker package declares a standalone floor of Node.js **22.23.4 or newer**. The repository workspace currently requires Node.js **24 or newer**. Independently, the native transport requires a patched bundled Undici release: **6.29.1 or newer in major 6, 7.30.1 or newer in major 7, or 8.12.2 or newer in major 8**. Unknown or unsupported Undici majors are rejected. Meeting the Node floor alone does not prove that the bundled Undici version passes this runtime guard.
- Construct the broker with non-empty `apiKey` and `apiSecret`.
- `tradingMode` is required and must be exactly `testnet` or `live`. It alone selects the Binance endpoint pair: `testnet` uses Binance Spot TESTNET; `live` uses Binance Spot LIVE. The broker does not inspect `NODE_ENV` or silently choose a default.
- `websocketApiUrl` and `websocketStreamsUrl` can be supplied explicitly for controlled environments. Do not point integration tests at production.
- `reconnectDelay` defaults to 5,000 ms and must be a non-negative integer.

Example:

```js
import { BinanceWebSocketBroker } from "@coinzilla/brokers"

const broker = new BinanceWebSocketBroker({
  apiKey: process.env.BINANCE_API_KEY,
  apiSecret: process.env.BINANCE_API_SECRET_KEY,
  tradingMode: process.env.TRADING_MODE,
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

## Binance API permissions

Use a dedicated Binance Spot TESTNET API key, never a production key. The signed account, order-status, history, and user-data subscription checks in the read-only TESTNET workflow need the relevant account-read access and a valid API key/secret pair. They do **not** need Spot trading permission.

**For the current GitHub Actions read-only workflow, keep Spot trading and withdrawals disabled.** The workflow sets `BINANCE_TESTNET_ALLOW_ORDER_MUTATIONS=0`; its integration checks do not create, cancel, or modify orders. Giving this key Spot trading permission does not make the workflow trade, but it grants capability the workflow does not need and increases the impact of an accidental future code/configuration change. If the key you created has trading permission enabled, edit its Binance TESTNET API restrictions and disable Spot trading before using it for this read-only acceptance run. Never enable withdrawals.

A separate, explicitly authorized local TESTNET order-lifecycle test is different: it creates and then cancels a test order, requires TESTNET Spot trading permission, and must additionally set `BINANCE_TESTNET_ALLOW_ORDER_MUTATIONS=1`. Do not add that permission or enable that flag for the GitHub Actions read-only workflow. The package cannot grant permissions or determine an account's Binance-side restrictions.

## Binance connection and subscription lifecycle

`connect()` opens the WebSocket API connection. The public Streams connection is opened on demand when `subscribeForPrices()` or `subscribeForBookTicker()` is called.

`disconnect()` stops user-data recovery, disconnects both clients, and is safe to call during shutdown. Applications should await it during graceful shutdown.

For user data:

1. Call `subscribeForUserData({ onEvent, onStatus })` after `connect()`.
2. The broker uses `userDataStream.subscribe.signature` on the WebSocket API connection. It uses the existing HMAC API key/secret flow; it does not require Ed25519 or `session.logon`.
3. Multiple local subscribers share one remote subscription on the API connection.
4. The returned subscription data provides `disconnect()`, the legacy `acknowledgeRecovery()` boolean, and the additive `acknowledgeRecoveryResult()` result contract.
5. A `terminated` or `connectionClosed` status means the event history has a gap. The broker reconnects and resubscribes, then emits `recovered` with `reconciliationRequired: true`.
6. The broker includes a monotonically increasing `recoveryGeneration` in each `recovered` reminder and the terminal `reconciled` status. A consumer must retain the token for the recovery work it is performing; a later disconnect/recovery produces a strictly newer token.
7. The consumer must reconcile current account/order/trade state before acknowledging recovery. The broker blocks order mutations until every active subscriber acknowledges the current recovery generation.
8. Call the returned `disconnect()` when the local consumer is done. When the last subscriber leaves, the broker stops the remote user-data subscription.

See the [broker roadmap](./ROADMAP.md) for verified lifecycle coverage and remaining work.
