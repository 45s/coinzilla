# Bitunix Spot — external implementation reference audit

**Status:** living engineering reference
**Last audited:** 2026-11-17
**Scope:** Bitunix Spot REST, Spot WebSocket RPC, market/account reads, order lifecycle, and Binance-broker parity
**Canonical blockers:** [issue #1185](https://github.com/45s/coinzilla/issues/1185)
**Related in-flight work:** [PR #1324 — read-only market data](https://github.com/45s/coinzilla/pull/1324)

This document records what external implementations actually contain, what their source and fixtures prove, what they get wrong or leave unproven, and which capabilities Coinzilla should port. It is not an exchange specification. The official Bitunix Spot documentation remains authoritative; third-party implementations are evidence and implementation examples only.

## 1. How to use this audit

For every Bitunix method requested in Coinzilla:

1. Find the corresponding method and contract in Coinzilla's BinanceBroker and the current Bitunix adapter. Read the consumers and tests so the intended Coinzilla behavior is clear.
2. Inspect the matching Spot interface, implementation, request DTO, response model, fixture and test in [JKorf/Bitunix.Net](https://github.com/JKorf/Bitunix.Net).
3. Cross-check [samanzamani/bitunix-mcp](https://github.com/samanzamani/bitunix-mcp) for an independent JavaScript/TypeScript implementation.
4. If either reference does not implement the method, contains a mismatch, or disagrees with the official docs, search GitHub using the exact endpoint path, method name, and capability. Inspect other language clients and connectors (C#, Python, Go, Ruby, TypeScript), not just README capability lists.
5. Verify endpoint path, HTTP verb, auth, parameters, response shape, numeric units, timestamps, pagination, identifiers, and lifecycle against the official Spot docs.
6. Record the source paths and immutable commit links, evidence, disagreements, test quality, and the proposed Coinzilla mapping here or in the linked issue.
7. Implement a native Coinzilla JavaScript adapter with test-first coverage. Do not add the external SDK, MCP server, or any other reference package as a runtime dependency.

**Search wider when needed; do not stop at the first package.** The minimum reference set is JKorf + the TypeScript MCP + official Spot docs. Additional projects are required when a capability is missing or conflicting in that set. A lack of third-party implementations is a finding: document it and build only from an unambiguous official contract.

### Evidence hierarchy

| Evidence | How to use it |
|---|---|
| Current official Bitunix Spot endpoint documentation | Wire-contract authority. Record contradictions within the vendor docs rather than choosing a convenient version. |
| Official Bitunix Open API repository/examples | Official implementation evidence, but check product scope. The inspected Node demo is Futures-only. |
| JKorf/Bitunix.Net implementation + interface + fixtures/tests | Primary behavioral reference. Inspect source; do not trust a method name or interface comment alone. |
| Independent TypeScript, C#, Python, Go or Ruby implementations | Cross-check request construction and model choices. They do not establish exchange guarantees. |
| Application/MCP projects and mirrored docs | Useful for observed behavior, edge cases and documentation defects. Lowest authority for the wire contract. |

No external code is copied verbatim into Coinzilla. No external dependency is introduced by this workflow.

## 2. External projects inspected

### 2.1 [JKorf/Bitunix.Net](https://github.com/JKorf/Bitunix.Net) — primary C# SDK

**Scope:** separate Spot and Futures REST/Socket surfaces built on CryptoExchange.Net.

Key Spot source:

- [Spot trading implementation](https://github.com/JKorf/Bitunix.Net/blob/57e1fce668b98804a441dea1c8df803da0437c4f/Bitunix.Net/Clients/SpotApi/Rest/BitunixRestClientSpotApiTrading.cs)
- [Spot trading interface](https://github.com/JKorf/Bitunix.Net/blob/57e1fce668b98804a441dea1c8df803da0437c4f/Bitunix.Net/Interfaces/Clients/SpotApi/IBitunixRestClientSpotApiTrading.cs)
- [Spot account implementation](https://github.com/JKorf/Bitunix.Net/blob/57e1fce668b98804a441dea1c8df803da0437c4f/Bitunix.Net/Clients/SpotApi/Rest/BitunixRestClientSpotApiAccount.cs)
- [Spot market-data implementation](https://github.com/JKorf/Bitunix.Net/blob/57e1fce668b98804a441dea1c8df803da0437c4f/Bitunix.Net/Clients/SpotApi/Rest/BitunixRestClientSpotApiExchangeData.cs)
- [Spot socket implementation](https://github.com/JKorf/Bitunix.Net/blob/57e1fce668b98804a441dea1c8df803da0437c4f/Bitunix.Net/Clients/SpotApi/Socket/BitunixSocketClientSpotApi.cs)
- [Spot order placement fixture](https://github.com/JKorf/Bitunix.Net/blob/57e1fce668b98804a441dea1c8df803da0437c4f/Bitunix.Net.UnitTests/Endpoints/Spot/Trading/PlaceOrder.txt)
- [Spot order-history fixture](https://github.com/JKorf/Bitunix.Net/blob/57e1fce668b98804a441dea1c8df803da0437c4f/Bitunix.Net.UnitTests/Endpoints/Spot/Trading/GetOrderHistory.txt)
- [Spot deposit fixture](https://github.com/JKorf/Bitunix.Net/blob/57e1fce668b98804a441dea1c8df803da0437c4f/Bitunix.Net.UnitTests/Endpoints/Spot/Account/GetDeposits.txt)
- [Spot withdrawal-history fixture](https://github.com/JKorf/Bitunix.Net/blob/57e1fce668b98804a441dea1c8df803da0437c4f/Bitunix.Net.UnitTests/Endpoints/Spot/Account/GetWithdrawalHistory.txt)
- [Spot asset/network fixture](https://github.com/JKorf/Bitunix.Net/blob/57e1fce668b98804a441dea1c8df803da0437c4f/Bitunix.Net.UnitTests/Endpoints/Spot/ExchangeData/GetAssets.txt)

**Useful coverage:** Spot latest price, depth, current/history klines, symbols, exchange rates, token/network metadata, balances, deposits, withdrawal history, deposit addresses, transfers, withdrawal, order placement/cancel, pending orders, order history, order detail, and a matching-order lookup. Spot WebSocket order placement/cancel are request/response queries.

**Important source defects / limits:**

- GetUserTradesAsync interface documents GET /api/spot/v1/order/deal/list, but the inspected implementation sends POST /api/spot/v1/order/pending/list. The official Spot order page documents POST /order/deal/list. Do not port the implementation as written.
- GetOrderBookAsync(symbol) omits the official required precision parameter. The MCP and StockSharp references pass a precision value, but its correct selection semantics remain unresolved.
- The PlaceOrder.txt fixture contains only data: { placeStatus: 1 }; it does not exercise the official documented orderId, symbol, side, type, volume and price fields. The model has those fields, but the fixture does not prove their presence.
- The order-history fixture contains data: {} rather than a representative page. It does not prove pagination, row completeness, ordering or page-size limits.
- No Spot GetUserTrades fixture or endpoint-level test was found in the inspected test tree. Spot GetUserTradesAsync models id, price, volume, time, fee, feeCoin and role, but the model itself does not prove quantity denomination, all-partial-fill completeness or ID uniqueness.
- Spot order placement has no client order ID or time-in-force parameter in the inspected interface.
- Spot socket methods are PlaceOrderAsync, CancelOrderAsync and CancelOrdersAsync implemented with QueryAsync; they are not subscriptions.

**Use:** first implementation to inspect for a Spot method, but verify every request path and fixture against the official contract. Treat the discovered trade endpoint mismatch as a known defect.

### 2.2 [samanzamani/bitunix-mcp](https://github.com/samanzamani/bitunix-mcp) — independent TypeScript

Key source:

- [Spot tools](https://github.com/samanzamani/bitunix-mcp/blob/6bf5d9f915bdf865394ac02f97c50b689ab9e8e7/src/tools/spot.ts)
- [HTTP/signing boundary](https://github.com/samanzamani/bitunix-mcp/blob/main/src/http.ts)
- [Repository README](https://github.com/samanzamani/bitunix-mcp/blob/6bf5d9f915bdf865394ac02f97c50b689ab9e8e7/README.md)

**Useful coverage:** public last price, depth, history klines and trading pairs; private account, pending orders, order history and order detail; optional trading tools for place/cancel, enabled only when BITUNIX_ENABLE_TRADING=true. Its HTTP boundary demonstrates pinned base URLs, request timeout, response-size limit, credential redaction and no redirects.

**Important limits / disagreements:**

- spot_get_pending_orders makes symbol optional and sends {} when omitted, although the official endpoint marks symbol required. This does not prove account-wide open-order support.
- spot_get_order_history makes symbol optional and locally caps page size at 100. Neither optional symbol nor that local cap is an official exchange guarantee.
- Its spot_place_order description says LIMIT volume is base quantity and MARKET BUY volume is quote quantity. This is not a safe resolution: the official single-order REST page says LIMIT quote / MARKET base, while the official batch endpoint says the inverse.
- It has no Spot WebSocket subscription implementation and no fill-history tool.
- It is an MCP tool wrapper, not a complete broker SDK. Its repository has CI/smoke coverage for tool registration and the trading-enable gate, but no endpoint-level Spot response fixtures were found in the inspected search. Its user-confirmation/trading-enable guard is useful safety design, not proof of exchange-side idempotency.

**Use:** best independent JavaScript reference for REST construction, schema validation, auth boundary and response handling. Do not adopt its optional symbol behavior, local pagination limits or disputed order-volume description.

### 2.3 [StockSharp/Connectors](https://github.com/StockSharp/Connectors) — independent C# connector

Inspected source:

- [Bitunix REST client](https://github.com/StockSharp/Connectors/blob/caa00fcc0e09554b1a3408781e8392d39eeb8302/Bitunix/Native/BitunixRestClient.cs)
- [Bitunix DTOs](https://github.com/StockSharp/Connectors/blob/caa00fcc0e09554b1a3408781e8392d39eeb8302/Bitunix/Native/Model/BitunixDtos.cs)
- [Spot transaction/order adapter](https://github.com/StockSharp/Connectors/blob/caa00fcc0e09554b1a3408781e8392d39eeb8302/Bitunix/BitunixMessageAdapter_Transaction.cs)

**Useful coverage:** Spot pairs, last price, depth with explicit precision, current/history candles, balances, place/cancel, pending orders, order history and a matching-order lookup. The matching-order method uses POST /api/spot/v1/order/deal/list and returns one BitunixSpotFill object. The transaction adapter queries it only when the order reports positive FilledVolume; it does not demonstrate exhaustive retrieval of every partial execution.

**Important limits:** the Spot placement DTO sends symbol, side, type, volume and price but no client order ID. The adapter checks that an order ID is returned, but it does not establish idempotent retry or unknown-outcome reconciliation. Spot cancel-all logic enumerates only symbols remembered by that process, not an authoritative account-wide symbol set. The Spot candle DTO includes a volume field although the official Spot K-line schema omits volume; no endpoint fixture was found to prove that the field is populated. The request/DTO code is useful cross-check material; no Bitunix-specific endpoint fixture suite was established in this audit. Its presence does not resolve order-volume semantics or mutation safety.

**Use:** useful independent C# confirmation of endpoint paths and required depth precision. Inspect its DTOs and adapter mapping before porting.

### 2.4 [0xCherryBlueZu/bitunix](https://github.com/0xCherryBlueZu/bitunix) — Python Spot client

Inspected [client.py](https://github.com/0xCherryBlueZu/bitunix/blob/28cefd924b6580a0ef46618ad0b7c387488526bb/bitunix/client.py).

**Useful coverage:** public price/depth/kline/pair/rate/token endpoints; private account; single/batch order placement; cancel; matching-order lookup via POST /api/spot/v1/order/deal/list; order history and pending orders.

**Do not copy as-is:**

- _get_authenticated() converts query parameters to a string, then passes that string to sign_request(), whose implementation expects a mapping and calls .items(). Authenticated GET requests with query parameters therefore appear defective.
- _post_authenticated() prints request headers (including the API key), request body and response. This is unsafe logging for account/trading code.
- The response handler checks HTTP status but does not validate the Bitunix business code envelope.
- No endpoint-level test suite was found in the repository search. The order method forwards a generic volume and does not resolve the official quantity contradiction.

**Use:** useful endpoint discovery and independent evidence for rate/list, coin_network/list and order/deal/list; not a safe implementation template.

### 2.5 [LuiInventions/Bitunix-MCP](https://github.com/LuiInventions/Bitunix-MCP) — Python MCP / application workflow

Inspected [client.py](https://github.com/LuiInventions/Bitunix-MCP/blob/ab01d983a76b4cfcc6119ebe034f5820fc439383/client.py) and [tools/spot.py](https://github.com/LuiInventions/Bitunix-MCP/blob/ab01d983a76b4cfcc6119ebe034f5820fc439383/tools/spot.py).

**Useful coverage:** Spot account, transfer, order placement/cancel and a conversion workflow. It demonstrates a second independent Python request/signing implementation.

**Do not copy:** its conversion helper converts financial amounts through Python float and hardcodes two-decimal trade sizing with a comment that most pairs support 2–4 decimals. That is not a pair-specific exchange rule and can truncate valid quantities. The workflow also performs live transfers and orders; it is not a safe broker contract.

**Use:** endpoint discovery and operational failure scenarios only. Do not use its float arithmetic or hardcoded precision.

### 2.6 [Steven-Chang/bitunix-api](https://github.com/Steven-Chang/bitunix-api) — Ruby client

Inspected [Spot public methods](https://github.com/Steven-Chang/bitunix-api/blob/afd7411cf854926adf4b92f2a90d15dda63f63aa/lib/bitunix/rest/spot/public.rb).

It independently implements the public coin_network/list token metadata endpoint. Useful as a narrow cross-check for token/network metadata, not a full Spot trading reference.

### 2.7 [mydcc/cachy-app](https://github.com/mydcc/cachy-app) — detailed Futures API audit

Inspected its [Bitunix API audit index](https://github.com/mydcc/cachy-app/blob/5aa47b78414bfd1554aecaee3afbf3e9b7392cfc/docs/bitunix-api/README.md), [WebSocket audit](https://github.com/mydcc/cachy-app/blob/5aa47b78414bfd1554aecaee3afbf3e9b7392cfc/docs/bitunix-api/08_websocket.md), and [documentation-defects register](https://github.com/mydcc/cachy-app/blob/5aa47b78414bfd1554aecaee3afbf3e9b7392cfc/docs/bitunix-api/12_doc_defects.md).

**Scope warning:** this mirror explicitly covers Bitunix Futures and says Spot is not mirrored. It is not a Spot implementation reference. Its strongest value is methodology: preserve vendor text, label repairs, distinguish observed application behavior from official claims, and keep a dedicated documentation-defects register.

### 2.8 [BitunixOfficial/open-api](https://github.com/BitunixOfficial/open-api) — official demos

The [Node demo README](https://github.com/BitunixOfficial/open-api/blob/main/Demo/Node/README.md) explicitly calls itself a **Bitunix Futures API Node.js Demo**. Its HTTP and WebSocket classes are named FuturePublic / FuturePrivate; it demonstrates Futures market, account, order, position and stream workflows. The official OpenAPI docs reached from openapidoc.bitunix.com redirect to the Futures documentation.

**Use:** official Futures examples only. Do not use the Futures ticker/depth/kline/order/user channels as evidence that Spot supports continuous subscriptions. The official Spot docs are a separate product surface.

### 2.9 [vgeyer/bitunix-client](https://github.com/vgeyer/bitunix-client) — Go client

The inspected README lists order, cancel, pending/history orders, trade history, position history and public/private WebSocket examples. The surfaced examples are Futures-oriented; no Spot implementation was verified in this audit.

**Use:** future Futures-only cross-check if Coinzilla adds a Futures broker. It is not current evidence for Bitunix Spot.

## 3. Official Spot contract findings that decide implementation

- [Official Spot public API](https://www.bitunix.com/api-docs/spots/en_us/public/) documents last price, depth, current/history K-lines, pair metadata, exchange rates and token/network metadata.
- [Official Spot order API](https://www.bitunix.com/api-docs/spots/en_us/order/) documents placement, batch placement, cancellation, matching-order lookup, order history, current orders and order detail.
- [Official Spot public WebSocket API](https://www.bitunix.com/api-docs/spots/en_us/public-ws/) exposes request/response methods such as market.last_price, market.depth, market.kline, and common metadata lookups. The documented request has an ID/method/params and receives a response; it does not define continuous Spot push subscriptions.
- [Official Spot user WebSocket API](https://www.bitunix.com/api-docs/spots/en_us/user-ws/) and [order WebSocket API](https://www.bitunix.com/api-docs/spots/en_us/order-ws/) expose account/order RPC operations, not a continuous private Spot event stream.
- The Futures WebSocket channels in the general OpenAPI docs are not Spot channels.
- Bitunix has confirmed that no Spot TESTNET is currently available; see [official Open API issue #4](https://github.com/BitunixOfficial/open-api/issues/4#issuecomment-3434841476).

### Confirmed documentation contradictions and reference defects

| Topic | Evidence | Decision |
|---|---|---|
| Single-order quantity | Official REST place_order: LIMIT volume is quote quantity; MARKET volume is base quantity. | Contradictory with batch contract; no placement. |
| Batch-order quantity | Official REST place_order/batch: LIMIT volume is base quantity; MARKET volume is quote quantity. | Do not extrapolate batch semantics to single-order endpoint. |
| Third-party order-volume claims | TypeScript MCP describes LIMIT base / MARKET BUY quote; other clients forward generic volume. | Not authoritative; keep #1185 blocker. |
| User-trade endpoint | JKorf interface says /order/deal/list, but source calls /order/pending/list; official docs say POST /order/deal/list; StockSharp and Python use that endpoint. | JKorf implementation defect; do not copy it. |
| Order-book precision | Official Spot depth requires precision; JKorf omits it; MCP and StockSharp pass it. | Caller-provided precision is the current safe boundary; do not infer it from precisions. |
| Kline response shape | Official Spot docs show a single object for current K-line; clients differ in array/object modeling. | Validate each endpoint's actual documented shape independently. |
| Candle volume | Official Spot K-line schema has OHLC and timestamp but no volume. | No canonical OHLCV candle; never synthesize volume. |
| Spot WebSocket | Official Spot WebSocket docs describe one-shot RPC; Futures docs describe push channels. | Do not implement Spot subscriptions or call polling a stream. |
| Place-order acknowledgement fixture | JKorf fixture omits orderId despite the official documented response schema listing it. | Fixture does not prove a complete canonical acknowledgement. |
| Order-history fixture | JKorf fixture is only data: {}. | No proof of page ordering, completion or pagination semantics. |
| Python signing/logging | 0xCherry authenticated GET signing passes a string where sign_request expects a mapping and calls .items(); POST helper prints headers and payload. | Do not copy signing or logging code. |
| StockSharp Spot cancel-all | Tracks symbols used by that process and fans out over those symbols. | Not proof of complete account-wide pending-order coverage. |
| Third-party Spot candle volume | StockSharp's DTO declares volume, while the official Spot K-line schema omits it and no fixture proves the field. | DTO presence alone is not evidence; do not synthesize canonical volume. |
| Precision shortcuts | Lui MCP conversion uses float and fixed 2-decimal sizing. | Never copy into exact-decimal broker code. |

## 4. Coinzilla Binance parity inventory

The following is the current method-by-method status from the Binance broker surface and Bitunix adapter on develop. PR #1324 is shown separately because it is still an open draft and is not merged into develop.

| Binance method / capability | Bitunix status | Reference evidence / decision |
|---|---|---|
| connect() / disconnect() | Implemented | Stateless REST adapter lifecycle. |
| getAssets() | Implemented, compatibility-only | Maps Spot account balances to legacy numeric Coin.value; exact decimals belong to getBalances(). |
| getBalances() | Implemented | Spot account endpoint; exact decimal strings. |
| getAccountSnapshot() | Blocked | No source timestamp/version or coherent snapshot contract. |
| getServerTime() | Blocked | No documented Spot server-time endpoint. Do not use local clock as exchange time. |
| getOpenOrders({ symbol? }) | Partial | Implemented only with required symbol. No account-wide query or proven exhaustive atomic fan-out. |
| getOrder({ symbol, orderId }) | Implemented, broker-ID only | Validates returned ID and symbol. No client-order-ID query. |
| getCanonicalOrder() | Blocked | No client order ID / stable canonical identity. |
| getOrderHistory() | Partial | Symbol-scoped, one-page result with filters and page-envelope checks. No proven completion/order/snapshot semantics. |
| getCanonicalOrderHistory() | Blocked | Requires stable client identity and complete order-history reconciliation. |
| getMyTrades() | Blocked | No account-wide Spot trade-history endpoint with complete paging/cursor semantics. |
| getFills({ symbol, orderId }) | Blocked | Deal endpoint exists, but quantity denomination, multi-execution completeness, stable/unique execution ID and fee semantics are unresolved. |
| createOrder() | Blocked | Single-order quantity conflict, no client order ID/idempotency key, no reliable unknown-outcome reconciliation, no TESTNET. |
| createCanonicalOrder() | Blocked | All placement blockers plus complete canonical acknowledgement required. |
| cancelOrder() | Blocked | No safe unknown-outcome cancellation reconciliation or private Spot event stream; no mutation environment. |
| cancelAllOpenOrders() | Blocked | Requires complete account-wide open-order coverage and safe partial-failure handling. |
| getPrices() / getPrice() | Implemented | One-shot last-price lookup; no source timestamp. |
| getCandles() | Blocked | Spot K-line omits volume required by canonical OHLCV. |
| getExchangeMarkets() | Implemented | Open Spot pair catalog. |
| getSymbolFilters() | Partial | Raw metadata + documented minimum quantity/notional mapping; no proven tick/step/depth precision. |
| subscribeForPrices() | Blocked | No continuous Spot public push subscription contract. |
| subscribeForCandles() | Blocked | No Spot push K-line channel and no volume. |
| subscribeForBookTicker() | Blocked | No continuous Spot book subscription; precision selection unresolved. |
| subscribeForUserData() | Blocked | No continuous private Spot balance/order/execution event stream or recovery semantics. |

### PR #1324 — merged read-only market-data slice (2026-11-17)

[PR #1324](https://github.com/45s/coinzilla/pull/1324) merged into `develop` as `5d707d17114d524ef3cd7c6d35387dde61338976`. It adds:

- `getOrderBook({ symbol, precision })` as a one-shot depth snapshot.
- `getKlines({ symbol, interval })` for current K-line rows.
- `getKlineHistory({ symbol, interval, endTime, limit })` for one history page.

It validates symbol, interval, decimals, OHLC invariants and timezone-qualified timestamps. It preserves caller-supplied depth precision and rejects undocumented `startTime`/cursor pagination. Canonical `getCandles()` remains unsupported because Spot K-lines omit volume. The merge and offline checks do not constitute live API acceptance; no live exchange call was performed.

### PR #1370 — Bitunix-only exchange-rate extension (merged 2026-11-17)

[Issue #1331](https://github.com/45s/coinzilla/issues/1331) tracked the public Spot exchange-rate read. The replacement test-first implementation merged into `develop` through [PR #1370](https://github.com/45s/coinzilla/pull/1370) as `55694b837c869878d22346dfd6b0f12c9b0f3269`; all six required `develop-core` checks passed on exact PR head `0f7fbaa332eea5b45a176a25eae4ba529495893a`. The original [PR #1332](https://github.com/45s/coinzilla/pull/1332) was closed as superseded; its branch was retained as historical evidence.

- **Official contract:** [Spot Query rate data](https://www.bitunix.com/api-docs/spots/en_us/public/#6-query-rate-data) documents `GET /api/spot/v1/common/rate/list`, no request parameters, and `data` as an optional array whose `baseSymbol`, `quoteSymbol`, and `rate` fields are individually optional. The [Open API introduction](https://www.bitunix.com/api-docs/) says public REST requests do not require authentication.
- **Primary .NET reference:** at JKorf/Bitunix.Net commit `57e1fce668b98804a441dea1c8df803da0437c4f`, `BitunixRestClientSpotApiExchangeData.GetExchangeRatesAsync()` requests the same path with its public/unauthenticated request definition. The matching `BitunixExchangeRate` model maps `baseSymbol`, `quoteSymbol`, and `rate`; its decimal model is not copied because Coinzilla must preserve the exchange's decimal text exactly.
- **Fixture evidence:** `Bitunix.Net.UnitTests/Endpoints/Spot/ExchangeData/GetExchangeRates.txt` records GET, the exact path, no URI parameters, an unauthenticated request flag, and a rate string such as `1.4452976228500000`. `RestRequestTests.ValidateSpotExchangeDataCalls` includes `GetExchangeRatesAsync()`.
- **Independent Python reference:** at commit `28cefd924b6580a0ef46618ad0b7c387488526bb`, `bitunix/client.py:get_rate_data()` calls the same path through the public `_get()` helper without authentication headers. No endpoint-specific test/fixture was found in that client.
- **TypeScript MCP:** at commit `6bf5d9f915bdf865394ac02f97c50b689ab9e8e7`, `src/tools/spot.ts` does not expose a rate-list tool. This is absence of coverage, not contrary protocol evidence.
- **Coinzilla decision:** expose only `BitunixSpotBroker.getExchangeRates()`; do not add it to `CoreBroker` or Binance. Require an array, non-empty string symbols, and a strictly positive decimal-string rate; preserve exact rate text and freeze the array/records. An explicit `data: []` is accepted, but missing `data` or incomplete rows fail closed. This is deliberately stricter than the optional-field documentation and must not be misrepresented as a guarantee that the exchange always returns complete rows.
- **Safety:** the REST client signs requests by default. Unsigned mode is explicit and limited to GET requests without a body or state-changing flag; it omits API authentication headers. Unauthenticated mutations are rejected before network I/O. No live API call or order/account mutation was performed.

## 5. What we should use, pick and implement

### Recommended next safe work

**Priority 1 — remaining Bitunix-specific public metadata extension (not Binance parity):**

- `getExchangeRates()` is implemented and merged in [PR #1370](https://github.com/45s/coinzilla/pull/1370); its source audit and stricter Coinzilla response contract are recorded above. Do not duplicate this capability.
- `getTokenMetadata()` (or a domain-appropriate name) remains a separate candidate for `GET /api/spot/v1/common/coin/coin_network/list`, returning token and network metadata such as deposit/withdraw availability, memo requirement, network name, minimums and address validation pattern. Define a real consumer contract before implementation.

These are Bitunix-only public extensions, not Binance parity methods. Keep exact decimal fields as strings; do not treat descriptive precision fields as tick/step filters. Token/network metadata is not authorization to implement transfers or withdrawals.

### Later, only after a separate contract review

- **Read-only account history extensions:** deposits (POST /api/spot/v1/deposit/page), withdrawal history (POST /api/spot/v1/withdraw_transfer/page) and deposit-address lookup (POST /api/spot/v1/deposit/address). JKorf has source and fixtures for deposit/withdrawal history and source for deposit address. These are not current Binance parity methods. Review retention, pagination, statuses, IDs, sensitive address handling and permission requirements before exposing them.
- **Matching-order lookup:** the endpoint is discoverable in official docs, StockSharp and Python. Keep canonical fills blocked until Bitunix clarifies unit, aggregation of partial fills, stable ID uniqueness and fee finality. A raw diagnostic method would need an explicitly non-canonical contract and a real consumer.
- **Order placement/cancellation:** external clients show request construction, but no implementation resolves the official volume contradiction, client order identity, unknown-outcome recovery or absent TESTNET. Do not implement or enable mutations until #1185 acceptance criteria are met.
- **Spot subscriptions:** no Spot push implementation was found in the inspected Spot packages. Futures channels and the official Futures Node demo do not qualify. Revisit only with official Spot push-channel documentation.
- **Klines/candles:** current and historical Spot K-line reads are covered by PR #1324; canonical OHLCV remains blocked until Bitunix supplies real volume.

### Do not implement from these references

- No account-wide getOpenOrders() by omitting symbol or by fanning out over only currently open markets.
- No getMyTrades()/canonical fills from the single-object matching-order endpoint without complete per-execution semantics.
- No local server-time substitute, account snapshot timestamp, synthetic candle volume, or fabricated stream events.
- No tick/step size or depth precision derived from basePrecision, quotePrecision, or the precisions list without official mapping.
- No placement/cancel/transfer/withdrawal live tests; no testnet is available.

## 6. Required per-method audit record

For each future capability, record:

| Field | Required content |
|---|---|
| Coinzilla contract | Binance method, signature, expected result shape and consumer. |
| Primary reference | JKorf interface + implementation + DTO/model + fixture/test path, or explicit “not found”. |
| JavaScript reference | MCP/JS implementation + tests, or explicit “not found”. |
| Additional references | Other GitHub packages searched; source/test paths and inspected commit. |
| Official contract | Current Bitunix Spot docs URL, HTTP verb, path, auth, request/response schema. |
| Differences | Any path, verb, parameter, unit, identity, timestamp, pagination or lifecycle disagreement. |
| Decision | Port, port with constraints, extension-only, blocked, or no implementation found. |
| Coinzilla work | Test-first plan, files, documentation, issue/PR and verification evidence. |

A package's README is a discovery aid, not source proof. If the reference has no test/fixture, say so. If the official docs contradict themselves, record the contradiction and preserve the safety gate.

## 7. Source index

- [Official Bitunix Spot documentation](https://www.bitunix.com/api-docs/spots/en_us/)
- [Official Spot public endpoints](https://www.bitunix.com/api-docs/spots/en_us/public/)
- [Official Spot order endpoints](https://www.bitunix.com/api-docs/spots/en_us/order/)
- [Official Spot public WebSocket RPC](https://www.bitunix.com/api-docs/spots/en_us/public-ws/)
- [Official Spot user WebSocket RPC](https://www.bitunix.com/api-docs/spots/en_us/user-ws/)
- [Official Spot order WebSocket RPC](https://www.bitunix.com/api-docs/spots/en_us/order-ws/)
- [JKorf/Bitunix.Net](https://github.com/JKorf/Bitunix.Net)
- [samanzamani/bitunix-mcp](https://github.com/samanzamani/bitunix-mcp)
- [StockSharp/Connectors — Bitunix](https://github.com/StockSharp/Connectors/tree/master/Bitunix)
- [0xCherryBlueZu/bitunix](https://github.com/0xCherryBlueZu/bitunix)
- [LuiInventions/Bitunix-MCP](https://github.com/LuiInventions/Bitunix-MCP)
- [Steven-Chang/bitunix-api](https://github.com/Steven-Chang/bitunix-api)
- [mydcc/cachy-app Bitunix Futures API mirror](https://github.com/mydcc/cachy-app/tree/main/docs/bitunix-api)
- [BitunixOfficial/open-api](https://github.com/BitunixOfficial/open-api)
- [vgeyer/bitunix-client](https://github.com/vgeyer/bitunix-client)

**Safety invariant:** Bitunix Spot remains read-only and not Harvester-ready while [issue #1185](https://github.com/45s/coinzilla/issues/1185) remains unresolved. Reference coverage is not authorization to enable a mutation.

## 8. Bitunix Spot deposit-history read (2026-11-17)

**Decision:** Implemented as a Bitunix-only, signed, read-only REST extension in issue [#1384](https://github.com/45s/coinzilla/issues/1384) / PR [#1385](https://github.com/45s/coinzilla/pull/1385). It is not a Binance-parity method and does not change the read-only/Harvester-readiness gate in #1185.

| Evidence | Finding |
|---|---|
| Official endpoint | `POST /api/spot/v1/deposit/page`; signed Spot user endpoint. |
| Request filters | `id`, `coin`, `type`, `transactionHash`, `startTime`, `endTime`, `limit`. Type filters are `deposit` and `inside_transfer_in`; transaction-hash filtering applies only to `deposit`. Time values are Unix milliseconds. Limit is at most 100 (default 100); documented rate limit is 10 requests/second per IP. |
| Pagination | No cursor, page number, or total-count contract is documented. The implementation issues one request only and makes no completeness claim. |
| Response shape | The official schema labels `data` as an object, but the official example is an array. JKorf's method returns `BitunixDeposit[]` and its fixture is an array. Coinzilla accepts either a single object or array and normalizes to an immutable array; missing/null data is rejected. |
| Identifier | The official schema labels `id` as a string, while the official example and JKorf fixture encode large values as JSON numbers; JKorf models the field as signed 64-bit `long`. The REST parser stringifies raw numeric ID tokens before `JSON.parse`; returned IDs are strings. Unsafe numeric IDs injected after parsing are rejected. |
| Amount/time | Amount is documented as decimal and the fixture uses a decimal string; raw numeric amount tokens are also stringified before parsing to avoid precision loss. `ctime` is an int64 millisecond timestamp; safe numeric values and integer strings are preserved. Unsafe numeric timestamps fail closed. |
| Identity fields | `fromAddress` and `toAddress` may be chain addresses or internal-transfer account identifiers; both remain opaque strings. Nullable `transactionHash` and `network` remain nullable. |
| Status/type | Known status examples include pending/cancelled/success/fail; type examples include deposit/inside_transfer_in. The adapter preserves non-empty strings without inventing a new enum mapping, so future exchange values remain visible. |

**Reference audit**

- Official docs: [Get deposit records (on-chain deposit/internal transfer)](https://www.bitunix.com/api-docs/spots/en_us/user/#9-get-deposit-records-on-chain-deposit-internal-transfer).
- JKorf interface: [IBitunixRestClientSpotApiAccount.GetDepositsAsync](https://github.com/JKorf/Bitunix.Net/blob/main/Bitunix.Net/Interfaces/Clients/SpotApi/IBitunixRestClientSpotApiAccount.cs).
- JKorf implementation: [BitunixRestClientSpotApiAccount.GetDepositsAsync](https://github.com/JKorf/Bitunix.Net/blob/main/Bitunix.Net/Clients/SpotApi/Rest/BitunixRestClientSpotApiAccount.cs).
- JKorf model: [BitunixDeposit](https://github.com/JKorf/Bitunix.Net/blob/main/Bitunix.Net/Objects/Models/BitunixDeposit.cs).
- JKorf response fixture: [GetDeposits.txt](https://github.com/JKorf/Bitunix.Net/blob/main/Bitunix.Net.UnitTests/Endpoints/Spot/Account/GetDeposits.txt).
- TypeScript MCP: no matching deposit-history tool found in the inspected Spot tool source.
- StockSharp/Connectors: no matching `/api/spot/v1/deposit/page` implementation found in the inspected source search.

The Coinzilla method validates all supplied filters before I/O, sends only supplied filters, validates the entire response before returning it, preserves exact identifier/amount text, and never mutates account state. It does not fetch deposit addresses, withdrawals, transfers, or any order operation.

## 9. Bitunix Spot withdrawal-history read (2026-11-17)

**Decision:** Implemented as a Bitunix-only, signed, read-only extension in issue/PR [#1387](https://github.com/45s/coinzilla/pull/1387). It does not close or weaken issue #1185 and is not Binance parity.

| Evidence | Finding |
|---|---|
| Official endpoint | `POST /api/spot/v1/withdraw_transfer/page`; signed Spot user endpoint. It includes both on-chain withdrawals and internal-transfer-out records. |
| Request filters | `id`, `outBizId`, `coin`, `transactionHash`, `type`, `startTime`, `endTime`, `remark`, `limit`. Type filters are `withdraw` and `inside_transfer_out`; transaction-hash filtering applies only to explicit `type: "withdraw"`. Time values are Unix milliseconds. Limit is 1–100 (default 100); rate limit is 10 requests/second per IP. |
| Pagination | No cursor, page number or total-count contract is documented. The implementation issues one request only and makes no completeness claim. |
| Response shape | Official schema labels `data` as an object, but its example is an array. JKorf returns `BitunixWithdrawal[]` and its fixture is an array. Coinzilla accepts either shape and normalizes to an immutable array; missing/null data is rejected. |
| Destination field | Official schema says `toAddress`; example and JKorf model use `address`. Coinzilla preserves raw `address` and exposes an exact-value `toAddress` alias when only `address` is supplied. If both non-null fields are supplied and disagree, the row fails closed. |
| Fee fields | Official schema marks `feeCoin` and `fee` required, but the official example and JKorf model allow null. Coinzilla preserves null and rejects malformed non-null decimal text. |
| Identity and amount | `id` is a string in the schema; `toUid` is int64. The REST parser stringifies raw numeric `id`, `toUid`, `amount` and `fee` tokens before `JSON.parse`, avoiding JavaScript precision loss. Returned IDs/UIDs/amounts/fees are strings. `ctime` remains a safe integer or integer string; unsafe numeric timestamps fail closed. |
| Recipient fields | `toAddress`/`address`, `toUid`, `toPhoneCountryCode`, `toPhoneNumber`, `toEmail`, `toType`, `remark`, and `memo` are returned as opaque caller-visible values. They are not logged, persisted, redacted or transformed. |
| Type/status | Known types include `withdraw` and `inside_transfer_out`; status examples include `verification`, `pending`, `cancelled`, `success`, and `fail`. The adapter preserves unfamiliar non-empty strings without inventing enum mappings. |

**Reference audit**

- Official docs: [Request withdrawal history (withdrawal and internal transfer included)](https://www.bitunix.com/api-docs/spots/en_us/user/#7-request-withdrawal-historywithdrawal-and-internal-transfer-included).
- JKorf interface: [IBitunixRestClientSpotApiAccount.GetWithdrawalHistoryAsync](https://github.com/JKorf/Bitunix.Net/blob/main/Bitunix.Net/Interfaces/Clients/SpotApi/IBitunixRestClientSpotApiAccount.cs).
- JKorf implementation: [BitunixRestClientSpotApiAccount.GetWithdrawalHistoryAsync](https://github.com/JKorf/Bitunix.Net/blob/main/Bitunix.Net/Clients/SpotApi/Rest/BitunixRestClientSpotApiAccount.cs).
- JKorf model: [BitunixWithdrawal](https://github.com/JKorf/Bitunix.Net/blob/main/Bitunix.Net/Objects/Models/BitunixWithdrawal.cs).
- JKorf response fixture: [GetWithdrawalHistory.txt](https://github.com/JKorf/Bitunix.Net/blob/main/Bitunix.Net.UnitTests/Endpoints/Spot/Account/GetWithdrawalHistory.txt).
- TypeScript MCP Spot source: no matching withdrawal-history tool or endpoint found.
- StockSharp/Connectors: no matching `/api/spot/v1/withdraw_transfer/page` implementation found in the inspected source search.

The method validates all filters before I/O, sends only supplied filters, validates the entire response before returning it, preserves exact numeric identifiers/amounts, and performs no withdrawal or transfer mutation. Sensitive recipient fields are returned only to the caller; they are not logged or stored.
