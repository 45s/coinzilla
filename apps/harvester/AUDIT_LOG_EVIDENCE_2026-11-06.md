# Harvester 2026-11-06 application-log evidence

**Parent audit:** [#645](https://github.com/45s/coinzilla/issues/645)  
**Audit baseline:** `develop` `7ebfbff803ae12b9a117ae4c222463673be52272`  
**Session:** 2026-11-06, approximately 07:00–07:58 UTC  
**Classification:** integrity PASS; ZRO runtime accounting PASS; DOGE SELL/order state CONFLICT; closing audit PARTIAL/INCOMPLETE.  
**Handling:** original files were read-only; no log was edited, normalized in place, or committed as raw data.

## 1. Original-file integrity and parsing

| File | Bytes | Physical lines | SHA-256 | Result |
|---|---:|---:|---|---|
| `harvester.log` | 16,878,030 | 4,880 | `5be28db5f6bc998e1190c1bddf4a91c97703fe9e502e98422932511a56ff633d` | PASS |
| `harvester-trace.log` | 17,021,746 | 5,739 | `4a030ccc4cd645b42ffdf01cb285d4cb1fa5d54417f8845a076448f1d20abcd3` | PASS |

Both files end with a newline. The physical line counts above count newline-terminated records and do not include a synthetic trailing empty line. Byte counts and SHA-256 values match the immutable evidence inventory in #645. Both JSONL logs were parsed and inspected; this document preserves the derived evidence so the audit continuation does not depend on re-uploading the files.

## 2. ZROUSDT — direct runtime Portfolio and RecoveryLedger evidence

**Result: PASS for the observed in-memory accounting transition and arithmetic.** This does not establish overall account settlement or TESTNET acceptance.

Trace lines 4551–4563 record SELL execution `binance:ZROUSDT:11666`, trade ID `11666`, order ID `727904`, maker, price `1.606`, quantity `39.91`, gross quote `64.09546 USDT`, and actual commission `0.06409546 USDT`.

The trace records `Execution accounted` with `applied=true` and `duplicate=false`. Immediately before the SELL, Portfolio held active `39.96 ZRO`, free `0`, total `39.96`, and quote net cash flow `-64.02 USDT`. RecoveryLedger held buy cost `64.02`, net sell proceeds `0`, outstanding `64.02`, realized `-64.02`, and applied fill count `8`.

After applying the SELL:
- Portfolio active quantity was `0.05 ZRO`, free quantity `0`, total `0.05 ZRO`, quote net cash flow `+0.01136454 USDT`.
- RecoveryLedger net sell proceeds were `64.03136454 USDT`, outstanding recovery `0`, realized `+0.01136454 USDT`, applied fill count `9`.
- Recovery completion was eligible with `sellOrderFullyFilled=true`, buy cost `64.02`, net proceeds `64.03136454`, active quantity `0.05`, keep quantity `0.01`, and minimum profit `0.01`.
- Completion allocated `0.01 ZRO` to free inventory, left `0.04 ZRO` active, retained total `0.05 ZRO`, and reset RecoveryLedger buy cost, proceeds, outstanding, and realized values to zero. The ledger's applied fill count remained `9`.
- The following market evaluation retained active `0.04`, free `0.01`, total `0.05 ZRO`.

Independent arithmetic agrees: eight BUY fills were 40 gross ZRO with 0.04 ZRO base commissions, leaving 39.96 net; the SELL disposed of 39.91; residual was 0.05. Net proceeds were 64.09546 less 0.06409546 = 64.03136454 USDT; against 64.02 cost this is +0.01136454 USDT. The direct trace now proves the Portfolio and RecoveryLedger state, not merely the Journal arithmetic.

Trace lines 5703 onward replay historical ZRO execution identities as duplicates during shutdown; those duplicate records do not create additional accounting deltas.

## 3. DOGEUSDT — evidence strengthens, conflict remains

**Result: CONFLICT for order terminal state; likely OPEN/unfilled at the last observed runtime point; no realized SELL proceeds or PnL may be booked.**

Trace lines approximately 5683, 5688, and 5691 show DOGE evaluations at 07:56:36.773Z and 07:57:19.419Z with SELL order `1276698`, client ID `h-971fc65d9a264984ab8aa7-11`, price `0.07185`, original quantity `1196`, executed quantity `0`, remaining quantity `1196`, and status `OPEN`. The same events show Portfolio active/free/total `1198.8 / 0 / 1198.8 DOGE`, quote net cash flow `-85.836 USDT`; RecoveryLedger buy cost and outstanding `85.836 USDT`, net sell proceeds `0`, realized `-85.836 USDT`, applied fill count `3`.

The shutdown INFO log contains exactly 12 `Execution received` records (harvester.log lines 4851–4874): three DOGE BUY executions (trade IDs 221733, 221736, 221738) and nine ZRO executions (eight BUYs and one SELL). There is no DOGE SELL execution among those 12 records. The trace contains duplicate replays of these same execution identities during shutdown (approximately lines 5694–5729); these are not new fills.

The closing account snapshot records DOGE free `19122.6`, locked `1196`, total `20318.6`. PREFLIGHT total was `19119.8`; the +1198.8 total delta exactly equals the three net DOGE BUY fills (1200 gross less 1.2 DOGE commission). This, together with the final runtime OPEN/zero-executed state and absence of a DOGE SELL execution in the shutdown execution set, strongly favors order 1276698 remaining open/unfilled at shutdown.

However, a separately supplied exchange order-history row reports the same order as FILLED for 1,196 DOGE. The available log records do not conclusively override that exchange-history fact. The CLOSING audit remains `INCOMPLETE` with `UNRESOLVED_OWNED_ORDERS:2`. Do not book the reported 85.9326 USDT gross quote, assume a commission, classify a terminal status, or calculate DOGE SELL PnL until complete trade history/order detail and the full CLOSING open-order payload resolve the contradiction.

## 4. Second unresolved order

ZRO BUY `727905` / client suffix `-23` is independently identified as NEW, 5 ZRO at 1.596, with 7.98 USDT locked. It is a confirmed unresolved order. DOGE SELL `1276698` is a strong candidate for the other unresolved order, given 1,196 DOGE locked and the final runtime OPEN state, but the full CLOSING open-orders payload is not present in these logs. Do not assert its identity as the second unresolved order without that payload.

## 5. Timestamp interpretation

The shutdown trace's `Exchange account snapshot loaded` event is timestamped `2026-11-06T07:58:11.369Z`; the CLOSING snapshot is durably journaled at `07:58:11.377Z`. Its `sourceTime=1793948926965` corresponds to the ZRO SELL execution time `07:08:46.965Z`, not to the 07:58 snapshot capture time. Keep exchange execution time, event-ingestion time, and snapshot-capture time distinct.

## 6. Remaining evidence required

1. Complete DOGE `myTrades` history for the session, including commission amount and asset for every trade; verify pagination/completeness.
2. Canonical order detail/history for DOGE order `1276698`, preserving exchange timestamps and cumulative executed quantity.
3. Full CLOSING account-wide open-order payload and reconciliation diagnostics, identifying both unresolved orders.
4. Timestamped later balances/open orders if already captured, plus evidence of any external/manual trades, transfers, deposits, or withdrawals relevant to the session.
5. Exact identity and reservation reconciliation for both unresolved orders.

No TESTNET order, cancellation, restart, account-setting change, or exchange write was performed. This addendum is derived evidence, not a substitute for the original exchange trade/order records.


## Evidence correction — balance and open-orders records were already supplied

Parent issue #645 comment 6680483675 records the operator-supplied latest open-orders snapshot: one ZROUSDT BUY LIMIT order 727905, client ID `h-971fc65d9a264984ab8aa7-23`, price 1.59600000, original quantity 5.00000000, executed quantity 0, status NEW. The same issue comment explicitly identifies this as a point-in-time latest snapshot, not the historical CLOSING open-order payload.

The original Journal (issue #645 comment 6680290142) contains these account snapshots:

| Phase | Asset | Free | Locked | Total |
|---|---|---:|---:|---:|
| PREFLIGHT | DOGE | 19119.8 | 0 | 19119.8 |
| PREFLIGHT | USDT | 8954.11668541 | 0 | 8954.11668541 |
| PREFLIGHT | ZRO | 245.125 | 0 | 245.125 |
| CLOSING | DOGE | 19122.6 | 1196 | 20318.6 |
| CLOSING | USDT | 8860.31204995 | 7.98 | 8868.29204995 |
| CLOSING | ZRO | 245.175 | 0 | 245.175 |

PREFLIGHT open orders were captured as count 0, readiness READY. CLOSING was INCOMPLETE with UNRESOLVED_OWNED_ORDERS:2.

These records were already available and are part of the evidence base. The remaining gaps are narrower: no complete ~07:58Z CLOSING open-orders payload has been located to identify both orders, and no later post-fill balance/open-orders snapshot or subsequent Harvester Journal/runtime session has been located to prove post-CLOSING wallet state and Portfolio/RecoveryLedger application. The supplied latest one-order snapshot is not interchangeable with either missing artifact.
