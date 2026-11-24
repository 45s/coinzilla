# Bitunix USDT Futures — external reference audit

**Status:** living engineering reference  
**Tracking:** [issue #1805](https://github.com/45s/coinzilla/issues/1805) · [PR #1806](https://github.com/45s/coinzilla/pull/1806)  
**Scope:** Bitunix USDT-margined Futures REST, account/trading settings, orders/positions/TP-SL, market data, and WebSocket channels.  
**Authority:** Current official Bitunix Futures API documentation is authoritative. Third-party SDKs and official demos are corroborating implementation evidence, not protocol authority.

This audit is separate from the Bitunix Spot reference audit. Futures endpoints, semantics and models must not be inferred from Spot behavior.

## 1. Sources inspected

### Official specification and examples

- [Futures API introduction](https://www.bitunix.com/api-docs/futures/common/introduction.html)
- [Futures signing](https://www.bitunix.com/api-docs/futures/common/sign.html)
- [Place Futures order](https://www.bitunix.com/api-docs/futures/trade/place_order.html)
- [Modify Futures order](https://www.bitunix.com/api-docs/futures/trade/modify_order.html)
- [Cancel Futures orders](https://www.bitunix.com/api-docs/futures/trade/cancel_orders.html)
- [Pending Futures orders](https://www.bitunix.com/api-docs/futures/trade/get_pending_orders.html)
- [Futures order history](https://www.bitunix.com/api-docs/futures/trade/get_history_orders.html)
- [Futures execution history](https://www.bitunix.com/api-docs/futures/trade/get_history_trades.html)
- [Futures private WebSocket](https://www.bitunix.com/api-docs/futures/websocket/prepare/WebSocket.html)
- Official repository, immutable inspected revision: [BitunixOfficial/open-api @ 0be792c](https://github.com/BitunixOfficial/open-api/tree/0be792c3a98a2706d22e5d1a9742f448f11f3347)
  - [Node private HTTP client](https://github.com/BitunixOfficial/open-api/blob/0be792c3a98a2706d22e5d1a9742f448f11f3347/Demo/Node/openApiHttpFuturePrivate.js)
  - [Node public HTTP client](https://github.com/BitunixOfficial/open-api/blob/0be792c3a98a2706d22e5d1a9742f448f11f3347/Demo/Node/openApiHttpFuturePublic.js)
  - [Node private WebSocket client](https://github.com/BitunixOfficial/open-api/blob/0be792c3a98a2706d22e5d1a9742f448f11f3347/Demo/Node/openApiWsFuturePrivate.js)
  - [Node public WebSocket client](https://github.com/BitunixOfficial/open-api/blob/0be792c3a98a2706d22e5d1a9742f448f11f3347/Demo/Node/openApiWsFuturePublic.js)
  - [Node demo README](https://github.com/BitunixOfficial/open-api/blob/0be792c3a98a2706d22e5d1a9742f448f11f3347/Demo/Node/README.md)

### Primary third-party behavioral reference

- [JKorf/Bitunix.Net, immutable inspected revision e138b8e](https://github.com/JKorf/Bitunix.Net/tree/e138b8eed0ad068959fb303e131d120f6dffe91b)
- [Futures trading interface](https://github.com/JKorf/Bitunix.Net/blob/e138b8eed0ad068959fb303e131d120f6dffe91b/Bitunix.Net/Interfaces/Clients/FuturesApi/IBitunixRestClientFuturesApiTrading.cs)
- [Futures trading implementation](https://github.com/JKorf/Bitunix.Net/blob/e138b8eed0ad068959fb303e131d120f6dffe91b/Bitunix.Net/Clients/FuturesApi/Rest/BitunixRestClientFuturesApiTrading.cs)
- [Futures account interface](https://github.com/JKorf/Bitunix.Net/blob/e138b8eed0ad068959fb303e131d120f6dffe91b/Bitunix.Net/Interfaces/Clients/FuturesApi/IBitunixRestClientFuturesApiAccount.cs)
- [Futures account implementation](https://github.com/JKorf/Bitunix.Net/blob/e138b8eed0ad068959fb303e131d120f6dffe91b/Bitunix.Net/Clients/FuturesApi/Rest/BitunixRestClientFuturesApiAccount.cs)
- [Futures market-data interface](https://github.com/JKorf/Bitunix.Net/blob/e138b8eed0ad068959fb303e131d120f6dffe91b/Bitunix.Net/Interfaces/Clients/FuturesApi/IBitunixRestClientFuturesApiExchangeData.cs)
- [Futures WebSocket implementation](https://github.com/JKorf/Bitunix.Net/blob/e138b8eed0ad068959fb303e131d120f6dffe91b/Bitunix.Net/Clients/FuturesApi/Socket/BitunixSocketClientFuturesApi.cs)
- [Futures REST request-validation tests](https://github.com/JKorf/Bitunix.Net/blob/e138b8eed0ad068959fb303e131d120f6dffe91b/Bitunix.Net.UnitTests/RestRequestTests.cs)
- [Futures REST integration tests](https://github.com/JKorf/Bitunix.Net/blob/e138b8eed0ad068959fb303e131d120f6dffe91b/Bitunix.Net.UnitTests/BitunixRestIntegrationTests.cs)
- [Futures shared API surface inventory](https://github.com/JKorf/Bitunix.Net/blob/e138b8eed0ad068959fb303e131d120f6dffe91b/.claude/skills/bitunix-net/references/api-surfaces.md)

## 2. Futures surface found in JKorf

The inspected interface exposes materially more than the current Coinzilla adapter:

| Surface | JKorf operations found |
|---|---|
| Orders | Place, edit, cancel one/many/all, close one/all positions, get detail, get pending/open orders, get order history, get user trades |
| Positions | Current positions, historical positions |
| TP/SL | Place order-level TP/SL, place position TP/SL, cancel TP/SL, pending TP/SL, TP/SL history |
| Account | Balances, trading settings, position mode, leverage/margin-mode reads; set position mode, set margin mode, set leverage, adjust isolated-position margin |
| Market | Tickers, depth, klines, symbols, current and historical funding rates, position tiers |
| WebSocket shared API | Trades, ticker, klines, order book, funding info, mark price, index price, balances, Futures orders and positions |

The interface documents these Futures paths directly. The REST implementation also sets per-endpoint request guards (for example, order placement, cancellation and close-position operations have distinct limits). Coinzilla must not infer a single universal exchange limit from the SDK defaults; use current official endpoint limits when implementing pacing.

The JKorf request-validation suite exercises order placement/edit/cancel/cancel-all, close position, order detail/history/open orders, user trades, current/historical positions, TP/SL placement/cancel and several market/account reads. The TP/SL history request-validation line is commented out in the inspected test file. Its separate integration suite is not a substitute for Coinzilla's deterministic offline tests and must not be run against LIVE by this task.

## 3. Official Node demo findings and limitations

- The private HTTP demo exposes account read, order placement, cancel orders, order history and current/historical position reads. It does not provide a complete Futures client. Its `placeOrder` helper defaults `tradeSide` to `OPEN`, `effect` to `GTC` and `reduceOnly` to `false`; Coinzilla must not copy these implicit risk-bearing defaults. Callers must supply and validate Futures semantics explicitly.
- The public HTTP demo exposes tickers, depth, klines and batch funding rates. The README describes symbol information, but the inspected public client source has no symbol-catalog method; use the official endpoint contract and the JKorf interface for that surface.
- The private WebSocket demo subscribes to `balance`, `position`, `order` and `tpsl`. It sends login and immediately sends subscriptions from the socket-open handler without waiting for a login acknowledgement. Coinzilla's authentication-ack gate is deliberately stricter.
- The public WebSocket demo handles `trade`, `ticker` and `depth_book1`; it does not demonstrate Kline, mark-price or index-price subscriptions. The Node demos reconnect but do not establish replay cursors, sequence-gap detection or complete REST reconciliation. Reconnect is not recovery.
- The demo is example code, not a production safety contract. Its console logging, generic errors, default trading parameters and reconnect behavior are not copied as Coinzilla policy.

## 4. Consequences for the current adapter

### Implemented provider-specific reads

The current adapter has distinct Futures configuration and signing, public market catalog/tickers/depth/REST candles, exact USDT balance projection, canonical order detail/history, provider-specific pending-order and TP/SL pending-order reads, current/historical position projections, position-mode and leverage/margin-mode reads, bounded raw execution-history pages, and public/private WebSocket observations.

### Common Broker contract gaps

These are implementation gaps or deliberate common-contract exclusions—not absent Futures endpoints:

| Common operation | Futures source evidence | Current Coinzilla state and reason |
|---|---|---|
| `getOpenOrders()` | `GET /api/v1/futures/trade/get_pending_orders` exists and JKorf exposes it. | Common legacy `Order[]` is unsupported; it cannot preserve Futures position/trade-side semantics and exact decimal guarantees. Exact provider-specific rows remain available through `getFuturesPendingOrders()`. |
| `getAccountSnapshot()` | Account REST and private balance/position channels exist. | Unsupported/unknown until a timestamped, consistent account snapshot contract and cross-resource consistency are established. A local receipt time is not exchange source time. |
| `getServerTime()` | No verified Futures server-time endpoint was found in the inspected interfaces or official Node demo. | Unknown/unsupported; do not synthesize server time from local time or an unrelated ticker timestamp. |
| `getOrder()` / `getOrderHistory()` legacy projections | Futures detail and history endpoints exist; canonical Coinzilla read methods are implemented. | Legacy compatibility methods remain unsupported until their numeric/order-state mapping can preserve the existing legacy contract without fabricating market-order prices or identities. |
| `getMyTrades()` / `getFills()` | `GET /api/v1/futures/trade/get_history_trades` exists; JKorf exposes user trades and raw pages. | Provider-specific raw history is implemented. Canonical Fill remains unsupported because fee-asset semantics and complete/gap-free execution history are not established. |
| `createOrder()` / `createCanonicalOrder()` | Place-order endpoint and full Futures-specific fields exist: `tradeSide`, `positionId`, `reduceOnly`, `clientId`, `effect`, and optional TP/SL parameters. | Not implemented. The common order entities do not carry the required Futures position/open-close semantics. A provider-specific typed operation is required; no ambiguous defaults may be introduced. |
| `cancelOrder()` / `cancelAllOpenOrders()` | Cancel-one/many/all endpoints exist; JKorf exposes each. | Not implemented. Must add one-shot state-changing dispatch, explicit opt-in, result-list validation, final-state readback and unknown-outcome handling before capability can be enabled. |
| Modify order | `POST /api/v1/futures/trade/modify_order` exists; JKorf exposes EditOrder. | Provider-specific extension not implemented; not a common Broker method. Requires exact identity, quantity/price validation, one-shot dispatch and readback. |
| Close position | Close-one and close-all endpoints exist; JKorf exposes both. | Provider-specific mutation not implemented; requires explicit position identity/symbol scope and final-state reconciliation. |
| TP/SL mutation | Futures TP/SL place, position TP/SL, cancel and history endpoints exist. | Pending TP/SL reads are implemented; mutation and TP/SL history coverage remain incomplete. |
| Position/account settings writes | Set position mode, set margin mode, set leverage and adjust margin endpoints exist. | Current adapter is read-only for these settings. Mutations require account-mutation opt-in, state preconditions and post-write verification. |
| Funding and position tiers | Current and historical funding, and position-tier endpoints exist. | Provider-specific read extensions not implemented; they are not currently part of the common Broker contract. |

The absence of a verified isolated Futures TESTNET prohibits mutation integration tests against LIVE. It does **not** erase the documented endpoint surface: offline request/response tests can be written, but state-changing methods must remain disabled until their one-shot dispatch, readiness gates, reconciliation and final-state verification are complete and the safety limitation is explicitly reviewed.

## 5. Protocol and model invariants

- Keep `qty`, `price`, fees, funding, margin and PnL values as exact decimal strings at the provider boundary. Never use JavaScript `Number` for financial arithmetic or silently round exchange values.
- Require explicit Futures position semantics. Do not default `tradeSide` to OPEN, assume one-way mode, infer close intent from BUY/SELL, or drop `positionId` / `reduceOnly`.
- Distinguish order state, execution/fill state, position state, fee, funding and realized/unrealized PnL. An order update is not a fill; a position delta is not an execution.
- Preserve stable exchange `orderId`, caller `clientId`, `positionId` and execution `tradeId` separately. Do not synthesize missing client IDs or execution IDs.
- The private stream's balance/position/order/TP-SL messages are observations. Without a documented replay cursor and proven REST coverage, reconnect must leave recovery required.
- A dispatched mutation with lost acknowledgement, timeout or malformed response is an unknown outcome. Never blindly retry; reconcile by stable order/position identity.
- The official Node demo's immediate subscribe-after-login-send is not proof that subscription is accepted before authentication acknowledgement. Keep Coinzilla's login acknowledgement gate.
- A WebSocket event timestamp is not automatically a candle open time, account source timestamp or sequence number.

## 6. Next implementation order

1. Add provider-specific typed Futures order inputs that explicitly represent side, order type, quantity, limit price, trade side, position ID, reduce-only, effect, client ID and optional TP/SL parameters; keep common canonical placement unsupported until its domain contract can express those fields safely.
2. Implement one-shot order placement and modify/cancel operations behind explicit opt-in and strict readiness gates, with deterministic offline tests for request construction, validation, rejection, timeout-after-dispatch, acknowledgement loss, response correlation and final-state readback. Do not use LIVE integration tests.
3. Implement position close, TP/SL mutations and account-setting writes with the same one-shot/unknown-outcome discipline and post-write verification.
4. Resolve open-order common projection semantics or retain the explicit unsupported status while keeping the provider-specific pending-order API.
5. Resolve canonical Fill fee-asset/completeness semantics and account snapshot freshness before enabling canonical Fill/account capabilities.
6. Add read-only funding-rate, position-tier and trading-settings extensions only if a concrete Broker consumer needs them; avoid exposing an unbounded copy of every exchange endpoint.
7. Keep private stream recovery UNKNOWN until sequence/replay or a complete REST reconciliation contract is documented and tested.

No external SDK, demo, or reference implementation is a Coinzilla runtime dependency.
