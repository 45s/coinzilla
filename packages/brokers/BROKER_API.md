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
```

- `provider` is required and must be exactly `"binance"` or `"bitunix"`; missing and unknown providers fail during construction.
- `apiKey`, `apiSecret`, and `tradingMode` are common top-level options. The selected provider validates credentials and its supported environment.
- Binance requires explicit `tradingMode: "testnet" | "live"`; `NODE_ENV` never selects exchange endpoints.
- Bitunix Spot requires explicit `tradingMode: "live"`. No Spot TESTNET endpoint is documented; the constructor does not silently infer LIVE.
- Provider-specific configuration is namespaced under `providerOptions`. For example, use `providerOptions: { baseUrl, requestTimeout }` for Bitunix or `providerOptions: { websocketApiUrl, websocketStreamsUrl }` for Binance. Provider options cannot override common credentials, logger, or environment selection.
- The optional common `logger` is passed to the selected adapter. Unknown top-level options fail fast rather than being silently ignored.
- The constructor returns the selected existing concrete provider instance and validates it against `assertBrokerContract`. Existing `BinanceWebSocketBroker` and `BitunixSpotBroker` constructors remain supported. Concrete provider `instanceof` checks remain valid; both providers also satisfy `instanceof Broker` via the structural contract.
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

All methods below are present on both provider facades. An unsupported implementation returns a failed `toResult` result containing a `BrokerUnsupportedOperationError`; it must not silently no-op, return `undefined`, fabricate data, or disguise unsupported behavior as an empty successful collection.

| Method | Binance Spot | Bitunix Spot | Contract notes |
|---|---|---|---|
| `connect()` / `disconnect()` | Supported | Supported | Idempotent lifecycle hooks; provider resource behavior differs. |
| `getBalances()` | Supported | Supported | Canonical `Balance[]`; exact decimal values. |
| `getAccountSnapshot()` | Supported | Unsupported | Bitunix does not provide the source timestamp/version required for an authoritative snapshot. |
| `getServerTime()` | Supported | Unsupported | Binance returns validated server time in Unix epoch milliseconds. |
| `getExchangeMarkets()` | Supported | Supported | Normalized `Market[]`. |
| `getOpenOrders()` | Supported | Supported | Current open orders; Bitunix requires a symbol, Binance can query account-wide or by symbol. |
| `getCanonicalOrder()` | Supported | Unsupported | Bitunix Spot does not expose the client order identity required by `CanonicalOrder`. |
| `getCanonicalOrderHistory()` | Supported | Unsupported | One bounded Binance query; not a claim of exhaustive account history. |
| `getFills()` | Supported | Unsupported | Canonical `Fill[]`; Bitunix matching details do not prove stable execution identity or fill completeness. |
| `getPrices({ symbol })` | Supported | Supported | One-shot ticker result; not a subscription. |
| `getCandles({ symbol, interval, ... })` | Supported | Unsupported | Bitunix Spot kline data omits volume required by the canonical OHLCV contract. |
| `createCanonicalOrder(input)` | Supported behind readiness/permission gates | Unsupported | Bitunix mutation blockers in #1185 remain in force. |
| `cancelOrder({ symbol, orderId })` | Supported behind readiness/permission gates | Unsupported | Mutation outcome is explicit; unknown is never treated as success. |
| `cancelAllOpenOrders({ symbol })` | Supported behind readiness/permission gates | Unsupported | Symbol-scoped Binance operation. |
| `subscribeForPrices(...)` | Supported | Unsupported | Successful result supplies a cleanup handle. |
| `subscribeForCandles(...)` | Supported | Unsupported | Successful result supplies a cleanup handle. |
| `subscribeForBookTicker(...)` | Supported | Unsupported | Successful result supplies a cleanup handle. |
| `subscribeForUserData({ onEvent, onObservation, onStatus })` | Supported | Supported for polling observations | Binance emits native authoritative events through `onEvent`; Bitunix emits non-authoritative polling snapshots through `onObservation`. The delivery mode is explicit in the returned subscription metadata. |

### Compatibility methods

These methods remain present on both facades for existing consumers. They are not aliases for canonical methods unless explicitly stated.

| Method | Compatibility behavior |
|---|---|
| `getAssets()` | Legacy `Coin[]` projection. Use `getBalances()` for exact decimal balances. |
| `getOrder({ symbol, orderId, clientOrderId? })` | Legacy `Order` lookup. Binance accepts broker or client identity; Bitunix accepts broker `orderId` only and returns an explicit unsupported error for `clientOrderId`. |
| `getOrderHistory(...)` | Legacy provider history. Binance returns its bounded `allOrders` response; Bitunix returns one symbol-scoped page. Pagination and legacy row shape are not interchangeable. Use `getCanonicalOrderHistory()` when canonical order history is required. |
| `getMyTrades(...)` | Legacy trade-history operation. Binance supports a bounded symbol-scoped response; Bitunix explicitly reports unsupported. It is not equivalent to canonical `getFills()`. |
| `getPrice({ symbol })` | Compatibility alias for `getPrices({ symbol })` on both providers. |
| `createOrder(input)` | Legacy `Order` placement facade. Binance supports it behind the same safety gates; Bitunix reports unsupported. Prefer `createCanonicalOrder()`. |
| `getSymbolFilters({ symbol })` | Raw provider metadata retained for existing infrastructure adapters. It is not a normalized `TradingRules` value and is not part of the canonical method catalog. |

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
