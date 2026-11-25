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

### Endpoint-specific pacing and mutation HTTP outcomes

The official [close-all positions endpoint](https://www.bitunix.com/api-docs/futures/trade/close_all_position.html) documents a limit of **1 request/second per UID**. The official [flash-close endpoint](https://www.bitunix.com/api-docs/futures/trade/flash_close_position.html) documents **5 requests/second per UID**. Other implemented endpoints retain a conservative shared 100 ms floor (10 requests/second); this intentionally does not attempt to consume endpoints' higher 20 requests/second allowances.

The Futures REST client now serializes requests through a process-local limiter shared by clients using the same API key, with endpoint-specific minimum intervals of 1,000 ms for `close_all_position` and 200 ms for `flash_close_position`. This does **not** coordinate distinct API keys or separate processes that share a Bitunix UID/IP; callers must not assume it is an account-wide or IP-wide distributed limiter. Multi-key/multi-process deployments still need a centralized UID/IP request scheduler before production use.

HTTP status is validated before parsing the response body. This preserves the common mutation-outcome contract even when a gateway returns non-JSON content: HTTP 400/429 are definitive rejections; 408/409/5xx remain outcome-unknown; malformed successful responses after a state-changing dispatch remain outcome-unknown. The client never retries a mutation automatically.

Offline regression evidence:

- `rest-client.rate-limit.test.js` — `Bitunix Futures REST applies the documented slower limits to close-position endpoints`.
- `rest-client.test.js` — `Bitunix Futures REST classifies non-JSON HTTP mutation failures by status before parsing the body`.

## 3. Official Node demo findings and limitations

- The private HTTP demo exposes account read, order placement, cancel orders, order history and current/historical position reads. It does not provide a complete Futures client. Its `placeOrder` helper defaults `tradeSide` to `OPEN`, `effect` to `GTC` and `reduceOnly` to `false`; Coinzilla must not copy these implicit risk-bearing defaults. Callers must supply and validate Futures semantics explicitly.
- The public HTTP demo exposes tickers, depth, klines and batch funding rates. The README describes symbol information, but the inspected public client source has no symbol-catalog method; use the official endpoint contract and the JKorf interface for that surface.
- The private WebSocket demo subscribes to `balance`, `position`, `order` and `tpsl`. It sends login and immediately sends subscriptions from the socket-open handler without waiting for a login acknowledgement. Coinzilla's authentication-ack gate is deliberately stricter.
- The public WebSocket demo handles `trade`, `ticker` and `depth_book1`; it does not demonstrate Kline, mark-price or index-price subscriptions. The Node demos reconnect but do not establish replay cursors, sequence-gap detection or complete REST reconciliation. Reconnect is not recovery.
- The demo is example code, not a production safety contract. Its console logging, generic errors, default trading parameters and reconnect behavior are not copied as Coinzilla policy.

## 4. Consequences for the current adapter

### Implemented provider-specific reads

The adapter implements distinct Futures configuration/signing; public contract catalog, ticker/mark price, depth and closed REST candles; exact USDT balance projection; canonical order detail/history; provider-specific pending-order, pending TP/SL and historical TP/SL reads; current/historical positions; position-mode, leverage/margin-mode and trading-settings reads; bounded raw execution history and canonical bounded Fill projection; funding-rate current/batch/history reads; position-tier reads; and public/private WebSocket observations.

### Implemented state-changing operations

The following Futures operations are implemented as provider-specific APIs. They remain disabled by default and are not production authorization:

| Operation | Current Coinzilla behavior | Safety / remaining limitation |
|---|---|---|
| Place MARKET/LIMIT order | `createFuturesOrder()` validates explicit `tradeSide`, `reduceOnly`, `clientId`, optional `positionId`, LIMIT effect, exact decimals and symbol metadata; verifies the returned identity through canonical detail lookup. | Requires `allowLiveOrderMutations: true` and an authenticated, reconciled private session. One-shot dispatch; uncertain response/readback remains UNKNOWN. No blind retry. |
| Modify order | `modifyFuturesOrder()` supports an exact identified pending LIMIT order and requires quantity and price. | Requires order-mutation opt-in/readiness, matching private UPDATE event and final REST readback. Attached TP/SL modification is not implemented. |
| Cancel one / cancel all | `cancelOrder()` and `cancelAllOpenOrders()` perform exact pending-order preflight, one-shot POST, matching private CLOSE event(s) and REST readback. | Requires order-mutation opt-in/readiness. Cancel-all callers must enforce single-writer ownership; partial/missing event confirmation remains UNKNOWN. |
| Close one position / close by side / close all | `closeFuturesPosition()`, `closeFuturesPositionBySide()` and `closeAllFuturesPositions()` perform exact position preflight and REST post-readback. Account-wide close requires `confirmAccountWideClose: true`. | Requires `allowLivePositionMutations: true` and an authenticated private session acknowledged after REST reconciliation. Missing closure proof remains UNKNOWN; no automatic retry. |
| Position-level TP/SL place / modify | `placeFuturesPositionTpSlOrder()` and `modifyFuturesPositionTpSlOrder()` require one exact open position, explicit trigger source, exact decimal price and symbol quote precision; matching private CREATE/UPDATE NEW event confirms the operation. | Requires a ready private session. A missing/mismatched event or uncertain dispatch remains UNKNOWN. |
| TP/SL cancellation | `cancelFuturesPositionTpSlOrder()` and `cancelFuturesTpSlOrder()` require exact symbol/order identity and matching private CLOSE event. | Only CANCELED confirms user cancellation. SYSTEM_CANCELED and FAILED are distinct; FILLED means triggered, while child-order fill remains UNKNOWN. |
| Position mode / margin mode / leverage | `setFuturesPositionMode()`, `setFuturesMarginMode()` and `setFuturesLeverage()` perform exposure/order/TP-SL preflight, one-shot POST and REST configuration readback. | Require `allowLiveAccountMutations: true`; unsafe exposure blocks dispatch. A lost acknowledgement remains OUTCOME_UNKNOWN even when readback observes the requested value. |
| Isolated position-margin adjustment | Explicitly unsupported. | No documented Futures endpoint was found. Do not emulate with leverage or margin-mode mutations. |

Order-level TP/SL placement/modification remains unsupported: the documented child-order API does not establish the required reduce-only/close-position guarantee. Attached TP/SL creation parameters on `createFuturesOrder()` and position-level TP/SL operations are separate supported surfaces.

### Common Broker contract gaps and deliberate exclusions

These are common-model limitations or external guarantee gaps, not necessarily missing Futures endpoints:

| Common operation | Futures source evidence | Current Coinzilla state and reason |
|---|---|---|
| `getOpenOrders()` | `GET /api/v1/futures/trade/get_pending_orders` exists. | Common legacy `Order[]` remains unsupported; use provider-specific `getFuturesPendingOrders()` to preserve Futures semantics and exact decimals. |
| `getAccountSnapshot()` | Account, position, order and TP/SL REST/private channels exist. | Unsupported: no shared source timestamp or atomic snapshot version. |
| `getServerTime()` | No verified Futures server-time endpoint was found in the inspected official references. | Unsupported; do not synthesize server time from local time or unrelated gateway timestamps. |
| Legacy `getOrder()` / `getOrderHistory()` | Futures order-detail and history endpoints exist. | Unsupported: the legacy Spot-shaped `Order` projection cannot preserve the required Futures position/trade-side semantics; use canonical/provider-specific order reads. |
| Legacy `getMyTrades()` | `GET /api/v1/futures/trade/get_history_trades` returns bounded execution rows with trade/order IDs, exact quantity/price/fee/PnL and skip/limit pagination. | Supported as a bounded array projection over `getFuturesTradeHistory()`. Fee asset is absent and account-wide completeness is not claimed; use `getFills()` for canonical Fill values. |
| `getFills()` | Trade history supplies stable `tradeId`/`orderId`, exact `qty`/`price`, fee and realized PnL. | Supported for one bounded page. Quote notional uses exact decimal multiplication; fee asset is absent, so commission denomination is UNKNOWN. Complete account-wide history/retention is not claimed. |
| `createOrder()` / `createCanonicalOrder()` | Futures place-order endpoint includes `tradeSide`, `positionId`, `reduceOnly`, `clientId` and `effect`. | Common Spot-shaped methods remain unsupported. Use explicit `createFuturesOrder()`. |
| Candle WebSocket | Public kline channel exists. | Unsupported through the common Candle contract because the payload lacks the documented candle-open timestamp. |
| Account-wide recovery | Private channels and independent REST reads exist. | UNKNOWN: no event replay cursor, monotonic sequence or proven gap-free account reconciliation. |

Official execution-history reference: https://www.bitunix.com/api-docs/futures/trade/get_history_trades.html (10 requests/second per UID; maximum 100 rows per page; skip/limit pagination).

Bitunix Futures is LIVE-only; Bitunix does not provide a Futures TESTNET. Offline request/response tests cover the implemented operations. No LIVE mutation integration test is permitted. The active private-session readiness gate and caller REST-reconciliation acknowledgement do not establish authoritative event replay, sequence-gap detection, atomic snapshots or process-restart recovery.

## 5. Protocol and model invariants

- Keep `qty`, `price`, fees, funding, margin, notional and PnL values as exact decimal strings at the provider boundary. Use exact decimal arithmetic for derived values; never use JavaScript `Number` for financial arithmetic or silently round exchange values.
- Require explicit Futures position semantics. Do not default `tradeSide` to OPEN, assume one-way mode, infer close intent from BUY/SELL, or drop `positionId`/`reduceOnly`.
- Distinguish order state, execution/fill state, position state, fee, funding and realized/unrealized PnL. An order update is not a fill; a position delta is not an execution.
- Preserve stable exchange `orderId`, caller `clientId`, `positionId` and execution `tradeId` separately. Do not synthesize missing client IDs or execution IDs.
- The private stream's balance/position/order/TP-SL messages are observations. Bitunix documents no replay cursor or monotonic sequence; reconnect must set recovery required.
- The official private-channel pages describe event-triggered pushes but do not document a subscription-acknowledgement response. Local send success plus login acknowledgement is not proof that every private channel was accepted by the exchange; this remains an explicit readiness-evidence limitation until official acknowledgement semantics are verified.
- A consumer may call `acknowledgeUserDataReconciliation({ reconciliationCompleted: true })` only after reconciling balances, positions, pending orders and TP/SL orders from REST. This is an explicit consumer attestation required by the mutation gate; it does not prove atomic snapshots, event replay, sequence continuity or event authority.
- The `isUserDataReady` gate requires a connected, authenticated private session and acknowledged reconciliation. Disconnect, reconnect and unsubscribe reset readiness. Every Futures order mutation and position-close operation fails closed with `NOT_SENT` while the gate is closed.
- A dispatched mutation with lost acknowledgement, timeout, malformed response or mismatched readback is an unknown outcome unless a documented response/readback proves otherwise. Never blindly retry; reconcile by stable order/position identity.
- The official Node demo's immediate subscribe-after-login-send is not proof that subscription is accepted before authentication acknowledgement. Keep Coinzilla's login acknowledgement gate.
- A WebSocket event timestamp is not automatically a candle open time, account source timestamp or sequence number.

## 6. Remaining work and acceptance boundaries

1. Bitunix Futures has no TESTNET. Keep automated tests offline; do not run LIVE mutation integration tests. Any future LIVE operational probe requires a separately reviewed, explicitly authorized operator procedure and must not be presented as TESTNET validation.
2. Keep private observations explicitly non-authoritative/non-replayable. Do not clear recovery-required state without a documented sequence/replay or a proven gap-free reconciliation procedure.
3. Keep complete account-wide fill history UNKNOWN until source retention, pagination and gap-free coverage are established; preserve bounded-page semantics and UNKNOWN commission denomination.
4. Keep account snapshot, server time, candle WebSocket and common Spot-shaped Futures order projections unsupported where the exchange contract cannot satisfy the shared model.
5. Keep order-level TP/SL place/modify and isolated-position-margin adjustment unsupported unless official documentation establishes the missing safety semantics or endpoint.
6. Continue reviewing private-event correlation, malformed/mismatched events, timeout, duplicate and disconnect behavior for every supported mutation. Missing evidence remains OUTCOME_UNKNOWN; never blindly retry.

The provider is **NOT PRODUCTION READY** and must not be routed to Harvester or production execution. No external SDK, demo, or reference implementation is a Coinzilla runtime dependency.
