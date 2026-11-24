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

The current adapter has distinct Futures configuration/signing; public market catalog, ticker/mark price, depth and closed REST candles; exact USDT balance projection; canonical order detail/history; provider-specific pending-order and TP/SL reads; current/historical positions; position-mode and leverage/margin-mode reads; bounded raw execution history; canonical bounded Fill projection; funding-rate current/batch/history reads; position-tier reads; authenticated trading-settings reads; and public/private WebSocket observations.

### Common Broker contract gaps and supported operations

These are implementation gaps or deliberate common-contract exclusions—not absent Futures endpoints:

| Common operation | Futures source evidence | Current Coinzilla state and reason |
|---|---|---|
| `getOpenOrders()` | `GET /api/v1/futures/trade/get_pending_orders` exists and JKorf exposes it. | Common legacy `Order[]` remains unsupported; it cannot preserve Futures position/trade-side semantics and exact decimal guarantees. Exact provider-specific rows are available through `getFuturesPendingOrders()`. |
| `getAccountSnapshot()` | Account REST and private balance/position channels exist. | Unsupported until a timestamped, consistent account snapshot contract and cross-resource consistency are established. Local receipt time is not exchange source time. |
| `getServerTime()` | No verified Futures server-time endpoint was found in the inspected interfaces or official Node demo. | Unsupported/unknown; do not synthesize server time from local time or an unrelated ticker timestamp. |
| Legacy `getOrder()`, `getOrderHistory()`, `getMyTrades()` | Futures detail/history/execution endpoints exist; canonical Coinzilla reads are implemented. | Legacy Spot-shaped projections remain unsupported where they would lose exact decimals, Futures identity or position semantics. |
| `getFills()` | `GET /api/v1/futures/trade/get_history_trades` returns stable `tradeId`/`orderId`, exact `qty`/`price`, role, fee, realized PnL and creation time. | Supported for one bounded page. Quote notional is derived with exact decimal multiplication; maker/taker and execution identity are preserved; `commissionStatus` remains `UNKNOWN` because fee asset is absent. Complete account-wide history/retention is not claimed. |
| `createOrder()` / `createCanonicalOrder()` | Place-order endpoint supports Futures fields including `tradeSide`, `positionId`, `reduceOnly`, `clientId`, `effect`, and attached TP/SL parameters. | Common Spot-shaped methods remain unsupported. Provider-specific `createFuturesOrder()` is implemented behind `allowLiveOrderMutations: true`, explicit Futures input validation, exact market-filter checks, private-session readiness and caller reconciliation acknowledgement. Lost/uncertain outcomes are never blindly retried. |
| `cancelOrder()` | Cancel-one endpoint exists; official docs identify private order push as the accurate result and warn that successful interface response is not necessarily successful cancellation. | Implemented behind live opt-in and private-session readiness: exact pending-order preflight, stable `clientId` requirement, one-shot `stateChanging: true` POST and canonical detail readback. Matching private-event confirmation remains incomplete; REST readback is not a replay/recovery guarantee. |
| `cancelAllOpenOrders()` | Cancel-all endpoint exists and accepts optional symbol; JKorf exposes it. | Implemented behind live opt-in and private-session readiness: symbol-scoped or account-wide one-shot request, pending-count preflight, response validation and final pending-count readback. Unknown acknowledgements are not retried; caller must enforce single-writer ownership. |
| Modify order | `POST /api/v1/futures/trade/modify_order` supports quantity, limit price and attached TP/SL fields. | Provider-specific `modifyFuturesOrder()` is implemented for an identified pending LIMIT order and requires exact quantity and price. Attached TP/SL modification is not yet exposed. Mismatched/uncertain readback remains `OUTCOME_UNKNOWN`; matching private-event confirmation is incomplete. |
| Close position | Close-one and close-all endpoints exist; JKorf exposes both. | Provider-specific mutation not implemented; requires explicit position identity/scope, one-shot dispatch and verified final position state. |
| TP/SL mutation | Order-level and position-level place/modify/cancel/history endpoints exist. Place-order also accepts attached TP/SL parameters. | Attached TP/SL creation parameters are supported by `createFuturesOrder()`; pending TP/SL reads are implemented. Separate TP/SL mutations, TP/SL history and attached TP/SL modification remain incomplete. |
| Position/account settings writes | Set position mode, set margin mode, set leverage and adjust isolated-position margin endpoints exist. | Current adapter is read-only for these settings. Mutations require account-mutation opt-in, safe state preconditions and post-write verification. |
| Funding, position tiers and trading settings | Current/batch/historical funding, position-tier and trading-settings endpoints are documented. | Provider-specific reads are implemented: `getFuturesFundingRate()`, `getFuturesFundingRates()`, `getFuturesFundingRateHistory()`, `getFuturesPositionTiers()` and authenticated `getFuturesTradingSettings()`. Decimal values remain strings; history is bounded to 200 rows per request; trading settings preserve separate long/short leverage where supplied. |

No isolated Futures TESTNET endpoint has been verified. No LIVE mutation integration tests are permitted. Offline request/response tests cover implemented operations. The active authenticated private-session gate and explicit consumer REST-reconciliation acknowledgement are implemented, but they do not establish authoritative event replay, sequence-gap detection or matching private-event confirmation. State-changing methods must remain disabled in production until those remaining guarantees and postconditions are reviewed.
## 5. Protocol and model invariants

- Keep `qty`, `price`, fees, funding, margin, notional and PnL values as exact decimal strings at the provider boundary. Use exact decimal arithmetic for derived values; never use JavaScript `Number` for financial arithmetic or silently round exchange values.
- Require explicit Futures position semantics. Do not default `tradeSide` to OPEN, assume one-way mode, infer close intent from BUY/SELL, or drop `positionId`/`reduceOnly`.
- Distinguish order state, execution/fill state, position state, fee, funding and realized/unrealized PnL. An order update is not a fill; a position delta is not an execution.
- Preserve stable exchange `orderId`, caller `clientId`, `positionId` and execution `tradeId` separately. Do not synthesize missing client IDs or execution IDs.
- The private stream's balance/position/order/TP-SL messages are observations. Bitunix documents no replay cursor or monotonic sequence; reconnect must set recovery required.
- A consumer may call `acknowledgeUserDataReconciliation({ reconciliationCompleted: true })` only after reconciling balances, positions, pending orders and TP/SL orders from REST. This is an explicit consumer attestation required by the mutation gate; it does not prove atomic snapshots, event replay, sequence continuity or event authority.
- The `isUserDataReady` gate requires a connected, authenticated private session and acknowledged reconciliation. Disconnect, reconnect and unsubscribe reset readiness. Every Futures order mutation fails closed with `NOT_SENT` while the gate is closed.
- A dispatched mutation with lost acknowledgement, timeout, malformed response or mismatched readback is an unknown outcome unless a documented response/readback proves otherwise. Never blindly retry; reconcile by stable order/position identity.
- The official Node demo's immediate subscribe-after-login-send is not proof that subscription is accepted before authentication acknowledgement. Keep Coinzilla's login acknowledgement gate.
- A WebSocket event timestamp is not automatically a candle open time, account source timestamp or sequence number.
## 6. Next implementation order

1. Correlate placement, modification and cancellation with matching private order/TP-SL events where the official API identifies those events as the accurate operation result. Missing events, disconnects and mismatched payloads remain `OUTCOME_UNKNOWN`; never retry a dispatched mutation.
2. Complete attached TP/SL modification and separate order-level/position-level TP/SL place, modify, cancel and history operations with explicit position/order identity, one-shot dispatch and read-after-write verification.
3. Implement position close/close-all with explicit scope, preflight, one-shot dispatch and verified position postconditions; account for remaining TP/SL orders.
4. Implement position-mode, margin-mode, leverage and isolated-position-margin mutations behind `allowLiveAccountMutations: true`, safe preconditions and exact post-write verification.
5. Keep common Spot-shaped `createOrder()`, `getOrder()`, `getOpenOrders()` and legacy projections unsupported where they cannot preserve Futures identity, exact decimals or open/close semantics. Keep provider-specific typed operations explicit rather than fabricating canonical mappings.
6. Preserve `READ_FILLS` as bounded-page support only; keep complete-history, account-snapshot freshness, server-time, event replay and process-restart recovery UNKNOWN until source guarantees and reconciliation coverage are proven.
7. Verify an isolated Futures TESTNET endpoint and credentials before adding any mutation integration tests. Ordinary CI remains offline; no LIVE mutation probes are permitted.

No external SDK, demo, or reference implementation is a Coinzilla runtime dependency.
