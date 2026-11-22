# Bitunix Spot live order-probe evidence

This log records operator-authorized LIVE order-placement probes against Bitunix Spot. It is an evidence log, not an assertion that the broker is ready for automated trading.

## Safety and interpretation

- Each probe is a separately confirmed, one-shot LIVE mutation. The operator runs the command locally and confirms it interactively.
- Never retry a dispatched request with an unknown outcome. Reconcile manually before any further mutation.
- A successful diagnostic workflow means the probe harness completed and captured the exchange response. It does **not** mean the exchange accepted the order.
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

## What is proven — and what is not

**Proven by these two observations:**

1. The current Coinzilla `BitunixSpotBroker.createOrder()` path dispatched both a Spot LIMIT BUY and a Spot LIMIT SELL request to Bitunix.
2. Bitunix returned a parseable HTTP-200 placement envelope with nested rejection code `10034`.
3. Coinzilla correctly surfaced the nested placement rejection as `BITUNIX_REST_EXCHANGE_REJECTED` and mutation outcome `REJECTED`.
4. The probe harness preserved the raw placement response and published a sanitized report for each attempt.

**Not proven:**

- That Bitunix accepts a Spot order from this implementation.
- That LIMIT `volume` denomination is correct. Official English/Chinese Spot documentation and other endpoint families disagree; an insufficient-balance rejection does not resolve that conflict.
- That MARKET order quantity denomination is safe. MARKET probes remain disabled until this is resolved.
- That HYPE balance rows omitted by the account endpoint mean a zero balance.
- That order IDs, open-order lookup, fills, partial fills, cancellation races, or unknown-outcome recovery are correct end to end.

## Next investigation

1. Inspect the raw sanitized reports and the exact request/response adapter path; keep the exchange response as the source of truth.
2. The operator confirmed the Spot account lacked the required assets; both `10034` insufficient-balance rejections were expected. Do not spend further effort investigating those rejections.
3. Resolve the LIMIT/MARKET `volume` contract from authoritative endpoint-specific evidence before enabling additional probes.
4. A funded BUY probe is prepared: LIMIT BUY `HYPEUSDT` at `30 USDT`, spending up to `11 USDT`, with quantity calculated from live `basePrecision` and a `0.24 USDT` reserve. It requires a short `y/N` confirmation. Do not run it until the operator has funded Spot and merged the PR.
5. Keep the broader Bitunix Spot lifecycle/Harvester admission blockers tracked independently; these two placement rejections do not make Bitunix trading-ready.

## 2026-11-22 — Issue #1704 Phase 1: pending-order fetch audit

- Audited `BitunixSpotBroker.getOpenOrders({ symbol })`: it requires an explicit symbol, normalizes it to uppercase, and makes one read-only `POST /api/spot/v1/order/pending/list`. The request is authenticated by the REST client's default and explicitly sets `stateChanging: false`.
- The response adapter accepts the documented single-row object and array shapes, rejects missing/invalid row data, validates every returned row against the requested symbol, and normalizes the exchange order through `adaptOrder()`.
- This is a **symbol-scoped** query, not an account-wide order enumeration. Querying HYPEUSDT is the correct supported route; do not claim that one response covers other symbols.
- The existing tests covered empty results, a generic order ID, single-row normalization, and symbol mismatch, but did not prove exact preservation of the accepted 19-digit HYPE order ID.
- Added an offline regression fixture for order ID `"2124329325141426176"`. It asserts exact string identity, HYPEUSDT/BUY/OPEN fields, quantity and price normalization, one POST only, and the signature over the exact serialized `{"symbol":"HYPEUSDT"}` body.

- Added a dedicated read-only operator command, `pnpm --filter @coinzilla/brokers bitunix:find-order --order-id=2124329325141426176`, which queries only HYPEUSDT pending orders and matches the exact string ID. It cannot place or cancel orders. It reports a missing pending row as inconclusive rather than proof of absence. Offline command tests cover exact matching, the empty-pending case, and rejection of numeric IDs.
- **Not yet live-verified:** the fixture proves the local adapter contract only. Phase 1 remains open until the operator runs the read-only HYPEUSDT pending-order query and the returned rows contain the exact order ID and matching symbol. No placement or cancellation is part of this check.

