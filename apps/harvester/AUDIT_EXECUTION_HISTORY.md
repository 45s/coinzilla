# Harvester Conservative Strategy Audit — Execution History

**Parent:** [#645](https://github.com/45s/coinzilla/issues/645)  
**Baseline:** `develop` `4af3434f788b87139513921f220294ae90daf4d5`  
**Journal window:** 2026-11-06 07:00:00.896–07:58:16.387 UTC  
**Current-session client ID namespace:** `h-971fc65d9a264984ab8aa7-`

## Run-level sequence

- 07:00:04.113 — PREFLIGHT balances captured: DOGE 19,119.8; USDT 8,954.11668541; ZRO 245.125; all locked balances zero.
- 07:00:04.417 — PREFLIGHT account-wide open-order snapshot: READY, zero orders.
- 07:00:08 onward — initial DOGE and ZRO BUY orders submitted.
- 07:01:41–07:04:47 — BUY fills trigger recovery SELL cancellation/replacement and standing BUY submissions.
- 07:08:47.127 — ZRO recovery cycle completed; free quantity 0.01; realized net profit 0.01136454 USDT.
- 07:58:11.370 — CLOSING account snapshot captured INCOMPLETE with two unresolved owned orders.
- 07:58:16.387 — Harvester stopped after SIGINT; Journal records outcome success. A successful process stop does not override the INCOMPLETE account audit.

## All 23 current-session orders

Order history is newest-first; this table is chronological by client-order sequence. Prices/quantities are the original order values; executed/quote values are the order-history values.

| Client suffix | Symbol | Side | Broker order ID | Price | Original qty | Executed qty | Quote qty | History status |
|---:|---|---|---:|---:|---:|---:|---:|---|
| -1 | DOGEUSDT | BUY | 1276628 | 0.07157 | 400 | 400 | 28.628 | FILLED |
| -2 | ZROUSDT | BUY | 727817 | 1.604 | 5 | 5 | 8.020 | FILLED |
| -3 | DOGEUSDT | SELL | 1276663 | 0.07203 | 398 | 0 | 0 | CANCELED |
| -4 | DOGEUSDT | BUY | 1276664 | 0.07153 | 400 | 400 | 28.612 | FILLED |
| -5 | ZROUSDT | SELL | 727837 | 1.615 | 4.98 | 0 | 0 | CANCELED |
| -6 | ZROUSDT | BUY | 727838 | 1.603 | 5 | 5 | 8.015 | FILLED |
| -7 | ZROUSDT | SELL | 727846 | 1.611 | 9.97 | 0 | 0 | CANCELED |
| -8 | ZROUSDT | BUY | 727847 | 1.602 | 5 | 5 | 8.010 | FILLED |
| -9 | DOGEUSDT | SELL | 1276683 | 0.07191 | 797 | 0 | 0 | CANCELED |
| -10 | DOGEUSDT | BUY | 1276684 | 0.07149 | 400 | 400 | 28.596 | FILLED |
| -11 | DOGEUSDT | SELL | 1276698 | 0.07185 | 1,196 | 1,196 | 85.9326 | FILLED* |
| -12 | ZROUSDT | SELL | 727858 | 1.610 | 14.96 | 0 | 0 | CANCELED |
| -13 | ZROUSDT | BUY | 727859 | 1.601 | 5 | 5 | 8.005 | FILLED |
| -14 | ZROUSDT | SELL | 727860 | 1.609 | 19.95 | 0 | 0 | CANCELED |
| -15 | ZROUSDT | BUY | 727861 | 1.600 | 5 | 5 | 8.000 | FILLED |
| -16 | ZROUSDT | SELL | 727866 | 1.608 | 24.94 | 0 | 0 | CANCELED |
| -17 | ZROUSDT | BUY | 727867 | 1.599 | 5 | 5 | 7.995 | FILLED |
| -18 | ZROUSDT | SELL | 727875 | 1.608 | 29.93 | 0 | 0 | CANCELED |
| -19 | ZROUSDT | BUY | 727876 | 1.598 | 5 | 5 | 7.990 | FILLED |
| -20 | ZROUSDT | SELL | 727891 | 1.607 | 34.92 | 0 | 0 | CANCELED |
| -21 | ZROUSDT | BUY | 727892 | 1.597 | 5 | 5 | 7.985 | FILLED |
| -22 | ZROUSDT | SELL | 727904 | 1.606 | 39.91 | 39.91 | 64.09546 | FILLED |
| -23 | ZROUSDT | BUY | 727905 | 1.596 | 5 | 0 | 0 | NEW |

`* FILLED` is the order-history status only; it conflicts with the Journal/account closing evidence and must not be treated as reconciled.

All current-session order IDs correlate to the Journal's submission acknowledgements. The Journal records nine cancellation requests and nine cancellation confirmations for the nine SELL orders with suffixes -3, -5, -7, -9, -12, -14, -16, -18, and -20. Each canceled order reports zero executed quantity in order history.

## Applied execution ledger

Execution times below are Binance trade timestamps in epoch milliseconds; Journal event times are separately recorded in the raw JSONL.

| Symbol | Trade ID | Broker order ID | Side | Price | Base qty | Quote qty | Commission asset/amount |
|---|---:|---:|---|---:|---:|---:|---|
| DOGEUSDT | 221733 | 1276628 | BUY | 0.07157 | 400 | 28.628 | DOGE 0.4 |
| DOGEUSDT | 221736 | 1276664 | BUY | 0.07153 | 400 | 28.612 | DOGE 0.4 |
| DOGEUSDT | 221738 | 1276684 | BUY | 0.07149 | 400 | 28.596 | DOGE 0.4 |
| ZROUSDT | 11658 | 727817 | BUY | 1.604 | 5 | 8.020 | ZRO 0.005 |
| ZROUSDT | 11659 | 727838 | BUY | 1.603 | 5 | 8.015 | ZRO 0.005 |
| ZROUSDT | 11660 | 727847 | BUY | 1.602 | 5 | 8.010 | ZRO 0.005 |
| ZROUSDT | 11661 | 727859 | BUY | 1.601 | 5 | 8.005 | ZRO 0.005 |
| ZROUSDT | 11662 | 727861 | BUY | 1.600 | 5 | 8.000 | ZRO 0.005 |
| ZROUSDT | 11663 | 727867 | BUY | 1.599 | 5 | 7.995 | ZRO 0.005 |
| ZROUSDT | 11664 | 727876 | BUY | 1.598 | 5 | 7.990 | ZRO 0.005 |
| ZROUSDT | 11665 | 727892 | BUY | 1.597 | 5 | 7.985 | ZRO 0.005 |
| ZROUSDT | 11666 | 727904 | SELL | 1.606 | 39.91 | 64.09546 | USDT 0.06409546 |

Journal applied-fill identity is `binance:<symbol>:<tradeId>`. The Journal records 13 duplicate-fill notifications: ZRO trade 11661 is replayed at 07:02:40.928Z, then all 12 applied fills are replayed again at CLOSING (07:58:11.075–07:58:11.077Z). No duplicate replay adds another execution to the ledger.

## Strategy decision to order correlation

The 13 Journal `strategy.decision` records map to the 23 order intents as follows. Client suffixes are the final sequence component of `h-971fc65d9a264984ab8aa7-<n>`.

| Decision time UTC | Symbol | Reference price | Action(s) and matching client suffix |
|---|---|---:|---|
| 07:00:08.056 | DOGEUSDT | 0.07161000 | BUY 400 @ 0.07157 — -1 INITIAL_BUY |
| 07:00:08.661 | ZROUSDT | 1.60500000 | BUY 5 @ 1.604 — -2 INITIAL_BUY |
| 07:01:41.006 | DOGEUSDT | 0.07157000 | SELL 398 @ 0.07203 — -3 RECOVER_INVESTED_CAPITAL_AND_MIN_PROFIT; BUY 400 @ 0.07153 — -4 NEXT_STANDING_BUY |
| 07:01:47.376 | ZROUSDT | 1.60400000 | SELL 4.98 @ 1.615 — -5 RECOVER_INVESTED_CAPITAL_AND_MIN_PROFIT; BUY 5 @ 1.603 — -6 NEXT_STANDING_BUY |
| 07:02:05.052 | ZROUSDT | 1.60300000 | SELL 9.97 @ 1.611 — -7 RECOVER_INVESTED_CAPITAL_AND_MIN_PROFIT; BUY 5 @ 1.602 — -8 NEXT_STANDING_BUY |
| 07:02:14.833 | DOGEUSDT | 0.07153000 | SELL 797 @ 0.07191 — -9 RECOVER_INVESTED_CAPITAL_AND_MIN_PROFIT; BUY 400 @ 0.07149 — -10 NEXT_STANDING_BUY |
| 07:02:31.008 | DOGEUSDT | 0.07149000 | SELL 1,196 @ 0.07185 — -11 RECOVER_INVESTED_CAPITAL_AND_MIN_PROFIT |
| 07:02:37.604 | ZROUSDT | 1.60200000 | SELL 14.96 @ 1.61 — -12 RECOVER_INVESTED_CAPITAL_AND_MIN_PROFIT; BUY 5 @ 1.601 — -13 NEXT_STANDING_BUY |
| 07:02:40.312 | ZROUSDT | 1.60200000 | SELL 19.95 @ 1.609 — -14 RECOVER_INVESTED_CAPITAL_AND_MIN_PROFIT; BUY 5 @ 1.600 — -15 NEXT_STANDING_BUY |
| 07:02:53.814 | ZROUSDT | 1.60000000 | SELL 24.94 @ 1.608 — -16 RECOVER_INVESTED_CAPITAL_AND_MIN_PROFIT; BUY 5 @ 1.599 — -17 NEXT_STANDING_BUY |
| 07:03:09.962 | ZROUSDT | 1.59900000 | SELL 29.93 @ 1.608 — -18 RECOVER_INVESTED_CAPITAL_AND_MIN_PROFIT; BUY 5 @ 1.598 — -19 NEXT_STANDING_BUY |
| 07:04:14.631 | ZROUSDT | 1.59800000 | SELL 34.92 @ 1.607 — -20 RECOVER_INVESTED_CAPITAL_AND_MIN_PROFIT; BUY 5 @ 1.597 — -21 NEXT_STANDING_BUY |
| 07:04:46.922 | ZROUSDT | 1.59700000 | SELL 39.91 @ 1.606 — -22 RECOVER_INVESTED_CAPITAL_AND_MIN_PROFIT; BUY 5 @ 1.596 — -23 NEXT_STANDING_BUY |

The initial decision created one BUY per enabled market. Subsequent filled BUY transitions produced a recovery SELL intent first and, where present, the next standing BUY intent. The nine prior SELL intents (-3, -5, -7, -9, -12, -14, -16, -18, -20) were canceled with zero execution before their replacements. The final ZRO SELL (-22) filled; its paired standing BUY (-23) remained NEW. The final DOGE SELL (-11) remains the cross-source status conflict described in AUDIT.md.

## Balance and order-state cross-check

| Asset | PREFLIGHT total | CLOSING free | CLOSING locked | CLOSING total | Delta |
|---|---:|---:|---:|---:|---:|
| DOGE | 19,119.8 | 19,122.6 | 1,196 | 20,318.6 | +1,198.8 |
| USDT | 8,954.11668541 | 8,860.31204995 | 7.98 | 8,868.29204995 | −85.82463546 |
| ZRO | 245.125 | 245.175 | 0 | 245.175 | +0.05 |

ZRO order 727905 is consistent across order history, the supplied open-orders snapshot, and the 7.98 USDT locked balance. DOGE order 1276698 is not consistent across order history, Journal state, and the 1,196 DOGE locked balance. The CLOSING account event's exchange sourceTime (1793948926965 / 2026-11-06T07:08:46.965Z) exactly matches ZRO SELL trade 11666's executedAt; the CLOSING Journal event timestamp is 07:58:11.370Z. Treat these as distinct source/event timestamps; do not infer snapshot query time from sourceTime.

## Evidence not available

The original `harvester.log` and `harvester-trace.log` are referenced by #645 and their sizes/line counts/checksums are recorded in its evidence inventory. They were not accessible to this execution session and were not parsed. Consequently, this derived ledger does not claim to correlate all application DEBUG/TRACE records or establish the cause of the DOGE conflict. No excerpts were substituted for the original files.
