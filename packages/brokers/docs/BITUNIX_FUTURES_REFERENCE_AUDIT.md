# Bitunix USDT Futures reference audit

- Status: Active implementation evidence
- Owner: Brokers
- Tracking: [issue #1805](https://github.com/45s/coinzilla/issues/1805) / [Draft PR #1806](https://github.com/45s/coinzilla/pull/1806)
- Last reviewed: 2026-11-24
- Product scope: USDT-margined Futures only; this is not Spot protocol evidence.

## Authority and source order

1. **Official Bitunix Futures API documentation** is the protocol authority.
2. **BitunixOfficial/open-api Node demo** is an official implementation reference, but documentation remains authoritative when demo behavior conflicts with the written contract.
3. **JKorf/Bitunix.Net** is an independent third-party implementation reference. It is useful for discovering request/response models and supported operations; it is not proof of exchange guarantees.
4. Fixtures and local tests prove Coinzilla adapter behavior only. They do not prove undocumented exchange behavior or LIVE readiness.

## Official documentation

- [Futures API introduction](https://www.bitunix.com/api-docs/futures/common/introduction.html)
- [REST and WebSocket signing](https://www.bitunix.com/api-docs/futures/common/sign.html)
- [Trading pairs](https://www.bitunix.com/api-docs/futures/market/get_trading_pairs.html)
- [Tickers](https://www.bitunix.com/api-docs/futures/market/get_tickers.html)
- [Depth](https://www.bitunix.com/api-docs/futures/market/get_depth.html)
- [Klines](https://www.bitunix.com/api-docs/futures/market/get_kline.html)
- [Single account](https://www.bitunix.com/api-docs/futures/account/get_single_account.html)
- [Pending positions](https://www.bitunix.com/api-docs/futures/position/get_pending_positions.html)
- [Position history](https://www.bitunix.com/api-docs/futures/position/get_history_positions.html)
- [Position mode](https://www.bitunix.com/api-docs/futures/account/get_position_mode.html)
- [Leverage and margin mode](https://www.bitunix.com/api-docs/futures/account/get_leverage_and_margin_mode.html)
- [Place order](https://www.bitunix.com/api-docs/futures/trade/place_order.html)
- [Pending orders](https://www.bitunix.com/api-docs/futures/trade/get_pending_orders.html)
- [Order detail](https://www.bitunix.com/api-docs/futures/trade/get_order_detail.html)
- [Order history](https://www.bitunix.com/api-docs/futures/trade/get_history_orders.html)
- [Trade history](https://www.bitunix.com/api-docs/futures/trade/get_history_trades.html)
- [WebSocket protocol](https://www.bitunix.com/api-docs/futures/websocket/prepare/WebSocket.html)
- [Private balance channel](https://www.bitunix.com/api-docs/futures/websocket/private/Balance%20Channel.html)
- [Private order channel](https://www.bitunix.com/api-docs/futures/websocket/private/Order%20Channel.html)
- [Private position channel](https://www.bitunix.com/api-docs/futures/websocket/private/Position%20Channel.html)
- [Public market-price channel](https://www.bitunix.com/api-docs/futures/websocket/public/MarketPrice%20Channel.html)

Some documentation URLs may be renamed by Bitunix. If a page moves, update this audit with the current official link; do not silently replace official evidence with a third-party mirror.

## Official protocol facts

### REST authentication

- REST requests use the Futures REST host `https://fapi.bitunix.com`.
- Required authentication headers are `api-key`, `nonce`, `timestamp`, and `sign`.
- REST timestamp is Unix epoch **milliseconds** and must be within 60 seconds of server time.
- Nonce is a random string (documented as 64 bits).
- Query keys are sorted in ascending ASCII order and concatenated as key/value pairs without separators.
- The request body is compact JSON; the exact transmitted body bytes must match the bytes included in the signature.
- Signature is double SHA-256: `SHA256(SHA256(nonce + timestamp + apiKey + queryParams + body) + secretKey)`.
- The Futures REST client performs one request only. It never retries a mutation after a timeout, response loss or ambiguous HTTP status.

### WebSocket authentication and limits

- Public endpoint: `wss://fapi.bitunix.com/public/`.
- Private endpoint: `wss://fapi.bitunix.com/private/`.
- The dedicated Futures WebSocket page specifies Unix epoch **seconds** for login timestamp and ping timestamp.
- The WebSocket signature sorts all login params except `sign`, concatenates key/value pairs, then applies the same double-SHA256 construction.
- The server accepts at most 5 client messages per second and 300 channel subscriptions per connection.
- Ping is a JSON operation with a seconds-format timestamp; do not substitute a WebSocket control-frame ping for the documented application message.
- Private push channels include balance, order and position. Their presence does not establish sequence numbers, replay, gap detection or durable fill completeness.

### Trading-pair precision and market constraints

The official trading-pair catalog exposes fields such as `basePrecision`, `quotePrecision`, `minTradeVolume`, maximum order volumes, and price-offset limits. The precision fields describe decimal precision; they are not documented as discrete quantity steps or price ticks. Do not derive `stepSize` or `tickSize` from them. `minTradeVolume` is a base-asset quantity, and price offsets are not minimum quote notional. Preserve the raw contract metadata and map only fields with explicit units/semantics.

### Futures order semantics

- Futures order requests have Futures-specific fields including `clientId`, `tradeSide`, `positionId`, `reduceOnly`, and position/margin context.
- One-way and hedge modes have different request semantics. Do not invent a default mode or translate Spot BUY/SELL semantics directly into Futures open/close behavior.
- In hedge mode, `tradeSide` distinguishes OPEN and CLOSE; close requests are associated with the position identity and side semantics described by the Futures order page.
- `clientId` is a client-supplied identity and must be preserved for unknown-outcome reconciliation where the order-detail endpoint supports it.
- Margin mode, leverage and position mode are account-level state. They are not inferred from a market symbol and must be changed only through separately gated operations.

### REST depth semantics

- Public depth is read from `GET /api/v1/futures/market/depth` with a symbol and a documented depth limit (`1`, `5`, `15`, `50`, or `max`). The endpoint is rate-limited to 10 requests/second/IP.
- The response contains `asks` and `bids` price/quantity pairs. The schema describes string values while the example body emits JSON numbers. Parsing those numbers through JavaScript `Number` can round valid exchange decimals; the Futures REST client quotes numeric tokens in these arrays before JSON parsing.
- The REST depth response does not provide a verified source timestamp or sequence. It is a point-in-time snapshot, not a gap-free stream.

### Account balance semantics

- The Futures account response separates `available`, `frozen`, and `margin`.
- The current adapter maps `available` to canonical free funds and combines `frozen + margin` as locked funds using exact decimal arithmetic.
- Promotional `bonus` is excluded from custody balance.
- The response does not currently establish the source timestamp/version required for the common authoritative `getAccountSnapshot()` contract. Do not label this balance read as a fresh account snapshot.

## Reference implementation inspection

### Official Node demo

Repository: [BitunixOfficial/open-api](https://github.com/BitunixOfficial/open-api)

Inspected Futures files:

- `Demo/Node/openApiHttpSign.js`
- `Demo/Node/openApiHttpFuturePrivate.js`
- `Demo/Node/openApiWsSign.js`
- `Demo/Node/openApiWsFuturePrivate.js`

Use these files to cross-check request construction and signature examples. They are examples, not a replacement for the endpoint-specific docs.

### JKorf/Bitunix.Net

Repository: [JKorf/Bitunix.Net](https://github.com/JKorf/Bitunix.Net)

Inspected Futures source:

- `Bitunix.Net/Clients/FuturesApi/Rest/BitunixRestClientFuturesApiTrading.cs`
- `Bitunix.Net/Clients/FuturesApi/Rest/BitunixRestClientFuturesApiAccount.cs`
- `Bitunix.Net/Clients/FuturesApi/Rest/BitunixRestClientFuturesApiExchangeData.cs`
- Futures socket client and Futures model surfaces in the repository tree.

The library is used as a secondary discovery/reference source. It does not establish exchange guarantees about history completeness, event replay, source timestamps, or safe unknown-outcome recovery.

## Discrepancies and unresolved evidence

1. **WebSocket timestamp example discrepancy:** the generic signing page's WebSocket example shows a 13-digit timestamp, while the dedicated Futures WebSocket protocol page explicitly says seconds and gives a 10-digit example. The dedicated protocol page is the more specific source; implementation uses seconds for WS login/ping and milliseconds for REST. Keep this discrepancy visible.
2. **No isolated Futures TESTNET endpoint verified:** the public Futures docs and official demo inspected here use the production Futures host. Do not infer a TESTNET endpoint from Spot docs, a third-party SDK, or a generic demo account description.
3. **Private WebSocket recovery:** the documented private channels do not establish replay cursors, monotonic sequence numbers, or gap-recovery guarantees. Private messages are observations; after reconnect the provider must reconcile with REST and must not claim a gap-free event ledger.
4. **Fill-history completeness:** trade-history rows expose execution identity and accounting fields, but the docs inspected so far do not establish retention, stable uniqueness across all time, or a consistent snapshot while pagination is in progress. Do not advertise complete fill history until those guarantees are evidenced.
5. **Account snapshot freshness:** the account response has no verified source timestamp/version. Keep common `getAccountSnapshot()` unsupported.
6. **Unknown mutation outcomes:** no automated LIVE order/cancel/account-setting tests are permitted. Implement offline fake-transport tests for one-shot dispatch, outcome classification and no retry. No LIVE request is made by the agent.

## Coinzilla implementation status

- [x] Separate `bitunix-futures` provider registration and public Broker facade.
- [x] Explicit LIVE-only configuration; no implicit environment selection.
- [x] LIVE order/account mutation flags default to false.
- [x] Signed REST transport, injected fetch/clock/nonce dependencies, explicit POST mutation-state declaration and no retries.
- [x] Public trading-pair catalog mapping with OPEN/API-supported filtering.
- [x] Private USDT account-balance mapping with exact decimal arithmetic.
- [x] Public ticker price and closed kline reads.
- [x] Lossless REST depth/order-book reads and raw symbol-filter metadata.
- [x] Public one-shot ticker prices (`lastPrice`, `markPrice`) and closed kline reads with exact decimals and interval-derived close time.
- [x] REST depth/order-book reads with lossless numeric-token parsing and explicit no-source-timestamp limitation.
- [x] Raw Futures trading-pair metadata; no tick/step increments are inferred from decimal precision fields.
- [ ] Pending/history orders, canonical order mapping and clientId-based unknown-outcome reconciliation.
- [ ] Position reads/history/tiers and explicit account position/leverage/margin controls.
- [ ] Canonical fill mapping only after identity/completeness evidence is sufficient.
- [ ] Order create/modify/cancel/batch/close and TP/SL operations behind explicit mutation gates.
- [ ] Public/private WebSocket clients, event mapping, heartbeat, subscription limits, reconnect and reconciliation lifecycle.
- [ ] Full capability matrix, common Broker conformance tests, package README/BROKER_API docs and exact-head CI.

No LIVE mutation has been performed by the implementation agent or automated tests. The partial provider is not production-ready and must not be used for Harvester execution or routing.

## 2026-11-24 implementation continuation

### Additional official REST contracts inspected

- [Pending orders](https://www.bitunix.com/api-docs/futures/trade/get_pending_orders.html): one page, maximum 100, sorted newest first; `orderList` plus `total`; optional `symbol`, `orderId`, `clientId`, `status`, and time bounds. LIMIT rows require `price` and `effect`; MARKET rows do not require `price`.
- [Order detail](https://www.bitunix.com/api-docs/futures/trade/get_order_detail.html): accepts at least one of `orderId` or `clientId`; response includes optional caller `clientId`, so canonical mapping must fail closed when it is absent.
- [Order history](https://www.bitunix.com/api-docs/futures/trade/get_history_orders.html): one bounded page; canceled-only query has a 3-day range, non-canceled query has a 90-day range. `PART_FILLED_CANCELED` is a distinct exchange status and maps to canonical CANCELED while retaining executed quantity.
- [Current positions](https://www.bitunix.com/api-docs/futures/position/get_pending_positions.html): `data` is an array; the endpoint can include subaccounts unless explicitly disabled. The adapter requests `includeSubAccounts=false` and preserves a returned `subAccountId`.
- [Position history](https://www.bitunix.com/api-docs/futures/position/get_history_positions.html): one `positionList` page plus total; supports `symbol` / `positionId` and create-time bounds.
- [Trade history](https://www.bitunix.com/api-docs/futures/trade/get_history_trades.html): one `tradeList` page plus total; exposes `tradeId`, `orderId`, quantity, price, fee, realized PnL, timestamp and liquidity role. It does not establish complete/gap-free execution history or fee asset semantics.
- [Pending TP/SL orders](https://www.bitunix.com/api-docs/futures/tp_sl/get_pending_tp_sl_order.html): a separate endpoint/model. The generic pending-order adapter does not treat this endpoint as equivalent to standard orders.

### Additional discrepancies

- Pending/history order and trade response examples use `type` in some examples while the response parameter table names `orderType`. The DTO adapters accept either field but normalize to `orderType`.
- TP/SL stop-type tables use `MARK_PRICE` / `LAST_PRICE`, while response examples include `MARK`. The pending-order DTO preserves the documented/example aliases instead of silently rewriting them.
- The official Futures WebSocket preparation page and official Node demo use seconds for login/ping timestamps. The inspected JKorf .NET implementation uses a millisecond timestamp helper. The provider follows the dedicated Futures protocol page and official Node demo (seconds); this discrepancy remains recorded for a live read-only verification before any stream capability is advertised.
- The official Node demo sends explicit private channel subscribe frames. The inspected JKorf private subscription abstraction does not expose a corresponding subscription query. The provider follows the explicit channel subscription protocol; no claim is made that a successful send proves server-side subscription.

### Current code increment

- [x] Strict canonical order-detail mapping by exactly one exchange order ID or caller client ID; verifies response symbol and requested identity.
- [x] Bounded canonical order history with explicit status/type/time/page filters and canceled-order status normalization. Rows missing optional exchange client identity fail closed.
- [x] Bounded pending-order page projection preserving decimal strings and TP/SL trigger fields; market orders may omit price; LIMIT trigger orders require their documented trigger price.
- [x] Current and historical Futures position projections, preserving exact financial strings, leverage/modes, timestamps and optional subaccount identity.
- [x] Account-wide position-mode and symbol leverage/margin-mode reads.
- [x] Bounded raw Futures execution history preserving trade identity, fee and realized PnL without falsely promoting it to canonical Fill.
- [x] Low-level Futures WebSocket client with public/private endpoints, login acknowledgement gating, channel validation, heartbeat and outbound rate limit.
- [ ] Broker integration for public/private WebSocket subscriptions and lifecycle cleanup.
- [ ] Bounded reconnect, resubscribe and mandatory REST reconciliation before user-data recovery.
- [ ] Canonical Fill mapping only after fee currency and history-completeness evidence are resolved.
- [ ] Safe order create/modify/cancel/close/TP-SL lifecycle and mutation-outcome reconciliation.
- [ ] Safe account-setting mutations and common Broker capability conformance.
- [ ] Exact-head unit tests, coverage and all required CI checks.

The Futures provider remains **not production-ready**. The WebSocket client is currently a low-level exported component, not a Broker stream capability. LIVE order/account mutation flags remain disabled by default. No live exchange request or mutation was performed by this implementation agent or its tests.

## 2026-11-24 — Broker stream and REST lifecycle continuation

### Implemented and covered by offline tests

- Public `trade` channel is integrated with `subscribeForPrices()`. Each trade message is validated and delivered with exact price/quantity strings, side and parsed ISO exchange trade timestamp. No stable trade ID is fabricated.
- Public `depth_book1` is integrated with `subscribeForBookTicker()`. Best bid/ask levels remain exact strings; timestamp is local receipt time because the channel does not provide a sequence or book version.
- One public WebSocket connection is shared across Broker subscriptions. Per-channel listener sets support multiple consumers; unsubscribe is idempotent and the connection closes when the final consumer releases it.
- Private `balance`, `position`, `order` and `tpsl` channels are integrated through `subscribeForUserData({ onObservation, onStatus })`. The method waits for login acknowledgement and delivers raw observation envelopes. It requires `onObservation`; it does not call `onEvent` with fake canonical events.
- Private observations carry `authoritative: false`, `replayable: false`, and `recoveryRequired: true`. Reconnect/resubscribe never clears the recovery requirement.
- Low-level WebSocket reconnect is bounded (five attempts, exponential 1s–30s backoff), reauthenticates private sessions, resubscribes desired channels, and detects missed heartbeat responses. The documented pong envelope is `op: "ping"` with a `pong` field; both this and legacy `op: "pong"` are recognized.
- REST request dispatch is serialized at 100ms intervals (10 requests/second per client), while responses may complete concurrently. The limiter reserves the dispatch slot at the actual fetch invocation so concurrent requests cannot overtake one another. It has an injectable clock/sleep function and deterministic concurrency tests.
- The common `getBalances()` method is restored with exact free/locked USDT values; promotional bonus funds are excluded. Account snapshot and server-time methods explicitly return unsupported results.

### Capability matrix updates

- [x] Public trade-price subscription and one-level book-ticker subscription are declared supported with timestamp/sequence limitations.
- [x] Private user-data observation is declared supported only as raw native observations.
- [ ] User-data recovery remains UNKNOWN because the protocol provides no replay cursor or monotonic sequence and no gap-free REST reconciliation can be proved.
- [ ] Canonical fill history remains unavailable because fee asset and completeness semantics are not established.
- [ ] Candle subscription remains unavailable because the documented kline event lacks the candle open timestamp required by the common Candle entity.
- [ ] Order/account mutations remain unsupported; LIVE mutation flags remain false by default.

### Verification notes

The implementation and regression tests are offline and use injected fake transports/fetchers. No LIVE Futures request or mutation was performed. No isolated Futures TESTNET endpoint has been verified. Production readiness remains blocked by mutation lifecycle/outcome reconciliation, authoritative account-state recovery, canonical Fill semantics, consumer integration, and all required exact-head CI checks.


### Separate pending TP/SL read endpoint

The official [Get Pending TP/SL Order](https://www.bitunix.com/api-docs/futures/tp_sl/get_pending_tp_sl_order.html) endpoint is distinct from standard pending orders: `GET /api/v1/futures/tpsl/get_pending_orders`. It accepts optional symbol/position filters and one `skip`/`limit` page (maximum 100); unlike standard order history, the response is a plain array without a total count.

The provider-specific `getFuturesPendingTpSlOrders()` extension now validates group identity, requires at least one TP/SL leg, validates each present leg's trigger price/type and quantity, and requires a positive execution price for LIMIT legs. It preserves the original row and every decimal string; it does not project the group into a canonical order or claim account-wide completeness. Four offline regression cases cover both legs, a single stop leg, malformed LIMIT legs and the page maximum.
