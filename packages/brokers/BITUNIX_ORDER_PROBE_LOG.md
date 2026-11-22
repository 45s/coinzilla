# Bitunix Spot live order-probe evidence

This log records operator-authorized LIVE order-placement probes against Bitunix Spot. It is an evidence log, not an assertion that the broker is ready for automated trading.

## Safety and interpretation

- Each probe is a separately confirmed, one-shot LIVE mutation. The operator runs the command locally and confirms it interactively.
- Never retry a dispatched request with an unknown outcome. Reconcile manually before any further mutation.
- A successful diagnostic workflow means the probe harness completed; inspect the nested placement acknowledgement to determine whether Bitunix accepted or rejected the order. A later read-only reconciliation failure does not undo a definitive placement acknowledgement.
- A placement-level rejection is distinct from an HTTP/transport failure. In particular, Bitunix can return HTTP 200 and outer `success: true` while the nested placement result rejects the order.
- Missing asset rows in the Spot account response remain **unknown**, not zero. An explicitly confirmed SELL probe may proceed with an extra typed acknowledgment; MARKET probes remain blocked while their volume denomination is unresolved.
- These probes do not establish order acceptance, fills, quantity denomination, precision/tick rules, or complete order lifecycle behavior.

## Confirmed observations

### 2026-11-22 — `limit-buy-1`

- Command: `pnpm --filter @coinzilla/brokers bitunix:healthcheck --probe-order=limit-buy-1`
- Order: Spot LIMIT BUY `HYPEUSDT`, quantity `1 HYPE`, price `30 USDT`.
- Wire body: `{"symbol":"HYPEUSDT","side":2,"type":1,"volume":"1","price":"30"}`.
- Preflight: USDT free balance was approximately `0.0000000049324959035`; HYPE balance was not returned.
- Placement response: HTTP `200`; outer `code: "0"`, `success: true`; nested `placeStatus: 0`, `placeCode: 10034`, `placeMsg: "余额不足"` (insufficient balance); `orderId: null`.
- Coinzilla result: `BitunixRestError`, `BITUNIX_REST_EXCHANGE_REJECTED`, exchange code `10034`; mutation outcome `REJECTED`.
- Conclusion: the Spot single-order placement request reached Bitunix and returned a structured placement-level insufficient-balance rejection. No order was accepted or created.
- Published sanitized report: `packages/brokers/diagnostics/reports/bitunix-health-20261122T011615067Z.json`.
- Report commit: `25eb7e57aa9f1ae79338997897d0d4f189d37bee`.

### 2026-11-22 — `limit-sell-1`

- Command: `pnpm --filter @coinzilla/brokers bitunix:healthcheck --probe-order=limit-sell-1`
- Order: Spot LIMIT SELL `HYPEUSDT`, quantity `1 HYPE`, price `30 USDT`.
- Wire body: `{"symbol":"HYPEUSDT","side":1,"type":1,"volume":"1","price":"30"}`.
- Preflight: HYPE free and locked balances were not returned; USDT free balance was `1.2406854249324959035`; open HYPEUSDT orders returned `0`.
- Operator explicitly typed `I ACCEPT UNKNOWN HYPE BALANCE` after the script warned that the HYPE balance was unreported and the order could rest or fill.
- Placement response: HTTP `200`; outer `code: "0"`, `success: true`; nested `placeStatus: 0`, `placeCode: 10034`, `placeMsg: "余额不足"` (insufficient balance); `orderId: null`.
- Coinzilla result: `BitunixRestError`, `BITUNIX_REST_EXCHANGE_REJECTED`, exchange code `10034`; mutation outcome `REJECTED`.
- Conclusion: the Spot single-order placement request reached Bitunix and returned the same structured placement-level insufficient-balance rejection. No order was accepted or created.
- Published sanitized report: `packages/brokers/diagnostics/reports/bitunix-health-20261122T013708002Z.json`.
- Report commit: `32362a40ec2f29b2ae895d0dbede78b3b157f907`.

### 2026-11-22 — `limit-buy-11-usdt` accepted; detail reconciliation rejected

- Command: `pnpm --filter @coinzilla/brokers bitunix:healthcheck --probe-order=limit-buy-11-usdt`.
- Operator explicitly confirmed the one LIVE order after reviewing the snapshot. No automatic retry was performed.
- Preflight: HYPEUSDT open orders `0`; available USDT `11.2436631349324959035`; required preflight minimum `11.24 USDT`.
- Order: Spot LIMIT BUY `HYPEUSDT`, price `30 USDT`, quantity `0.366 HYPE`, estimated notional `10.98 USDT`, reserved fee allowance `0.24 USDT`.
- Exact placement request body: `{"symbol":"HYPEUSDT","side":2,"type":1,"volume":"0.366","price":"30"}`.
- Placement response: HTTP `200`; outer `code: "0"`, `msg: "result.success"`, `success: true`; nested `orderId: "2124329325141426176"`, `side: 2`, `type: 1`, `volume: "0.366"`, `price: "30"`, `placeStatus: 1`, `placeCode: 0`, `placeMsg: "成功"`.
- **Placement conclusion: CONFIRMED.** Bitunix explicitly accepted the order and returned a non-empty string order ID. The operator subsequently confirmed the order was still waiting/open; no fill is claimed.
- Follow-up read: one authenticated `GET /api/spot/v1/order/detail?orderId=2124329325141426176`; HTTP `200`; exchange code `100005`; message `result.api.parameter.sign.illegal`. This is a separate read-only detail/signature failure after successful placement, not a placement rejection.
- The CLI showed `Broker result: not successful` and exited non-zero because the detail reconciliation error was included in the broker result. This was misleading: the mutation outcome remained `CONFIRMED` and the exchange had already accepted the order.
- Safety: do not repeat this placement. Reconcile the existing order using read-only exchange queries. No cancellation, retry, or second mutation was performed.
- Local private evidence: `packages/brokers/.diagnostics/bitunix-order-probe-limit-buy-11-usdt.json`. Published sanitized report: `packages/brokers/diagnostics/reports/bitunix-health-20261122T022854989Z.json`; report commit `72619cad577301b293454d3c3f82fda5190b5743`.
- Operator output and probe evidence are being hardened so the accepted mutation and unavailable reconciliation are printed/persisted as separate fields (`mutationOutcome`, `reconciliation.status`, source, endpoint, and structured error). The original report remains historical evidence and is not rewritten.

## What is proven — and what is not

**Proven by the three observations above:**

1. The current Coinzilla `BitunixSpotBroker.createOrder()` path dispatched Spot LIMIT BUY and SELL requests; the funded BUY was explicitly accepted by Bitunix.
2. Bitunix returned a parseable HTTP-200 placement envelope with nested rejection code `10034`.
3. Coinzilla correctly surfaced the two unfunded nested placement rejections as `BITUNIX_REST_EXCHANGE_REJECTED` / `REJECTED`, and the funded BUY as `CONFIRMED` with an exchange order ID.
4. The probe harness preserved the raw placement response and published a sanitized report for each attempt.

**Not proven:**

- That order-detail GET authentication/signature construction is accepted by Bitunix; the first post-placement detail lookup returned exchange code `100005`.
- That LIMIT `volume` denomination is correct. Official English/Chinese Spot documentation and other endpoint families disagree; an insufficient-balance rejection does not resolve that conflict.
- That MARKET order quantity denomination is safe. MARKET probes remain disabled until this is resolved.
- That HYPE balance rows omitted by the account endpoint mean a zero balance.
- That order IDs, open-order lookup, fills, partial fills, cancellation races, or unknown-outcome recovery are correct end to end.

## Next investigation

1. Inspect the raw sanitized reports and the exact request/response adapter path; keep the exchange response as the source of truth.
2. The operator confirmed the Spot account lacked the required assets; both `10034` insufficient-balance rejections were expected. Do not spend further effort investigating those rejections.
3. Resolve the LIMIT/MARKET `volume` contract from authoritative endpoint-specific evidence before enabling additional probes.
4. The funded BUY probe is complete and must never be repeated. Its order ID is `2124329325141426176`; the operator reports it remains waiting/open.
5. Investigate the `100005 result.api.parameter.sign.illegal` response for the signed GET order-detail endpoint in [issue #1704](https://github.com/45s/coinzilla/issues/1704). Compare the exact canonical query string, URL encoding, and official signing example. Prefer already-working signed POST pending/history reads for safe reconciliation if justified by tests. Keep broader Bitunix Spot lifecycle/Harvester admission blockers tracked independently; one accepted LIMIT order does not make Bitunix trading-ready.
