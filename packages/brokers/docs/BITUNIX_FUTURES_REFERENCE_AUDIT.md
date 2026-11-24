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

### Futures order semantics

- Futures order requests have Futures-specific fields including `clientId`, `tradeSide`, `positionId`, `reduceOnly`, and position/margin context.
- One-way and hedge modes have different request semantics. Do not invent a default mode or translate Spot BUY/SELL semantics directly into Futures open/close behavior.
- In hedge mode, `tradeSide` distinguishes OPEN and CLOSE; close requests are associated with the position identity and side semantics described by the Futures order page.
- `clientId` is a client-supplied identity and must be preserved for unknown-outcome reconciliation where the order-detail endpoint supports it.
- Margin mode, leverage and position mode are account-level state. They are not inferred from a market symbol and must be changed only through separately gated operations.

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
- [ ] Public tickers, depth, candles and Futures market filters.
- [ ] Pending/history orders, canonical order mapping and clientId-based unknown-outcome reconciliation.
- [ ] Position reads/history/tiers and explicit account position/leverage/margin controls.
- [ ] Canonical fill mapping only after identity/completeness evidence is sufficient.
- [ ] Order create/modify/cancel/batch/close and TP/SL operations behind explicit mutation gates.
- [ ] Public/private WebSocket clients, event mapping, heartbeat, subscription limits, reconnect and reconciliation lifecycle.
- [ ] Full capability matrix, common Broker conformance tests, package README/BROKER_API docs and exact-head CI.

No LIVE mutation has been performed by the implementation agent or automated tests. The partial provider is not production-ready and must not be used for Harvester execution or routing.
