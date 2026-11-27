# Broker provider operations

## Bitunix healthcheck CLI

Run the operator healthcheck with `pnpm --filter @coinzilla/brokers bitunix:healthcheck`. Its `--version` path prints package/script/source identity before loading credentials and does not contact Bitunix. Existing operator-only LIVE order controls are unchanged. See the repository [CLI source identity rollout inventory](../../docs/engineering/CLI_SOURCE_IDENTITY.md).

Bitunix-specific engineering references and readiness notes are indexed in [docs/README.md](./docs/README.md). Live order-probe observations and raw exchange placement outcomes are recorded in the [Bitunix live order-probe evidence log](./BITUNIX_ORDER_PROBE_LOG.md).

For every Bitunix Spot capability, follow the [mandatory reference-first workflow](./AGENTS.md#bitunix-spot-development--mandatory-reference-audit) and consult the maintained [Bitunix external implementation reference audit](./docs/BITUNIX_REFERENCE_AUDIT.md). Start with [JKorf/Bitunix.Net](https://github.com/JKorf/Bitunix.Net) and [samanzamani/bitunix-mcp](https://github.com/samanzamani/bitunix-mcp); search additional C#, TypeScript, Python, Go and Ruby implementations when coverage is missing or references disagree. The audit records source paths, fixtures, known defects, parity status and safe implementation picks. Official Bitunix Spot documentation remains authoritative.

For the package's target DDD structure and ownership boundaries, see [Architecture](./ARCHITECTURE.md). The exchange-neutral public method, result, error, capability, and compatibility contracts are specified in [BROKER_API.md](./BROKER_API.md); execution status is in [Roadmap](./ROADMAP.md).

The active Binance implementation is `BinanceWebSocketBroker`. It uses two independent native Node.js WebSocket connections:

- **WebSocket API** (`wss://ws-api...`): signed RPC for account, order, history, metadata, and the signature-based user-data subscription.
- **WebSocket Streams** (`wss://stream...`): public market-data subscriptions such as aggregate trades.

The package does not use the Binance REST API or a third-party Binance SDK. Do not add REST fallbacks or automatically retry a state-changing request after an uncertain disconnect.

## Binance public market-data liveness

The public Streams client monitors both connection and logical market-stream delivery:

- Binance server ping frames are observed through Undici's `undici:websocket:ping` diagnostics channel. If no server ping arrives for 45 seconds, the broker closes the stale transport and uses its existing bounded reconnect/resubscribe lifecycle. Generic transport errors are diagnostic and do not cause blind reconnects.
- Each `subscribeForPrices()` subscription listens to the symbol's `aggTrade` stream and the shared `!ticker_1h@arr` all-market rolling-window ticker stream. It compares the ticker's last raw trade ID (`L`) with the aggregate stream's last covered trade ID (`l`).
- If `L` advances beyond `l`, the broker waits five seconds for delivery to catch up. It then resubscribes only the affected symbol's `aggTrade` stream, with a maximum of three attempts per 60 seconds. Further attempts require a genuinely newer ticker trade ID; repeated updates with the same ID do not retry. A recovered stream resets its attempt budget.
- No new ticker trade ID means no evidence of a missed trade, so an inactive market is not automatically treated as a broken stream. No ticker price fallback or REST fallback is used.
- `BinanceStreamsClient.diagnostics` reports connection state/generation, heartbeat age, desired/confirmed subscriptions, and per-stream last-message receipt age. Consumers own fail-closed price-freshness gates and all trading decisions.

See the detailed [Binance WebSocket contract](../../docs/brokers-websocket-contract.md#public-market-data-liveness-and-recovery) for protocol details and known limits.

## Package exports

The `@coinzilla/brokers` entry point exports:

- `Broker` — exchange-neutral constructor selecting the existing Binance or Bitunix Spot implementation.
- `BinanceWebSocketBroker` — the concrete Binance WebSocket API/Streams broker.
- `BinanceWebSocketConfig` — validated Binance broker configuration.
- `BitunixSpotBroker` and `BitunixSpotConfig` — the Bitunix Spot REST broker implementation and its validated configuration.
- `BitunixFuturesBroker` and `BitunixFuturesConfig` — the separate Bitunix USDT-margined Futures provider and its validated LIVE-only configuration. Single-order `cancelOrder()` and symbol-scoped/account-wide `cancelAllOpenOrders()` are available only behind `providerOptions.allowLiveOrderMutations: true` and explicit preflight/final-state checks; order creation, modification, position close, TP/SL and account-setting mutations remain disabled by default. Bitunix does not provide a Futures TESTNET; automated tests remain offline and LIVE mutations are never used as tests.
- `BitunixSpotWebSocketClient` and `BitunixWebSocketError` — a separately managed, authenticated Spot WebSocket request/response RPC client; it does not add subscriptions or order mutations.
- Bitunix polling reconciliation remains a private infrastructure helper, but the public `subscribeForUserData()` method exposes its explicitly scoped snapshots through `onObservation` and the `OBSERVE_USER_DATA` capability. This is not a native user-data stream, canonical fill feed, authoritative account snapshot, or Harvester provider. See [the polling boundary](./docs/BITUNIX_SPOT_POLLING.md).
- `normalizeBinanceId` — exact non-negative Binance identifier normalization, exported for package consumers that need the same identifier contract.
- `BrokerCapabilities`, `BROKER_CAPABILITY_TYPES`, `BROKER_CAPABILITY_STATUSES` — the canonical immutable provider capability declaration contract.
- `BrokerUnsupportedOperationError` — stable typed error for explicitly unsupported operations.
- `BROKER_METHODS`, `BROKER_COMPATIBILITY_METHODS`, `BROKER_MUTATION_OUTCOMES`, `assertBrokerContract`, `getBrokerMutationOutcome` — structural API, compatibility, and mutation-outcome contract helpers.

## Exchange-neutral Broker API

Construct a provider through the public `Broker` constructor:

```js
import { Broker } from "@coinzilla/brokers"

const broker = new Broker({
  provider: "binance",
  apiKey,
  apiSecret,
  tradingMode: "testnet",
})

// Bitunix Spot uses the same constructor and requires explicit LIVE selection.
const spotBroker = new Broker({
  provider: "bitunix",
  apiKey,
  apiSecret,
  tradingMode: "live",
  providerOptions: {
    requestTimeout: 10_000,
  },
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

The provider must be exactly `"binance"`, `"bitunix"`, or `"bitunix-futures"`. Environment selection is explicit: Binance requires `tradingMode: "testnet" | "live"`; Bitunix Spot and Bitunix USDT Futures currently require `tradingMode: "live"` because Bitunix Spot and Futures are LIVE-only; Bitunix does not provide a Futures TESTNET. Provider-specific options (such as `baseUrl`, `websocketApiUrl`, `requestTimeout`, or injected dependencies) belong inside `providerOptions`. Common credentials, environment selection, and the optional logger cannot be overridden there.

The constructor returns the existing concrete provider instance, preserving its behavior and concrete `instanceof` checks. Both instances also satisfy `instanceof Broker` through the shared structural contract. Existing direct constructors remain supported. The factory selects an adapter only; application-specific account/market routing remains with the consuming application.

Both providers expose an immutable `BrokerCapabilities` declaration. The canonical three statuses are `SUPPORTED`, `UNSUPPORTED`, and `UNKNOWN`; environment selection and runtime readiness are metadata/conditions, never a fourth status. Supported declarations require method and guarantee evidence; unsupported/unknown declarations require reasons.

Unsupported methods remain present and return a typed `BrokerUnsupportedOperationError` inside a failed result. They never silently no-op or fabricate successful empty data. State-changing methods expose `mutationOutcome` so callers can distinguish `NOT_SENT`, `REJECTED`, `CONFIRMED`, and `OUTCOME_UNKNOWN`.

The public Brokers capability exports are compatibility re-exports of the canonical `BrokerCapabilities` contract from `@coinzilla/entities`. Provider adapters supply provider/product/environment identity and evidence metadata through that shared class. There is one capability vocabulary, three-state status model, validator, lookup implementation, and serializer; Brokers does not maintain a competing capability class.

See [BROKER_API.md](./BROKER_API.md) for the full method-by-method Binance/Bitunix matrix, canonical and compatibility operations, result/error semantics, decimal/timestamp guarantees, pagination, lifecycle, and safety boundaries.

### Provider instances and routing ownership

The package exposes exchange-specific broker implementations; it does not select which exchange a strategy or market should use. A consuming application owns its application port and composition root, constructs the named provider instances it needs, and owns any strategy/market execution routing and independent market-data routing.

Multiple instances of one provider type may represent different accounts or supported environments. Keep provider-specific options and endpoint selection inside the matching implementation. Binance requires explicit `TRADING_MODE=testnet|live`; this rule does not define another exchange's environment support.

## Bitunix Spot integration

The Spot pair catalog is a public, unsigned `GET /api/spot/v1/common/coin_pair/list` used by both `getExchangeMarkets()` and `getSymbolFilters({ symbol })`. The market list includes only pairs explicitly marked open; unknown/closed statuses are excluded. Symbol-filter lookup returns the unique matching raw Bitunix metadata row plus the normalized `symbol`, not a Binance filter DTO. It requires valid `base`/`quote` identity, rejects duplicate rows and a supplied non-matching symbol, and validates documented optional numeric metadata without converting its raw representation. `minPrice` and `minVolume` must be exact non-negative decimal strings when supplied; missing/null values remain unknown and explicit zero is preserved. `basePrecision`/`quotePrecision` are safe non-negative precision counts, and `precisions` is retained as a validated decimal-string list. None of these precision fields is treated as `tickSize`, `stepSize`, or a depth aggregation increment. Undocumented maximum fields found only in third-party fixtures are preserved but not promoted to canonical limits. Application-specific metadata mapping is outside this package. Unsupported increments and maxima remain unknown.

The Bitunix adapter also exposes three one-shot public market-data reads:

- `getOrderBook({ symbol, precision })` calls the documented Spot depth endpoint. The caller must supply the required numeric precision; Coinzilla does not guess which aggregation precision to select. Source level prices/volumes remain exact decimal strings, and the optional source timestamp is preserved as text.
- `getKlines({ symbol, interval })` reads the current OHLC row. `getKlineHistory({ symbol, interval, endTime, limit })` reads one historical page; `endTime` is Unix seconds and `limit` is 1–500. The history endpoint does not document `startTime` or cursor pagination.
- These Bitunix-specific methods return validated OHLC/depth data, not Binance-normalized streams. The official Spot K-line schema omits volume, so `getCandles()` remains unsupported rather than fabricating OHLCV candles. No continuous book-ticker or price subscription is implied.

The Bitunix-only `getExchangeRates()` extension reads `GET /api/spot/v1/common/rate/list` without authentication or query parameters. It returns a frozen array of frozen `{ baseSymbol, quoteSymbol, rate }` records, preserves positive decimal-string rates exactly, accepts an explicit empty array, and rejects missing or incomplete data. The official response schema marks `data` and its row fields optional; this adapter deliberately applies the stricter fail-closed Coinzilla contract rather than treating missing fields as valid rates.

The Bitunix-only `getTokenNetworks()` extension reads the public `GET /api/spot/v1/common/coin/coin_network/list` catalog without authentication or request parameters. It returns immutable token records and immutable network records, preserves exchange-provided fields and exact decimal strings, validates optional deposit/withdraw minimums and maximums as non-negative decimal strings, and preserves omitted/null optional metadata without inventing values. An explicit empty array is valid; missing/non-array data, malformed token/network rows, and invalid decimal limits fail closed. This read exposes deposit/withdraw availability, network names, memo requirements, contract/address metadata and exchange limits; it does not select a network, generate an address, or initiate a deposit, withdrawal or transfer. It is a Bitunix-only metadata extension, not Binance parity.

The Bitunix-only `getUserInfo()` extension reads the signed private `GET /api/spot/v1/user/info` endpoint without parameters. It returns an immutable user-info object, preserves an omitted/null UID, and normalizes non-negative int64 UIDs to exact decimal strings so JavaScript cannot round identifiers. This identifies the user bound to the API key (a sub-account key resolves to its linked master UID); it is not an account snapshot and adds no balance, position, or update-timestamp information.

The Bitunix-only `getTaxFilingHistory({ startTime, endTime, dataTypeCodes?, page?, pageSize? })` extension reads signed `POST /api/spot/v1/tax/filing/page`. It requires UTC ISO-8601 bounds no more than 365 days apart, defaults to page 1/page size 1000, and accepts page sizes up to 1000. Each call returns exactly one immutable page with pagination metadata; callers request subsequent pages explicitly. Record fields and financial amount strings are preserved verbatim, including the documented `—` placeholders. Optional `dataTypeCodes` may be omitted or empty to request all enabled types; documented types include Spot orders, deposits, withdrawals, transfers, realized `PNL`, and `FUNDING_COST` where enabled. This is a Bitunix-specific reporting extension, not a normalized Binance income model.

The Bitunix Spot adapter also implements the state-changing `withdraw()`, `cancelWithdrawal()`, `transferInternally()`, `cancelInternalTransfer()`, and `transferFunds()` operations. They use signed POST requests and preserve exact decimal amount strings. These methods are real provider operations, not unsupported placeholders, but they require the separate `BitunixSpotConfig.allowLiveFundsMutations: true` opt-in (default `false`); this does not change the separate order-mutation gate. Withdrawal requires an API key with withdrawal permission and an address already present in Bitunix's quick-withdrawal list. Internal transfers support UID, phone, or email recipients; UID routing preserves the full positive signed int64 as an exact JSON integer token, without JavaScript Number rounding. Optional `outBizId` is passed through as Bitunix's idempotency key. Successful submission/cancellation acknowledgements confirm request acceptance only, not blockchain settlement or final cancellation; use `getWithdrawalHistory()` and the tax-filing history for status. The documented funds endpoints are limited to 10 requests/second per IP; HTTP 429 responses expose `retryAfterMs` when the server supplies `Retry-After`. Coinzilla never retries a state-changing request automatically; a transport failure after dispatch remains `OUTCOME_UNKNOWN`. No live withdrawal or transfer tests are run because Bitunix does not document a Spot TESTNET.

The Bitunix-only `getDeposits({ id?, coin?, type?, transactionHash?, startTime?, endTime?, limit? })` extension reads one signed page query from `POST /api/spot/v1/deposit/page`. It accepts the documented `deposit` and `inside_transfer_in` type filters, requires an explicit `type: "deposit"` when filtering by transaction hash, and accepts Unix-millisecond time bounds plus a limit from 1 to 100 (exchange default 100). The endpoint exposes no cursor or page-number parameter, so the method never paginates or claims complete history. Records are immutable; IDs and decimal amounts are preserved as strings even when the JSON response encodes them as numbers. Raw type/status strings and address/UID strings are retained without guessed normalization. The official schema describes `data` as an object while its example and JKorf's DTO/fixture use an array; the adapter accepts either shape and returns an array. This is a Bitunix-only account-history extension, not Binance parity and not a withdrawal, funds-transfer, or order-mutation capability.

The Bitunix-only `getDepositAddress({ coin, network })` extension reads the address list for one explicitly selected coin/network using a signed `POST /api/spot/v1/deposit/address`. Both non-empty string inputs are required; the adapter does not guess or auto-select a network. It returns an immutable array, accepts an explicit empty array, and rejects missing/null/non-array data, malformed rows, or records whose coin/network differ from the request. Every returned address is preserved exactly; optional memo values remain omitted, null, or string (including an empty string) exactly as received. The endpoint documents a 10 requests/second per-IP limit; Coinzilla sends one request per invocation, does not paginate or retry, and callers must avoid polling above that limit. Addresses and memos are caller-visible sensitive values and are never logged or persisted. This method only retrieves existing deposit details; it does not generate an address, deposit funds, or move funds. It is a Bitunix-only extension, not Binance parity.

The Bitunix-only `getWithdrawalHistory({ id?, outBizId?, coin?, type?, transactionHash?, startTime?, endTime?, remark?, limit? })` extension reads one signed page query from `POST /api/spot/v1/withdraw_transfer/page`, which includes on-chain withdrawals and internal-transfer-out records. It accepts the documented `withdraw` and `inside_transfer_out` types; a transaction-hash filter requires explicit `type: "withdraw"`. Time bounds are Unix milliseconds and the limit is 1–100 (exchange default 100). No cursor/page parameter is documented, so the method never paginates or claims complete history. The official schema says `data` is an object while the example and JKorf model/fixture use an array; both are accepted. The schema uses `toAddress`, while the example/JKorf use `address`; the raw `address` field is retained and copied exactly to `toAddress` when that alias is needed. Fee and fee-coin fields remain nullable as shown by the example; empty/blank optional memo values normalize to `null`, while malformed non-string memo values fail closed. Numeric IDs, recipient UIDs and decimal amount/fee tokens are preserved losslessly as strings. Recipient addresses, UIDs, phone numbers, email addresses and remarks are caller-visible opaque data and are never logged or persisted by this method. This is a Bitunix-only query extension, not a withdrawal/transfer mutation or Binance parity.

The Bitunix-only `getMatchingOrderDetails({ orderId, symbol })` extension makes one signed `POST /api/spot/v1/order/deal/list` for a known order and returns the immutable exchange-native `{ volume, price, fee, feeCoin, role, ctime, id }` record. An explicit `data: null` remains `null`; missing data, arrays, incomplete records and malformed decimals/timestamps fail closed. Raw numeric ID, role and decimal tokens are preserved as strings before JSON parsing can round them. This lookup does not interpret `volume` units, promote `id` to a canonical execution ID, or claim that the record covers every partial execution. It is not `getFills()` or `getMyTrades()`, and does not satisfy the full order/fill lifecycle contract.

The current Bitunix implementation exposes market catalog/metadata, canonical balances (`getBalances()`), legacy non-zero `Coin` values (`getAssets()`), latest-price and exchange-rate lookup, deposit-address and deposit/withdrawal history queries, raw per-order matching-order details, per-symbol pending orders and order history, and order detail. Direct legacy `createOrder()` supports LIMIT with base `quantity` and MARKET with quote `quoteQuantity` on the single-order REST endpoint; `cancelOrder()` and symbol-scoped `cancelAllOpenOrders({ symbol })` are implemented with post-mutation order-detail verification. All live order mutations are disabled by default and require `allowLiveOrderMutations: true` in `BitunixSpotConfig` to opt in explicitly. Funds mutations are separately disabled by default and require `allowLiveFundsMutations: true`; they are not added to the exchange-neutral Broker contract or the order capability model. Canonical placement, canonical fills, and the complete private-event/account lifecycle required for Harvester execution remain unsupported. Pending-order reads accept the documented single-object and array row shapes, preserve an explicit empty array as no open orders, and reject missing or `null` response data rather than treating an undocumented response as an empty account. Unknown non-empty order status codes are normalized to `UNKNOWN` and retained in `exchangeStatus`; missing or malformed status values remain invalid. Bitunix documents broker `orderId` values as strings; Coinzilla also retains compatibility with safe-integer numeric IDs, but rejects unsafe numeric IDs before order lookup or order adaptation to avoid silently rounded identities. `getAssets()` reads the same account endpoint, combines free and locked amounts exactly before converting to the legacy JavaScript `Number`-based `Coin.value` shape, and omits exact zero balances. Use `getBalances()` for exact decimal amounts and financial calculations; the legacy `getAssets()` result is compatibility-only. `getFills()` deliberately returns an unsupported result without making a request: the Spot `order/deal/list` response does not define whether `volume` is base or quote quantity, whether one object covers every partial execution, or whether `id` is stable/unique for durable deduplication. A canonical Fill cannot be constructed safely until Bitunix clarifies those semantics. PR #1205 previously added a `dealVolume`/response-presence guard and PR #1220 rejected undocumented array responses, but neither proved fill completeness or quantity denomination. Order-history queries accept the canonical `status`, `side`, and `type` filters; the adapter translates them to Bitunix's numeric API codes. The adapter requires positive safe-integer request `page` and optional `limit` values before I/O, then validates the non-negative `total`, positive integer `pageNum` (string or number), and returned page identity; an omitted `data` array is normalized only when `total` is zero. It still returns one page and does not sort or auto-paginate because Bitunix does not document ordering, snapshot consistency, or completion semantics. Bitunix's Spot pair catalog does not include a symbol field, so the adapter derives the exchange symbol by concatenating the documented base and quote codes (for example, BTC + USDT → BTCUSDT); order/price APIs use that pair form. If an optional `symbol` field is present, it must match that derived pair identity; contradictory metadata is rejected. If an optional `symbol` field is present (as in the JKorf reference fixture), it must match that derived pair identity; contradictory metadata is rejected. The active catalog includes only pairs explicitly marked open; missing or unknown open-state values are excluded. The last-price endpoint must return a strictly positive decimal string; the adapter preserves that string exactly in the Binance-compatible `{ symbol, price }` response shape. The REST account response documents balances as JSON numbers; the transport preserves the raw numeric tokens as decimal strings before entity construction to avoid JavaScript number rounding. Order-history queries accept the canonical `status`, `side`, and `type` filters; the adapter translates them to Bitunix's numeric API codes. The adapter requires positive safe-integer request `page` and optional `limit` values before I/O, then validates the non-negative `total`, positive integer `pageNum` (string or number), and returned page identity; an omitted `data` array is normalized only when `total` is zero. It still returns one page and does not sort or auto-paginate because Bitunix does not document ordering, snapshot consistency, or completion semantics. Bitunix's Spot pair catalog does not include a symbol field, so the adapter derives the exchange symbol by concatenating the documented base and quote codes (for example, BTC + USDT → BTCUSDT); order/price APIs use that pair form. The active catalog includes only pairs explicitly marked open; missing or unknown open-state values are excluded. The last-price endpoint must return a strictly positive decimal string; the adapter preserves that string exactly in the Binance-compatible `{ symbol, price }` response shape. The REST account response documents balances as JSON numbers; the transport preserves the raw numeric tokens as decimal strings before entity construction to avoid JavaScript number rounding.

All adapted Bitunix order rows (pending orders, order history, and order detail) require non-empty string `ctime` and `utime` fields. The adapter preserves these source strings exactly and does not assume a timezone, timestamp precision, or ordering rule that the official order-history schema does not define. The Bitunix order-detail endpoint is keyed by `orderId` alone, matching JKorf/Bitunix.Net `GetOrderAsync(string id)`: `getOrder({ orderId })` therefore accepts the broker order ID without requiring a symbol and uses the returned exchange symbol. When a caller supplies `symbol`, Coinzilla still validates it against the response. Client-order-ID lookup remains unsupported.

The REST boundary reports `BitunixRestError` (a `SystemCustomError` subclass) with `kind` set to `transport`, `http`, `exchange`, or `response`. Its `code` is a stable Coinzilla diagnostic code; the exchange's non-zero API code is retained separately as `exchangeCode` and is not mapped to guessed meanings. The original transport or response-parsing failure is preserved as native `cause`. HTTP status failures are distinguished from HTTP-success exchange rejections. Successful HTTP envelopes require a scalar safe-integer number or integer-string `code` equal to zero and a string `msg`; `data` remains optional. Malformed code types and missing messages fail closed. HTTP 429 responses retain their status and expose `retryAfterMs` when the server supplies `Retry-After`; no automatic retries or retryability guesses are made for other exchange error codes.

It intentionally does not support canonical order placement/lookup/history, canonical fills, account snapshots, server time, or continuous price/private execution subscriptions. Direct legacy order placement uses only the single-order REST endpoint. Current official REST docs specify LIMIT `volume` in base units and MARKET `volume` in quote units: generic LIMIT `quantity` maps directly, and MARKET requires quote `quoteQuantity`. The provider never estimates quote quantity from price. Bitunix does not accept a caller-supplied client order ID; dispatched transport failures therefore remain `OUTCOME_UNKNOWN` and are never retried automatically. No Spot TESTNET endpoint is documented. Keep `allowLiveOrderMutations` false until independent order-lifecycle authorization and a safe acceptance plan are approved. Keep `allowLiveFundsMutations` false until separate funds-operation authorization is approved.

These are hard lifecycle constraints, not missing convenience methods. Unsupported canonical mutations do not send requests. Direct legacy REST placement/cancellation is available to explicit broker callers, but unknown outcomes require manual reconciliation. Do not admit Bitunix to Harvester trading until stable canonical order identity, private execution lifecycle/reconciliation, complete fills, and recovery guarantees are implemented. See [Bitunix capability contract](../../docs/brokers-websocket-contract.md#bitunix-spot-capability-contract) and [Bitunix Spot API docs](https://www.bitunix.com/api-docs/spots/en_us/).

Example:

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

## Bitunix Spot WebSocket RPC

`BitunixSpotWebSocketClient` implements the documented Spot WebSocket request/response API at `wss://openapi.bitunix.com:443/ws-api/v1`. Every RPC is authenticated, including market-data and catalog lookups. It exposes these query methods:

- `getLastPrice({ symbol })` — `market.last_price`
- `getDepth({ symbol, precision })` — `market.depth`; precision is required and supplied by the caller.
- `getKline({ symbol, interval })` — `market.kline`
- `getTradingPairs()` — `common.coin_pair.list`
- `getExchangeRates()` — `common.rate.list`
- `getTokenNetworks()` — `common.coin.coin_network.list`
- `getAccount()` — `user.account`
- `getUserInfo()` — `user.info`
- `getOpenOrders({ symbol })` — `order.pending.list`; requires one symbol.
- `getOrderHistory(input)` — `order.history.page`; returns one validated page.
- `getMatchingOrderDetails({ orderId, symbol })` — `order.deal.list`; looks up one known order.

The client correlates concurrent responses by echoed request ID, validates response envelopes, applies the official Spot WebSocket double-SHA256 signature (separate from REST signing), and never automatically retries a request. Account balance numeric tokens are returned as exact decimal strings; unsafe int64 user IDs are preserved as strings. A timeout or disconnect rejects unresolved RPCs. After a connection closes, call `connect()` again to create a fresh transport and listener set on the same client instance. Concurrent reconnect calls share one connection attempt; interrupted RPCs are rejected and never replayed. Reconnection is explicit and caller-controlled—there is no automatic retry/backoff, subscription restoration, or missed-event replay. Bitunix documents a 24-hour connection lifetime.

```js
import { BitunixSpotWebSocketClient } from "@coinzilla/brokers"

const client = new BitunixSpotWebSocketClient({
  apiKey: process.env.BITUNIX_API_KEY,
  apiSecret: process.env.BITUNIX_API_SECRET,
})

await client.connect()
try {
  const [price, balances, markets] = await Promise.all([
    client.getLastPrice({ symbol: "BTCUSDT" }),
    client.getAccount(),
    client.getTradingPairs(),
  ])
  // Each result is the corresponding Bitunix response data.
} finally {
  await client.disconnect()
}
```

These are one-shot RPC reads, not streaming subscriptions. No continuous public price/depth/K-line feed or private order/execution/balance event stream is implemented. The existing `BitunixSpotBroker` REST methods are unchanged and do not silently switch transports.

## Canonical order placement response

The canonical `createCanonicalOrder()` contract requires the complete exchange order facts (exchange order ID, client order ID, type, side, original/executed quantities, price and status) to construct a `CanonicalOrder`. Binance Spot defaults `LIMIT` and `MARKET` to `FULL`, but defaults other order types such as `LIMIT_MAKER` to the minimal `ACK` response. ACK contains identifiers and transaction time only; it is not sufficient for canonical ownership tracking.

Canonical placement therefore explicitly sends `newOrderRespType: "RESULT"`. RESULT returns the order facts required by the canonical adapter without requesting the additional `fills` array. This applies to canonical placement regardless of order type; the ordinary `createOrder()` compatibility method retains its existing response contract.

Do not infer a successful canonical order from a minimal ACK, synthesize missing order facts, or automatically retry a state-changing placement after an uncertain response. If the request outcome is ambiguous, the consumer must resolve the original client order ID through authoritative user-data or broker reconciliation before any further order action.

## JavaScript editor types

The public broker methods, configuration options, Binance adapters, RPC/Streams clients, and user-data boundaries use JSDoc to describe their inputs, outputs, callbacks, and important value constraints. VS Code and other JavaScript language servers read these annotations for hover information, parameter hints, and IntelliSense without a TypeScript build step.

The package remains plain JavaScript. JSDoc improves editor type information; it does not add runtime validation or enable project-wide static type checking. Keep runtime validation and the existing offline tests as the correctness boundary. Do not add `checkJs`, `@ts-check`, TypeScript declarations, or a TypeScript toolchain as part of routine JSDoc maintenance; follow the repository-wide [JavaScript and JSDoc standard](../../docs/engineering/JAVASCRIPT_JSDOC_STANDARD.md).

## Runtime and configuration

- The broker package declares a standalone floor of Node.js **22.23.4 or newer**. The repository workspace currently requires Node.js **24 or newer**. Independently, the native transport requires a patched bundled Undici release: **6.29.1 or newer in major 6, 7.30.1 or newer in major 7, or 8.12.2 or newer in major 8**. Unknown or unsupported Undici majors are rejected. Meeting the Node floor alone does not prove that the bundled Undici version passes this runtime guard.
- Construct the broker with non-empty `apiKey` and `apiSecret`.
- `tradingMode` is required and must be exactly `testnet` or `live`. It alone selects the endpoint pair: `testnet` uses Binance Spot TESTNET; `live` uses Binance Spot LIVE. The broker does not inspect `NODE_ENV` or silently choose a default.
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

## API permissions

Use a dedicated Binance Spot TESTNET API key, never a production key. The signed account, order-status, history, and user-data subscription checks in the read-only TESTNET workflow need the relevant account-read access and a valid API key/secret pair. They do **not** need Spot trading permission.

**For the current GitHub Actions read-only workflow, keep Spot trading and withdrawals disabled.** The workflow sets `BINANCE_TESTNET_ALLOW_ORDER_MUTATIONS=0`; its integration checks do not create, cancel, or modify orders. Giving this key Spot trading permission does not make the workflow trade, but it grants capability the workflow does not need and increases the impact of an accidental future code/configuration change. If the key you created has trading permission enabled, edit its Binance TESTNET API restrictions and disable Spot trading before using it for this read-only acceptance run. Never enable withdrawals.

A separate, explicitly authorized local TESTNET order-lifecycle test is different: it creates and then cancels a test order, requires TESTNET Spot trading permission, and must additionally set `BINANCE_TESTNET_ALLOW_ORDER_MUTATIONS=1`. Do not add that permission or enable that flag for the GitHub Actions read-only workflow. The package cannot grant permissions or determine an account's Binance-side restrictions.

## Connection and subscription lifecycle

`connect()` opens the WebSocket API connection. The public Streams connection is opened on demand when `subscribeForPrices()` or `subscribeForBookTicker()` is called.

`disconnect()` stops user-data recovery, disconnects both clients, and is safe to call during shutdown. Applications should await it during graceful shutdown.

For user data:

1. Call the common `subscribeForUserData({ symbols?, trackedOrders?, onEvent, onObservation, onStatus })` method after `connect()`. Binance uses `onEvent` for native exchange events; Bitunix Spot uses `onObservation` for non-authoritative polling snapshots.
2. The broker uses `userDataStream.subscribe.signature` on the WebSocket API connection. It uses the existing HMAC API key/secret flow; it does not require Ed25519 or `session.logon`.
3. Multiple local subscribers share one remote subscription on the API connection.
4. The returned subscription data provides `disconnect()`, the legacy `acknowledgeRecovery()` boolean, and the additive `acknowledgeRecoveryResult()` result contract.
5. A `terminated` or `connectionClosed` status means the event history has a gap. The broker reconnects and resubscribes, then emits `recovered` with `reconciliationRequired: true`.
6. The broker includes a monotonically increasing `recoveryGeneration` in each `recovered` reminder and the terminal `reconciled` status. A consumer must retain the token for the recovery work it is performing; a later disconnect/recovery produces a strictly newer token.
7. The consumer must reconcile current account/order/trade state before acknowledging. Prefer `acknowledgeRecoveryResult(recoveryGeneration)`, passing the exact token from the matching `recovered` status. It returns:
   - `{ accepted: true, completed: false }`: this subscriber's acknowledgement was recorded for that generation; another active subscriber is still pending.
   - `{ accepted: true, completed: true }`: this acknowledgement completed shared recovery for that generation.
   - `{ accepted: false, completed: false, reason: "stale-or-inactive" }`: this subscription handle is no longer active.
   - `{ accepted: false, completed: false, reason: "recovery-not-pending" }`: no active recovery acknowledgement can be accepted.
   - `{ accepted: false, completed: false, reason: "stale-recovery-generation" }`: the supplied token is missing, malformed, or belongs to an older recovery generation. The acknowledgement is not recorded.
8. The legacy `acknowledgeRecovery()` method remains callable with no arguments and preserves its boolean behavior: it returns `true` only when this call completes shared recovery, and `false` while other subscribers are pending or when the acknowledgement is not accepted. Because the legacy signature carries no generation token, consumers needing stale-work fencing must migrate to `acknowledgeRecoveryResult(recoveryGeneration)`.
9. If application reconciliation or a required durability barrier fails, the consumer must not acknowledge. The broker keeps recovery required, continues its bounded reminders, and keeps state-changing RPCs blocked until all active subscribers acknowledge the current generation.
10. A `reconciled` status indicates that all active subscribers acknowledged the same current generation; local acceptance alone is not global readiness. Consumers must also correlate the terminal status to the token and subscription identity they reconciled.
11. If a reconnect client's `connect()` fails, the session detaches that client's listeners and attempts to disconnect the failed client before scheduling another retry. If disposal fails, the session retries disposal of that same client and does not create a replacement socket until closure succeeds. Cleanup failure is logged separately and does not replace the original connection error.

The recommended reconciliation inputs are:

- `getAccountSnapshot()` for current balances and the account snapshot source timestamp.
- `getOpenOrders()` for the current open-order set.
- `getExchangeMarkets()` for the complete symbol catalog returned by Binance `exchangeInfo`; this read-only method returns canonical `Market` values and primes the broker's canonical market cache. It includes the symbols in the current exchange catalog, not delisted symbols.

`getOpenOrders({ symbol? })` accepts an omitted symbol to retrieve the account-wide open-order set. Its normalized `Order` values retain `id`, `symbol`, optional `clientOrderId`, `originalPrice`, `originalQuantity`, `executedQuantity`, and `status`. `price` remains the legacy numeric convenience field; use `originalPrice` when exact decimal fidelity is required for audit/reconciliation. `originalPrice`, original quantity, and executed quantity preserve the exchange's decimal strings.

- `getMyTrades()` and `getOrderHistory()` for available symbol-scoped history, using pagination where required.

These snapshots and query results do **not** reconstruct every intermediate event or balance delta missed during an outage. Event timestamps are not a global replay cursor. Consumers must reconcile their own durable state and must not assume that reconnecting replays missed events.

The `onEvent` callback contract remains `onEvent({ event })`. Status notifications are delivered separately through the optional `onStatus(status)` callback. Callback exceptions are isolated and logged.

## Order safety and uncertain outcomes

Bitunix Spot supports single-order cancellation through the signed REST API and verifies the final status with an order-detail read. A lost acknowledgement or non-terminal follow-up status is reported as `OUTCOME_UNKNOWN`; never blindly retry. `cancelAllOpenOrders({ symbol })` is implemented for one explicit symbol and only attempts rows returned by the current-order query; the API contract does not establish exhaustive symbol coverage or account-wide enumeration. Direct `createOrder()` supports LIMIT and MARKET through the single-order REST endpoint only. LIMIT uses base `quantity`; MARKET requires quote `quoteQuantity`. No price-based conversion is performed. Bitunix does not accept a caller-supplied client order ID, so transport timeouts return `OUTCOME_UNKNOWN` and are never retried; canonical placement remains unsupported.

A failed `cancelOrder()` result includes `cancellationOutcome`: **`NOT_SENT`** means the local user-data-availability guard rejected the call before invoking `order.cancel`; **`OUTCOME_UNKNOWN`** means the broker invoked the RPC but could not return an authoritative canonical order result. Treat missing or unknown classifications conservatively. Consumers must trust `NOT_SENT` only when the broker result is unsuccessful (`ok: false`); contradictory success-shaped metadata remains unconfirmed. A successful result carries the broker order response; consumers that require canonical cancellation must still verify canonical order history and actual fills.

A timeout or connection loss during a state-changing RPC can mean Binance accepted the operation but the response was lost. Such an outcome is **unknown**, not proof of failure. Do not blindly submit the same order or cancellation again. `getCanonicalOrder({ symbol, orderId })` and `getCanonicalOrder({ symbol, clientOrderId })` perform read-only `order.status` lookups and return an exact-decimal `CanonicalOrder`; the client-ID form maps to Binance's `origClientOrderId` request parameter. A lookup result is only an identity/status observation: callers must still reconcile canonical order history and actual fills. A not-found response or lookup failure is not permission to retry.

`getOrder({ symbol, orderId })` preserves broker-order-ID lookup. `getOrder({ symbol, clientOrderId })` performs the same signed `order.status` query using Binance's `origClientOrderId`. Exactly one identifier is required. A definitive Binance `-2013` (`NO_SUCH_ORDER`) response returns `{ ok: true, data: null }`; authentication, transport, rate-limit, malformed-response, and other API failures remain errors. This null result is not permission to retry an uncertain state-changing request without reconciling the surrounding order and fill state.

The RPC client uses a 10,000 ms default request timeout and a 5,000 ms default `recvWindow`. These are client defaults, not guarantees about Binance processing time or rate-limit capacity. Binance rate limits and account restrictions remain authoritative; handle rate-limit and API errors explicitly and do not add unbounded retry loops.

## Public market-data streams

`subscribeForPrices({ symbol, onPrice })` subscribes to the symbol's `aggTrade` stream and the shared `!ticker_1h@arr` liveness stream, then returns an unsubscribe function in its result data. The Streams client reconnects desired subscriptions after unexpected disconnection, paces control messages, limits a connection to 1,024 streams, batches subscribe/unsubscribe requests in groups of at most 200, and rotates a connection before the documented 24-hour connection lifetime.

`subscribeForBookTicker({ symbol, onBookTicker })` subscribes to the symbol's `bookTicker` stream and returns an unsubscribe function. Its immutable callback payload contains `symbol`, `bestBidPrice`, `bestBidQuantity`, `bestAskPrice`, `bestAskQuantity` (all price/quantity values remain exact decimal strings), and a local receipt `timestamp`. Malformed events and events for a different symbol are rejected; the timestamp records local receipt time because Binance's bookTicker event does not include an event timestamp.

These reconnect guarantees apply to the public stream subscription set; they do not imply user-data event replay or reconciliation.

### Historical and live candles

The Binance WebSocket broker exposes normalized historical candles and live Kline updates, delivered in [PR #1017](https://github.com/45s/coinzilla/pull/1017):

- **getCandles({ symbol, interval, limit = 500, startTime?, endTime? })** — uses the unsigned WebSocket API time and klines methods, returns immutable candles in strictly ascending open-time order, and supports 1–1000 rows.
- **subscribeForCandles({ symbol, interval, onCandle })** — subscribes to the public Kline stream and returns an unsubscribe handle.

The normalized immutable candle contains symbol, interval, openTime, closeTime (Unix milliseconds), exact decimal-string open, high, low, close and volume, plus isClosed. Historical isClosed is determined using Binance server time fetched immediately before the klines request, not the local machine clock. A current candle can be returned with isClosed false. Live updates preserve Binance's Kline close flag.

Malformed rows, invalid timestamps/prices/volume, inconsistent OHLC values, duplicate/out-of-order history, unsupported intervals and invalid time bounds return an unsuccessful broker result. The broker does not sort or invent missing candles; gap detection and backfill policy belong to the consumer.

The implementation uses the existing native WebSocket API klines request and public Kline Streams subscription. It adds no REST fallback or third-party SDK. The Streams protocol already recognized Kline stream names; PR #1017 adds the public normalized adapter and broker methods.

Protocol references: [Binance Spot WebSocket API — Klines](https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-api.md#klines) and [Binance Spot Kline Streams](https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md#klinecandlestick-streams-for-utc).

## Bitunix development workflow

Every Bitunix Spot implementation task must follow the mandatory [Bitunix Spot development workflow](./docs/BITUNIX_WORKFLOW.md). It requires agents to work through the common Broker API and Bitunix provider facade, turn verified protocol findings and operator observations into adapter/error-handling improvements and offline regression tests, and keep capability evidence and documentation synchronized.

**The safety policy is unchanged:** automated tests, CI, scheduled jobs, and AI-agent-executed commands must never mutate a LIVE account. Order-mutation integration tests remain TESTNET-only. A human-initiated local LIVE experiment is a separate, explicitly confirmed operator investigation—not a test—and AI agents must never execute it. The lack of Bitunix Spot TESTNET does not authorize redirecting tests to LIVE; issue [#1185](https://github.com/45s/coinzilla/issues/1185) remains authoritative for lifecycle and production-readiness blockers.

All Bitunix local workflows now use one entry point: `pnpm --filter @coinzilla/brokers bitunix:healthcheck` (default read-only report publishing), `pnpm --filter @coinzilla/brokers bitunix:healthcheck -- --local` (local-only diagnostics), or the human-only `pnpm --filter @coinzilla/brokers bitunix:healthcheck -- --place-order` mode. The `--place-order` mode first verifies the explicit diagnostic safety/configuration prerequisites, then starts the guarded one-shot order attempt inside the same report-branch workflow. That attempt independently re-reads markets, symbol filters, balances and open orders through the Broker API; any failed read or invalid preflight blocks confirmation and dispatch. Other diagnostic failures remain visible in the report but do not block this fresh guarded preflight. It must never be run by AI agents, CI, or scheduled jobs. Its fixed order and safety gates are tracked in [issue #1608](https://github.com/45s/coinzilla/issues/1608) / [PR #1609](https://github.com/45s/coinzilla/pull/1609), with CLI consolidation tracked in [issue #1614](https://github.com/45s/coinzilla/issues/1614) / [PR #1616](https://github.com/45s/coinzilla/pull/1616).

### One-at-a-time Bitunix Spot order probes

A separately reviewed, human-only probe mode is available through the same CLI:

```sh
pnpm --filter @coinzilla/brokers bitunix:healthcheck -- --probe-order=limit-buy-1
pnpm --filter @coinzilla/brokers bitunix:healthcheck -- --probe-order=limit-buy-2
pnpm --filter @coinzilla/brokers bitunix:healthcheck -- --probe-order=limit-sell-1
pnpm --filter @coinzilla/brokers bitunix:healthcheck -- --probe-order=limit-sell-2
pnpm --filter @coinzilla/brokers bitunix:healthcheck -- --probe-order=market-buy-1
pnpm --filter @coinzilla/brokers bitunix:healthcheck -- --probe-order=market-buy-2
pnpm --filter @coinzilla/brokers bitunix:healthcheck -- --probe-order=market-sell-1
pnpm --filter @coinzilla/brokers bitunix:healthcheck -- --probe-order=market-sell-2
```

Unlike the generic health-check and fixed `--place-order` modes, each probe invocation skips unrelated diagnostics and selects exactly one HYPEUSDT BUY/SELL LIMIT/MARKET probe (amount 1 or 2). It performs only the fresh read-only market/filter/relevant-balance/open-order preflight, displays the exact Coinzilla input and REST wire body, and requires a fresh ENTER confirmation. It dispatches through the common `Broker.createOrder()` method. A unique exclusive marker under ignored `.diagnostics/` records the dispatch state and captured place-order HTTP status/raw response body, request body, Broker outcome and error metadata. The local evidence file is private (mode 0600); the report branch contains only the existing allowlisted sanitized diagnostic summary. A definitive `REJECTED` marker is the only outcome that allows a different next probe; the same probe ID can never be repeated. Any `DISPATCH_STARTED`, `CONFIRMED`, `OUTCOME_UNKNOWN`, `NOT_SENT` or malformed marker blocks the entire matrix pending manual review. The runner never loops, retries, cancels, transfers or withdraws.

The matrix is a controlled first pass, not a combinatorial fuzzer. Bitunix's official English and Chinese Spot docs disagree about LIMIT/MARKET volume denomination; the probe is intended to gather LIVE observations, not to assert a new protocol guarantee. Any accepted order may rest or fill immediately. The operator alone may execute this mode; never run it from an AI agent, test, CI or scheduled job. See [issue #1690](https://github.com/45s/coinzilla/issues/1690).

## Bitunix Spot local diagnostics

The Bitunix diagnostic runner is an explicitly invoked, non-mutating local tool. Application-level read checks run through the same public `Broker` constructor used by consumers (market catalog, price, balances, and open orders); REST and WebSocket clients are accessed directly only for separate transport-level endpoint, request-correlation, connection, and cleanup probes. The diagnostic does not change broker runtime composition or enable trading.

Bitunix documents Spot WebSocket as authenticated request/response RPC: every request, including methods listed under the Public Interface, carries API key, timestamp, nonce and signature. The connection is documented as valid for 24 hours, and the API exposes a `ping` RPC connection test. It does **not** document continuous market subscriptions or private order/execution event streams. A successful RPC is not proof of a live stream. See the [official WebSocket introduction](https://www.bitunix.com/api-docs/spots/en_us/ws/) and [public RPC methods](https://www.bitunix.com/api-docs/spots/en_us/public-ws/).

### Configure and run

Create `packages/brokers/.env.development` (never commit it; the root `.gitignore` already excludes it). The published health check requires both private API credentials; the lower-level diagnostic command still supports public-only checks:

~~~dotenv
BITUNIX_API_KEY=your_read_only_diagnostic_api_key
BITUNIX_API_SECRET=your_api_secret
# Optional: leave unset to skip REST and WebSocket depth checks; choose only a value you have verified for your market.
# BITUNIX_DIAGNOSTICS_DEPTH_PRECISION=
~~~

From `packages/brokers`:

~~~sh
node scripts/bitunix/run-healthcheck.js
~~~

For public-only diagnostics without private credentials, use `pnpm --filter @coinzilla/brokers bitunix:healthcheck -- --local`; this command does not create or push a report branch. The publisher rejects missing or blank credentials before fetching or creating a branch, so it cannot label a public-only run as a successful authenticated health check.

The source-level `DIAGNOSTIC_CONFIG.confirmLiveReads` constant is the explicit acknowledgement gate because Bitunix Spot has no documented TESTNET environment. It defaults to `true`; set it to `false` in `scripts/bitunix/diagnostics/run-diagnostics.js` to prevent the runner from making requests. The runner contacts the configured LIVE Spot endpoint and performs non-mutating query requests only.

Both `BITUNIX_API_KEY` and `BITUNIX_API_SECRET` are optional for public-only diagnostics. With neither credential configured—or with only one configured—the runner executes unsigned public REST transport probes plus public `Broker` API market-catalog, price and symbol-filter reads, then marks private `Broker` API balance/open-order/order-history, REST account/open-order, and authenticated WebSocket RPC checks as skipped. The public `Broker` instance receives an internal read-only placeholder config only because the Bitunix Spot config requires non-empty constructor credentials; the public requests explicitly set `authenticated: false`, so the placeholder is never sent or signed. Configure **both** variables to enable signed `Broker` API balance/open-order/order-history reads, private REST probes, and authenticated WebSocket RPC. A private REST request without credentials fails closed with `BITUNIX_REST_AUTHENTICATION_REQUIRED`; the REST client never fabricates or sends credentials for a private request. The two values are treated as one credential pair.

When enabling private diagnostics, use a dedicated API key with account-read permission and **without** trading or withdrawal permission. Do not use production mutation-enabled keys for diagnostics.

The runner checks these documented Spot REST operations:

- Public trading-pair catalog, latest price, exchange rates, and token/network metadata.
- Public order-book depth when `BITUNIX_DIAGNOSTICS_DEPTH_PRECISION` is explicitly configured.
- Current K-line and one historical K-line sample using the constant `1min` interval.
- Private account balances.
- Private current open orders via `POST /api/spot/v1/order/pending/list`. Although the HTTP method is POST, Bitunix documents this as **Query current orders**; the diagnostic sends only the symbol, sets `stateChanging: false`, and never places or cancels orders.

The same diagnostic lifecycle also exercises the public Broker facade's `getSymbolFilters({ symbol })` and, when credentials are configured, `getOrderHistory({ symbol, page: 1, limit: 10 })`. Order history is explicitly symbol-scoped and only the first bounded page is queried; this is a schema/normalization probe, not a completeness guarantee.

The official [Spot public REST reference](https://www.bitunix.com/api-docs/spots/en_us/public/) does not document a server-time or general recent-trades endpoint, so neither is invented or probed. The [Spot order reference](https://www.bitunix.com/api-docs/spots/en_us/order/) documents the current-orders query separately from place/cancel operations.

It then connects to the authenticated Spot WebSocket RPC endpoint and checks:

- `ping` (the documented authenticated connection-test RPC).
- `market.last_price`, `market.depth`, and `market.kline`.
- `common.coin_pair.list`, `common.rate.list`, and `common.coin.coin_network.list`.
- `user.account` and `user.info`.
- `order.pending.list`, `order.history.page`, and `order.deal.list` (read-only, authenticated, symbol/order scoped).

After a successful initial RPC session, it disconnects and explicitly reconnects the same client instance, then verifies the replacement transport with another authenticated `ping`. This is not an automatic retry loop and does not simulate the documented 24-hour server expiry. Subscription restoration is explicitly skipped because the official Spot API reference defines one-shot request/response methods and no subscription channels.

REST and WebSocket depth checks are skipped unless `BITUNIX_DIAGNOSTICS_DEPTH_PRECISION` is explicitly supplied; the runner does not infer depth aggregation precision from basePrecision, quotePrecision, or precisions[].

Each operation receives its own pass/fail/skip result and duration. The named `DIAGNOSTIC_CONFIG` constants in `scripts/bitunix/diagnostics/run-diagnostics.js` set the symbol (`BTCUSDT`), K-line interval (`1min`), request/connect/close timeout (`10_000` ms), and public-payload capture policy (`false`). Change these values in code when needed; they are not environment settings. Public response payloads are omitted by default. Broker API checks additionally emit `schemaObservations` containing response shape, observed/unknown field names, missing required fields, and unexpected field types—never response values. Unknown fields are reported but do not fail otherwise valid normalization; missing required fields, invalid row shapes, and unexpected types produce explicit failed schema checks. Diagnostic failures use `DiagnosticError` (`BROKER_DIAGNOSTIC_SCHEMA_MISMATCH` or `BROKER_DIAGNOSTIC_RESULT_INVALID`), preserving only safe path/operation/issue context and the stable code in the sanitized report. The optional depth precision remains an environment setting because its value must be explicitly chosen rather than inferred. The report is written to packages/brokers/.diagnostics/ (ignored by Git) with restrictive file permissions. Outbound WS messages are captured only after credential/signature/nonce redaction. Private account responses are summarized by shape and field names; private balances, UIDs and other sensitive values are never persisted.

This is an operator diagnostic, not a trading test, exchange acceptance certificate, TESTNET substitute, or proof of trading readiness. It never places/cancels orders, withdraws/transfers funds, retries failed requests, or automatically reconnects after an unexpected failure. Its single controlled same-client reconnect probe runs only after the first session completes successfully. It does not test protocol-level control-frame heartbeats or simulate 24-hour expiry. The report records response latency and sanitized response structure, but does not impose a stale-data threshold because Bitunix does not document a maximum market-data age; RPC response correlation is tested, but there is no stream sequence-ordering or subscription-restoration test. Default unit tests remain offline and do not execute this command.

### One-command report publishing

From `packages/brokers`, run `node scripts/bitunix/run-healthcheck.js` on a clean local checkout on `develop`. The command loads the `packages/brokers/.env.development`, fetches `origin/develop`, creates a timestamped `diagnostics/bitunix-health-<timestamp>` branch, and reuses the read-only diagnostics above. It writes the local report under `packages/brokers/.diagnostics/` and commits/pushes only the sanitized report under `packages/brokers/diagnostics/reports/`. It then switches the local checkout back to `develop`.

The operator preflight gate requires successful `diagnostic safety confirmation` and `diagnostic configuration`. It separately reports failed non-blocking diagnostics, including optional Broker history and WebSocket probes. The guarded order attempt then performs fresh Broker API reads for markets, symbol filters, balances and open orders; those reads and validations are authoritative for whether the operator may confirm the order. The overall diagnostic summary still records every failed operation, and a failure report is still pushed when Git permits.

The publisher refuses to start when the worktree is dirty, the current branch is not `develop`, or the `origin` remote is missing. It never stashes, resets, force-pushes, deletes branches, creates a PR, or stages files other than the generated report. The report branch remains on GitHub so it can be inspected independently. The `--place-order` mode uses this same branch lifecycle: diagnostic safety/configuration prerequisites are checked first; if they pass, the guarded operator preflight and one-shot attempt run before the sanitized report is written, committed and pushed; the local checkout is then returned to `develop`. Other diagnostic failures remain in the report and make the diagnostics summary degraded, but do not suppress the guarded preflight. The preflight itself still stops before confirmation/dispatch on any failed read or invalid market, filter, balance or open-order condition. The published JSON is built with a strict allowlist: operation names, pass/fail status, duration, aggregate check counts, the overall health verdict, and selected error classifications (name/code/kind/status/exchange code). It contains no request objects, response objects, API credentials, signatures, account identifiers, balances, addresses, request IDs, or free-form error messages. Unexpected fields from Bitunix responses are excluded by construction, not merely redacted. The ignored local report is also sanitized, but treat it as private and never commit or share it. The local report requests owner-only `0600` permissions on POSIX; on Windows it inherits the repository folder's ACL, so keep that folder private. Free-form exchange error messages are withheld from the local report as well; only structured error classifications and codes are retained. The pushed report withholds those messages.

If Bitunix requests fail, the failure report is still committed and pushed when Git permits, the command returns a non-zero exit code, and the checkout is switched back to `develop`. If pushing fails, the command reports the local branch/commit details and still attempts to return to `develop`. Git must have a configured user name/email and a working `origin` push credential. No GitHub Actions secrets or workflows are involved.

Use a dedicated API key with account-read permission only. The health check contacts the configured LIVE Bitunix Spot API and never places/cancels orders, withdraws, transfers, or changes account state. A successful check verifies the currently documented read-only REST/RPC calls; it does not establish TESTNET availability, continuous private events, or Harvester trading readiness.

## One-shot Bitunix HYPEUSDT operator order attempt

This is a deliberately fixed, human-operated LIVE investigation—not a general order CLI, an integration test, a TESTNET substitute, or proof of production readiness. The agent, unit tests, CI, scheduled jobs, and Harvester must never invoke it.

Check the exact local script revision without loading credentials or contacting Bitunix:

```sh
node packages/brokers/scripts/bitunix/run-healthcheck.js --version
```

Every invocation also prints this identity before starting the workflow. It includes the full Git commit SHA and whether the worktree is clean or dirty.

From the repository root, run this command manually in an interactive terminal:

```sh
pnpm --filter @coinzilla/brokers bitunix:healthcheck -- --place-order
```

It loads `packages/brokers/.env.development` and requires both `BITUNIX_API_KEY` and `BITUNIX_API_SECRET`. It requires a clean checkout on `develop` and a working `origin` remote, verifies the diagnostic safety/configuration prerequisites, and then runs the guarded order preflight. Unrelated diagnostic failures are still reported but do not block that preflight. After the single guarded attempt, it publishes the allowlisted sanitized result through the existing report branch workflow and returns the local checkout to `develop. Use a dedicated key with account-read and Spot-trading permissions; keep withdrawals disabled. The command uses the common `Broker` facade. Its read-only Broker has `allowLiveOrderMutations: false`; a separate mutation-enabled Broker is not constructed until after the operator presses ENTER to approve the exact displayed order.

The only order this command can attempt is:

- Symbol: `HYPEUSDT`
- Side/type: `BUY LIMIT`
- Price: `30` USDT
- Base quantity: `0.4` HYPE
- Exact notional: `12` USDT

Before prompting for confirmation, it reads the market catalog, symbol metadata, account balances, and symbol-scoped open orders through the common Broker API. It aborts unless HYPEUSDT is explicitly open with matching HYPE/USDT identity, the documented `minVolume` (base quantity) and `minPrice` (quote notional) are present and satisfied, free USDT is below 12, and the symbol-scoped open-order query returns no rows. Decimal comparisons are exact. The local 11 USDT notional floor is provisional and is **not** an exchange guarantee.

The preflight display also states the limitations: the empty symbol-scoped open-order response is not proof of account-wide absence because response completeness is unverified; the balance is a point-in-time response without an authoritative source timestamp and may change before dispatch; and price tick and quantity step remain UNKNOWN. Free USDT below 12 does not guarantee rejection: bonuses, transfers, other assets, account settings, or exchange behavior may still affect acceptance. A successful or rejected LIVE response is one observation, not a production-readiness guarantee. If accepted, the 30 USDT limit may be marketable and could fill immediately at the live ask. This is a real LIVE order, not a safe simulation. Review every displayed value. After the full preflight display, the final prompt asks the operator to press ENTER to approve this exact order. No long confirmation phrase must be typed; typing anything declines:

After that confirmation, the command connects the mutation-enabled Broker, atomically creates the exclusive marker `packages/brokers/.diagnostics/bitunix-hypeusdt-buy-limit-attempt.json` with mode 0600 on POSIX; on Windows the marker inherits the `.diagnostics` directory ACL, so keep the package folder private, and calls `createOrder()` exactly once. The marker contains only the fixed order intent and timestamp—not credentials or account balances. Its existence blocks every subsequent invocation. Do not remove it to retry. There is no automatic retry, cancellation, transfer, or second mutation. If the Broker reports `OUTCOME_UNKNOWN`, keep the marker and reconcile manually before taking any further action.

This command does not change the default `allowLiveOrderMutations: false` setting, the common Broker contract, capability declarations, or Harvester routing. It does not resolve issue [#1185](https://github.com/45s/coinzilla/issues/1185)'s client-order identity, unknown-outcome recovery, fill completeness, account freshness, private-event, or TESTNET blockers.

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

The workflow maps these repository secrets to the broker's existing environment-variable names `BINANCE_API_KEY` and `BINANCE_API_SECRET_KEY`. It exposes them only to the single read-only integration step; checkout, tool setup, and dependency installation run without exchange credentials. That step rejects missing credentials and case-insensitive placeholder values before starting the integration tests. Do not create a GitHub Environment for this workflow; it does not reference one. Never put secret values in source files, workflow YAML, issue/PR text, logs, screenshots, or chat. Never print or inspect secret values while troubleshooting.

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

For user-data `executionReport` TRADE events, canonical Fill execution time is Binance transaction time `T`. Event publication time `E` remains event/order-update metadata and must not be used as the execution timestamp. This matches the WebSocket API `myTrades.time` field, so the same exchange trade has identical canonical facts whether it is first observed in a history response or an `executionReport` user-data stream event. Preserve strict duplicate-fill conflict detection: identical facts are idempotent; conflicting facts reusing a Fill ID remain errors.

### User-data delivery modes

The method name is shared; the delivery guarantee is not. Binance declares `SUBSCRIBE_USER_DATA: SUPPORTED`, returns `deliveryMode: "NATIVE_EVENTS"` / `nativePush: true`, and forwards authenticated exchange events through `onEvent`. Bitunix declares `OBSERVE_USER_DATA: SUPPORTED` while native `SUBSCRIBE_USER_DATA` remains unsupported; it returns `deliveryMode: "POLLING_OBSERVATIONS"` / `nativePush: false` and sends changed, explicitly scoped snapshots only through `onObservation`.

Do not convert observations into execution reports, canonical fills, or account snapshots. Polling cannot replay transient states or prove complete history. Harvester keeps Bitunix outside provider registration until [issue #1185](https://github.com/45s/coinzilla/issues/1185)'s native lifecycle, authoritative snapshot, canonical fill, and recovery prerequisites are met. See [the shared Broker API contract](./BROKER_API.md#user-data-delivery-channels).

### Bitunix Spot order request adapters

Bitunix Spot order request/response mapping lives in the Bitunix infrastructure `adapters/order-requests.js` module and has direct offline tests. It owns exact LIMIT base-quantity / MARKET quoteQuantity request construction, order identity correlation, and the explicit signed detail/cancel request envelopes. The broker facade retains mutation opt-in, dispatch tracking, reconciliation, unknown-outcome classification, and cancellation/fill-race orchestration. A definitive successful placement acknowledgement remains `mutationOutcome: "CONFIRMED"` even if the follow-up detail read fails. Because no normalized `Order` was returned, the overall Broker result remains `ok: false`; it preserves the raw placement acknowledgement in `data`, the read error in `errors`, and structured `reconciliation: { status: "UNAVAILABLE", source: "PLACEMENT_ACKNOWLEDGEMENT", endpoint, error }` metadata. Callers must branch on `mutationOutcome` before considering another mutation: `CONFIRMED` means the order was accepted and must never be blindly retried. The acknowledgement does not prove the order is still open, filled, or otherwise reconciled. A successful detail read returns the normalized order and `reconciliation.status: "VERIFIED"`. This separation does not enable live mutations. LIMIT volume is the caller's base `quantity`; MARKET volume is the caller's quote `quoteQuantity`, with no price-based conversion.

For state-changing Bitunix REST calls, an HTTP-success response with an unusable API envelope (malformed payload, invalid exchange code, or missing required message) is classified as `outcomeUnknown`. An explicit non-zero exchange response code remains a definitive exchange rejection. Callers must reconcile uncertain mutations and must never retry them blindly.

### Bitunix Spot deposit and withdrawal diagnostics

When credentials are configured, the read-only diagnostic runner also exercises `getDeposits({ limit: 1 })` and `getWithdrawalHistory({ limit: 1 })` through the public Broker facade. These are single bounded page probes only; they do not establish complete history. Reports retain structural schema observations and never persist deposit amounts, withdrawal amounts, addresses, transaction hashes, or record values. Public-only mode skips both private reads.

## Bitunix USDT Futures

The `bitunix-futures` provider is a separate USDT-margined Futures adapter. Do not infer Futures order, position or TP/SL behavior from Bitunix Spot.

**Status: broad provider-specific read and mutation functionality implemented; NOT PRODUCTION READY.** See the [Futures reference audit](./docs/bitunix-futures-reference-audit.md), [Broker API status matrix](./BROKER_API.md#bitunix-usdt-futures-provider--implementation-status), and [tracking issue #1805](https://github.com/45s/coinzilla/issues/1805).

### Implemented reads

- Contract catalog, ticker/mark price, REST depth and closed REST candles.
- Exact USDT balance projection; current and historical positions.
- Position mode, leverage/margin mode and authenticated trading-settings reads.
- Current/batch/historical funding rates and position tiers.
- Canonical order detail/history and bounded canonical `getFills()`; raw Futures trade history preserves fee and realized-PnL fields.
- Provider-specific pending orders, pending TP/SL groups and historical TP/SL pages.
- Public trade/book-ticker subscriptions and authenticated private balance/position/order/TP-SL observations.

Canonical fills are limited to one bounded page per call. Quote notional uses exact decimal arithmetic; commission denomination remains UNKNOWN because the exchange response omits fee asset. No complete account-wide execution-history guarantee is claimed.

### Implemented mutations

- `createFuturesOrder()`: explicit MARKET/LIMIT Futures order semantics, caller client identity, exact market-filter checks and attached TP/SL creation fields.
- `modifyFuturesOrder()`: identified pending LIMIT order modification with exact quantity and price.
- `cancelOrder()` and `cancelAllOpenOrders()`: one-shot cancellation, matching private CLOSE events and REST readback.
- `closeFuturesPosition()`, `closeFuturesPositionBySide()` and `closeAllFuturesPositions()`: exact position preflight, explicit account-wide confirmation, one-shot dispatch and REST post-readback.
- `placeFuturesPositionTpSlOrder()` and `modifyFuturesPositionTpSlOrder()`: position-level TP/SL operations confirmed by matching private CREATE/UPDATE events.
- `cancelFuturesPositionTpSlOrder()` and `cancelFuturesTpSlOrder()`: cancellation outcome is derived from the matching private CLOSE status.
- `setFuturesLeverage()`, `setFuturesMarginMode()` and `setFuturesPositionMode()`: explicit account-mutation opt-in, no-exposure preflight and REST configuration readback.

Order-level TP/SL placement/modification remains unsupported because the documented child-order API does not establish a reduce-only/close-position guarantee. `adjustFuturesPositionMargin()` remains unsupported because no documented endpoint was found.

### Mutation safety and recovery

All LIVE mutation flags default to false:

- `providerOptions.allowLiveOrderMutations`
- `providerOptions.allowLivePositionMutations`
- `providerOptions.allowLiveAccountMutations`

Order and position mutations require an authenticated private user-data session and caller-acknowledged REST reconciliation. Consumers must reconcile balances, positions, pending orders and TP/SL orders before calling:

```js
await broker.acknowledgeUserDataReconciliation({
  reconciliationCompleted: true,
})
```

The acknowledgement is a consumer attestation only. Private observations are not authoritative or replayable; the protocol has no documented monotonic event sequence or replay cursor. Disconnect, reconnect and unsubscribe reset readiness. State-changing requests are one-shot, marked `stateChanging: true`, and never automatically retried. Lost acknowledgements, missing/mismatched private events and uncertain readback remain UNKNOWN.

### Remaining blockers

- Bitunix Futures has no TESTNET. Automated verification remains offline; LIVE mutation tests are prohibited.
- Private events remain non-authoritative and non-replayable; no gap-free session or process-restart recovery guarantee exists.
- Account snapshots, server time, complete account-wide fill history and common Spot-shaped Futures order projections remain unsupported/unknown where the documented contract cannot satisfy the common API.
- Order-level TP/SL place/modify and isolated-position-margin adjustment remain unsupported for the documented reasons above.

No LIVE Futures mutation was performed by implementation work or ordinary CI. Keep this provider out of production execution and Harvester routing until external recovery guarantees and final acceptance are complete; no TESTNET prerequisite exists for this LIVE-only provider.
