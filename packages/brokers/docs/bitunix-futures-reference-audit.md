# Bitunix USDT Futures — external reference audit

**Status:** living engineering reference
**Tracking:** [issue #1805](https://github.com/45s/coinzilla/issues/1805) · [PR #1806](https://github.com/45s/coinzilla/pull/1806)
**Scope:** Bitunix USDT-margined Futures REST, account/trading settings, orders/positions/TP-SL, market data, and WebSocket channels.
**Authority:** Current official Bitunix Futures API documentation is authoritative. Third-party SDKs and official demos are corroborating implementation evidence, not protocol authority.

This audit is separate from the Bitunix Spot reference audit. Futures endpoints, semantics and models must not be inferred from Spot behavior. The current repository contains a Binance Spot Broker implementation but no Binance Futures provider implementation; there is no Binance Futures code to compare or copy. Binance Spot is used only as a reference for the shared Broker contract and its conformance patterns.

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
- [Single Futures account](https://www.bitunix.com/api-docs/futures/account/get_single_account.html)
- [Futures trading settings](https://www.bitunix.com/api-docs/futures/account/get_trading_settings.html)
- [Get position mode](https://www.bitunix.com/api-docs/futures/account/get_position_mode.html)
- [Get leverage and margin mode](https://www.bitunix.com/api-docs/futures/account/get_leverage_and_margin_mode.html)
- [Change position mode](https://www.bitunix.com/api-docs/futures/account/change_position_mode.html)
- [Change margin mode](https://www.bitunix.com/api-docs/futures/account/change_margin_mode.html)
- [Change leverage](https://www.bitunix.com/api-docs/futures/account/change_leverage.html)
- [Adjust position margin](https://www.bitunix.com/api-docs/futures/account/adjust_position_margin.html)
- [Current funding rate](https://www.bitunix.com/api-docs/futures/market/get_funding_rate.html)
- [Batch funding rates](https://www.bitunix.com/api-docs/futures/market/get_funding_rate_batch.html)
- [Funding-rate history](https://www.bitunix.com/api-docs/futures/market/get_funding_rate_history.html)
- [Position tiers](https://www.bitunix.com/api-docs/futures/position/get_position_tiers.html)
- [Close all positions](https://www.bitunix.com/api-docs/futures/trade/close_all_position.html)
- [Flash close position](https://www.bitunix.com/api-docs/futures/trade/flash_close_position.html)
- [Batch Futures orders](https://www.bitunix.com/api-docs/futures/trade/batch_order.html)
- [Place TP/SL order](https://www.bitunix.com/api-docs/futures/tp_sl/place_tp_sl_order.html)
- [Place position TP/SL](https://www.bitunix.com/api-docs/futures/tp_sl/place_position_tp_sl_order.html)
- [Modify TP/SL order](https://www.bitunix.com/api-docs/futures/tp_sl/modify_tp_sl_order.html)
- [Modify position TP/SL](https://www.bitunix.com/api-docs/futures/tp_sl/modify_position_tp_sl_order.html)
- [Cancel TP/SL order](https://www.bitunix.com/api-docs/futures/tp_sl/cancel_tp_sl_order.html)
- [Pending TP/SL orders](https://www.bitunix.com/api-docs/futures/tp_sl/get_pending_tp_sl_order.html)
- [TP/SL history](https://www.bitunix.com/api-docs/futures/tp_sl/get_history_tp_sl_order.html)
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

The current adapter has distinct Futures configuration and signing, public market catalog/tickers/depth/REST candles, exact USDT balance projection, canonical order detail/history, provider-specific pending-order and TP/SL pending-order reads, current/historical position projections, position-mode and leverage/margin-mode reads, bounded raw execution-history pages, canonical bounded Fill projection, and public/private WebSocket observations.

### Common Broker contract gaps

These are implementation gaps or deliberate common-contract exclusions—not absent Futures endpoints:

| Common operation | Futures source evidence | Current Coinzilla state and reason |
|---|---|---|
| `getOpenOrders()` | `GET /api/v1/futures/trade/get_pending_orders` exists and JKorf exposes it. | Common legacy `Order[]` is unsupported; it cannot preserve Futures position/trade-side semantics and exact decimal guarantees. Exact provider-specific rows remain available through `getFuturesPendingOrders()`. |
| `getAccountSnapshot()` | Account REST and private balance/position channels exist. | Unsupported/unknown until a timestamped, consistent account snapshot contract and cross-resource consistency are established. A local receipt time is not exchange source time. |
| `getServerTime()` | No verified Futures server-time endpoint was found in the inspected interfaces or official Node demo. | Unknown/unsupported; do not synthesize server time from local time or an unrelated ticker timestamp. |
| `getOrder()` / `getOrderHistory()` legacy projections | Futures detail and history endpoints exist; canonical Coinzilla read methods are implemented. | Legacy compatibility methods remain unsupported until their numeric/order-state mapping can preserve the existing legacy contract without fabricating market-order prices or identities. |
| `getMyTrades()` / `getFills()` | `GET /api/v1/futures/trade/get_history_trades` returns stable `tradeId` and `orderId`, exact `qty`/`price`, `roleType`, `fee`, `realizedPNL` and `ctime`. | `getFills()` is supported for one bounded page: quote notional is derived with exact decimal multiplication, maker/taker and execution identity are preserved, and `commissionStatus` remains `UNKNOWN` because the fee asset is absent. `getMyTrades()` remains an unsupported legacy projection; raw fee and realized PnL remain available through `getFuturesTradeHistory()`. Complete account-wide history/retention is not claimed. |
| `createOrder()` / `createCanonicalOrder()` | Place-order endpoint and full Futures-specific fields exist: `tradeSide`, `positionId`, `reduceOnly`, `clientId`, `effect`, and optional attached TP/SL parameters. | Common Spot-shaped methods remain unsupported because they cannot express all Futures semantics. Provider-specific `createFuturesOrder()` is implemented behind `allowLiveOrderMutations: true`, requires explicit Futures fields and exact market-filter validation, and reconciles by client ID without retrying. Its live mutation path is not production-ready until the private user-data readiness/reconciliation gate and event-confirmation requirements are enforced. |
| `cancelOrder()` | Cancel-one endpoint exists; JKorf exposes it. Official documentation warns that a successful interface response is not necessarily a successful cancellation and identifies the private order push as the accurate result. | Implemented behind `allowLiveOrderMutations: true`: exact pending-order preflight, stable `clientId` requirement, one-shot `stateChanging: true` POST, response-list validation and final detail readback. No blind retry. REST readback is not a substitute for the documented private-event confirmation; the readiness/event gate remains a production blocker. |
| `cancelAllOpenOrders()` | Cancel-all endpoint exists and accepts an optional symbol; JKorf exposes it. | Implemented behind `allowLiveOrderMutations: true`: optional symbol or account-wide one-shot request, pending-count preflight, response-list validation and final pending-count readback. Lost acknowledgements are not retried; unresolved outcomes remain unknown. Caller must enforce single-writer ownership. The documented private-event confirmation and readiness gate remain production blockers. |
| Modify order | `POST /api/v1/futures/trade/modify_order` exists; JKorf exposes EditOrder. The endpoint supports quantity, limit price and attached TP/SL fields. | Provider-specific `modifyFuturesOrder()` is implemented for an identified pending LIMIT order and requires both exact quantity and price. Attached TP/SL modification is not yet exposed. Acknowledgement/readback mismatches remain `OUTCOME_UNKNOWN`; private order-event confirmation and the readiness gate remain production blockers. |
| Close position | Close-one and close-all endpoints exist; JKorf exposes both. | Provider-specific mutation not implemented; requires explicit position identity/symbol scope and final-state reconciliation. |
| TP/SL mutation | Futures order placement accepts attached TP/SL fields; separate order-level and position-level place/modify/cancel/history endpoints also exist. | Attached TP/SL fields are supported by `createFuturesOrder()`. Pending TP/SL reads are implemented. Separate position-level TP/SL, modification, cancellation and TP/SL history operations remain incomplete. |
| Position/account settings writes | Set position mode, set margin mode, set leverage and adjust margin endpoints exist. | Current adapter is read-only for these settings. Mutations require account-mutation opt-in, state preconditions and post-write verification. |
| Funding and position tiers | Current and historical funding, and position-tier endpoints exist. | Provider-specific read extensions not implemented; they are not currently part of the common Broker contract. |

The absence of a verified isolated Futures TESTNET prohibits mutation integration tests against LIVE. It does **not** erase the documented endpoint surface: offline request/response tests can be written, but state-changing methods must remain disabled until their one-shot dispatch, private user-data readiness/reconciliation gate, event-based confirmation, read-after-write checks and unknown-outcome behavior are complete and the safety limitation is explicitly reviewed.

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

1. Gate every order-changing operation on explicit live-mutation opt-in **and** an authenticated private user-data session whose recovery state has been acknowledged only after the consumer's REST reconciliation. Keep observations non-authoritative and non-replayable; reconnect must reset readiness.
2. Confirm placement, modification and cancellation from matching private order-channel events where the official API identifies those events as the accurate operation result. A missing event, disconnect or mismatched payload remains `OUTCOME_UNKNOWN`; never retry a dispatched mutation.
3. Complete LIMIT modification with the documented attached TP/SL fields, exact preflight and final-state verification.
4. Implement position close/close-all, separate TP/SL place/modify/cancel/history, batch order operations, and account setting/margin mutations only with explicit scope, one-shot dispatch, readiness gates and verified postconditions.
5. Add read-only current/historical funding rates, position tiers and trading settings from their documented endpoints, with exact DTO validation and pagination/rate-limit tests.
6. Keep common Spot-shaped `createOrder()`, `getOrder()`, `getOpenOrders()` and legacy projections unsupported where they cannot preserve Futures identity, exact decimals or open/close semantics. Keep provider-specific typed operations explicit rather than fabricating a canonical mapping.
7. Preserve `READ_FILLS` as bounded-page support only; keep complete-history, account-snapshot freshness, server-time, event replay and process-restart recovery UNKNOWN until source guarantees and reconciliation coverage are proven.

No external SDK, demo, or reference implementation is a Coinzilla runtime dependency.
