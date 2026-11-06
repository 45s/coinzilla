# Harvester Conservative Strategy Audit

**Parent:** [#645 — Harvester Conservative Strategy Audit](https://github.com/45s/coinzilla/issues/645)  
**Audit baseline:** `develop` at `4af3434f788b87139513921f220294ae90daf4d5` (2026-11-06; PR #644 merge commit)  
**Evidence session:** 2026-11-06 07:00:00.896–07:58:16.387 UTC  
**Status:** PARTIAL — original application logs integrity-verified and parsed; ZRO runtime Portfolio/RecoveryLedger state PASS; DOGE SELL/order state remains CONFLICT; CLOSING audit INCOMPLETE.  
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
| `harvester.log` | Original conversation attachment; 16,878,030 bytes, 4,880 physical lines | PASS — SHA-256 independently recomputed; parsed; see [log evidence addendum](./AUDIT_LOG_EVIDENCE_2026-11-06.md) |
| `harvester-trace.log` | Original conversation attachment; 17,021,746 bytes, 5,739 physical lines | PASS — SHA-256 independently recomputed; parsed; see [log evidence addendum](./AUDIT_LOG_EVIDENCE_2026-11-06.md) |

Original log checksums recorded in #645 and independently recomputed against the original attachments:
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
- The parsed TRACE log shows order 1276698 OPEN with zero executed and 1,196 remaining at the last DOGE evaluations; the shutdown execution set contains no DOGE SELL fill. This strongly favors OPEN/unfilled at the last observed runtime point, but the separate order-history row says FILLED. Keep the order state CONFLICT until complete DOGE trade history, canonical order detail, and the full CLOSING open-order payload reconcile it.

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
- Issue #626 remains OPEN as of this audit despite merged PR #627; the issue's acceptance/closure is not assumed. PR #627 merged the recovery orchestration fix. Its exact PR head `d3307e473cb67b0a76dacb39fb2a0dd40935480b` has recorded success for Unit Tests, Test Coverage, JavaScript Syntax, Utils Unit Tests, and Dependency Audit.
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
| Original log integrity and parsing | PASS | Both original files independently hashed and parsed; see [log evidence addendum](./AUDIT_LOG_EVIDENCE_2026-11-06.md) |
| Source behavior review | PARTIAL | Relevant code inspected; no full runtime execution |
| Regression coverage | PARTIAL | Relevant tests inspected, not run |
| Live TESTNET acceptance | UNVERIFIED | No new exchange operation authorized or performed |

## Safety decision

Keep the existing TESTNET execution gate closed. Do not restart Harvester or submit/cancel orders to resolve this audit. The logs are now integrity-verified and parsed; next obtain complete DOGE `myTrades` with commission facts, canonical order detail for 1276698, and the full CLOSING open-order payload/reconciliation diagnostics. DOGE SELL execution and realized PnL remain CONFLICT / UNVERIFIED.

## Lifecycle reconstruction and decision-by-decision assessment

Evidence labels are strict: observed = present in supplied Journal/order-history/account records; source behavior = code inspected at baseline; test coverage = assertion exists but was not run in this audit. These are not interchangeable.

### 1. Startup, ownership, and readiness

| Step | Expected control | Run evidence | Status |
|---|---|---|---|
| 1.1 Configuration | Validate strategy mode, enabled symbols, budgets, maker/taker percentages, minProfit, keepQuantity, tick/step/min-notional before side effects. | Orders show DOGEUSDT and ZROUSDT enabled; complete redacted runtime config and filter snapshot were not supplied. | PARTIAL |
| 1.2 Pair ownership | One controller owns each pair; second controller cannot trade same pair. | Lock/ownership source and tests inspected; no competing-process evidence for this run. | UNVERIFIED for this run |
| 1.3 Broker readiness | Establish exchange rules, balances, account-wide open orders, market data, and user-data stream before strategy activation. | PREFLIGHT balances 07:00:04.113Z; account-wide open-order capture 07:00:04.417Z reports READY / zero orders. Logs unavailable to prove stream/readiness ordering. | PARTIAL |
| 1.4 Baseline | Separate existing account inventory from Harvester-owned positions. | DOGE 19,119.8; USDT 8,954.11668541; ZRO 245.125; all locked balances zero; zero open orders. | PASS for supplied snapshot |
| 1.5 Trading gate | No decision/order before required preflight checks. | First strategy decisions follow PREFLIGHT records. Exact readiness log and config absent. | PARTIAL |

### 2. Strategy decisions and order lifecycle

1. **DOGE initial evaluation, 07:00:08.056Z:** reference 0.07161000; BUY 400 at 0.07157, suffix -1 / order 1276628. History says FILLED; Journal trade 221733 applies 400 with 0.4 DOGE commission. Net contribution 399.6 DOGE.
2. **ZRO initial evaluation, 07:00:08.661Z:** reference 1.605; BUY 5 at 1.604, suffix -2 / order 727817. Trade 11658 applies 5 with 0.005 ZRO commission. Net contribution 4.995 ZRO.
3. **Subsequent BUY-fill decisions:** each decision creates a recovery SELL intent based on accumulated exposure and, where shown, a next standing BUY. The decision ledger lists SELL before paired BUY. This proves decision ordering, not atomic exchange-side behavior.
4. **Cancel/replace:** nine prior SELL intents (-3, -5, -7, -9, -12, -14, -16, -18, -20) have Journal cancel requests and confirmations; history says CANCELED with zero executed. Replacements appear in later decisions. Without original DEBUG/TRACE logs, the audit cannot prove all asynchronous races were handled safely between cancel confirmation and replacement.
5. **DOGE final recovery SELL:** decision 07:02:31.008Z creates SELL 1,196 at 0.07185, suffix -11 / order 1276698. History says FILLED; Journal acknowledgement says OPEN; no DOGE SELL fill is applied; closing has 1,196 DOGE locked. This is a blocker, not a PASS.
6. **ZRO final recovery SELL and standing BUY:** decision 07:04:46.922Z creates SELL 39.91 at 1.606, suffix -22 / order 727904, and BUY 5 at 1.596, suffix -23 / order 727905. SELL trade 11666 executes 07:08:46.965Z; recovery completion is journaled 07:08:47.127Z. Paired BUY remains NEW with 7.98 USDT locked at close.
7. **Shutdown:** CLOSING snapshot 07:58:11.370Z is INCOMPLETE with two unresolved owned orders; process stop is 07:58:16.387Z. Successful process exit does not mean trading/account reconciliation passed.

### 3. Recovery SELL calculation and completion contract

Inspected source behavior, not runtime proof:
1. Apply BUY fills by canonical exchange trade identity; actual base/quote commission affects inventory and cash.
2. Conservative policy considers active inventory, active SELL state, and outstanding recovery amount.
3. Positive residual inventory alone is insufficient to create another recovery SELL; outstanding recovery must also be positive and no active SELL may exist.
4. Planner reserves base for configured fee, divides sellable quantity by 1 + feeRate, rounds quantity down to exchange step, and rounds price up to tick. Current code uses max(makerPercent, takerPercent), while multiple domain documents say maker-only. This is a contract conflict tracked in #646, not an approved product decision.
5. Apply actual broker commission asset/amount per SELL fill; planned reserve is not a substitute.
6. Completion requires a fully filled SELL, sufficient active inventory, and actual net proceeds meeting cost plus minProfit.
7. Bootstrap completion allocates configured keepQuantity to Portfolio and resets RecoveryLedger only after eligibility succeeds.
8. Residual active inventory after reset does not itself trigger a new recovery SELL. Existing engine test covers this; it was inspected, not run here.
9. A standing BUY can be paired with a recovery SELL intent; exact-once completion and ownership of outstanding orders must remain intact.

ZRO observed arithmetic: 40 gross BUY - 0.04 base fee - 39.91 SELL = 0.05 ZRO remaining; completion records 0.01 free and 0.04 active residual. Net quote result +0.01136454 USDT. DOGE evidence does not establish SELL completion or realized PnL.

### 4. Shutdown and unresolved-order decision

- PREFLIGHT account-wide open-order count is zero.
- CLOSING audit is INCOMPLETE with UNRESOLVED_OWNED_ORDERS:2.
- One unresolved order is identified: ZRO BUY 727905, NEW, 5 ZRO at 1.596, zero executed, 7.98 USDT quote locked.
- The second unresolved order is not identified by the supplied closing open-order detail. DOGE SELL 1276698 is a candidate because evidence conflicts, but it must not be asserted as the second unresolved order without the full closing list/logs.
- No order was canceled, amended, or recreated during this audit. Current decision is read-only investigation and fail-closed status.

### 5. Clarification gaps and exact evidence needed

| Gap | Unknown | Evidence required | Closure rule |
|---|---|---|---|
| Runtime config | Exact budgets, mode, fees, minProfit, keepQuantity, enabled symbols, filters. | Redacted config snapshot and timestamped exchange filters for both symbols. | Tie all values to this run and verify each order's tick/step/notional. |
| DOGE SELL 1276698 | Whether filled/partial/canceled/stale and why 1,196 DOGE locked. | Original logs; full order detail; all DOGE trades and commissions; closing open orders and balances. | Correlate orderId + clientOrderId + tradeId; do not infer proceeds from status label. |
| Second unresolved order | Identity and reserved asset of second unresolved order. | Full CLOSING openOrders payload and reconciliation diagnostics. | Name both orders and reconcile remaining quantity/reservations. |
| Cancel/replace races | Whether replacement always waited for confirmed cancellation/canonical reconciliation. | DEBUG/TRACE timeline and deterministic cancel/fill race replay. | No over-reservation or unsafe overlapping live SELLs. |
| Duplicate fills | Whether exact-once holds across reconnect/restart permutations. | Offline duplicate, reorder, reconnect, REST/stream overlap, restart tests. | Canonical trade changes state once; conflicting same-identity payload fails closed. |
| Fee/config contract | Maker-only or max maker/taker; are zero minProfit/keepQuantity valid? | Explicit decision in #646, then aligned docs, validator, tests. | One contract across config, planner, completion, docs, tests. |
| Completion | Exactly-once allocation/reset across full partial-fill/replacement lifecycle. | #648 full-cycle offline regression. | Duplicate terminal update cannot allocate/reset/issue next BUY twice. |
| #626 recovery | Do #627/#629 satisfy all original acceptance criteria? | Re-read #626 criteria; map to tests and exact CI. | Keep #626 open until each criterion has disposition. |
| Log provenance | Full 4,880-line and 5,739-line log correlation. | Original files read-only; verify SHA-256 before parsing. | Checksum mismatch means stop and record provenance issue. |

### 6. Status and evidence discipline

Observed fact is from Journal/order-history/account records. Source behavior is inspected code, not proof it ran. Test coverage means assertion exists, not that it passed. Hypotheses are not accounting inputs. PASS requires independent reconciliation or verified test; PARTIAL means incomplete lifecycle; CONFLICT means sources disagree; UNVERIFIED means evidence is absent. No global strategy-pass conclusion is supported: overall PARTIAL, ZRO arithmetic PASS, DOGE SELL CONFLICT, closing audit INCOMPLETE, TESTNET acceptance UNVERIFIED.


## Lifecycle reconstruction and decision-by-decision assessment

Evidence labels are strict: observed = present in supplied Journal/order-history/account records; source behavior = code inspected at baseline; test coverage = assertion exists but was not run in this audit. These are not interchangeable.

### Startup, ownership, and readiness

| Step | Expected control | Run evidence | Status |
|---|---|---|---|
| Configuration | Validate mode, enabled symbols, budgets, fee percentages, minProfit, keepQuantity, tick/step/min-notional before side effects. | DOGEUSDT and ZROUSDT orders are present; complete redacted config and filter snapshot were not supplied. | PARTIAL |
| Pair ownership | One controller owns each pair. | Lock/ownership source and tests inspected; no competing-process evidence for this run. | UNVERIFIED for this run |
| Broker readiness | Establish exchange rules, balances, account-wide open orders, market data, and user-data stream before activation. | PREFLIGHT balances 07:00:04.113Z; open-order capture 07:00:04.417Z reports READY / zero orders. Logs unavailable to prove stream ordering. | PARTIAL |
| Baseline | Separate existing account inventory from Harvester-owned positions. | DOGE 19,119.8; USDT 8,954.11668541; ZRO 245.125; all locked balances zero; zero open orders. | PASS for supplied snapshot |
| Trading gate | No decision/order before preflight checks. | First decisions follow PREFLIGHT records; exact readiness log/config absent. | PARTIAL |

### Strategy decisions and order lifecycle

1. DOGE initial evaluation 07:00:08.056Z: reference 0.07161000; BUY 400 at 0.07157, suffix -1 / order 1276628. Trade 221733 applies 400 with 0.4 DOGE commission; net contribution 399.6 DOGE.
2. ZRO initial evaluation 07:00:08.661Z: reference 1.605; BUY 5 at 1.604, suffix -2 / order 727817. Trade 11658 applies 5 with 0.005 ZRO commission; net contribution 4.995 ZRO.
3. Subsequent BUY-fill decisions create a recovery SELL intent and, where shown, a next standing BUY. The ledger lists SELL before paired BUY; this proves decision ordering, not atomic exchange-side behavior.
4. Nine prior SELL intents (-3, -5, -7, -9, -12, -14, -16, -18, -20) have Journal cancel requests and confirmations; history says CANCELED with zero execution. Replacements appear in later decisions. The DEBUG/TRACE logs are now available for correlation; this audit does not claim that every asynchronous cancel/fill race was exercised or proven by this single session.
5. DOGE final recovery SELL: decision 07:02:31.008Z creates SELL 1,196 at 0.07185, suffix -11 / order 1276698. History says FILLED; Journal acknowledgement says OPEN; no DOGE SELL fill is applied; closing has 1,196 DOGE locked. This is a blocker, not a PASS.
6. ZRO final recovery SELL and standing BUY: decision 07:04:46.922Z creates SELL 39.91 at 1.606, suffix -22 / order 727904, and BUY 5 at 1.596, suffix -23 / order 727905. SELL trade 11666 executes 07:08:46.965Z; recovery completion is journaled 07:08:47.127Z. Paired BUY remains NEW with 7.98 USDT locked at close.
7. Shutdown: CLOSING snapshot 07:58:11.370Z is INCOMPLETE with two unresolved owned orders; process stop is 07:58:16.387Z. Successful process exit does not mean reconciliation passed.

### Recovery SELL calculation and completion contract

Inspected source behavior, not runtime proof:
1. Apply BUY fills by canonical exchange trade identity; actual commission affects inventory and cash.
2. Conservative policy considers active inventory, active SELL state, and outstanding recovery amount.
3. Positive residual inventory alone is insufficient to create another recovery SELL; outstanding recovery must also be positive and no active SELL may exist.
4. Planner reserves base for configured fee, divides sellable quantity by 1 + feeRate, rounds quantity down to exchange step, and rounds price up to tick. Current code uses max(makerPercent, takerPercent), while multiple domain docs say maker-only. This conflict is tracked in #646; no product decision is implied.
5. Apply actual broker commission asset/amount per SELL fill; planned reserve is not a substitute.
6. Completion requires a fully filled SELL, sufficient active inventory, and actual net proceeds meeting cost plus minProfit.
7. Bootstrap completion allocates configured keepQuantity to Portfolio and resets RecoveryLedger only after eligibility succeeds.
8. Residual active inventory after reset does not itself trigger a new recovery SELL. Existing engine test covers this; it was inspected, not run here.

ZRO arithmetic: 40 gross BUY - 0.04 base fee - 39.91 SELL = 0.05 ZRO remaining; completion records 0.01 free and 0.04 active residual. Net quote result +0.01136454 USDT. DOGE evidence does not establish SELL completion or realized PnL.

### Shutdown and unresolved-order decision

- PREFLIGHT open-order count is zero.
- CLOSING audit is INCOMPLETE with UNRESOLVED_OWNED_ORDERS:2.
- One unresolved order is identified: ZRO BUY 727905, NEW, 5 ZRO at 1.596, zero executed, 7.98 USDT quote locked.
- The second unresolved order is not identified by supplied closing open-order detail. DOGE SELL 1276698 is a candidate, but must not be asserted as the second unresolved order without the full closing list/logs.
- No order was canceled, amended, or recreated during this audit. Current decision is read-only investigation and fail-closed status.

### Clarification gaps and exact evidence needed

| Gap | Unknown | Evidence required | Closure rule |
|---|---|---|---|
| Runtime config | Exact budgets, mode, fees, minProfit, keepQuantity, symbols, filters. | Redacted config snapshot and timestamped exchange filters. | Tie values to run and verify every order's tick/step/notional. |
| DOGE SELL 1276698 | Whether filled/partial/canceled/stale and why 1,196 DOGE locked. | Original logs; full order detail; all DOGE trades/commissions; closing open orders and balances. | Correlate orderId + clientOrderId + tradeId; do not infer proceeds from status label. |
| Second unresolved order | Identity and reserved asset. | Full CLOSING openOrders payload and reconciliation diagnostics. | Name both orders and reconcile remaining quantity/reservations. |
| Cancel/replace races | Whether replacement waited for confirmed cancellation/canonical reconciliation. | DEBUG/TRACE timeline and deterministic cancel/fill race replay. | No over-reservation or unsafe overlapping live SELLs. |
| Duplicate fills | Exact-once across reconnect/restart permutations. | Offline duplicate, reorder, reconnect, REST/stream overlap, restart tests. | Canonical trade changes state once; conflicting payload fails closed. |
| Fee/config contract | Maker-only or max maker/taker; are zero minProfit/keepQuantity valid? | Explicit #646 decision, aligned docs, validator, tests. | One contract across config, planner, completion, docs, tests. |
| Completion | Exactly-once allocation/reset across partial-fill/replacement lifecycle. | #648 full-cycle offline regression. | Duplicate terminal update cannot allocate/reset/issue next BUY twice. |
| #626 recovery | Do #627/#629 satisfy original criteria? | Re-read #626 criteria; map to tests and exact CI. | Keep #626 open until each criterion has disposition. |
| Log provenance | Full 4,880-line and 5,739-line correlation. | Original files read-only; verify SHA-256 before parsing. | Checksum mismatch means stop and record provenance issue. |

### Status and evidence discipline

Observed fact is from Journal/order-history/account records. Source behavior is inspected code, not proof it ran. Test coverage means assertion exists, not that it passed. Hypotheses are not accounting inputs. PASS requires independent reconciliation or verified test; PARTIAL means incomplete lifecycle; CONFLICT means sources disagree; UNVERIFIED means evidence is absent. No global strategy-pass conclusion is supported: overall PARTIAL, ZRO arithmetic PASS, DOGE SELL CONFLICT, closing audit INCOMPLETE, TESTNET acceptance UNVERIFIED.


## Verified original application-log addendum — 2026-11-06

The former evidence-access blocker is resolved. Both original files were read-only hashed and parsed; byte counts, physical line counts, newline termination, and SHA-256 values are recorded in [AUDIT_LOG_EVIDENCE_2026-11-06.md](./AUDIT_LOG_EVIDENCE_2026-11-06.md). The trace directly records ZRO Portfolio and RecoveryLedger before/after SELL accounting and cycle completion (0.01 free + 0.04 active residual). It also records DOGE order 1276698 OPEN with zero executed at the final runtime evaluations and no DOGE SELL among the 12 shutdown execution records. This strengthens, but does not resolve, the conflict with the separate exchange order-history FILLED row. The second unresolved order remains unidentified; DOGE order 1276698 is only a candidate. Do not book DOGE SELL proceeds or PnL. See the addendum for exact line references, timestamps, and remaining evidence.


## 2026-11-06 post-CLOSING TESTNET trade-history reconciliation

New read-only exports are preserved verbatim, including all 50 rows each, in [DOGE trade evidence](./AUDIT_DOGE_TRADES_2026-11-06.md) and [ZRO trade evidence](./AUDIT_ZRO_TRADES_2026-11-06.md). Both commands requested 50 rows with no `fromId`; neither is asserted to be exhaustive all-time history.

**DOGE order 1276698 / client suffix -11:** trade 221990 (278 DOGE) and trade 221991 (918 DOGE) are SELL MAKER fills at 0.07185, at 08:03:01.841Z and 08:03:18.202Z. Total 1,196 DOGE; gross quote 85.93260000 USDT; quote commission 0.08593260 USDT; net quote proceeds 85.84666740 USDT. The final runtime evaluation (~07:57:19Z) and CLOSING snapshot (~07:58:11Z) predate both fills. This is a chronology resolution, not contradictory same-time evidence. Exchange execution is confirmed after shutdown; application accounting and later account balance remain unverified.

**ZRO order 727905 / client suffix -23:** trade 12182 is BUY 5 ZRO at 1.596 at 08:38:24.782Z, gross quote 7.98 USDT, commission 0.005 ZRO, net base credited 4.995 ZRO. The ~07:58 CLOSING snapshot correctly showed it NEW with 7.98 USDT locked. This resolves one of the two unresolved order identities by later execution; the second identity remains unknown.

**ZRO recovery SELL 727904 / trade 11666:** 39.91 ZRO at 1.606, gross 64.09546 USDT, fee 0.06409546 USDT, net 64.03136454 USDT; against 64.02 USDT BUY cost, realized net +0.01136454 USDT. This fill predates CLOSING and matches the observed runtime Portfolio/RecoveryLedger completion.

The CLOSING snapshot remains a valid historical point-in-time record. Later exchange fills must not be retroactively inserted into that snapshot or treated as proof the stopped Harvester processed them. TESTNET acceptance remains NOT ACCEPTED; no exchange writes or bot restart were performed.


## 2026-11-06 repository and exact-head verification follow-up

At the follow-up verification session (2026-11-06 11:57 UTC), the live GitHub PR metadata, branch ref, changed-file inventory, workflow runs, job results, issue states, and review state were rechecked. PR #653 remains OPEN and unmerged, targets `develop`, and its branch ref matched the previously recorded HEAD `94650284a05e0e18cda662d5a41bce0a47788ac8` at the start of this verification. The PR diff lists all seven expected audit artifacts, and each was fetched successfully from the PR branch. The DOGE/ZRO trade addenda preserve the bounded 50-row exports; neither query is represented as exhaustive all-time history.

All five PR-triggered workflow runs associated with that exact HEAD completed successfully: JavaScript Syntax (run 42213769852), Test Coverage (42213769902), Dependency Audit (42213769838), Unit Tests (42213769873), and Utils Unit Tests (42213769913). Their inspected jobs completed successfully. The Unit Tests workflow's read-only Binance TESTNET integration job was SKIPPED, not passed. Separately, the commit-status endpoint returned `pending` with zero legacy statuses; this is reported independently and is not treated as a failed workflow or as a green combined status. No PR reviews or inline review threads were present at this check.

The repository connector provides read-only GitHub access and cannot read GitHub secret values or dispatch the repository's secret-backed exchange-history workflow. No fresh Binance balances, open orders, complete historical CLOSING open-order payload, or later Harvester Journal/runtime session was available in this session. Accordingly, current DOGE/ZRO/USDT free, locked, and total balances and post-CLOSING Portfolio/RecoveryLedger processing remain UNVERIFIED. Do not infer them from trade exports. The historical CLOSING snapshot remains unchanged.

Related workstream cross-check: #649 is CLOSED after its exact-once regression was merged; #646 remains OPEN pending explicit product decisions on fee-reserve policy and zero-value input semantics; #626 remains OPEN pending disposition of its original empty-TypeError cause and controlled TESTNET/owner acceptance. No exchange writes, order changes, cancellations, withdrawals, account-setting changes, or bot restarts were performed. TESTNET acceptance remains NOT ACCEPTED.


## Evidence correction — previously supplied balances and open-orders snapshot (2026-11-06)

A review of parent issue #645 comment 6680483675 and the original Journal comment 6680290142 confirms that these records were already supplied by the operator and must not be described as absent.

### Historical account snapshots from the original Journal

| Phase | Asset | Free | Locked | Total |
|---|---|---:|---:|---:|
| PREFLIGHT (~07:00:04Z) | DOGE | 19,119.8 | 0 | 19,119.8 |
| PREFLIGHT (~07:00:04Z) | USDT | 8,954.11668541 | 0 | 8,954.11668541 |
| PREFLIGHT (~07:00:04Z) | ZRO | 245.125 | 0 | 245.125 |
| CLOSING (~07:58:11Z) | DOGE | 19,122.6 | 1,196 | 20,318.6 |
| CLOSING (~07:58:11Z) | USDT | 8,860.31204995 | 7.98 | 8,868.29204995 |
| CLOSING (~07:58:11Z) | ZRO | 245.175 | 0 | 245.175 |

The PREFLIGHT account snapshot was COMPLETE and its open-orders snapshot reported zero orders. The CLOSING account snapshot was INCOMPLETE with `UNRESOLVED_OWNED_ORDERS:2`. These are historical Journal facts, not current wallet balances.

### Operator-supplied latest open-orders snapshot

The operator also supplied a separate point-in-time open-orders response, preserved in issue #645 comment 6680483675. It showed one open order:

- Symbol: ZROUSDT
- Side/type: BUY LIMIT
- Exchange order ID: `727905`
- Client order ID: `h-971fc65d9a264984ab8aa7-23`
- Price: `1.59600000`
- Original quantity: `5.00000000`
- Executed quantity: `0`
- Status: `NEW`

This matches the ZRO BUY later confirmed by trade 12182 at 08:38:24.782Z. It is a supplied latest snapshot, but it is not the complete account-wide open-orders payload captured at the earlier ~07:58Z CLOSING event.

### Corrected evidence classification

- **Already supplied and preserved:** PREFLIGHT and CLOSING balances; PREFLIGHT zero-open-orders Journal record; separate latest one-order ZROUSDT open-orders snapshot; DOGE/ZRO order histories; bounded 50-row DOGE/ZRO trade exports; original Journal and parsed application-log evidence.
- **Still not supplied/located in the preserved audit:** the complete historical ~07:58Z CLOSING open-orders payload identifying both unresolved owned orders.
- **Still unverified:** a timestamped account-balance/open-orders snapshot after the later DOGE 1276698 and ZRO 727905 fills; any later Harvester Journal/runtime evidence proving those post-CLOSING fills were applied to Portfolio/RecoveryLedger.
- Do not call historical balances or the supplied one-order snapshot "missing". Do not call them post-fill/current balances. Do not infer internal accounting from exchange fills alone.

The raw evidence remains immutable. This correction updates derived audit interpretation only; it does not rewrite the original Journal or retroactively alter the CLOSING snapshot.


## Superseding chronology clarification — post-CLOSING DOGE/ZRO fills (2026-11-06)

The preliminary DOGE order-state conflict described above is superseded for the exchange execution chronology by the preserved 50-row actual-trade exports. The original application logs and CLOSING snapshot end around 07:58:11Z; they show DOGE order 1276698 OPEN with zero executed at the last runtime evaluations. The exchange-side fills occurred later:

- DOGE order 1276698: trade 221990, SELL 278 DOGE at 08:03:01.841Z, and trade 221991, SELL 918 DOGE at 08:03:18.202Z. Total 1,196 DOGE; 85.93260000 USDT gross; 0.08593260 USDT quote commission; 85.84666740 USDT net proceeds.
- ZRO BUY 727905: trade 12182 at 08:38:24.782Z, gross 5 ZRO, 0.005 ZRO base commission, 4.995 ZRO net credit, 7.98000000 USDT quote debit.

Thus the runtime OPEN/zero-executed state and later exchange FILLED history are chronologically consistent, not contradictory same-time observations. The eventual exchange-side DOGE execution is confirmed; the earlier ~07:58 CLOSING snapshot remains historically valid and must not be rewritten.

This does not prove that a later Harvester process applied either post-CLOSING fill to Portfolio/RecoveryLedger. No timestamped post-fill account/open-orders snapshot or later Journal/runtime session has been located. The complete historical CLOSING open-orders payload identifying both unresolved orders is also still absent. ZRO 727905 is one identified CLOSING unresolved order; the second identity remains unproven. Keep account-wide settlement and TESTNET acceptance PARTIAL/NOT ACCEPTED.


## Operator workstation lifecycle clarification — 2026-11-06

The operator runs Harvester on a personal PC and is not expected to maintain a 24/7 process. Stopping Harvester while exchange orders remain open is a normal supported operating condition. Exchange-side orders are not automatically cancelled when the local process stops and may fill while the application is offline. In-memory Portfolio/RecoveryLedger state cannot update during that interval; this fact alone is not a defect or an operator failure.

The required safety behavior is **restart reconciliation before trading resumes**: discover owned open orders and fills since the last durable checkpoint, reconcile partial/terminal states, commissions and authoritative balances, apply executions idempotently to Portfolio/RecoveryLedger, restore reservations, and keep trading fail-closed until reconciliation completes. Historical CLOSING snapshots remain immutable; later fills belong to the next-session reconciliation.

Accordingly, DOGE 1276698 (1,196 DOGE SELL at 08:03Z) and ZRO 727905 (5 ZRO BUY at 08:38Z) filling after the ~07:58Z shutdown is expected and must not be described as a runtime contradiction or as a requirement for 24/7 uptime. Lack of a later same-session Journal update is **not** a defect. Whether startup recovery correctly imports these offline fills remains an engineering behavior to verify; do not claim it failed without a restart/reconciliation test or source-level proof.
