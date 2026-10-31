# Binance broker WebSocket contract and Phase 0 audit

**Audit date:** 2026-10-31  
**Repository:** `45s/coinzilla`  
**Audited source baseline:** `main` at `bec7266e9f2c2dddbc638e66f9dbd1cfe67a92ea`  
**Integration branch:** `migration/binance-native-ws`  
**Phase branch:** `migration/binance-phase-0-audit`

This document records the Phase 0 inventory. It is a contract and implementation map, not an implementation specification for undocumented behavior. Re-check Binance documentation and the latest `main` before each implementation phase.

## 1. Scope and dependency inventory

### Package manifest

`packages/brokers/package.json` currently declares:

| Dependency | Kind | Phase 0 finding |
|---|---|---|
| `@binance/spot` | Third-party runtime | The only direct third-party runtime dependency declared by this package. Version range `^34.0.3`. Must be removed after replacement and compatibility verification. |
| `@coinzilla/entities` | Internal workspace runtime | Keep if still required; not a third-party dependency. Its only declared dependency is `@coinzilla/utils`. |
| `@coinzilla/utils` | Internal workspace runtime | Keep if still required; its package manifest has no dependencies. |

The lockfile records `@binance/spot@34.0.3` and its external dependency graph (including `debug`). Removing only the import statements is insufficient: the package manifest and lockfile must both be updated and the production dependency tree audited.

The package's direct third-party runtime dependency target is therefore clear: remove `@binance/spot`, without removing internal workspace dependencies that remain part of the project contract.

### SDK package usage

The audited package files show:

- Runtime import of `Spot` from `@binance/spot` in `src/binance/broker-sdk/broker.js`.
- Runtime imports of production/testnet WebSocket URL constants from `@binance/spot` in `src/binance/broker-sdk/binance-sdk-config.js`.
- Test-only imports of those URL constants in `binance-sdk-config.test.js`.
- The package manifest dependency and lockfile entries described above.

No other `@binance/spot` imports were found in the inspected broker source tree. Re-run a repository-wide search immediately before Phase 7 removal.

## 2. Public package exports

`packages/brokers/src/index.js` currently exports:

| Export | Current source | Compatibility decision |
|---|---|---|
| `BinanceSdkBroker` | `binance/broker-sdk/broker.js` | Preserve the exported name initially; replace its internals with the native implementation. A later rename requires a separate consumer migration decision. |
| `BinanceSdkConfig` | `binance/broker-sdk/binance-sdk-config.js` | Preserve the exported name initially; remove SDK-derived constants and keep equivalent validated configuration. |
| `BinanceBroker` | `binance/broker/broker.js` | Legacy custom REST broker. Deprecate; do not expand. Remove only after import/consumer checks prove it safe. |
| `BinanceStreamClient` | `binance/websocket-stream/stream-client.js` | Existing custom Streams client, incomplete and not safe as-is. Its supported stream methods are part of the export compatibility inventory. |
| `wsEventsMap` | `binance/websocket-stream/adapters/index.js` | Preserve unless consumer search proves unused and a removal is explicitly planned. |
| `CoreBroker` | `broker.core.js` | Shared broker base class; preserve its public contract. |

The SDK broker also inherits `CoreBroker`. The base class provides shared logger/state fields and placeholder methods including `getAssets`, `cancelOrder`, `getOpenOrders`, `getPrice`, `createOrder`, `subscribeForPrices`, `getSymbolFilters`, and `getMyTrades`.

## 3. Repository consumer contract

The only current workspace package manifest declaring `@coinzilla/brokers` is `apps/bot-free-roll`. Its `prepare-broker.js` imports `BinanceSdkBroker` and `BinanceSdkConfig`, constructs the broker with `apiKey` and `apiSecret`, calls `connect()`, and calls `disconnect()` during cleanup.

The current bot consumer invokes these broker operations:

| Consumer operation | When/why used | Required compatibility |
|---|---|---|
| `connect()` / `disconnect()` | Broker startup and shutdown | Promise lifecycle; safe cleanup on partial startup failure. |
| `subscribeForUserData({ onEvent, onStatus? })` | Account/order execution events and lifecycle signals | Preserve the existing `{ event: adaptedEvent }` callback. Optional `onStatus` reports explicit stream termination, RPC errors, and unexpected socket closure with `recoveryRequired: true`; existing consumers may omit it. |
| `subscribeForPrices({ symbol, onPrice })` | Per-symbol aggregate trade prices | Lowercase stream symbol; callback receives the existing adapted aggregate-trade shape. |
| `getSymbolFilters({ symbol })` | Load symbol metadata before trading | Preserve `symbol`, `baseAsset`, `quoteAsset`, string `tickSize`, string `stepSize`, and `supportedOrderTypes`. |
| `createOrder(input)` | Submit bot orders | Preserve accepted input fields, `clientOrderId` mapping, defaults, and adapted order result. |
| `cancelOrder({ symbol, orderId })` | Cancel bot orders | Preserve adapted order result and structured errors. |
| `getMyTrades({ symbol, orderId, limit })` | Reconcile fills after cancellation/races | Preserve normalized fill fields, including exact quantity/price/commission strings and commission asset. |

The bot source also has explicit capability checks for `getSymbolFilters()` and `getMyTrades()`; absence of either is a startup/runtime contract failure. This migration must not edit `apps/bot-free-roll`; consumer source is read-only audit evidence.

Other SDK broker methods are public compatibility candidates even though the current bot source does not call them directly:

- `getAssets()`
- `getOpenOrders({ symbol? })`
- `getOrder({ symbol, orderId })`
- `getOrderHistory({ symbol, orderId?, limit? })`
- `cancelAllOpenOrders({ symbol })`
- `getPrices({ symbol })`

Do not silently drop these merely because the current bot does not call them. Their public export and existing tests mean they remain in the broker contract until the project deliberately narrows that contract.


### User-data lifecycle and event identity (Phase 6)

Binance wraps each user-data event with a `subscriptionId`. The broker forwards only events matching the active subscription. An `eventStreamTerminated` envelope is a subscription lifecycle signal, not an order/account update; it is reported through `onStatus` and is still forwarded in the existing `onEvent({ event })` shape for compatibility.

The broker keeps one remote `userDataStream.subscribe.signature` subscription per account/API connection and fans events out to local handles. Concurrent local subscribe calls share the same remote subscribe request. Disconnecting one handle removes only that callback; the remote subscription is removed when the final local handle disconnects. Binance documents one subscription per account per WebSocket API connection; do not create one remote subscription per callback.

The optional `onStatus` callback reports:
- `{ type: "terminated", subscriptionId, eventTime, recoveryRequired: true }`
- `{ type: "rpcError", error, recoveryRequired: false }`
- `{ type: "connectionClosed", code, reason, recoveryRequired: true }`
- `{ type: "recovering", attempt, error?, recoveryRequired: true }`
- `{ type: "recovered", subscriptionId, reconciliationRequired: true, recoveryRequired: true }`
- `{ type: "recoveryFailed", attempt, error?, recoveryRequired: true }`
- `{ type: "reconciled", subscriptionId, recoveryRequired: false }`

An explicit stream termination triggers a new signature subscription on the still-open API connection. An unexpected socket close creates a fresh one-shot native RPC client, reconnects it, then subscribes again. If a signature-subscribe request fails or times out after it may have reached Binance, the broker queries `session.subscriptions` before deciding that no subscription exists; it adopts the single active subscription ID when unambiguous instead of blindly creating a duplicate. Recovery uses a single-flight retry loop with exponential backoff capped at 30 seconds and a finite default budget of five attempts. It is canceled when the final local handle disconnects or the broker is intentionally shut down. A later explicit `broker.connect()` can resume retained subscribers after retry exhaustion.

A successful resubscription is **not** proof that missed events have been recovered. After recovery, each active local handle must call its additive `acknowledgeRecovery()` method only after its consumer has reconciled the relevant account/order state. Trading mutations (`createOrder`, `cancelOrder`, and `cancelAllOpenOrders`) remain blocked until every active local handle acknowledges. The handle returns `true` only when all active handles have acknowledged; otherwise it returns `false`. Existing consumers that do not handle `onStatus` remain fail-closed after an interruption. No consumer code is changed as part of this broker migration.

Intentional broker shutdown is not reported as an unexpected recovery gap. Unexpected API socket closure is logged even when no `onStatus` callback is supplied. Event and status callback exceptions are isolated so one local consumer cannot prevent delivery to other handles.

Execution reports can be deduplicated using the documented `symbol`, `orderId`, and `executionId` tuple. Other event types do not expose a universal unique event ID, so the bounded fallback cache suppresses only exact repeated payloads. The identity cache is retained across reconnects so a repeated event under a new subscription ID can still be suppressed. This is best-effort idempotency, not a claim that all semantic duplicates can be recognized.

Do not treat `E` (event time), `T` (transaction time), or `u` (account update time) as a global monotonic sequence or replay cursor. A connection interruption means events may have been missed. Current snapshots from `account.status` and `openOrders.status`, plus symbol-scoped `myTrades` / `allOrders` queries, can reconcile present state and available order/trade history but cannot reconstruct every missed intermediate balance delta. Never replay pending or uncertain state-changing RPC requests during recovery.


### Consumer reconciliation procedure after user-data recovery

A connection interruption creates an event-history gap. A new subscription restores future delivery; it does not replay missed events. The broker therefore keeps order mutations blocked until every active local subscription handle explicitly acknowledges reconciliation.

Consumers should perform reconciliation serially with their normal event-processing path:

1. Pause order placement and cancellation while the broker reports `connectionClosed`, `terminated`, or `recovering`. The broker independently enforces this pause.
2. Wait for `recovered`. This means the replacement API connection and signature subscription are active; it does **not** mean account/order state is reconciled.
3. Fetch a current account snapshot with `getAssets()` (`account.status`) and the current open-order snapshot with `getOpenOrders()` (`openOrders.status`).
4. For every symbol relevant to the consumer's tracked orders/fills, query `getOrderHistory({ symbol })` (`allOrders`) and `getMyTrades({ symbol })` (`myTrades`). Use known order IDs and bounded time/ID checkpoints where supported by the consumer's own state model.
5. Apply the snapshots/history idempotently, while ensuring newly arriving user-data events are serialized or buffered so a snapshot cannot overwrite a newer event.
6. Only after the consumer has established a consistent state, call `acknowledgeRecovery()` on that specific local subscription handle. If multiple handles exist, every active handle must acknowledge before the broker re-enables order mutations.
7. If any query or state application is incomplete, do not acknowledge. Keep the mutation gate closed and retry/reconcile under the consumer's own bounded policy.

**Reconciliation limits:** account and open-order snapshots describe current state; order/trade history queries expose available records. They cannot reconstruct every missed intermediate balance delta or prove that every event was observed. Do not synthesize missing balance events from current balances, and do not blindly replay an order placement/cancellation whose outcome was uncertain at disconnect time.

A handle added after recovery receives a `recovered` status with `reconciliationRequired: true` and must also acknowledge. A later interruption resets acknowledgements for every active handle. Disconnecting an unacknowledged handle removes it from the all-consumer acknowledgement barrier.

The current bot consumer audit is tracked separately in [issue #304](https://github.com/45s/coinzilla/issues/304). The broker migration does not modify bot application code. Until the bot domain adopts `onStatus` and `acknowledgeRecovery()`, that consumer intentionally remains fail-closed after an interruption.

### Opt-in TESTNET verification

Run the focused user-data test with `pnpm --filter @coinzilla/brokers test:user-data-integration` and read-only-capable Binance TESTNET API credentials in `.env.development` (`BINANCE_API_KEY` and `BINANCE_API_SECRET_KEY`). The test explicitly asserts the TESTNET WebSocket API hostname and performs no order placement or cancellation.

The broader `pnpm --filter @coinzilla/brokers test:integration` command also runs the existing `broker.integration.js` suite, which creates and cancels a TESTNET order. Use the focused command above when validating user-data recovery without order placement.

The user-data recovery integration test verifies signature subscription, active subscription lookup, socket disconnect, automatic reconnect/resubscription, account/open-order snapshots, symbol-scoped order/trade history, and the explicit acknowledgement gate. It is skipped by default when credentials are absent.

Live event receipt cannot be guaranteed without account activity. To opt into that assertion, set `BINANCE_TESTNET_EXPECT_USER_DATA_EVENT=1` and generate harmless account/order activity on the TESTNET account while the test is waiting. The test itself never places or cancels orders. The event timeout defaults to 60 seconds and can be changed with `BINANCE_TESTNET_EVENT_TIMEOUT_MS`.

## 4. Binance WebSocket API method matrix

The current `BinanceSdkBroker` maps its request/response operations as follows. The Binance method names below are documented Spot WebSocket API operations; verify exact parameters, signing payload canonicalization, response envelopes, limits, and error codes again during implementation.

| Broker method | Current SDK method | Binance Spot WebSocket API method | Security class | Notes |
|---|---|---|---|---|
| `getAssets()` | `accountStatus({ omitZeroBalances: true })` | `account.status` | USER_DATA, signed | Returns account balances; preserve current asset adapter behavior. |
| `getOpenOrders({ symbol? })` | `openOrdersStatus(params)` | `openOrders.status` | USER_DATA, signed | Symbol is optional; omitted means all open orders. |
| `getOrder({ symbol, orderId })` | `orderStatus(params)` | `order.status` | USER_DATA, signed | Preserve order adapter and ID representation. |
| `getOrderHistory({ symbol, orderId?, limit })` | `allOrders(params)` | `allOrders` | USER_DATA, signed | Current implementation returns raw Binance order history data; do not accidentally change this result shape in a transport rewrite. |
| `getMyTrades({ symbol, orderId?, limit })` | `myTrades(params)` | `myTrades` | USER_DATA, signed | Current implementation adapts trades; preserve exact decimal strings and commission metadata. |
| `createOrder(input)` | `orderPlace(params)` | `order.place` | TRADE, signed | State-changing request. Never automatically replay after uncertain disconnect. Preserve client order ID mapping and LIMIT/LIMIT_MAKER defaults. |
| `cancelOrder({ symbol, orderId })` | `orderCancel(params)` | `order.cancel` | TRADE, signed | State-changing request; uncertain outcome must be reconciled. |
| `cancelAllOpenOrders({ symbol })` | `openOrdersCancelAll(params)` | `openOrders.cancelAll` | TRADE, signed | State-changing request; response can contain order and order-list reports. |
| `getPrices({ symbol })` | `tickerPrice(params)` | `ticker.price` | NONE, public | WebSocket API request/response price snapshot. |
| `getSymbolFilters({ symbol })` | Direct global `fetch()` to REST `/api/v3/exchangeInfo` | `exchangeInfo` | NONE, public | The WebSocket API exposes this method; move metadata retrieval there. Preserve the validated filter output contract. |

The official Spot WebSocket API uses a request envelope containing a client-generated `id`, a `method`, and optional `params`; responses correlate by `id` and carry a status/result or error. The RPC implementation must support out-of-order responses and concurrent requests rather than relying on request/response arrival order.

## 5. User-data subscription is part of the WebSocket API connection

This is an important architectural distinction:

- The SDK broker's `subscribeForUserData()` calls `tradingConnection.userDataStreamSubscribeSignature()`.
- It does **not** subscribe to user data on the market-data Streams connection.
- Binance documents `userDataStream.subscribe.signature` as the signed USER_STREAM subscription method. It does not require `session.logon` or Ed25519 authentication, and Binance's changelog explicitly states it works with any API key type. Events are pushed on the subscribed WebSocket API connection.
- Binance also documents `userDataStream.subscribe`, which requires an authenticated WebSocket API session using Ed25519 keys. This is a separate alternative, not a prerequisite for `userDataStream.subscribe.signature`; do not substitute it.
- The old custom `BinanceStreamClient.userData()` is a different legacy path: it creates/renews a REST listen key and opens a classic Streams connection. It is incomplete and must not be mistaken for the SDK broker's current user-data behavior.

Therefore the target architecture has **two transport roles**, not “market streams plus user data on the same Streams socket”:

1. WebSocket API connection: RPC requests/responses **and** the authenticated user-data subscription/events delivered on that API connection.
2. WebSocket Streams connection: public market-data streams such as `<symbol>@aggTrade`.

**Credential compatibility decision:** preserve the current bot's existing HMAC API-key configuration. The existing `apiKey` and `apiSecret` are sufficient: include the API key in the signed request and compute the signature with HMAC-SHA-256 using the API secret. Binance's official changelog confirms that `userDataStream.subscribe.signature` works with any API key type and does not require an Ed25519 API key. The alternative `userDataStream.subscribe` method does require an Ed25519-authenticated session, but it is not the method used by the current SDK and must not be substituted. Phase 3 must still verify exact WebSocket signing-payload canonicalization with known test vectors and testnet; that is an implementation correctness gate, not a requirement for additional credentials.

## 6. Binance WebSocket Streams inventory

The old exported `BinanceStreamClient` currently exposes these stream methods:

| Method | Stream(s) constructed |
|---|---|
| `trade({ tickets })` | `<symbol>@trade` |
| `kline({ tickets, interval })` | `<symbol>@kline_<interval>` |
| `miniTicker({ symbol? })` | `<symbol>@miniTicker` or `!miniTicker@arr` |
| `ticker({ symbol? })` | `<symbol>@ticker` or `!ticker@arr` |
| `rollingWindowTicker({ windowSize, symbol? })` | `<symbol>@ticker_<windowSize>` or `!ticker_<windowSize>@arr` |
| `bookTicker({ symbol })` | `<symbol>@bookTicker` |
| `partialBookDepth({ symbol, levels, speed })` | `<symbol>@depth<levels>@<speed>` |
| `diffBookDepth({ symbol, speed })` | `<symbol>@depth@<speed>` |
| `aggTrade({ tickets })` | `<symbol>@aggTrade` |
| `userData()` | Legacy listen-key stream; do not carry forward as the new broker user-data path without a deliberate compatibility decision. |

The current bot uses only `aggTrade` through `BinanceSdkBroker.subscribeForPrices()`. The remaining stream methods are still exported API and need an explicit preserve/deprecate decision before removal.

Spot Streams support raw and combined connections. The current custom client supports a combined-stream URL mode and live SUBSCRIBE/UNSUBSCRIBE messages, but its transport is currently unusable (see findings below). Spot stream names use lowercase symbols.

## 7. Legacy custom implementation findings

### Old custom REST broker

`BinanceBroker` in `src/binance/broker/broker.js` delegates to REST-oriented methods. It exposes:

- `getAssets`
- `getPrices`
- `getOrder`
- `getOpenOrders`
- `cancelAllOpenOrders`
- `createOrder`
- `cancelOrder`
- `subscribeForPrices`

This is not a substitute for the SDK broker contract. It does not currently provide the SDK broker's order history, trade history, symbol filter, or user-data subscription behavior. Deprecate it and its REST-specific helpers; do not expand it as part of this WebSocket migration.

### Existing custom WebSocket transport/client

- `src/binance/websocket-stream/WS.js` defines an empty `createWebSocket()` function, so `initConnect()` cannot create a real socket.
- The class assumes EventEmitter-style `.on()` and low-level `.ping()`/`.pong()` methods. Node's built-in global WebSocket is WHATWG/EventTarget-style and does not expose those low-level methods.
- `stream-client.js` contains REST listen-key creation/renewal via the shared REST request helper, including an interval that is not retained for cleanup.
- The old client has no complete, tested lifecycle/recovery contract and must not be promoted by changing exports alone.
- Existing adapters and pure helper functions may be reusable, but they require characterization tests and protocol-specific review.

## 8. Runtime and platform decision

- Repository CI currently sets up **Node.js 22**.
- Root `package.json` and `packages/brokers/package.json` do not declare a Node `engines` range. The current `@coinzilla/event-bus` and `@coinzilla/journal` manifests declare `node >=20`; the `@coinzilla/bot-free-roll` manifest does not declare a Node range. Repository CI currently tests Node 22.
- Node's official v22 documentation records global WHATWG `WebSocket` as available without the experimental flag from Node 22.0.0 and no longer experimental from Node **22.4.0**. Node 20.10 introduced it behind an experimental flag. Therefore, the built-in client is a stable no-extra-flag choice only from Node 22.4.0.
- **Decision (accepted 2026-10-31): `@coinzilla/brokers` and every consumer using its native WebSocket implementation require Node.js >=22.4.0.** This intentionally raises the effective runtime floor for those consumers above the `node >=20` range declared by `@coinzilla/event-bus` and `@coinzilla/journal`. Add the matching `engines` metadata and update runtime documentation as part of implementation; do not imply that all unrelated workspace packages independently require Node 22.4.0.
- The WHATWG API is EventTarget-style and does not expose `ws`-style `.ping()` or `.pong()` methods. Binance Spot Streams requires timely control-frame ping/pong handling. The implementation must prove that the Node built-in client automatically handles server ping frames correctly; if that cannot be demonstrated on the supported Node runtime, stop and revisit the transport decision rather than introducing a third-party runtime dependency by default.
- The native WebSocket constructor and lifecycle behavior must be tested on the exact Node versions used by CI and production. Node 22 as a major version alone is not a sufficiently precise minimum-version contract.

## 9. Official protocol references reviewed

- [Binance Spot WebSocket API — Account](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/ws-api/account): `account.status`, `openOrders.status`, `order.status`, `allOrders`, and `myTrades`.
- [Binance Spot WebSocket API — Trade](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/ws-api/trade): `order.place`, `order.cancel`, and `openOrders.cancelAll`.
- [Binance Spot WebSocket API — General](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/ws-api/general): public `exchangeInfo`.
- [Binance Spot WebSocket API — Market](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/ws-api/market): `ticker.price`.
- [Binance Spot WebSocket API — User Data Stream](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/ws-api/user-data-stream): signature subscription and Ed25519 authenticated-session subscription are distinct methods.
- [Binance Spot WebSocket Streams — General](https://developers.binance.com/en/docs/products/spot/web-socket-streams): endpoints, raw/combined payloads, 24-hour connection lifetime, server ping requirements, message and stream limits, and shutdown behavior.
- [Node.js v22 Global WebSocket documentation](https://nodejs.org/download/release/v22.23.3/docs/api/globals.html): built-in WebSocket availability/stability history.
- [Node.js v22 WebSocket API](https://nodejs.org/download/release/v22.23.3/docs/api/globals.html#class-websocket): WHATWG WebSocket surface; no public low-level ping/pong methods.

## 10. Phase 0 conclusion and implementation gates

Phase 0 has identified the current consumer contract and the protocol mapping needed to begin characterization tests. No runtime files were changed.

Before implementation proceeds, preserve these decisions:

1. Keep the two protocol roles separate: WebSocket API RPC + user-data subscription/events, and public market-data WebSocket Streams.
2. Keep `userDataStream.subscribe.signature` as the compatibility baseline until its exact current signing requirements are verified; do not silently switch to the Ed25519-only `userDataStream.subscribe` session flow.
3. Preserve current public broker exports and result shapes while the replacement is introduced.
4. Treat order placement/cancellation as state-changing operations with uncertain outcomes after disconnect; never replay them blindly.
5. Use Node's native WebSocket only after proving server ping/pong compliance and production runtime support.
6. Keep all bot application files read-only throughout this migration.

**Phase 0 status:** complete. Inventory, consumer contract, protocol mapping, the Node.js >=22.4.0 runtime decision, and user-data credential compatibility are documented. HMAC-SHA-256 signing payload canonicalization still requires known test vectors in Phase 3, and native ping/pong behavior remains an implementation gate in Phase 2; neither is a reason to guess.

## 11. Canonical fill API

The additive `BinanceSdkBroker.getFills({ symbol, orderId?, limit? })` API returns shared Entities `Fill` instances. It requests exact market metadata for the requested Binance symbol through WebSocket API `exchangeInfo`, constructs a canonical `Market` from the returned base/quote asset codes, then requests signed `myTrades` and adapts each execution.

- Trade IDs are scoped by canonical Market identity; Binance symbols are opaque and are never split to infer assets.
- Price and quote quantity are exact quote-asset `Money`; base quantity is exact base-asset `Quantity`. No financial value passes through JavaScript `Number`.
- A positive commission is represented by a `Commission` with its explicit commission Asset. A confirmed zero commission is `COMPLETE` with an empty commission list. If a positive commission has no known denomination, its status is `UNKNOWN`; no fee Asset is fabricated.
- Missing maker/taker metadata maps to `UNKNOWN`, and missing execution timestamps remain absent.
- The legacy `getMyTrades()` API and its plain-object result shape are unchanged for compatibility. Consumer migration to `getFills()` is a separate task owned by the consumer domain.
