# Harvester Conservative Strategy Audit

**Parent:** [#645 — Harvester Conservative Strategy Audit](https://github.com/45s/coinzilla/issues/645)  
**Audit baseline:** `develop` at `4af3434f788b87139513921f220294ae90daf4d5` (2026-11-06; PR #644 merge commit)  
**Evidence session:** 2026-11-06 07:00:00.896–07:58:16.387 UTC  
**Status:** PARTIAL — ZRO arithmetic reconciles; DOGE execution/order state conflicts; original application logs were not accessible in this execution session.  
**Safety:** No TESTNET orders, bot restarts, credential requests, or exchange writes were performed.

## Executive result

The accessible Journal and the two verbatim 100-row order-history comments establish 23 Harvester order submissions in the 07:00 session: six DOGEUSDT orders and seventeen ZROUSDT orders. The Journal records 12 applied fills, 13 duplicate-fill events, nine cancellation requests and nine confirmed cancellations, and one ZRO recovery-cycle completion.

ZRO independently reconciles at the execution and account-balance levels. DOGE does not: order history reports the final 1,196-DOGE SELL as FILLED, while the Journal retains its order as OPEN, the closing account snapshot contains 1,196 DOGE locked, and no DOGE SELL fill is applied in the Journal. The closing account audit correctly reports INCOMPLETE with two unresolved owned orders.

Do not treat the session as a successful two-symbol reconciliation.

## Evidence and provenance

| Evidence | Source | Review status |
|---|---|---|
| Original Journal JSONL, 114 records / 50,317 bytes | [#645 original Journal comment](https://github.com/45s/coinzilla/issues/645#issuecomment-6680290142) | Full 114-record JSONL parsed |
| DOGEUSDT order history, 100 rows | [#645 DOGE order-history comment](https://github.com/45s/coinzilla/issues/645#issuecomment-6680477550) | All 100 rows parsed; six current-session orders isolated |
| ZROUSDT order history, 100 rows | [#645 ZRO order-history comment](https://github.com/45s/coinzilla/issues/645#issuecomment-6680478011) | All 100 rows parsed; seventeen current-session orders isolated |
| Latest open-orders snapshot | [#645 evidence inventory](https://github.com/45s/coinzilla/issues/645#issuecomment-6680483675) | One ZRO BUY order 727905 NEW, corroborated |
| `harvester.log` | Original conversation attachment; 16,878,030 bytes, 4,880 lines | UNVERIFIED — not mounted/exposed in this execution session; not substituted with excerpts |
| `harvester-trace.log` | Original conversation attachment; 17,021,746 bytes, 5,739 lines | UNVERIFIED — not mounted/exposed in this execution session; not substituted with excerpts |

Original log checksums recorded in #645 (not recomputed here):
- `harvester.log`: `5be28db5f6bc998e1190c1bddf4a91c97703fe9e502e98422932511a56ff633d`
- `harvester-trace.log`: `4a030ccc4cd645b42ffdf01cb285d4cb1fa5d54417f8845a076448f1d20abcd3`

Order-history pasted-text checksums recorded in #645:
- DOGE: `d581684f0bed7cb33dbffcf080cc165fd78f941024587f860e77af2956110807`
- ZRO: `11fd8e7cba56871eaf01cc00b6ea2693a3d0a74d9c05241780813849e64a25be`

Raw evidence remains unchanged in the parent issue. This audit contains derived calculations only. The 100-row histories include orders from prior sessions; the current session is isolated by client-ID prefix `h-971fc65d9a264984ab8aa7-`. Earlier-session rows are not attributed to the 07:00 Journal session.

## Repository and requirements preflight

- Exact baseline SHA: `4af3434f788b87139513921f220294ae90daf4d5`; rechecked immediately before creating the audit branch.
- Reviewed repository governance and engineering workflow: root `AGENTS.md`, `ENGINEERING_STANDARDS.md`, `AI_AGENT_WORKFLOW.md`, documentation-only task checklist, and domain ownership.
- Reviewed Harvester instructions and relevant product/technical contracts: `apps/harvester/AGENTS.md`, `TRADING_FIRST.md`, Conservative domain specification, Accounting Invariants, trading-strategies, Portfolio, architecture, broker port/adapter, Journal operations, logging, TESTNET validation runbook, TESTNET order tools, README, and Harvester roadmap.
- Inspected the current Conservative policy, recovery SELL planner/completion, RecoveryLedger, paired Portfolio/ledger accounting use case, Trading Engine, Binance adapter, bootstrap completion flow, and related tests.
- Reviewed parent issue #645 evidence and related issue/PR history, especially #626, #627, and #629.

Applicable constraints: this audit does not authorize TESTNET writes or restart; default tests remain offline; exact decimal arithmetic and fail-closed reconciliation are required; code changes require regression tests and test-first RED → GREEN; task PRs target `develop`; no source fix is justified while the DOGE exchange/account-state conflict remains unexplained.

## Journal inventory

| Journal event | Count |
|---|---:|
| Total records | 114 |
| `strategy.decision` | 13 |
| `order.submission_requested` | 23 |
| `order.submitted` | 23 |
| `order.cancel_requested` | 9 |
| `order.cancelled` | 9 |
| `execution.fill_applied` | 12 |
| `execution.duplicate_fill` | 13 |
| `recovery.cycle_completed` | 1 |
| `account.snapshot_captured` | 2 |
| `account.open_orders_captured` | 1 |
| `harvester.stopped` | 1 |

The two balance snapshots are a PREFLIGHT baseline and a CLOSING snapshot. PREFLIGHT account-wide open orders were zero. The CLOSING snapshot is INCOMPLETE with `UNRESOLVED_OWNED_ORDERS:2`. The 13 duplicate-fill records are duplicate notifications, not 13 additional executions: trade 11661 is replayed once at 07:02:40.928Z, then all 12 applied fills are replayed again during CLOSING at 07:58:11.075–07:58:11.077Z. The duplicate records do not add inventory or cash flow.

## Independent account balance reconciliation

The PREFLIGHT balance snapshot at 07:00:04.113Z is the session baseline. The CLOSING snapshot is at 07:58:11.370Z; process stop is recorded at 07:58:16.387Z.

| Asset | PREFLIGHT total | CLOSING free | CLOSING locked | CLOSING total | Total delta |
|---|---:|---:|---:|---:|---:|
| DOGE | 19,119.8 | 19,122.6 | 1,196 | 20,318.6 | **+1,198.8** |
| USDT | 8,954.11668541 | 8,860.31204995 | 7.98 | 8,868.29204995 | **−85.82463546** |
| ZRO | 245.125 | 245.175 | 0 | 245.175 | **+0.05** |

These totals are exchange account observations, not by themselves strategy PnL. In this session the USDT and base-asset deltas can be reconciled against the Journal fills, subject to the DOGE SELL conflict below.

## DOGEUSDT — unresolved

Three applied BUY fills:

| Trade ID | Order ID | Client order ID suffix | Executed base | Quote notional | Commission |
|---|---:|---:|---:|---:|---:|
| 221733 | 1276628 | -1 | 400 DOGE | 28.628 USDT | 0.4 DOGE |
| 221736 | 1276664 | -4 | 400 DOGE | 28.612 USDT | 0.4 DOGE |
| 221738 | 1276684 | -10 | 400 DOGE | 28.596 USDT | 0.4 DOGE |

BUY totals: 1,200 DOGE gross; 1.2 DOGE base commissions; 1,198.8 DOGE net; 85.836 USDT quote debited.

Order-history SELL `1276698` / client suffix `-11` reports 1,196 DOGE executed at 0.07185 for 85.9326 USDT and status FILLED. The Journal only records its acknowledgement as OPEN and contains no corresponding `execution.fill_applied` for a DOGE SELL. The CLOSING account snapshot has 1,196 DOGE locked. The 1,196 locked amount equals the order's reported executed quantity, but the closing balance snapshot does not itself identify an order.

The DOGE total balance delta (+1,198.8) equals the three net BUY fills exactly and does not reflect the reported SELL. Therefore:
- Base inventory and BUY cash debit reconcile.
- SELL execution, SELL commission, realized net PnL, and final sellable/free DOGE are UNVERIFIED / CONFLICT.
- Do not book the order-history quote amount as realized proceeds or assume a commission asset/rate.
- The 1,196 DOGE locked and order 1276698's FILLED status are mutually inconsistent in the supplied evidence. Original application logs are required to establish the timeline and identity; they were not available here.

DOGE order lifecycle from the current-session history:
- 1276628 BUY 400 @ 0.07157 — FILLED.
- 1276663 SELL 398 @ 0.07203 — CANCELED, zero executed.
- 1276664 BUY 400 @ 0.07153 — FILLED.
- 1276683 SELL 797 @ 0.07191 — CANCELED, zero executed.
- 1276684 BUY 400 @ 0.07149 — FILLED.
- 1276698 SELL 1,196 @ 0.07185 — history says FILLED; account/Journal conflict.

## ZROUSDT — arithmetic reconciles; one BUY remains open

Eight applied BUY fills, all with 0.005 ZRO base commission:

| Trade ID | Order ID | Price | Base qty | Quote qty |
|---|---:|---:|---:|---:|
| 11658 | 727817 | 1.604 | 5 | 8.020 |
| 11659 | 727838 | 1.603 | 5 | 8.015 |
| 11660 | 727847 | 1.602 | 5 | 8.010 |
| 11661 | 727859 | 1.601 | 5 | 8.005 |
| 11662 | 727861 | 1.600 | 5 | 8.000 |
| 11663 | 727867 | 1.599 | 5 | 7.995 |
| 11664 | 727876 | 1.598 | 5 | 7.990 |
| 11665 | 727892 | 1.597 | 5 | 7.985 |

BUY totals: 40 ZRO gross; 0.04 ZRO base commissions; 39.96 ZRO net; 64.02 USDT quote cost.

One applied SELL:
- Trade 11666; order 727904; client suffix -22.
- 39.91 ZRO at 1.606; gross quote 64.09546 USDT.
- Actual SELL commission: 0.06409546 USDT.
- Net quote proceeds: 64.03136454 USDT.

Independent calculations:
- Remaining base: 40 − 0.04 − 39.91 = **0.05 ZRO**.
- Net quote PnL: 64.03136454 − 64.02 = **+0.01136454 USDT**.
- Account ZRO delta: 245.175 − 245.125 = **+0.05 ZRO**.
- Account USDT delta equals DOGE BUY debit plus ZRO net proceeds: −85.836 + 0.01136454 = **−85.82463546 USDT**.

The Journal records `recovery.cycle_completed` at 07:08:47.127Z with `freeQuantity=0.01` and `realizedNetProfit=0.01136454`. The remaining 0.05 ZRO is consistent with 0.01 ZRO allocated free plus 0.04 ZRO active residual from fee-reserved sell sizing / step rounding. It is not an unexplained missing fill. The Conservative policy's positive-outstanding-recovery guard prevents residual active inventory alone from creating a new recovery SELL after the ledger reset.

A separate standing BUY remains:
- Order 727905; client suffix -23; 5 ZRO @ 1.596; history status NEW; executed 0.
- Locked quote: 5 × 1.596 = 7.98 USDT, exactly the CLOSING USDT locked balance.
- The supplied latest open-orders snapshot also reports this same order NEW.
This order is a confirmed unresolved order, not a fill. It contributes no base inventory or realized PnL.

## Code behavior and inspected test coverage

Source behavior inspected (not executed in this audit):
- `evaluateConservativeStrategy` creates a recovery SELL only when active inventory is positive, no active SELL exists, and outstanding recovery is positive; it can also create the next standing BUY.
- `calculateRecoverySellPlan` reserves base quantity by dividing sellable quantity by `1 + feeRate`, rounds quantity down to exchange step, and rounds price up.
- `evaluateRecoveryCompletion` requires a fully filled SELL, sufficient active inventory, and actual net proceeds meeting cost plus minimum profit; only configured keep quantity is allocated.
- Bootstrap `completeRecoveryCycle` applies that free allocation to Portfolio and resets the RecoveryLedger only after eligibility succeeds.
- `updateTradingAccounting` applies Portfolio and RecoveryLedger transitions together and rejects identity/result disagreement.
- The Binance adapter keeps exchange-specific calls behind the application broker port.

Inspected tests (existence/source reviewed; not run here):
- Recovery SELL plan: 8 tests, including fee reserve, quantity rounding, no sellable quantity, and invalid inputs.
- Recovery completion: 6 tests, including exact keep allocation, partial/canceled SELL, minimum-profit failure, insufficient inventory, and residual fee reserve.
- Conservative strategy: 10 tests, including simultaneous SELL/BUY intents and no new SELL from residual inventory after ledger reset.
- Paired accounting use case: 12 tests, including actual base/quote commissions, idempotent duplicates, conflicts, and Portfolio/RecoveryLedger consistency.
- Bootstrap tests include CLOSING audit INCOMPLETE behavior for unresolved owned orders.
No package tests were executed in this documentation audit. Do not report these inspected tests as passing.

## Related issue and PR history

- #626 documents a prior user-data recovery deadlock.
- PR #627 merged the recovery orchestration fix. Its exact PR head `d3307e473cb67b0a76dacb39fb2a0dd40935480b` has recorded success for Unit Tests, Test Coverage, JavaScript Syntax, Utils Unit Tests, and Dependency Audit.
- PR #629 merged the all-enabled-market subscription ordering fix. Its exact PR head `77572649559efada881e3da7bbf958329f84b870` has the same five recorded successful workflows.
- These historical PR checks do not verify this session's exchange behavior or the current audit branch.

## Findings and follow-up

See [AUDIT_FINDINGS.md](./AUDIT_FINDINGS.md) for the status-coded register and [AUDIT_EXECUTION_HISTORY.md](./AUDIT_EXECUTION_HISTORY.md) for the 23-order chronology.

Two focused child issues were created: [#646 — Align Conservative specification with implemented recovery and fee-reserve rules](https://github.com/45s/coinzilla/issues/646) for confirmed specification/config-boundary drift, and [#648 — Add exact-once full Conservative recovery-cycle regression coverage](https://github.com/45s/coinzilla/issues/648) for the explicit exact-once/full-cycle test gaps in the accounting-invariants matrix. No runtime defect is asserted from the currently accessible evidence. No fix PR is opened.

## Current acceptance status

| Area | Status | Reason |
|---|---|---|
| Repository baseline SHA | PASS | Exact develop SHA recorded and rechecked |
| Journal parsing | PASS | All 114 JSONL records parsed |
| DOGE/ZRO order-history parsing | PASS | All 100 rows per symbol parsed |
| ZRO execution/account arithmetic | PASS | Trade-level and balance deltas reconcile exactly |
| ZRO standing BUY terminal state | PARTIAL | NEW order and 7.98 USDT locked are consistent; remains unresolved |
| DOGE BUY inventory/cash debit | PASS | Three fills and account deltas reconcile |
| DOGE SELL/order/balance state | CONFLICT | History FILLED vs Journal OPEN, no applied SELL fill, 1,196 DOGE locked |
| DOGE realized net PnL | UNVERIFIED | Missing applied SELL fill/actual commission correlation |
| Full application-log correlation | UNVERIFIED | Original log attachments unavailable in this execution session |
| Source behavior review | PARTIAL | Relevant code inspected; no full runtime execution |
| Regression coverage | PARTIAL | Relevant tests inspected, not run |
| Live TESTNET acceptance | UNVERIFIED | No new exchange operation authorized or performed |

## Safety decision

Keep the existing TESTNET execution gate closed. Do not restart Harvester or submit/cancel orders to resolve this audit. The next engineering step is to obtain access to the original log attachments in a context where they can be read without altering them, verify their recorded SHA-256 checksums, and correlate the DOGE order 1276698 lifecycle with the account closing snapshot and the two unresolved owned-order records. Until that is done, DOGE SELL execution and realized PnL remain CONFLICT / UNVERIFIED.
