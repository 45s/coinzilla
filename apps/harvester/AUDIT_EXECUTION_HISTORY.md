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

The order-history timestamp is the exchange order creation/time field in the supplied CLI export. Client IDs share the prefix `h-971fc65d9a264984ab8aa7-`; the suffix is the per-session sequence. Prices and quantities are exact exported strings.

| Client suffix | Order-history time UTC | Symbol | Side | Binance orderId | Price | Original qty | Executed qty | Quote qty | History status |
|---:|---|---|---|---:|---:|---:|---:|---:|---|
| -1 | 2026-11-06T07:00:08.202Z | DOGEUSDT | BUY | 1276628 | 0.07157000 | 400.00000000 | 400.00000000 | 28.62800000 | FILLED |
| -2 | 2026-11-06T07:00:08.808Z | ZROUSDT | BUY | 727817 | 1.60400000 | 5.00000000 | 5.00000000 | 8.02000000 | FILLED |
| -3 | 2026-11-06T07:01:41.153Z | DOGEUSDT | SELL | 1276663 | 0.07203000 | 398.00000000 | 0.00000000 | 0.00000000 | CANCELED |
| -4 | 2026-11-06T07:01:41.456Z | DOGEUSDT | BUY | 1276664 | 0.07153000 | 400.00000000 | 400.00000000 | 28.61200000 | FILLED |
| -5 | 2026-11-06T07:01:47.527Z | ZROUSDT | SELL | 727837 | 1.61500000 | 4.98000000 | 0.00000000 | 0.00000000 | CANCELED |
| -6 | 2026-11-06T07:01:47.830Z | ZROUSDT | BUY | 727838 | 1.60300000 | 5.00000000 | 5.00000000 | 8.01500000 | FILLED |
| -7 | 2026-11-06T07:02:05.195Z | ZROUSDT | SELL | 727846 | 1.61100000 | 9.97000000 | 0.00000000 | 0.00000000 | CANCELED |
| -8 | 2026-11-06T07:02:05.500Z | ZROUSDT | BUY | 727847 | 1.60200000 | 5.00000000 | 5.00000000 | 8.01000000 | FILLED |
| -9 | 2026-11-06T07:02:14.978Z | DOGEUSDT | SELL | 1276683 | 0.07191000 | 797.00000000 | 0.00000000 | 0.00000000 | CANCELED |
| -10 | 2026-11-06T07:02:15.284Z | DOGEUSDT | BUY | 1276684 | 0.07149000 | 400.00000000 | 400.00000000 | 28.59600000 | FILLED |
| -11 | 2026-11-06T07:02:31.151Z | DOGEUSDT | SELL | 1276698 | 0.07185000 | 1196.00000000 | 1196.00000000 | 85.93260000 | FILLED* |
| -12 | 2026-11-06T07:02:37.746Z | ZROUSDT | SELL | 727858 | 1.61000000 | 14.96000000 | 0.00000000 | 0.00000000 | CANCELED |
| -13 | 2026-11-06T07:02:38.051Z | ZROUSDT | BUY | 727859 | 1.60100000 | 5.00000000 | 5.00000000 | 8.00500000 | FILLED |
| -14 | 2026-11-06T07:02:40.455Z | ZROUSDT | SELL | 727860 | 1.60900000 | 19.95000000 | 0.00000000 | 0.00000000 | CANCELED |
| -15 | 2026-11-06T07:02:40.761Z | ZROUSDT | BUY | 727861 | 1.60000000 | 5.00000000 | 5.00000000 | 8.00000000 | FILLED |
| -16 | 2026-11-06T07:02:53.960Z | ZROUSDT | SELL | 727866 | 1.60800000 | 24.94000000 | 0.00000000 | 0.00000000 | CANCELED |
| -17 | 2026-11-06T07:02:54.264Z | ZROUSDT | BUY | 727867 | 1.59900000 | 5.00000000 | 5.00000000 | 7.99500000 | FILLED |
| -18 | 2026-11-06T07:03:10.107Z | ZROUSDT | SELL | 727875 | 1.60800000 | 29.93000000 | 0.00000000 | 0.00000000 | CANCELED |
| -19 | 2026-11-06T07:03:10.417Z | ZROUSDT | BUY | 727876 | 1.59800000 | 5.00000000 | 5.00000000 | 7.99000000 | FILLED |
| -20 | 2026-11-06T07:04:14.775Z | ZROUSDT | SELL | 727891 | 1.60700000 | 34.92000000 | 0.00000000 | 0.00000000 | CANCELED |
| -21 | 2026-11-06T07:04:15.080Z | ZROUSDT | BUY | 727892 | 1.59700000 | 5.00000000 | 5.00000000 | 7.98500000 | FILLED |
| -22 | 2026-11-06T07:04:47.064Z | ZROUSDT | SELL | 727904 | 1.60600000 | 39.91000000 | 39.91000000 | 64.09546000 | FILLED |
| -23 | 2026-11-06T07:04:47.368Z | ZROUSDT | BUY | 727905 | 1.59600000 | 5.00000000 | 0.00000000 | 0.00000000 | NEW |

`* FILLED` is the order-history status only; it conflicts with the Journal/account closing evidence and must not be treated as reconciled.

The Journal records nine cancellation requests and nine cancellation confirmations for the nine SELL orders with suffixes -3, -5, -7, -9, -12, -14, -16, -18, and -20. Each canceled order reports zero executed quantity in order history.

## Applied execution ledger

The Journal's canonical fill identity is `binance:<symbol>:<tradeId>`. Both the Journal event time and exchange `executedAt` are shown; the latter is the millisecond timestamp carried by the fill DTO.

| Symbol | Journal event UTC | Exchange executedAt UTC | Client suffix | Trade ID | Binance orderId | Side | Price | Base qty | Quote qty | Actual commission | Liquidity | Commission status |
|---|---|---|---:|---:|---:|---|---:|---:|---:|---|---|---|
| DOGEUSDT | 2026-11-06T07:01:41.004Z | 2026-11-06T07:01:40.846Z | -1 | 221733 | 1276628 | BUY | 0.07157 | 400 | 28.628 | 0.4 DOGE | MAKER | COMPLETE |
| ZROUSDT | 2026-11-06T07:01:47.374Z | 2026-11-06T07:01:47.219Z | -2 | 11658 | 727817 | BUY | 1.604 | 5 | 8.02 | 0.005 ZRO | MAKER | COMPLETE |
| ZROUSDT | 2026-11-06T07:02:03.551Z | 2026-11-06T07:02:03.388Z | -6 | 11659 | 727838 | BUY | 1.603 | 5 | 8.015 | 0.005 ZRO | MAKER | COMPLETE |
| DOGEUSDT | 2026-11-06T07:02:13.334Z | 2026-11-06T07:02:13.170Z | -4 | 221736 | 1276664 | BUY | 0.07153 | 400 | 28.612 | 0.4 DOGE | MAKER | COMPLETE |
| DOGEUSDT | 2026-11-06T07:02:29.509Z | 2026-11-06T07:02:29.345Z | -10 | 221738 | 1276684 | BUY | 0.07149 | 400 | 28.596 | 0.4 DOGE | MAKER | COMPLETE |
| ZROUSDT | 2026-11-06T07:02:36.107Z | 2026-11-06T07:02:35.944Z | -8 | 11660 | 727847 | BUY | 1.602 | 5 | 8.01 | 0.005 ZRO | MAKER | COMPLETE |
| ZROUSDT | 2026-11-06T07:02:38.812Z | 2026-11-06T07:02:38.051Z | -13 | 11661 | 727859 | BUY | 1.601 | 5 | 8.005 | 0.005 ZRO | TAKER | COMPLETE |
| ZROUSDT | 2026-11-06T07:02:52.317Z | 2026-11-06T07:02:52.152Z | -15 | 11662 | 727861 | BUY | 1.6 | 5 | 8 | 0.005 ZRO | MAKER | COMPLETE |
| ZROUSDT | 2026-11-06T07:03:08.450Z | 2026-11-06T07:03:08.289Z | -17 | 11663 | 727867 | BUY | 1.599 | 5 | 7.995 | 0.005 ZRO | MAKER | COMPLETE |
| ZROUSDT | 2026-11-06T07:04:13.128Z | 2026-11-06T07:04:12.964Z | -19 | 11664 | 727876 | BUY | 1.598 | 5 | 7.99 | 0.005 ZRO | MAKER | COMPLETE |
| ZROUSDT | 2026-11-06T07:04:45.423Z | 2026-11-06T07:04:45.259Z | -21 | 11665 | 727892 | BUY | 1.597 | 5 | 7.985 | 0.005 ZRO | MAKER | COMPLETE |
| ZROUSDT | 2026-11-06T07:08:47.124Z | 2026-11-06T07:08:46.965Z | -22 | 11666 | 727904 | SELL | 1.606 | 39.91 | 64.09546 | 0.06409546 USDT | MAKER | COMPLETE |

The Journal records 13 duplicate-fill notifications: ZRO trade 11661 is replayed at 07:02:40.928Z, then all 12 applied fills are replayed at CLOSING (07:58:11.075–07:58:11.077Z). No duplicate replay adds another execution to the ledger.

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

## Original application logs — verified and parsed

The original `harvester.log` and `harvester-trace.log` were read-only inspected, independently SHA-256 verified against #645, and parsed. Integrity metadata, exact line references, ZRO Portfolio/RecoveryLedger transitions, DOGE final runtime state, shutdown execution inventory, and timestamp interpretation are preserved in [AUDIT_LOG_EVIDENCE_2026-11-06.md](./AUDIT_LOG_EVIDENCE_2026-11-06.md). ZRO runtime accounting is now directly observed. DOGE order 1276698 is OPEN/zero-executed in the last runtime evaluations and no DOGE SELL appears in the 12 shutdown execution records, but the separate exchange order-history row reports FILLED; retain CONFLICT. The logs do not identify the second CLOSING unresolved order with certainty.

## Expanded per-symbol decision and lifecycle interpretation

### DOGEUSDT decision sequence

| # | Decision UTC | Strategy decision | Order action | Observed result | Status |
|---:|---|---|---|---|---|
| 1 | 07:00:08.056 | Initial BUY, reference 0.07161000 | BUY 400 @ 0.07157, suffix -1 | 1276628 FILLED; trade 221733 applied; 0.4 DOGE fee | PASS |
| 2 | 07:01:41.006 | BUY-fill transition, reference 0.07157000 | SELL 398 @ 0.07203 (-3); BUY 400 @ 0.07153 (-4) | SELL 1276663 canceled zero; BUY 1276664 filled | PASS observed |
| 3 | 07:02:14.833 | BUY-fill transition, reference 0.07153000 | SELL 797 @ 0.07191 (-9); BUY 400 @ 0.07149 (-10) | SELL 1276683 canceled zero; BUY 1276684 filled | PASS observed |
| 4 | 07:02:31.008 | BUY-fill transition, reference 0.07149000 | SELL 1,196 @ 0.07185 (-11) | History FILLED; Journal OPEN; no applied SELL fill; 1,196 DOGE locked at close | CONFLICT |

DOGE BUY checkpoint: 1,200 gross - 1.2 DOGE BUY fees = 1,198.8 net. The SELL is excluded from realized accounting until conflict is resolved. The account DOGE delta +1,198.8 matches BUY net exactly.

### ZROUSDT decision sequence

| # | Decision UTC | Strategy decision | Order action | Observed result | Status |
|---:|---|---|---|---|---|
| 1 | 07:00:08.661 | Initial BUY, reference 1.605 | BUY 5 @ 1.604 (-2) | 727817 / trade 11658 filled; 0.005 ZRO fee | PASS |
| 2 | 07:01:47.376 | BUY transition, reference 1.604 | SELL 4.98 (-5); BUY 5 @ 1.603 (-6) | SELL 727837 canceled zero; BUY 727838 filled | PASS observed |
| 3 | 07:02:05.052 | BUY transition, reference 1.603 | SELL 9.97 (-7); BUY 5 @ 1.602 (-8) | SELL 727846 canceled zero; BUY 727847 filled | PASS |
| 4 | 07:02:37.604 | BUY transition, reference 1.602 | SELL 14.96 (-12); BUY 5 @ 1.601 (-13) | SELL 727858 canceled zero; BUY 727859 filled | PASS |
| 5 | 07:02:40.312 | BUY transition, reference 1.602 | SELL 19.95 (-14); BUY 5 @ 1.600 (-15) | SELL 727860 canceled zero; BUY 727861 filled | PASS |
| 6 | 07:02:53.814 | BUY transition, reference 1.600 | SELL 24.94 (-16); BUY 5 @ 1.599 (-17) | SELL 727866 canceled zero; BUY 727867 filled | PASS |
| 7 | 07:03:09.962 | BUY transition, reference 1.599 | SELL 29.93 (-18); BUY 5 @ 1.598 (-19) | SELL 727875 canceled zero; BUY 727876 filled | PASS |
| 8 | 07:04:14.631 | BUY transition, reference 1.598 | SELL 34.92 (-20); BUY 5 @ 1.597 (-21) | SELL 727891 canceled zero; BUY 727892 filled | PASS |
| 9 | 07:04:46.922 | BUY transition, reference 1.597 | SELL 39.91 @ 1.606 (-22); BUY 5 @ 1.596 (-23) | SELL 727904 filled; trade 11666 applied; completion recorded; BUY 727905 remains NEW | PARTIAL |

The nine canceled SELLs are not executions. Their zero executed quantities contribute no base debit, quote proceeds, or realized PnL.

## Order-state vocabulary

- INITIAL_BUY: first BUY intent after initial market evaluation.
- NEXT_STANDING_BUY: subsequent BUY intent after a BUY-fill decision; intent does not mean filled.
- RECOVER_INVESTED_CAPITAL_AND_MIN_PROFIT: strategy SELL intent; intent does not mean execution.
- NEW: order-history/open-order state with zero execution in this run.
- CANCELED: terminal history state; all nine canceled SELLs report zero executed.
- FILLED*: history reports FILLED but Journal/account contradict it; not a reconciled fill.
- execution.fill_applied: canonical fill applied to Journal/accounting.
- execution.duplicate_fill: duplicate notification; must not change balances twice.
- recovery.cycle_completed: completion event; still requires eligibility, commission, Portfolio, and RecoveryLedger verification.

## Explicit event gaps

1. Original app logs were unavailable. No exact DEBUG/TRACE decision rationale, market tick, filter response, retry timing, WebSocket reconnect, or cancel/replace interleaving is claimed.
2. Full CLOSING open-order payload is absent. ZRO 727905 is identified; the second unresolved order is unknown.
3. DOGE order 1276698 history creation time is 07:02:31.151Z; decision time is 07:02:31.008Z. Neither proves when terminal status changed. Need order update time and trade execution timestamps.
4. ZRO trade 11666 exchange executedAt 07:08:46.965Z; Journal fill applied 07:08:47.124Z; completion 07:08:47.127Z. CLOSING event at 07:58:11.370Z carries sourceTime equal to the earlier trade timestamp; do not treat sourceTime as snapshot event time.
5. Journal shows one early duplicate for ZRO trade 11661 and duplicate replays of all 12 applied fills during CLOSING. This does not prove all crash/reconnect permutations.

## Reconciliation equations

DOGE BUY: gross 400 + 400 + 400 = 1,200 DOGE; fees 0.4 + 0.4 + 0.4 = 1.2; net 1,198.8 DOGE; quote debit 28.628 + 28.612 + 28.596 = 85.836 USDT. Closing DOGE delta = (19,122.6 free + 1,196 locked) - 19,119.8 = +1,198.8 DOGE. Exclude SELL from realized accounting until resolved.

ZRO: gross BUY 8 × 5 = 40; BUY fees 8 × 0.005 = 0.04; SELL 39.91; residual 40 - 0.04 - 39.91 = 0.05 ZRO. Gross SELL quote 39.91 × 1.606 = 64.09546; quote fee 0.06409546; net proceeds 64.03136454; BUY cost 64.02; realized net +0.01136454 USDT. Combined USDT delta -85.836 + 0.01136454 = -85.82463546, matching account total change.

These equations prove ZRO arithmetic and DOGE BUY leg only. They do not resolve DOGE SELL or prove complete in-memory ownership state.


## Expanded per-symbol decision and lifecycle interpretation

### DOGEUSDT decision sequence

| # | Decision UTC | Strategy decision | Order action | Observed result | Status |
|---:|---|---|---|---|---|
| 1 | 07:00:08.056 | Initial BUY, reference 0.07161000 | BUY 400 @ 0.07157, suffix -1 | 1276628 FILLED; trade 221733 applied; 0.4 DOGE fee | PASS |
| 2 | 07:01:41.006 | BUY-fill transition, reference 0.07157000 | SELL 398 @ 0.07203 (-3); BUY 400 @ 0.07153 (-4) | SELL 1276663 canceled zero; BUY 1276664 filled | PASS observed |
| 3 | 07:02:14.833 | BUY-fill transition, reference 0.07153000 | SELL 797 @ 0.07191 (-9); BUY 400 @ 0.07149 (-10) | SELL 1276683 canceled zero; BUY 1276684 filled | PASS observed |
| 4 | 07:02:31.008 | BUY-fill transition, reference 0.07149000 | SELL 1,196 @ 0.07185 (-11) | History FILLED; Journal OPEN; no applied SELL fill; 1,196 DOGE locked at close | CONFLICT |

DOGE BUY checkpoint: 1,200 gross - 1.2 DOGE BUY fees = 1,198.8 net. The SELL is excluded from realized accounting until conflict is resolved. Account DOGE delta +1,198.8 matches BUY net exactly.

### ZROUSDT decision sequence

| # | Decision UTC | Strategy decision | Order action | Observed result | Status |
|---:|---|---|---|---|---|
| 1 | 07:00:08.661 | Initial BUY, reference 1.605 | BUY 5 @ 1.604 (-2) | 727817 / trade 11658 filled; 0.005 ZRO fee | PASS |
| 2 | 07:01:47.376 | BUY transition, reference 1.604 | SELL 4.98 (-5); BUY 5 @ 1.603 (-6) | SELL 727837 canceled zero; BUY 727838 filled | PASS observed |
| 3 | 07:02:05.052 | BUY transition, reference 1.603 | SELL 9.97 (-7); BUY 5 @ 1.602 (-8) | SELL 727846 canceled zero; BUY 727847 filled | PASS |
| 4 | 07:02:37.604 | BUY transition, reference 1.602 | SELL 14.96 (-12); BUY 5 @ 1.601 (-13) | SELL 727858 canceled zero; BUY 727859 filled | PASS |
| 5 | 07:02:40.312 | BUY transition, reference 1.602 | SELL 19.95 (-14); BUY 5 @ 1.600 (-15) | SELL 727860 canceled zero; BUY 727861 filled | PASS |
| 6 | 07:02:53.814 | BUY transition, reference 1.600 | SELL 24.94 (-16); BUY 5 @ 1.599 (-17) | SELL 727866 canceled zero; BUY 727867 filled | PASS |
| 7 | 07:03:09.962 | BUY transition, reference 1.599 | SELL 29.93 (-18); BUY 5 @ 1.598 (-19) | SELL 727875 canceled zero; BUY 727876 filled | PASS |
| 8 | 07:04:14.631 | BUY transition, reference 1.598 | SELL 34.92 (-20); BUY 5 @ 1.597 (-21) | SELL 727891 canceled zero; BUY 727892 filled | PASS |
| 9 | 07:04:46.922 | BUY transition, reference 1.597 | SELL 39.91 @ 1.606 (-22); BUY 5 @ 1.596 (-23) | SELL 727904 filled; trade 11666 applied; completion recorded; BUY 727905 remains NEW | PARTIAL |

The nine canceled SELLs are not executions. Their zero executed quantities contribute no base debit, quote proceeds, or realized PnL.

## Order-state vocabulary

- INITIAL_BUY: first BUY intent after initial market evaluation.
- NEXT_STANDING_BUY: subsequent BUY intent after a BUY-fill decision; intent does not mean filled.
- RECOVER_INVESTED_CAPITAL_AND_MIN_PROFIT: strategy SELL intent; intent does not mean execution.
- NEW: order-history/open-order state with zero execution in this run.
- CANCELED: terminal history state; all nine canceled SELLs report zero executed.
- FILLED*: history reports FILLED but Journal/account contradict it; not a reconciled fill.
- execution.fill_applied: canonical fill applied to Journal/accounting.
- execution.duplicate_fill: duplicate notification; must not change balances twice.
- recovery.cycle_completed: completion event; still requires eligibility, commission, Portfolio, and RecoveryLedger verification.

## Explicit event gaps

1. Original app logs were unavailable. No exact DEBUG/TRACE decision rationale, market tick, filter response, retry timing, WebSocket reconnect, or cancel/replace interleaving is claimed.
2. Full CLOSING open-order payload is absent. ZRO 727905 is identified; the second unresolved order is unknown.
3. DOGE order 1276698 history creation time is 07:02:31.151Z; decision time is 07:02:31.008Z. Neither proves when terminal status changed. Need order update time and trade execution timestamps.
4. ZRO trade 11666 exchange executedAt 07:08:46.965Z; Journal fill applied 07:08:47.124Z; completion 07:08:47.127Z. CLOSING event 07:58:11.370Z carries sourceTime equal to the earlier trade timestamp; do not treat sourceTime as snapshot event time.
5. Journal shows one early duplicate for ZRO trade 11661 and duplicate replays of all 12 applied fills during CLOSING. This does not prove all crash/reconnect permutations.

## Reconciliation equations

DOGE BUY: gross 400 + 400 + 400 = 1,200 DOGE; fees 0.4 + 0.4 + 0.4 = 1.2; net 1,198.8 DOGE; quote debit 28.628 + 28.612 + 28.596 = 85.836 USDT. Closing DOGE delta = (19,122.6 free + 1,196 locked) - 19,119.8 = +1,198.8 DOGE. Exclude SELL from realized accounting until resolved.

ZRO: gross BUY 8 × 5 = 40; BUY fees 8 × 0.005 = 0.04; SELL 39.91; residual 40 - 0.04 - 39.91 = 0.05 ZRO. Gross SELL quote 39.91 × 1.606 = 64.09546; quote fee 0.06409546; net proceeds 64.03136454; BUY cost 64.02; realized net +0.01136454 USDT. Combined USDT delta -85.836 + 0.01136454 = -85.82463546, matching account total change.

These equations prove ZRO arithmetic and DOGE BUY leg only. They do not resolve DOGE SELL or prove complete in-memory ownership state.


## Verified log-derived lifecycle update — 2026-11-06

- ZRO SELL trade 11666/order 727904: applied once; actual quote commission 0.06409546 USDT; net proceeds 64.03136454 USDT; Portfolio quote cash flow +0.01136454 USDT; RecoveryLedger outstanding reached zero. Recovery completion allocated 0.01 ZRO free, retained 0.04 active residual, and reset cycle totals. The next market evaluation preserved 0.04 active + 0.01 free.
- DOGE SELL 1276698/client suffix -11: last observed evaluations show OPEN, executed 0, remaining 1,196; Portfolio remains 1,198.8 DOGE; RecoveryLedger proceeds remain zero. No DOGE SELL execution is among the 12 shutdown execution records. Exchange order history still reports FILLED, so terminal state and realized PnL remain CONFLICT.
- ZRO BUY 727905/client suffix -23 remains confirmed NEW with 7.98 USDT locked. DOGE 1276698 is only a candidate for the other unresolved order until the complete CLOSING open-order payload is available.


## 2026-11-06 post-CLOSING exchange trade timeline (operator-supplied read-only exports)

The complete 50-row DOGE and ZRO trade-history outputs are preserved in [AUDIT_DOGE_TRADES_2026-11-06.md](./AUDIT_DOGE_TRADES_2026-11-06.md) and [AUDIT_ZRO_TRADES_2026-11-06.md](./AUDIT_ZRO_TRADES_2026-11-06.md).

| UTC timestamp | Symbol | Trade | Order | Side | Qty | Quote | Fee |
|---|---|---:|---:|---|---:|---:|---:|
| 2026-11-06 07:08:46.965 | ZROUSDT | 11666 | 727904 | SELL | 39.91 ZRO | 64.09546000 USDT | 0.06409546 USDT |
| 2026-11-06 08:03:01.841 | DOGEUSDT | 221990 | 1276698 | SELL | 278 DOGE | 19.97430000 USDT | 0.01997430 USDT |
| 2026-11-06 08:03:18.202 | DOGEUSDT | 221991 | 1276698 | SELL | 918 DOGE | 65.95830000 USDT | 0.06595830 USDT |
| 2026-11-06 08:38:24.782 | ZROUSDT | 12182 | 727905 | BUY | 5 ZRO | 7.98000000 USDT | 0.005 ZRO |

DOGE 1276698: 1,196 DOGE total; 85.93260000 USDT gross proceeds; 0.08593260 USDT commission; 85.84666740 USDT net. ZRO 727905: 5 ZRO gross less 0.005 ZRO fee = 4.995 ZRO net; 7.98 USDT quote debit. ZRO 727904: 64.09546 gross less 0.06409546 fee = 64.03136454 net; against 64.02 cost gives +0.01136454 USDT realized net.

Chronology is decisive: DOGE 1276698 fills at 08:03, after ~07:58 CLOSING; ZRO 727905 fills at 08:38, after ~07:58 CLOSING. The closing audit's two unresolved owned orders were therefore pending at that snapshot. The later evidence identifies both known order IDs as subsequently filled, but only one was confirmed among the two unresolved at close (ZRO 727905); DOGE's candidate identity is now supported by its matching post-close fill, but the full closing payload is still needed to prove the second identity conclusively. Neither post-close fill proves internal Harvester processing.


## 2026-11-06 11:57 UTC — repository and CI verification

- Re-read PR #653 metadata and branch ref. PR is OPEN, unmerged, base `develop`; branch `docs/harvester-log-evidence-2026-11-06` matched HEAD `94650284a05e0e18cda662d5a41bce0a47788ac8` at verification start.
- Confirmed the PR changed-file list contains all seven expected evidence/audit documents; fetched all seven from the branch. The DOGE and ZRO raw trade addenda each retain the complete operator-provided 50-row bounded result, including displayed commission fields; no exhaustive-history claim is made.
- Exact-HEAD Actions runs: JavaScript Syntax 42213769852 PASS; Test Coverage 42213769902 PASS; Dependency Audit 42213769838 PASS; Unit Tests 42213769873 PASS; Utils Unit Tests 42213769913 PASS. Inspected jobs completed successfully. The read-only Binance TESTNET integration job in Unit Tests was SKIPPED.
- The separate commit-status API response was `pending`, `total_count=0`; record it as a distinct status signal, not as an Actions failure or success.
- No PR reviews or inline review threads were present at the time of inspection.
- No fresh TESTNET balances/open orders, full historical CLOSING open-order payload, or later Harvester Journal/runtime session were available. The connector cannot read GitHub secret values or dispatch the secret-backed exchange workflow. Current DOGE/ZRO/USDT balances and post-CLOSING internal processing remain UNVERIFIED.
- #649 is closed after merge of exact-once regression coverage; #646 remains open for product decisions; #626 remains open for the original empty-TypeError disposition and controlled TESTNET/owner acceptance.
- No exchange mutation, order change/cancel/replace, withdrawal, account-setting change, or bot restart occurred. TESTNET acceptance remains NOT ACCEPTED.
