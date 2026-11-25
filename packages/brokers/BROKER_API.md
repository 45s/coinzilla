# Broker API and capability contract

**Package owner:** `@coinzilla/brokers`
**Contract version:** 1
**Primary implementation issue:** [#1446](https://github.com/45s/coinzilla/issues/1446)

This document defines the exchange-neutral public Broker contract, the compatibility surface retained for existing consumers, and the provider capability declaration model. Provider protocols and DTOs remain private to each provider implementation.

## Public provider constructor

Consumers may select either supported provider without importing an exchange-specific class:

```js
import { Broker } from "@coinzilla/brokers"

const broker = new Broker({
  provider: "binance",
  apiKey,
  apiSecret,
  tradingMode: "testnet",
})

const spotBroker = new Broker({
  provider: "bitunix",
  apiKey,
  apiSecret,
  tradingMode: "live",
})

const futuresBroker = new Broker({
  provider: "bitunix-futures",
  apiKey,
  apiSecret,
  tradingMode: "live",
  providerOptions: {
    allowLiveOrderMutations: false,
    allowLiveAccountMutations: false,
  },
})
```

- `provider` is required and must be exactly `"binance"`, `"bitunix"`, or `"bitunix-futures"`; missing and unknown providers fail during construction.
- `apiKey`, `apiSecret`, and `tradingMode` are common top-level options. The selected provider validates credentials and its supported environment.
- Binance requires explicit `tradingMode: "testnet" | "live"`; `NODE_ENV` never selects exchange endpoints.
- Bitunix Spot and Bitunix USDT Futures require explicit `tradingMode: "live"`. Bitunix does not provide a TESTNET for either product; both are LIVE-only and the constructor does not silently infer LIVE.
- Bitunix Futures uses the separate `bitunix-futures` provider ID and a Futures-specific configuration. LIVE order and account-setting mutations are disabled by default; `providerOptions.allowLiveOrderMutations` and `providerOptions.allowLiveAccountMutations` are explicit opt-ins, not readiness approvals.
- Provider-specific configuration is namespaced under `providerOptions`. For example, use `providerOptions: { baseUrl, requestTimeout }` for Bitunix or `providerOptions: { websocketApiUrl, websocketStreamsUrl }` for Binance. Provider options cannot override common credentials, logger, or environment selection.
- The optional common `logger` is passed to the selected adapter. Unknown top-level options fail fast rather than being silently ignored.
- The constructor returns the selected concrete provider instance and validates it against `assertBrokerContract`. Existing `BinanceWebSocketBroker` and `BitunixSpotBroker` constructors remain supported; `BitunixFuturesBroker` is a separate Futures implementation. Concrete provider `instanceof` checks remain valid; both providers also satisfy `instanceof Broker` via the structural contract.
- `Broker` is a constructor convenience, not an application provider registry or market-routing policy. Consuming applications retain ownership of account/market routing and composition.

## 1. Ownership and capability-model decision

The shared exchange-neutral `BrokerCapabilities` value contract is owned by **Entities** and re-exported by Brokers for compatibility. Brokers owns the provider-specific declarations and the evidence supporting each status; it does not maintain a second capability class, vocabulary, status enum, validator, or lookup implementation.

The canonical Entities value preserves the original capability-only constructor/value shape for compatibility and supports richer provider declarations with `contractVersion`, provider/product/environment identity, and method/guarantee/limitation/reason/condition evidence. Both legacy consumers and provider implementations therefore use one source of truth without making Entities depend on Brokers or importing exchange protocol details into Entities.

### Canonical status semantics

Only three statuses exist:

| Status | Meaning |
|---|---|
| `SUPPORTED` | The operation is implemented and its declared guarantee is evidenced. |
| `UNSUPPORTED` | The provider/adapter cannot safely perform the operation under the declared contract. |
| `UNKNOWN` | Available evidence is insufficient to claim support or non-support. |

`UNKNOWN` is not a synonym for unsupported. An omitted capability resolves to `UNKNOWN`.

There is deliberately no `ENVIRONMENT_DEPENDENT` status. A method implemented for a provider remains `SUPPORTED`; environment selection, account permissions, connectivity, recovery readiness, and other prerequisites are represented by declaration metadata and runtime guards. A selected environment is not proof that an account is authorized or currently connected.

### Declaration shape

`BrokerCapabilities` is an immutable value exported from `@coinzilla/brokers`:

```js
new BrokerCapabilities({
  provider: "binance",
  product: "spot",
  environment: {
    selector: "tradingMode",
    selectedMode: "testnet",
    supportedModes: ["testnet", "live"],
    notes: "NODE_ENV does not select exchange endpoints.",
  },
  capabilities: [
    {
      type: "PLACE_LIMIT_ORDER",
      status: "SUPPORTED",
      method: "createCanonicalOrder",
      guarantee: "Submits a limit order with a stable client order identity.",
      limitation: "The result does not itself prove fill reconciliation.",
      conditions: [
        "The selected account must have Spot trading permission.",
        "Private user-data recovery must be acknowledged.",
      ],
    },
    {
      type: "RECONCILE_ORDERS",
      status: "UNSUPPORTED",
      reason: "The broker does not own an end-to-end reconciliation workflow.",
    },
    {
      type: "READ_COMPLETE_FILL_HISTORY",
      status: "UNKNOWN",
      reason: "Exhaustive history coverage has not been established.",
    },
  ],
})
```

Contract rules:

- `contractVersion` is currently `1`.
- `provider` and `product` are required.
- Capability types and statuses are validated; duplicate capability types are rejected.
- `SUPPORTED` requires both `method` and `guarantee`.
- `UNSUPPORTED` and explicit `UNKNOWN` entries require a `reason`.
- `method`, `guarantee`, `limitation`, `reason`, and `conditions` preserve provider-specific evidence without changing status semantics.
- `environment.selectedMode` must be included in non-empty `environment.supportedModes` when both are supplied.
- The declaration, environment, capability records, and nested conditions are recursively immutable.
- `getCapability({ type })` returns the declared record or an immutable `UNKNOWN` record.
- `getStatus({ type })` returns the status.
- `value` and `toJSON()` return detached serializable snapshots.

The public `contractVersion`, `provider`, `environment.selectedMode`, and `environment.supportedModes` fields preserve the existing Harvester provider-registry compatibility contract. This is a consumer compatibility boundary, not a dependency from Brokers into Harvester.

## 2. Structural Broker contract

The public exports `BROKER_METHODS`, `BROKER_COMPATIBILITY_METHODS`, `BROKER_MUTATION_OUTCOMES`, and `assertBrokerContract({ broker })` define and verify the contract. The conformance suite runs against both Binance and Bitunix.

### Common operations

All methods below are present on the Binance Spot, Bitunix Spot and Bitunix Futures facades. An unsupported implementation returns a failed `toResult` result containing a `BrokerUnsupportedOperationError`; it must not silently no-op, return `undefined`, fabricate data, or disguise unsupported behavior as an empty successful collection.

| Method | Binance Spot | Bitunix Spot | Bitunix Futures | Contract notes |
|---|---|---|---|---|
| `connect()` / `disconnect()` | Supported | Supported | Supported | Idempotent lifecycle hooks; provider resource behavior differs. |
| `getBalances()` | Supported | Supported | Supported | Canonical `Balance[]`; Futures projects exact USDT free/locked values and excludes promotional bonus. |
| `getAccountSnapshot()` | Supported | Unsupported | Unsupported | Bitunix Futures has no documented source timestamp/version for an authoritative account snapshot. |
| `getServerTime()` | Supported | Unsupported | Unsupported | Binance returns validated server time in Unix epoch milliseconds; no verified Bitunix Futures server-time endpoint. |
| `getExchangeMarkets()` | Supported | Supported | Supported | Normalized `Market[]`; Futures returns OPEN/API-enabled contracts. |
| `getOpenOrders({ symbol? })` | Supported | Supported | Unsupported | Futures pending rows remain available through `getFuturesPendingOrders()`; the common legacy projection does not preserve Futures semantics/completeness. |
| `getCanonicalOrder()` | Supported | Unsupported | Supported | Futures verifies exchange order ID/client ID and symbol identity; missing exchange client ID fails closed. |
| `getCanonicalOrderHistory({ symbol, orderId?, startTime?, endTime?, limit?, includeFollowingOrders? })` | Supported | Unsupported | Supported | One bounded symbol-scoped page; caller owns pagination and retention coverage. |
| `getFills()` | Supported | Unsupported | Supported (bounded page) | Futures uses stable trade/order IDs and exact decimal quote notional; fee asset is unknown and complete account-wide history is not claimed. |
| `getPrices({ symbol })` | Supported | Supported | Supported | One-shot ticker result; not a subscription. |
| `getCandles({ symbol, interval, ... })` | Supported | Unsupported | Supported | Futures closed REST klines preserve exact OHLCV; Futures candle WebSocket subscription remains unsupported. |
| `createCanonicalOrder(input)` | Supported behind readiness/permission gates | Unsupported | Unsupported | Spot-shaped common input cannot express Futures `tradeSide`, `positionId`, `reduceOnly` and hedge-mode selection. Use `createFuturesOrder()`. |
| `cancelOrder({ symbol, orderId })` | Supported behind readiness/permission gates | Implemented behind explicit opt-in | Supported behind opt-in and private-session readiness | Futures requires `allowLiveOrderMutations: true`, active authenticated private user data, and caller-acknowledged REST reconciliation; one-shot dispatch and readback, no blind retry. |
| `cancelAllOpenOrders({ symbol? })` | Supported behind readiness/permission gates | Implemented behind explicit opt-in; symbol-scoped | Supported behind opt-in and private-session readiness | Futures supports symbol-scoped or account-wide one-shot cancellation, preflight and final pending-order readback; callers must enforce single-writer ownership. |
| `subscribeForPrices(...)` | Supported | Unsupported | Supported | Futures public trade channel; exact decimal price/quantity, exchange trade timestamp, no stable trade ID. |
| `subscribeForCandles(...)` | Supported | Unsupported | Unsupported | Futures public kline payload lacks the documented candle open timestamp required by the common Candle contract. |
| `subscribeForBookTicker(...)` | Supported | Unsupported | Supported | Futures one-level depth channel; exact best bid/ask, local receipt time and no source sequence. |
| `subscribeForUserData({ symbols?, trackedOrders?, onEvent, onObservation, onStatus })` | Supported | Supported for polling observations | Supported for native raw observations | Binance emits native events through `onEvent`; Spot emits non-authoritative polling observations; Futures emits native private observations but no replay/sequence guarantee. Futures mutations additionally require explicit external reconciliation acknowledgement. |

### Compatibility methods

These methods remain present on all provider facades for existing consumers. They are not aliases for canonical methods unless explicitly stated.

| Method | Compatibility behavior |
|---|---|
| `getAssets()` | Legacy `Coin[]` projection. Bitunix Futures reports unsupported; use `getBalances()` for exact Futures balances. |
| `getOrder({ symbol, orderId, clientOrderId? })` | Legacy `Order` lookup. Binance accepts broker or client identity; Bitunix Spot accepts broker `orderId` only; Bitunix Futures reports unsupported because the legacy order shape cannot preserve Futures semantics. |
| `getOrderHistory(...)` | Legacy provider history. Binance returns bounded `allOrders`; Bitunix Spot returns one symbol-scoped page; Bitunix Futures reports unsupported. Use `getCanonicalOrderHistory()` for Futures canonical order history. |
| `getMyTrades(...)` | Legacy trade-history operation. Binance supports a bounded symbol-scoped response; Bitunix Spot remains unsupported. Bitunix Futures returns one bounded array from its documented Futures execution-history endpoint, preserving exact provider fields; fee asset remains unavailable. Use `getFills()` for canonical Fill values. |
| `getPrice({ symbol })` | Compatibility alias for `getPrices({ symbol })` on Binance, Bitunix Spot, and Bitunix Futures. |
| `createOrder(input)` | Legacy Spot-shaped `Order` placement facade. Binance supports it behind safety gates; Bitunix Spot implements LIMIT base `quantity` and MARKET quote `quoteQuantity` behind explicit opt-in; Bitunix Futures reports unsupported. Use `createFuturesOrder()` with explicit Futures semantics. |
| `getSymbolFilters({ symbol })` | Raw provider metadata retained for existing infrastructure adapters. It is not a normalized `TradingRules` value and is not part of the canonical method catalog. |

### Canonical Binance order-history query semantics

`getCanonicalOrderHistory()` remains one bounded, symbol-scoped query; it does not paginate automatically.

- With `includeFollowingOrders` omitted or `false`, a supplied `orderId` preserves the established exact-order lookup behavior. This remains the default for existing reconnect/reconciliation callers.
- With `includeFollowingOrders: true`, the caller must supply `orderId`. Binance treats this value as an inclusive lower-bound cursor, and the broker returns every canonical order from that bounded `allOrders` response rather than filtering to one exact ID.
- Continue a pagination scan from the last returned order ID plus one. A short/empty page ends that one cursor scan; it does not prove account-wide, delisted-market, or retention-window completeness.
- The option changes only read-only result selection. It does not change order placement, cancellation, mutation outcomes, or provider capabilities. Bitunix canonical order history remains explicitly unsupported.

### Order quantity denomination

- `quantity` always means base-asset units.
- `quoteQuantity` means quote-asset units, is valid only for MARKET orders, and is mutually exclusive with `quantity`.
- Binance maps `quoteQuantity` to its native `quoteOrderQty`; Bitunix maps LIMIT `quantity` and MARKET `quoteQuantity` directly to REST `volume`.
- Providers must reject unsupported denominations. They must never estimate quote quantity from a ticker or execution price.
- Bitunix order mutations remain disabled by default. `allowLiveOrderMutations: true` is an explicit opt-in, not production readiness or Harvester admission. `cancelAllOpenOrders({ symbol })` is limited to rows returned by the symbol-scoped current-order query; the exchange contract does not establish exhaustive coverage.

There is no `getOrders()` alias. `getOpenOrders()` means the current open-order set; `getOrderHistory()` means a historical provider response. Similar names do not imply equivalent completeness, pagination, or result semantics.

### Provider-specific extensions

Bitunix-only provider operations remain inside `infrastructure/bitunix`: reads `getDeposits`, `getDepositAddress`, `getMatchingOrderDetails`, `getWithdrawalHistory`, `getExchangeRates`, `getTokenNetworks`, `getUserInfo`, `getTaxFilingHistory`, `getOrderBook`, `getKlines`, and `getKlineHistory`; funds mutations `withdraw`, `cancelWithdrawal`, `transferInternally`, `cancelInternalTransfer`, and `transferFunds` are separately gated by `BitunixSpotConfig.allowLiveFundsMutations` (default false). These exchange-specific methods are not promoted into the common Broker contract merely to make method names identical.

The Bitunix WebSocket RPC client is a provider-specific request/response transport. It exposes authenticated market/account reads plus symbol-scoped current orders, one-page order history, and matching-order detail. It does not imply account-wide order coverage, canonical fill completeness, a continuous market feed, or a private user-data subscription.

## 3. Results, errors, and mutation outcomes

Fallible broker operations use the existing `toResult` envelope: `{ ok, data?, errors? }`. Successful subscription results provide an unsubscribe/cleanup handle. Unsupported operations use `BrokerUnsupportedOperationError`, which extends the repository's `SystemCustomError` and has stable code `BROKER_OPERATION_UNSUPPORTED`, provider/operation context, `retryable: false`, and native-cause preservation.

State-changing methods expose `mutationOutcome`:

| Outcome | Meaning |
|---|---|
| `NOT_SENT` | Local validation/readiness/unsupported guard stopped the operation before dispatch. |
| `REJECTED` | The provider returned a definitive rejection response. |
| `CONFIRMED` | The provider returned an authoritative success response. This remains true if later local normalization fails. |
| `OUTCOME_UNKNOWN` | The request may have reached the exchange, but no authoritative outcome was received. |

HTTP/RPC conflicts and server failures, timeouts, connection loss after dispatch, and malformed responses after dispatch are treated conservatively as `OUTCOME_UNKNOWN`. A request rejected before dispatch is `NOT_SENT`. Callers must not blindly retry unknown mutations. The legacy `cancellationOutcome` field remains for compatibility; `mutationOutcome` is the common classification.

## 4. Decimal, timestamp, identity, and pagination guarantees

- Canonical `Balance`, `Money`, `Quantity`, `CanonicalOrder`, and `Fill` values preserve decimal strings; do not convert canonical financial values through JavaScript `Number`.
- Legacy `Coin` and `Order` shapes retain their established compatibility field types; they are not a reason to weaken canonical decimal guarantees.
- Canonical order client/broker identifiers and fill trade/broker identifiers are non-empty strings. Binance numeric IDs are normalized before entering canonical entities.
- Canonical order lifecycle timestamps (`createdAt`, `acknowledgedAt`, `updatedAt`, `completedAt`) and fill `executedAt` are non-negative safe-integer Unix epoch millisecond values when present. Binance server/account snapshot times use the same unit. Provider-native timestamp strings in legacy DTOs remain provider-native.
- Each history call returns one bounded provider response/page. The broker does not imply automatic pagination, exhaustive symbol coverage, gap-free history, or complete retention-window coverage. Binance cursor/time parameters and Bitunix page-number semantics remain explicit provider limitations.
- A successful order lookup or mutation acknowledgement is not proof of complete fill reconciliation. Canonical fills and account/order snapshots remain separate facts.

## 5. Lifecycle and cleanup

- `connect()` and `disconnect()` are idempotent lifecycle hooks, not a universal proof of current network health.
- Binance owns the WebSocket API and public Streams resources; disconnect must close provider-owned connections and stop subscriptions/user-data lifecycle resources.
- Bitunix Spot uses stateless signed/unsigned REST requests for its supported operations. Its lifecycle flag is local adapter state; it does not create a persistent exchange connection.
- Every successful subscription exposes cleanup. Disconnect cleans up provider-owned subscriptions. Unsupported Bitunix subscriptions return an explicit failed result and create no resource.

## 6. Safety and ownership boundaries

- Bitunix Spot does not yet implement the complete order, fill, and account lifecycle required for trading. This API work does not authorize speculative placement, cancellation, or fill support; preserve all blockers in [#1185](https://github.com/45s/coinzilla).
- REST/WS clients, authentication/signing, DTOs, protocol mapping, and provider-specific errors remain inside each provider infrastructure folder.
- Harvester owns its application ports, adapters, registries, orchestration, and trading workflows. Brokers must not import or absorb them.
- Providers may use different internal REST/WebSocket architectures while satisfying the same structural public contract.

## User-data delivery channels

Both providers expose the same `subscribeForUserData()` method and callback shape. Consumers never inspect provider classes or provider source code to choose a transport:

```js
await broker.subscribeForUserData({
  symbols: ["BTCUSDT"],
  trackedOrders: [],
  onEvent,        // native exchange events
  onObservation,  // non-authoritative polling observations
  onStatus,       // lifecycle and health
})
```

- **`onEvent`** is reserved for native exchange events. Binance uses its authenticated WebSocket user-data stream and returns `deliveryMode: "NATIVE_EVENTS"` with `nativePush: true`.
- **`onObservation`** is reserved for explicitly scoped, non-authoritative observations. Bitunix Spot uses its private REST polling reconciler and returns `deliveryMode: "POLLING_OBSERVATIONS"` with `nativePush: false`. It requires a non-empty explicit `symbols` list and optionally accepts explicitly tracked order identities.
- **`onStatus`** reports lifecycle and polling health. A polling status never upgrades observations into native events.
- Bitunix advertises `OBSERVE_USER_DATA: SUPPORTED` while `SUBSCRIBE_USER_DATA: UNSUPPORTED`. Its `getAccountSnapshot()` remains unsupported. Polling observations are not canonical fills, cannot replay transient states, and cannot satisfy Harvester's authoritative account/user-data readiness gates.
- Harvester routes the two callback channels independently. Its native event handler owns execution accounting; the observation handler is diagnostic-only and has no access to order accounting, the canonical event publisher, or trading readiness.

A successful observation subscription is therefore not evidence that native user-data delivery or trading readiness is available.

Binance declares `SUBSCRIBE_USER_DATA: SUPPORTED` and `OBSERVE_USER_DATA: UNSUPPORTED`: its authenticated native WebSocket events use `onEvent`, not a polling observation channel. Bitunix declares the inverse delivery capabilities and remains non-authoritative.

The Binance subscription result retains the live `subscriptionId` getter and recovery acknowledgement controls from `UserDataSession`. Delivery metadata is attached without spreading/snapshotting the handle, so reconnects continue to expose the current remote subscription ID.

## Bitunix USDT Futures provider — implementation status

The `bitunix-futures` provider is a separate USDT-margined Futures adapter implemented in [PR #1806](https://github.com/45s/coinzilla/pull/1806), merged into `develop` as [`d6e98251363f8713ed1231a2eb4ac548c270eae8`](https://github.com/45s/coinzilla/commit/d6e98251363f8713ed1231a2eb4ac548c270eae8); implementation tracking [issue #1805](https://github.com/45s/coinzilla/issues/1805) is complete. This status describes implemented functionality and explicit limitations; it is not a production-readiness declaration. This status describes implemented functionality and explicit limitations; it is not a production-readiness declaration.

### Common Broker methods

| Method | Status | Evidence / limitation |
|---|---|---|
| `connect()` / `disconnect()` | Supported | Lifecycle cleanup for public/private WebSocket clients and listeners. |
| `getBalances()` | Supported | Exact USDT free/locked projection; promotional bonus excluded. |
| `getAccountSnapshot()` | Unsupported | Independent account, position, order and TP/SL reads have no shared source timestamp/version. |
| `getServerTime()` | Unsupported | No verified Futures server-time endpoint. |
| `getExchangeMarkets()` | Supported | Returns OPEN and API-enabled Futures contracts. |
| `getOpenOrders()` | Unsupported | Use `getFuturesPendingOrders()`; the common legacy `Order[]` cannot preserve Futures semantics/completeness. |
| `getCanonicalOrder()` | Supported | Detail lookup by exchange order ID or caller client ID; identity and symbol correlation enforced. |
| `getCanonicalOrderHistory()` | Supported | One bounded symbol-scoped page; caller owns pagination and retention coverage. |
| `getFills()` | Supported (bounded page) | Stable trade/order identity and exact quote notional; commission denomination is UNKNOWN because fee asset is absent. Complete account-wide history is not claimed. |
| `getPrices()` | Supported | One-shot ticker with exact last and mark prices. |
| `getCandles()` | Supported | Closed REST klines with exact decimals and documented interval-based close-time derivation. |
| `createCanonicalOrder()` | Unsupported | Spot-shaped input cannot express Futures `tradeSide`, `positionId`, `reduceOnly` and hedge-mode semantics. |
| `cancelOrder({ symbol, orderId })` | Supported behind gates | Explicit live opt-in, authenticated/reconciled private session, exact pending-order preflight, one-shot dispatch, matching CLOSE event and canonical readback. |
| `cancelAllOpenOrders({ symbol? })` | Supported behind gates | One-shot symbol/account scope, preflight, matching CLOSE events and final pending-order readback; caller must enforce single-writer ownership. |
| `subscribeForPrices()` | Supported | Public trade channel; exact price/quantity and exchange trade timestamp; no stable trade ID. |
| `subscribeForCandles()` | Unsupported | Public kline payload lacks the documented candle-open timestamp required by the common contract. |
| `subscribeForBookTicker()` | Supported | One-level depth channel; exact best bid/ask, local receipt timestamp and no source sequence. |
| `subscribeForUserData()` | Supported (raw observations) | Native balance/position/order/TP-SL observations; no replay cursor, sequence or authoritative snapshot guarantee. |

### Futures-specific reads

- `getFuturesPendingOrders({ symbol?, orderId?, clientOrderId?, status?, startTime?, endTime?, limit?, skip? })`: one bounded pending-order page with exact decimals and Futures identity.
- `getFuturesPendingTpSlOrders({ symbol?, positionId?, limit?, skip? })`: pending position TP/SL groups; exact trigger/quantity values, one bounded page.
- `getFuturesTpSlOrderHistory({ symbol?, side?, positionMode?, startTime?, endTime?, limit?, skip? })`: bounded historical TP/SL page with exchange total and identity-preserving fields.
- `getFuturesPositions({ symbol?, positionId? })` and `getFuturesPositionHistory(...)`: current and bounded historical position projections.
- `getFuturesPositionMode()`, `getFuturesLeverageAndMarginMode({ symbol, marginCoin: "USDT" })`, and `getFuturesTradingSettings({ symbols? })`: authenticated account-setting reads.
- `getFuturesFundingRate({ symbol })`, `getFuturesFundingRates()`, `getFuturesFundingRateHistory(...)`, and `getFuturesPositionTiers({ symbol })`: funding and risk-tier reads.
- `getFuturesTradeHistory(...)`: one bounded raw execution-history page preserving exact fee and realized-PnL values and pagination metadata.
- `getMyTrades({ symbol?, orderId?, positionId?, startTime?, endTime?, limit?, skip? })`: compatibility array projection over the same bounded Futures execution page; it does not claim complete account-wide history or commission denomination.

### Futures-specific mutations

All mutation flags default to false. These provider-specific operations do not change the exchange-neutral Broker order model.

| Operation | Status and safety contract |
|---|---|
| `createFuturesOrder()` | MARKET/LIMIT placement with explicit Futures semantics, caller `clientId`, exact market-filter validation, private-session readiness and `allowLiveOrderMutations: true`. Placement is one-shot; mismatched or uncertain readback remains UNKNOWN. |
| `modifyFuturesOrder()` | Identified pending LIMIT orders only; exact quantity and price; requires order-mutation opt-in/readiness, matching UPDATE event and final readback. |
| `cancelOrder()` / `cancelAllOpenOrders()` | Require order-mutation opt-in/readiness; one-shot dispatch, matching CLOSE events and REST reconciliation. Never blindly retry. |
| `closeFuturesPosition()`, `closeFuturesPositionBySide()`, `closeAllFuturesPositions()` | Require `allowLivePositionMutations: true` **and** an authenticated private session acknowledged after REST reconciliation. Exact position preflight, explicit account-wide confirmation, one-shot close and REST post-readback. |
| `placeFuturesPositionTpSlOrder()` / `modifyFuturesPositionTpSlOrder()` | Position-level TP/SL only; exact open position and trigger validation; require matching private CREATE/UPDATE NEW event. |
| `cancelFuturesPositionTpSlOrder()` / `cancelFuturesTpSlOrder()` | Exact symbol/order identity and matching private CLOSE event. Only CANCELED confirms user cancellation; SYSTEM_CANCELED, FAILED and FILLED remain distinct outcomes. A triggered child-order fill remains UNKNOWN. |
| `setFuturesLeverage()`, `setFuturesMarginMode()`, `setFuturesPositionMode()` | Require `allowLiveAccountMutations: true`; reject unsafe exposure/pending-order/TP-SL preconditions; verify configuration through REST readback. Lost acknowledgements remain OUTCOME_UNKNOWN even if readback shows the requested setting. |
| `adjustFuturesPositionMargin()` | Unsupported: no documented isolated-position-margin endpoint was found; do not emulate it with leverage or margin-mode changes. |

Order-level TP/SL placement/modification remains unsupported because the documented child-order surface does not establish the required reduce-only/close-position guarantee. Attached TP/SL parameters on `createFuturesOrder()` and position-level TP/SL operations are separate, explicitly scoped capabilities.

### WebSocket lifecycle and recovery

- Public `trade` and `depth_book1` subscriptions share the public connection and return cleanup handles.
- Private `balance`, `position`, `order` and `tpsl` subscriptions wait for login acknowledgement and emit raw observations through `onObservation`.
- The client validates official channels, enforces documented outbound message/channel limits, sends heartbeat pings, detects missed pong, and uses bounded reconnect/resubscribe.
- Every new private session starts with recovery required. Consumers must reconcile balances, positions, pending orders and TP/SL orders, then call `acknowledgeUserDataReconciliation({ reconciliationCompleted: true })`.
- The acknowledgement is a consumer attestation, not proof of atomicity, event authority, sequence continuity or replay. Disconnect, reconnect and unsubscribe reset readiness.

### Production status and limitations

The REST client serializes dispatch conservatively and never automatically retries. State-changing requests are one-shot and explicitly marked `stateChanging: true`. Private observations are non-authoritative and non-replayable; complete account-wide fill history, atomic snapshots, gap-free recovery and process-restart recovery remain UNKNOWN. Bitunix Futures is LIVE-only; Bitunix does not provide a Futures TESTNET. Automated tests remain offline, and LIVE mutations are not permitted as implementation tests.

The provider remains **NOT PRODUCTION READY** and must not be routed to Harvester or production execution. The remaining blockers are external protocol guarantees and verification, not a reason to fabricate support for unsupported common-model operations. See the [maintained Futures reference audit](./docs/bitunix-futures-reference-audit.md) and [issue #1805](https://github.com/45s/coinzilla/issues/1805).
