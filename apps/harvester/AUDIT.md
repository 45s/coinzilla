# Harvester Conservative Strategy Audit

> This is a historical evidence report, not a strategy-rule authority. The sole current Conservative contract is [CONSERVATIVE_DOMAIN_SPECIFICATION.md](./docs/domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md). Old rule summaries and status tables below are historical unless explicitly updated; they must not override the canonical specification.


**Parent:** [#645 — Harvester Conservative Strategy Audit](https://github.com/45s/coinzilla/issues/645)  
**Audit baseline:** `develop` at `4af3434f788b87139513921f220294ae90daf4d5` (2026-11-06; PR #644 merge commit)  
**Evidence session:** 2026-11-06 07:00:00.896–07:58:16.387 UTC  
**Status:** IMPLEMENTATION AUDIT CLOSED (2026-11-07) — in-scope Conservative source behavior, regression coverage inventory, and supporting documentation have been reconciled against the canonical specification. Test execution and exact-head CI are a separate pending verification phase; no test-pass claim is made. Historical exchange-filter inputs not captured in the original logs remain UNVERIFIED and non-blocking. TESTNET acceptance is NOT CLAIMED.  
**Safety:** No TESTNET orders, bot restarts, credential requests, or exchange writes were performed.

## Executive result

The accessible Journal and the two verbatim 100-row order-history comments establish 23 Harvester order submissions in the 07:00 session: six DOGEUSDT orders and seventeen ZROUSDT orders. The Journal records 12 applied fills, 13 duplicate-fill events, nine cancellation requests and nine confirmed cancellations, and one ZRO recovery-cycle completion.

ZRO's pre-CLOSING recovery SELL and DOGE's post-CLOSING SELL reconcile at the trade/arithmetic level. Both observed SELLs met the minimum net-profit amount after actual commissions. The source audit identified and corrected the ZRO residual sell-through/completion defect; current code continues selling exchange-sellable inventory above exact keepQuantity and retains only validated exchange-constrained dust as a keepQuantity bonus. DOGE's post-shutdown fills and ZRO's post-shutdown BUY are expected workstation-downtime behavior, not same-session runtime failures. Exact historical exchange-filter values and the complete historical CLOSING open-order payload were not preserved; those narrow historical facts remain UNVERIFIED and non-blocking. The original CLOSING audit remains INCOMPLETE at its recorded timestamp and is not rewritten.

## Current closure decision — 2026-11-07

**The in-scope Conservative Strategy implementation/documentation audit is CLOSED.** The code and regression inventory have been reviewed against the sole authority, [CONSERVATIVE_DOMAIN_SPECIFICATION.md](./docs/domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md). This closure does not mean tests or CI passed, and it does not grant TESTNET or live-trading acceptance.

Implemented and represented by focused regression coverage on this branch:

- Recovery SELL planning continues after the minimum net-profit target is secured until all exchange-sellable quantity above `keepQuantity` is sold. Residuals use the validated market reference and still pass exchange quantity/notional/price and POST-ONLY checks.
- Exchange-constrained dust is accepted only with exact quantity evidence and a validated limiting filter (`MIN_QUANTITY`, `MIN_NOTIONAL`, or `QUANTITY_INCREMENT`). Dust is retained as a bonus on top of `keepQuantity`; price-filter blocks are not dust.
- The completion lifecycle records the dust quantity, limiting reason, and evaluated filter values in its lifecycle event. Completion preserves `keepQuantity + dust` and resets the recovery basis only after a reconciled terminal FILLED SELL and the actual minimum-profit check.
- Any BUY fill while a recovery SELL is open triggers cancel, terminal-state/fill/commission reconciliation, and replacement planning; a partial BUY remains partial. A partial SELL without a new BUY remains the same order and price.
- Terminal recovery SELL outcomes (CANCELED, EXPIRED, REJECTED) reconcile execution history before reevaluation or fail closed. Exact-once fill application and recovery completion/reset are covered by deterministic offline regressions.
- A full-cycle engine regression now covers the supported `keepQuantity = 0` path as well as a positive retained quantity.

Historical evidence disposition:
- DOGE SELL 1276698 and ZRO BUY 727905 filled after the workstation process stopped. This is expected downtime behavior; same-session in-memory updates were not expected.
- The complete historical CLOSING open-order payload and post-fill account snapshot were not preserved. Those facts remain historically UNVERIFIED and non-blocking; no values or order identities are inferred.
- Historical exact exchange-filter values were not preserved in runtime logs. Actual exchange acceptance and trade arithmetic are known, but candidate historical filter assumptions are not promoted to facts.
- Process-restart reconstruction remains explicitly deferred to [#654](https://github.com/45s/coinzilla/issues/654) and is outside this audit.

**Verification boundary:** regression tests are present and mapped in [ACCOUNTING_INVARIANTS.md](./docs/domain/ACCOUNTING_INVARIANTS.md), but have not yet been executed on this exact head. The next phase is to run the focused Harvester tests, full Harvester suite, and required CI, then fix any failures. Do not describe this audit closure as test, CI, or TESTNET acceptance.

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

The expected Conservative behavior is defined exclusively in [CONSERVATIVE_DOMAIN_SPECIFICATION.md](./docs/domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md). This evidence report does not repeat SELL formulas, commission reserves, retained-inventory rules, residual handling, terminal outcomes, or recovery-completion criteria.

Historical source observations in the original audit baseline are superseded by the current canonical contract and current source. Implementation conformance remains unaccepted until focused regressions and exact-head CI pass.

ZRO observed arithmetic in the historical session remains an immutable evidence fact: 40 gross BUY - 0.04 base fee - 39.91 SELL = 0.05 ZRO remaining; the recorded quote result was +0.01136454 USDT. DOGE historical evidence and chronology are documented separately in the audit addenda; do not infer current balances or runtime state from those snapshots.

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
| Conservative contract | Strategy rules and accepted configuration | Sole authority: canonical Conservative Domain Specification; owner decisions closed | Every other artifact references it; implementation and exact-head tests conform. |
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


## Historical 2026-11-06 repository and exact-head verification checkpoint (superseded by later docs commits)

> This is a point-in-time snapshot from 11:57 UTC before the canonical-specification consolidation. Its PR head, workflow results, and issue states below are historical. The later documentation commits and current CI state are recorded in the current ROADMAP and PR #653.


At the follow-up verification session (2026-11-06 11:57 UTC), the live GitHub PR metadata, branch ref, changed-file inventory, workflow runs, job results, issue states, and review state were rechecked. PR #653 remains OPEN and unmerged, targets `develop`, and its branch ref matched the previously recorded HEAD `94650284a05e0e18cda662d5a41bce0a47788ac8` at the start of this verification. The PR diff lists all seven expected audit artifacts, and each was fetched successfully from the PR branch. The DOGE/ZRO trade addenda preserve the bounded 50-row exports; neither query is represented as exhaustive all-time history.

All five PR-triggered workflow runs associated with that exact HEAD completed successfully: JavaScript Syntax (run 42213769852), Test Coverage (42213769902), Dependency Audit (42213769838), Unit Tests (42213769873), and Utils Unit Tests (42213769913). Their inspected jobs completed successfully. The Unit Tests workflow's read-only Binance TESTNET integration job was SKIPPED, not passed. Separately, the commit-status endpoint returned `pending` with zero legacy statuses; this is reported independently and is not treated as a failed workflow or as a green combined status. No PR reviews or inline review threads were present at this check.

The repository connector provides read-only GitHub access and cannot read GitHub secret values or dispatch the repository's secret-backed exchange-history workflow. No fresh Binance balances, open orders, complete historical CLOSING open-order payload, or later Harvester Journal/runtime session was available in this session. Accordingly, current DOGE/ZRO/USDT free, locked, and total balances and post-CLOSING Portfolio/RecoveryLedger processing remain UNVERIFIED. Do not infer them from trade exports. The historical CLOSING snapshot remains unchanged.

Historical cross-workstream cross-check at 11:57 UTC: #649 was CLOSED; #626 remained open. The earlier statement that #646 awaited product decisions is superseded: all Conservative owner decisions are now closed and recorded only in the canonical specification. #654 remains the separate restart-reconciliation scope. No exchange writes, order changes, cancellations, withdrawals, account-setting changes, or bot restarts were performed. TESTNET acceptance remains NOT ACCEPTED.


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


## 2026-11-06 source audit — startup replay and residual sell-through

The workstation lifecycle clarification remains authoritative: offline fills are expected and do not require 24/7 uptime or same-session in-memory accounting. DOGE SELL 1276698 and ZRO BUY 727905 must be imported on the next startup before any new trading.

A source review now establishes a concrete restart blocker: `start-harvester.js` explicitly disables durable Journal replay and initializes fresh in-process trading state. The startup path does not call `restoreHarvesterJournalState` or attach its restored Portfolio/RecoveryLedger/OrderRegistry to the trading engine. Separate projection, restoration, trade-history audit, and account-audit helpers exist, but are not proof of startup integration. Classify restart reconciliation as **FAIL at the inspected startup integration**, not merely unknown due to absent runtime logs.

The residual sell-through defect is also source-confirmed: after recovery completion allocates exactly `keepQuantity` and resets the ledger, strategy evaluation suppresses SELL intents when outstanding recovery is zero, even if active inventory remains above `keepQuantity`. The existing test asserts this suppression. Do not make a blind residual SELL; preserve original cycle basis and actual commission facts, and check minimum notional, post-only, quantity steps, and explicit dust before implementing.

Required next work: implement durable replay/reconciliation and fail-closed readiness; implement safe residual sell-through with exact reserve/dust behavior; add the full requested regression matrix; run relevant tests and exact-final-HEAD CI. PR #653 stays open/unmerged. TESTNET acceptance remains **NOT ACCEPTED**. No exchange writes, cancellations, withdrawals, account/config changes, live trades, or bot restarts were performed.


## Audit priority correction — 2026-11-06

Process-restart reconciliation is deferred to the final item in `ROADMAP.md`. It is not an active implementation task, blocker, or acceptance criterion for the current Conservative strategy/policy audit. Do not spend further audit time implementing restart recovery. Continue with Conservative policy defects, sell-through, commission accounting, exact `keepQuantity`, exchange filters/dust, and regression tests.

 
## 2026-11-06 actual DOGE/ZRO Conservative conformance reconciliation

**Decision-time configuration:** the audit-baseline `trading-config.json` at `4af3434f788b87139513921f220294ae90daf4d5` matches the current audit branch configuration: `minProfit=0.01`; DOGE `keepQuantity=1`, maker/taker reserve 0.1%; ZRO `keepQuantity=0.01`, maker/taker reserve 0.1%. Both submitted recovery orders were ordinary `LIMIT` orders, so the applicable planning reserve is 0.1%.

| Symbol / order | Expected under candidate filter steps vs actual SELL quantity and price | Exchange-side result | Strategy verdict |
|---|---|---|---|
| DOGE 1276698 | Under step size 1: 1,196 @ 0.07185; actual 1,196 @ 0.07185 | Two distinct post-CLOSING fills; net proceeds 85.84666740 USDT; profit +0.01066740 USDT; remaining 2.8 DOGE | FOLLOWED for submitted order/exchange execution; filter-based calculation UNVERIFIED |
| ZRO 727904 | Under step size 0.01: 39.91 @ 1.606; actual 39.91 @ 1.606 | One pre-CLOSING fill; net proceeds 64.03136454 USDT; profit +0.01136454 USDT; remaining 0.05 ZRO | FOLLOWED for submitted order/exchange execution; filter-based calculation UNVERIFIED; VIOLATED for recovery completion |

Under candidate step sizes of 1 DOGE and 0.01 ZRO, the canonical 0.1% reserve calculation reproduces both submitted quantities and limit prices exactly. The decision-time configuration is directly confirmed at the audit baseline, and the order history confirms both actual orders were `LIMIT`. However, the original logs record only `Exchange trading rules validated` and do not preserve the exact filter values; the historical step/tick/minimum-filter inputs are therefore UNVERIFIED. Exchange acceptance proves each submitted order passed the exchange's then-current order filters, but does not prove the assumed step values or the residual dust classification. Actual trade commissions, not configured rates, determine realized results.

### DOGE — post-CLOSING SELL, not a runtime contradiction

Three BUY fills acquired 1,198.8 DOGE net after 1.2 DOGE base commissions, with full cost 85.836 USDT. Order 1276698 then filled as two distinct trades after shutdown: trade 221990 sold 278 DOGE and trade 221991 sold 918 DOGE, both at 0.07185. Combined gross proceeds were 85.93260000 USDT, actual quote commission 0.08593260 USDT, and net proceeds 85.84666740 USDT. Net profit is +0.01066740 USDT. Exchange-side remaining inventory is 2.8 DOGE: exact configured keep quantity 1 plus 1.8 excess.

The submitted order values match the canonical calculation under the candidate step-size assumption; exact historical filter-based calculation remains UNVERIFIED. Both executions occurred after the ~07:58Z CLOSING snapshot and process stop, so no same-session Portfolio/RecoveryLedger update was expected. The 1.8 DOGE excess has not been proven as dust from a preserved decision-time exchange-filter snapshot; its value at 0.07185 is 0.12933 USDT. Final in-process disposition remains UNVERIFIED and belongs to the separately deferred restart scope #654, not this active audit.

### ZRO — confirmed historical completion violation

Eight BUY fills acquired 39.96 ZRO net after 0.04 ZRO base commissions; Position.spent was 64.02 USDT. SELL order 727904 sold 39.91 ZRO at 1.606; gross proceeds were 64.09546000 USDT, actual quote commission 0.06409546 USDT, net proceeds 64.03136454 USDT, and realized net profit +0.01136454 USDT. Position quantity after the SELL was 0.05 ZRO.

The historical runtime then allocated 0.01 ZRO to free inventory and reset the RecoveryLedger while 0.04 ZRO remained active. Immediately afterward, repeated Conservative evaluations (07:08:47.129Z through 07:09:04.750Z) returned NO_ACTION with an empty actions array despite the 0.04 active remainder. This directly proves the old strategy did not create a residual SELL. This is **VIOLATED** regardless of whether the 0.04 remainder was exchange-constrained dust: canonical completion requires active quantity to equal keepQuantity, and dust above keepQuantity must remain active with its original cost basis and must not trigger ledger reset. At 1.606, 0.04 ZRO is worth 0.06424 USDT; whether it failed the exact historical MIN_NOTIONAL filter is UNVERIFIED because that decision-time filter snapshot was not preserved.

**Confirmed root cause at the audit baseline:** `evaluateRecoveryCompletion` rejected active quantity below keepQuantity but accepted any amount above it; it did not require equality. Separately, `evaluateConservativeStrategy` emitted recovery SELL only while outstanding recovery was positive, so after the profit target was met it could not sell residual inventory. The baseline Position had no separate accumulated-spent field, so RecoveryLedger.buyCost was the sole recorded recovery cost basis; resetting that ledger zeroed the 64.02 USDT basis while 0.04 ZRO remained active. Together these conditions allowed premature allocation/reset and stranded active residual without its original recovery basis.

**Implementation correction already present on the audit branch:** completion now returns `RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH` whenever active quantity exceeds keepQuantity; the strategy continues planning SELLs above keepQuantity after the profit target is secured, prices that residual from the current market reference, checks exchange filters, and classifies exact constrained dust without resetting the basis. Added actual-fill regression fixtures for both DOGE and ZRO plus an exact ZRO completion-gate regression. These new tests have not yet been executed locally or by GitHub Actions.

ZRO BUY order 727905 (5 gross ZRO, 0.005 ZRO base commission, 4.995 net) filled at 08:38:24.782Z after CLOSING and is a separate later exchange event. It is not included in the 39.96-ZRO pre-SELL position above.

### Current verdict and verification boundary

- DOGE submitted SELL order and exchange execution: FOLLOWED; exact filter-based calculation and post-shutdown residual disposition: UNVERIFIED.
- DOGE post-shutdown fill accounting inside Harvester and final dust disposition: UNVERIFIED; #654 is deferred.
- ZRO submitted SELL order and actual fee/profit arithmetic: FOLLOWED; exact historical filter-based calculation: UNVERIFIED.
- ZRO recovery completion/reset with 0.04 active residual: VIOLATED; root cause confirmed and implementation corrected on this branch.
- Partial SELL stability, decision-B cancel/reconcile/replacement, and other terminal states are not proven by these two final SELLs; continue focused source/test audit rather than infer them from this outcome.
- No TESTNET writes, cancellations, new orders, bot restarts, or merges were performed.


## 2026-11-06 lifecycle audit — partial BUY while recovery SELL is open

**Confirmed source finding — VIOLATED:** `processUserDataEventTransition()` in `src/use-cases/conservative-trading-engine.js` accounts a BUY TRADE fill but returns from the generic `PARTIALLY_FILLED` branch before canceling an active recovery SELL. Cancellation currently occurs only in the later FILLED-BUY path. The canonical specification requires the existing SELL to be canceled and fully reconciled after any new BUY fill, including a partial BUY fill, before recalculating SELL quantity/price.

**Fix and regression added:** commit `9c054725e03a751b06b8a3421e859201640c6469` adds cancellation/reconciliation/replanning for a partial BUY while a recovery SELL is active; commit `3cfc085d0caecc9a74ca9cb279298dde7c6075df` adds a regression asserting the BUY remains PARTIALLY_FILLED, the old SELL is canceled, and a replacement SELL is opened only after reconciliation. Exact-head GitHub Actions had no runs at the time of this update; test and fix are therefore **PENDING VERIFICATION**, not passed.

**Related lifecycle checks:** partial SELL fills are applied through the paired idempotent accounting transition and do not trigger completion; the cancellation-race regression at test line 2551 proves one application when a raced SELL fill is replayed. Dust becoming sellable after a later BUY still requires a dedicated regression. Completion must continue to require exact keepQuantity and preserve above-keep dust/basis without allocation/reset.

The canonical specification remains the sole source of truth and is unchanged. PR #653 remains open/unmerged; #654 remains deferred. No TESTNET writes, cancellations, new orders, or bot restarts were performed.


## Lifecycle audit refinement — partial BUY replacement path (2026-11-06)

The partial-BUY fix required one additional source correction: `evaluateConservativeStrategy()` had an early return for any partially filled BUY, which suppressed all SELL planning even after the old recovery SELL had been reconciled. That gate is removed; active BUY/SELL orders themselves continue to suppress duplicate intents, while SELL planning can now use the updated active Position. Commit `546c2388962774ea89bcc78a98e319337252c895` contains this policy correction; regression commit `58f9369a5ef4b74b83b8680b174ac99765e3a310` updates the scenario to apply the BUY fill to both Position and RecoveryLedger and verify a larger replacement SELL while the BUY remains PARTIALLY_FILLED.

Current lifecycle classifications:
- Partial SELL exact-once accounting: FOLLOWED in-process; paired accounting and stable fill fingerprints, with partial/terminal regression coverage.
- SELL fill racing cancellation and late stream replay: FOLLOWED in-process; test verifies one accounting application.
- Any BUY fill while recovery SELL is open: source correction and regression added; **PENDING VERIFICATION** until exact-head tests run.
- Dust becoming sellable after a later BUY while preserving accumulated basis: UNVERIFIED; source retains Position.spent and evaluates aggregate active quantity, but a dedicated dust-plus-later-BUY regression is still missing.
- Exact keepQuantity on completion: FOLLOWED by the completion predicate and tests; above-keep residual/dust defers free allocation and both Position/RecoveryLedger reset.

Latest source/test head known at this checkpoint: `58f9369a5ef4b74b83b8680b174ac99765e3a310`. No GitHub Actions runs were visible for that exact head. Do not claim tests passed. The canonical specification remains the only source of strategy rules and is unchanged. PR #653 remains open/unmerged; #654 remains deferred. No exchange or TESTNET actions were performed.


## 2026-11-06 continuation — Conservative regression audit

Source/spec review found and corrected stale tests that contradicted the canonical partial-BUY lifecycle: an active PARTIALLY_FILLED BUY suppresses duplicate BUY intent but does not suppress recovery SELL planning; if a recovery SELL is already OPEN/PARTIALLY_FILLED, any new BUY fill requires cancel/reconcile/replace even while the BUY remains partial. Added/updated domain and full-cycle regression assertions. Dust-plus-later-BUY accounting regression is also added. These are test-only changes; no recovery, Journal, or broker implementation was changed.

**Historical checkpoint:** exact dust quantity/filter persistence was unresolved at that time. Superseded by the 2026-11-07 implementation recorded below.

Latest exact-head Actions/workflow runs and legacy statuses remain empty; no tests are claimed as passing. PR #653 remains open/unmerged. No TESTNET or exchange actions were performed.


## 2026-11-06 audit continuation — lifecycle regression precision

After aligning the full-cycle partial-BUY scenario with owner decision B, its fill-count, order-count, and cancellation assertions were updated for both cancellation/reconciliation cycles (follow-up test commit `9c9b0d12fcd04d2ce08915a09e4431241bfd7f9f`). The partial-SELL/no-new-BUY regression was also strengthened to assert the same SELL remains PARTIALLY_FILLED with unchanged limit price and original quantity, with no duplicate SELL or cancellation after a market-price event (test commit `bbeb8ce4f39111bc0f076b99b9dc2001766332c6`). These are test-only changes. Exact-head CI remains unverified.


## Focused lifecycle source audit — 2026-11-06 21:05 +02:00

**Audited ref:** `8c1bdfda34c9f3e9fc0aaf4a5635ecf7cbb570ff`  
**Canonical specification:** unchanged, SHA `7e85f077a0722fff8ee386c3ddba53754ffa313c`.

Rule-by-rule source/test inspection confirms the following current coverage: partial BUY suppresses duplicate BUY while allowing recovery SELL; a BUY partial fill triggers SELL cancellation/reconciliation without advancing the BUY lifecycle; a partial SELL without a new BUY remains the same order/price/original quantity; residual inventory continues sell-through after the profit target; MAX_QUANTITY/MAX_NOTIONAL cap residual SELLs; dust can combine with a later BUY without losing the full cost basis; completion is blocked while inventory remains above exact keepQuantity.

**New coverage gap:** the engine has a terminal SELL path for CANCELED, EXPIRED, and REJECTED: it reconciles terminal fill history before reevaluation. Existing generic terminal-state tests exercise BUY orders, while the recovery-SELL tests cover fill-during-cancel and FILLED completion. No focused test directly exercises each terminal SELL outcome (including a partial execution reported with a non-FILLED terminal status) and proves that complete fill/commission reconciliation precedes replacement. See F-011.

No concrete source/spec behavior mismatch was confirmed in the lifecycle paths inspected in this pass. This is not an overall audit PASS. Exact-head Actions query returned no PR-triggered workflow runs; no tests were executed in this session. Keep PR #653 open/unmerged and TESTNET closed. Historical checkpoint only; superseded by the 2026-11-07 dust completion event implementation below.

## F-011 regression follow-up — terminal recovery SELL

Focused offline engine regression cases have now been added for recovery SELL terminal states CANCELED, EXPIRED, and REJECTED. The valid partial-execution cases assert that actual quote commission is applied to Portfolio net cash flow and RecoveryLedger net SELL proceeds, Position quantity changes while accumulated `spent` is preserved, and only then does CANCELED/EXPIRED return for reevaluation (REJECTED reconciles first, then pauses as designed). Missing executed-fill history and conflicting duplicate fill facts are also covered; both must fail closed without changing accounting or creating a replacement SELL.

Test-only commits: `d936f823e96499e6f586f98847bf5bfa536fb76a`, `bf753cb8f63bc33a868f69aeace460718ddfe7c2`, `8a0483ad8f208236afa8d86be642497aab6038b8`, `0a276483479bc9d11867018a857a3f3b2f2d33bb`. No production source, Journal, broker, or exchange code changed. Test execution and exact-head CI are still pending; this is regression coverage added, not a pass claim.


## 2026-11-06 — final SELL lifecycle coverage review

Reviewed the current branch source and regression inventory for the complete in-scope SELL lifecycle:

- Partial SELL with no new BUY: the existing order remains PARTIALLY_FILLED with unchanged limit price and original quantity; no duplicate SELL or cancellation is created after a market-price event.
- BUY fill while a recovery SELL is open: the engine cancels and reconciles the old SELL before replacement; the BUY may remain PARTIALLY_FILLED. Full-cycle coverage includes both cancellation/reconciliation cycles.
- Terminal recovery SELL: focused CANCELED, EXPIRED, and REJECTED cases include partial terminal execution, actual quote commission, and position/basis/proceeds assertions. Missing history and conflicting duplicate fill facts fail closed without accounting mutation or replacement.
- Residual and dust: coverage includes sell-through after the profit target, quantity-step and MIN_NOTIONAL dust, MAX_QUANTITY/MAX_NOTIONAL caps, exact keepQuantity completion gating, and a later BUY making prior dust sellable while preserving accumulated spent basis and prior net SELL proceeds.
- Actual DOGE/ZRO fill fixtures assert net quantities, full spent basis, net proceeds, and above-keep residual disposition under their explicitly stated test-filter fixtures.

This is a source/test coverage review, **not a test execution or PASS claim**. Focused Harvester tests and the complete verification matrix remain pending. A local clone attempt failed because this environment could not resolve github.com. The exact PR HEAD at the start of this review had no reported commit statuses or PR-triggered workflow runs.

At this historical checkpoint, exact dust quantity/filter persistence was unresolved. Superseded by the 2026-11-07 application/event implementation below.

PR #653 remains OPEN and UNMERGED. No TESTNET or exchange actions were performed.

## Owner clarification — exchange-constrained dust is a keepQuantity bonus (2026-11-06)

The canonical rule is now explicit: unsellable exchange-constrained dust is retained **in addition to** configured `keepQuantity`, not treated as outstanding inventory that must later be sold before completion. Example: `keepQuantity = 1.00` and `dust = 0.04` means retain `1.04` total. Never discard dust, force an invalid SELL, or count dust as sold. Once all sellable quantity is sold and the other completion conditions pass, retain `keepQuantity + dust` and preserve the dust quantity/accounting provenance.

This supersedes older audit wording that required above-keep dust to remain active, block completion/reset, or wait for a later BUY to become sellable. Those statements are historical and are not the current owner-approved contract. The canonical authority is `docs/domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md`.

**Historical checkpoint (superseded 2026-11-07):** source/test conformance had not yet been checked against the dust clarification. The audit-closure section below records the subsequent implementation and regression additions. Exact-head CI remains pending.

## Audit closure — historical evidence disposition and dust recording

**Historical evidence disposition (2026-11-07):**
- DOGE SELL 1276698 and ZRO BUY 727905 filled after Harvester was stopped. The owner runs Harvester on a personal workstation and does not require 24/7 uptime. These post-shutdown fills are expected exchange behavior; missing same-session in-memory Portfolio/Journal updates are not defects.
- The complete historical CLOSING open-order payload and a timestamped post-fill account snapshot were not preserved in the supplied evidence. Their identities/balances remain historically UNVERIFIED; no facts are reconstructed or claimed.
- This historical evidence limitation is dispositioned as non-blocking for this audit. Safe reconciliation of fills during downtime remains a separate restart workstream in #654. The CLOSING audit correctly remained INCOMPLETE at its recorded timestamp.
- Historical DOGE/ZRO exchange-filter calculations cannot be independently reproduced where contemporaneous filter payloads were not captured. This does not invalidate the trade arithmetic or authorize retroactive assumptions.

**Dust completion evidence:**
- Completion accepts above-keep residual only with a validated EXCHANGE_CONSTRAINED_DUST disposition whose exact quantity equals active inventory minus configured keepQuantity.
- The limiting filter must be demonstrated (MIN_QUANTITY, MIN_NOTIONAL, or QUANTITY_INCREMENT); price-filter blocks and unsupported reasons cannot be retained as dust.
- The completed-cycle lifecycle event records dust quantity, reason, and relevant filter threshold/evaluated values. Retained allocation is keepQuantity plus dust.
- Dust completion is attempted only after a reconciled FILLED recovery SELL and a fresh strategy evaluation; a subsequent BUY fill or new SELL order invalidates that eligibility.


---

## 2026-11-07/08 Binance Spot TESTNET session audit — issue #667

**Evidence window:** 2026-11-07 23:08:17.676 UTC through 2026-11-08 01:06:27.840 UTC  
**Runtime:** Conservative strategy, trading enabled, Binance Spot TESTNET  
**Markets:** DOGEUSDT and ZROUSDT  
**Sources:** supplied 130-event session Journal, matching DEBUG/TRACE logs, and `.harvester-trading.lock`. This is a log/evidence audit, not a live account query. No exchange actions were performed during this review.

### Executive disposition

This session is **not a clean acceptance run**. It completed one DOGE recovery cycle and one profitable ZRO SELL, but it also exposed unresolved startup-readiness semantics, a ZRO residual/dust completion discrepancy, a DOGE BUY-to-next-SELL gap, and a failed CLOSING audit. The session must not be described as a successful end-to-end run.

The supplied session Journal contains 130 events. The DEBUG log covers multiple historical runs; the concrete order/fill ledger below is restricted to the 2026-11-07/08 Journal session.

### 1. PREFLIGHT and startup behavior

Configuration validated with trading enabled in Conservative mode for DOGEUSDT and ZROUSDT. Binance connection, exchange trading rules, and user-data subscription were established.

The PREFLIGHT snapshot at 23:08:20.848 UTC recorded:

| Asset | Free | Locked | Total |
|---|---:|---:|---:|
| DOGE | 19,125.4 | 1,196 | 20,321.4 |
| USDT | 8,762.07271735 | 0 | 8,762.07271735 |
| ZRO | 250.24 | 59.87 | 310.11 |

The account-wide open-order query at 23:08:21.141 UTC found two pre-existing SELL orders, both from a different client-ID namespace and therefore unowned by this process:

| Symbol | Broker order ID | Client order ID | Side | Quantity | Limit |
|---|---:|---|---|---:|---:|
| DOGEUSDT | 1317237 | `h-9861b2fcc16b4609add7ee-24` | SELL | 1,196 DOGE | 0.07206 |
| ZROUSDT | 746804 | `h-9861b2fcc16b4609add7ee-31` | SELL | 59.87 ZRO | 1.639 |

The durable `account.open_orders_captured` event recorded `readiness: BLOCKED` and `UNOWNED_OPEN_ORDERS:2`. Nevertheless, the same process activated the Conservative trading engine, published `harvester.started`, and submitted new Harvester orders. This is observed behavior, not an inferred startup failure.

**Contract discrepancy:** the current bootstrap durably records the readiness result but does not reject trading-enabled startup solely because the result is BLOCKED. The roadmap describes existing unowned orders as not automatically rejecting startup, while the README says trading-enabled startup remains blocked and TRADING_FIRST says not to trade blindly when pre-existing orders make the test ambiguous. The runtime's `BLOCKED` label is therefore misleading unless its precise meaning and operator implications are made explicit. Issue [#667](https://github.com/45s/coinzilla/issues/667) tracks the policy decision and required regression. This report does not silently choose a new trading policy.

### 2. Complete Harvester order ledger

The 12 Harvester-submitted orders in this session are listed below. “Actual fill” is the exchange execution price, not the submitted limit. A BUY limit filling below its limit is price improvement and is not, by itself, an invalid order.

| Broker order | Symbol | Side | Submitted limit × quantity | Actual result |
|---:|---|---|---|---|
| 1319921 | DOGEUSDT | BUY | 0.07136 × 400 | CANCELED, 0 filled; trailing repricing |
| 747804 | ZROUSDT | BUY | 1.636 × 5 | FILLED 5 at 1.628, TAKER |
| 747805 | ZROUSDT | SELL | 1.639 × 4.98 | FILLED 4.98 at 1.639, MAKER |
| 747806 | ZROUSDT | BUY | 1.627 × 5 | CANCELED at shutdown, 0 filled |
| 1320040 | DOGEUSDT | BUY | 0.07141 × 400 | FILLED 400 at 0.07141, MAKER |
| 1320210 | DOGEUSDT | SELL | 0.07187 × 398 | CANCELED, 0 filled; recalculated after BUY fill |
| 1320212 | DOGEUSDT | BUY | 0.07137 × 400 | FILLED 400 at 0.07011, TAKER |
| 1320213 | DOGEUSDT | SELL | 0.07112 × 797 | FILLED 797 at 0.07112, MAKER |
| 1320214 | DOGEUSDT | BUY | 0.07007 × 400 | CANCELED, 0 filled; trailing repricing |
| 1320261 | DOGEUSDT | BUY | 0.07084 × 400 | CANCELED, 0 filled; trailing repricing |
| 1320262 | DOGEUSDT | BUY | 0.07108 × 400 | CANCELED, 0 filled; trailing repricing |
| 1320270 | DOGEUSDT | BUY | 0.07141 × 400 | FILLED 400 at 0.07141, MAKER |

No rejection is recorded for these 12 Harvester submissions. Six were filled and six were canceled without execution. The six distinct applied fills are ZRO trade IDs 12352 and 12355, and DOGE trade IDs 230454, 230472, 230478, and 230696. Repeated delivery of already-applied fills was logged as duplicate and ignored; the supplied evidence does not show duplicate accounting application.

All submitted prices align with the captured exchange price increments (DOGE 0.00001; ZRO 0.001), and quantities align with the captured quantity increments (DOGE 1; ZRO 0.01). The submitted notionals shown above exceed the captured minimum notionals (DOGE 1 USDT; ZRO 5 USDT). No invalid tick/step/minimum-notional order is demonstrated by this session.

### 3. External order execution — not a Harvester order

At 23:38:39.319 UTC, pre-existing ZRO SELL order 746804 (client ID `h-9861b2fcc16b4609add7ee-31`) filled:

- Trade ID: 12354
- Side/quantity/price: SELL 59.87 ZRO at 1.639
- Gross quote: 98.12693 USDT
- Commission: 0.09812693 USDT
- Net quote after that commission: 98.02880307 USDT

This was not submitted by the current Harvester process and must not be attributed to its strategy PnL. Harvester emitted `execution.unowned_order`, rejected the event because neither client nor broker order ID matched its registry, and paused ZRO with `UNKNOWN_OR_EXTERNAL_ORDER_EVENT`. The ownership rejection is the expected protective response to an unowned execution; the unresolved question is why the process was allowed to begin trading with this order already present and how the resulting global/user-data readiness should affect the other pair.

The pre-existing DOGE SELL 1317237 was also external/unowned. The closing DOGE locked balance remained 1,196, consistent with that quantity remaining locked, but the supplied Journal does not contain a CLOSING open-order payload; its exact terminal exchange status at shutdown is therefore **not independently verified**.

### 4. ZRO accounting and incomplete dust completion

Harvester BUY order 747804 was submitted as LIMIT 1.636 × 5 and filled as TAKER at 1.628 × 5:

- Gross BUY quote: 8.14 USDT
- Base commission: 0.005 ZRO
- Net strategy position after BUY: 4.995 ZRO
- Accumulated spent: 8.14 USDT

Harvester SELL order 747805 filled 4.98 ZRO at 1.639 as MAKER:

- Gross SELL quote: 8.16222 USDT
- Quote commission: 0.00816222 USDT
- Net SELL proceeds: 8.15405778 USDT
- Realized net profit: 0.01405778 USDT

The configured `keepQuantity` was 0.01 ZRO. The remaining position was 0.015 ZRO, leaving 0.005 ZRO above keepQuantity. The captured ZRO quantity increment was 0.01, so the 0.005 remainder is below one quantity step and is a candidate for exchange-constrained dust. At the recorded price it is also far below the 5 USDT minimum notional.

Despite the actual net profit exceeding the 0.01 minimum, the DEBUG log reports `RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH`; no `recovery.cycle_completed` event was recorded for ZRO. The log's completion input shows activeQuantity 0.015, keepQuantity 0.01, spent 8.14, and netSellProceeds 8.15405778. This conflicts with the canonical specification's dust-plus-keep completion contract unless an additional safety condition (including the earlier unowned-order pause or unavailable free quantity) explains the result. Treat this as an unresolved implementation/evidence discrepancy, not as a proven safe completion or a proven sellable residual. Issue [#667](https://github.com/45s/coinzilla/issues/667) requires a focused regression with exact exchange-filter and free/locked-quantity evidence.

### 5. DOGE recovery cycle and subsequent BUY with no recovery SELL

The first DOGE recovery cycle is accounted in the logs as follows:

| Execution | Gross quote | Commission | Net base/quote effect |
|---|---:|---:|---|
| BUY 400 at 0.07141 | 28.564 USDT | 0.4 DOGE | +399.6 DOGE |
| BUY 400 at 0.07011 | 28.044 USDT | 0.4 DOGE | +399.6 DOGE |
| SELL 797 at 0.07112 | 56.68264 USDT | 0.05668264 USDT | +56.62595736 USDT net |

The cycle's accumulated BUY cost was 56.608 USDT. Net SELL proceeds were 56.62595736 USDT, yielding realized net profit of 0.01795736 USDT. The position retained 2.2 DOGE: configured keepQuantity 1 DOGE plus 1.2 DOGE classified as `EXCHANGE_CONSTRAINED_DUST` due MIN_NOTIONAL. The journal/log record `recovery.cycle_completed`; this cycle's arithmetic and dust disposition are internally consistent with the supplied evidence.

The later DOGE BUY order 1320270 filled at 00:34:50.045 UTC: 400 DOGE at 0.07141, gross quote 28.564 USDT, base commission 0.4 DOGE, net active addition 399.6 DOGE. The DEBUG state then showed DOGE active position 399.6, spent 28.564 USDT, and prior retained/free quantity 2.2 DOGE.

After this accepted BUY fill, repeated DOGE market evaluations reported `NO_ACTION`; no subsequent recovery SELL was submitted before shutdown. The session therefore ended with a new active DOGE recovery position and no SELL order for it. The supplied evidence does not establish why the next required recovery action was not generated. This is a high-priority decision/lifecycle investigation, not a claim that the BUY itself was invalid.

### 6. Shutdown, closing balances, and lock retention

At 01:06:05.933 UTC, Harvester requested cancellation of its own open ZRO BUY order 747806 (5 ZRO at 1.627, zero executed). The exchange cancellation was confirmed at 01:06:07.369 UTC. The external DOGE order was not canceled by Harvester, consistent with the policy that external orders are not owned or automatically modified.

The CLOSING account snapshot at 01:06:22.817 UTC was marked `INCOMPLETE` with reason `USER_DATA_OR_ACCOUNTING_RECONCILIATION_INCOMPLETE`:

| Asset | Free | Locked | Total |
|---|---:|---:|---:|
| DOGE | 19,527.2 | 1,196 | 20,723.2 |
| USDT | 8,831.56953556 | 0 | 8,831.56953556 |
| ZRO | 250.255 | 0 | 250.255 |

The shutdown error was `AggregateError: Harvester shutdown was incomplete`, containing `CLOSING account audit is incomplete: USER_DATA_OR_ACCOUNTING_RECONCILIATION_INCOMPLETE`. The process then disconnected from Binance and closed the Journal, but the stopped event recorded `outcome: failed`. Observability cleanup retained the trading lock because runtime shutdown was not confirmed.

The supplied `.harvester-trading.lock` contains PID 10208, hostname `lpv1`, start time `2026-11-07T23:08:17.659Z`, and an ownership token. The file's presence is evidence that the lock was retained; it is not proof that PID 10208 is still running or that the lock is safe to delete. Verify the process owner on the recorded host before any manual cleanup. Never remove the lock merely to make a subsequent start succeed.

### 7. Account snapshot scope discrepancy

The exchange snapshot source contained 517 balances, but each persisted Journal account snapshot in this session contains only three assets: DOGE, USDT, and ZRO. DEBUG summaries report `sourceAssetCount: 517` and `assetCount: 3`. The current bootstrap passes only enabled markets' base/quote asset codes as `allowedAssetCodes` to the account-snapshot mapper.

This does not match README wording that the PREFLIGHT/CLOSING audit contains every asset returned by the broker. The 517-asset source response was not fully represented in the persisted event. Resolve whether the actual contract is all returned assets or only configured market assets, then align code, event metadata, and docs. If the contract is all assets, add an offline regression with unrelated assets and preserve all of them in the durable event. This is tracked in [#667](https://github.com/45s/coinzilla/issues/667).

### 8. Final classification

**Confirmed correct/expected behavior in the supplied evidence**
- Binance accepted the 12 Harvester orders; no rejection is recorded.
- BUY fills below their submitted limit prices are favorable LIMIT executions, not evidence of an incorrect price.
- Exchange increments and minimum notionals are satisfied by the submitted order prices/quantities.
- The six canonical fills were applied once; duplicate delivery was recognized and ignored.
- The first DOGE recovery cycle's proceeds, commission, profit, and 1.2 DOGE MIN_NOTIONAL dust are internally consistent.
- The pre-existing ZRO order was rejected as unowned and caused ZRO to pause; it was not misattributed to Harvester's own order registry.

**Unresolved/high-priority discrepancies**
- PREFLIGHT readiness says BLOCKED while trading starts; docs disagree about whether unowned open orders should block.
- ZRO's 0.005 remainder above keepQuantity was not classified/completed as dust in the recorded cycle.
- DOGE's later 400-unit BUY fill did not result in a recovery SELL before shutdown.
- CLOSING audit failed due unresolved user-data/accounting reconciliation.
- The persisted account snapshots contain only 3 of 517 source assets despite all-asset documentation.
- The process lock was retained after failed shutdown and requires host/PID verification before manual removal.

**Not established:** a wrong-side Harvester order, an exchange-filter-invalid submitted order, an exchange rejection, duplicate fill accounting, or a successful overall session. No live account state was queried during this retrospective audit.

**Scope:** this evidence report and documentation alignment do not implement the runtime fixes, do not enable Journal replay/process-restart recovery, and do not authorize any TESTNET or production exchange writes. See [issue #667](https://github.com/45s/coinzilla/issues/667) for implementation/regression follow-up.

---

## Follow-up source-code review — 2026-11-08 (supersedes first-pass classifications)

This section updates the initial retrospective classifications using the current develop source, the complete event/log chronology, and the user's confirmed operating policy. The original order/fill ledger and timestamps above remain unchanged.

### 1. The unowned ZRO execution intentionally closes global readiness

At 23:38:39.319 UTC, pre-existing external ZRO SELL order 746804 filled. The Harvester order registry did not own its client or broker order ID. The engine emitted execution.unowned_order, paused ZRO with UNKNOWN_OR_EXTERNAL_ORDER_EVENT, and returned an unsuccessful processing result.

Bootstrap treats that result as an account-integrity failure: it sets userDataAccountingFailed = true, clears userDataReady, and reports EXECUTION_ACCOUNTING_FAILED. The trading engine's canTrade gate depends on userDataReady, so strategy evaluations stop globally. The existing regression explicitly expects the closing audit to remain incomplete after an unowned execution.

**Reclassification:** this global fail-closed behavior is intentional safety policy, not a defect to remove. Pre-existing external orders are allowed at startup and remain unowned; a later unowned execution is a separate account-integrity event.

### 2. Confirmed defect: an already-resting Harvester BUY survived the global halt

DOGE BUY order 1320270 was acknowledged/open at 23:33:26.420 UTC, before the external ZRO execution. The accounting-failure path closed readiness but did not cancel already-resting Harvester BUY orders. DOGE BUY 1320270 therefore remained live and filled at 00:34:50.045 UTC, after the bot had lost permission to evaluate or submit its recovery SELL.

This is the confirmed safety gap: global trading was frozen, but an existing BUY could still add exposure while the bot could not manage the resulting position.

**Fix:** PR #669 adds an account-integrity safety halt that first reconciles Harvester-owned order identities and then uses the existing durable, ownership-checked cancellation/fill-reconciliation workflow for acknowledged OPEN/PARTIALLY_FILLED BUYs only. Existing SELL orders and all external orders remain untouched. The global gate stays closed even after cancellation succeeds. Offline fake-broker regression, full Harvester package tests, and configured repository checks passed on the PR head. No TESTNET or production exchange actions were performed.

### 3. ZRO residual and missing DOGE recovery SELL are consequences of the same halt

After ZRO SELL 747805 filled, the immediate recovery-completion check did not yet have the strategy's inventoryDisposition; it returned RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH and requested a follow-up evaluation. The follow-up evaluation was suppressed because the earlier unowned ZRO execution had already closed global user-data readiness. Thus the 0.005 ZRO remainder was not independently demonstrated to be sellable, and its dust classification did not run in this session.

Likewise, the later DOGE BUY 1320270 filled while global readiness remained closed, so no recovery SELL was generated. The evidence does not demonstrate a separate Conservative strategy-side or dust-policy defect. PR #669 addresses the actionable exposure gap by canceling resting owned BUYs after the safety gate closes.

### 4. Startup PREFLIGHT BLOCKED is an ownership-audit classification

The user confirmed that legitimate pre-existing open orders must not block startup. The account-wide open-order audit can report readiness BLOCKED because those orders are unowned and cannot be reconciled to the current process, while bootstrap still allows startup and leaves them untouched.

**Reclassification:** the runtime behavior is consistent with the confirmed startup policy. The audit label describes ownership/reconciliation completeness, not process startup readiness. Documentation must make that distinction explicit.

### 5. Confirmed snapshot allowlist scope defect — configured assets, not all exchange assets

The user confirmed that PREFLIGHT/CLOSING snapshots must include every asset referenced by Harvester trading configuration, including pairs configured but disabled, and must exclude unrelated exchange-account assets.

The current bootstrap derives both accountAuditMarkets and the Journal configuredAssetCodes allowlist from enabled symbols only. The checked-in config also contains disabled SOLFDUSD and ZROFDUSD pairs, so FDUSD (and SOL where relevant) can be omitted even though those assets are configured.

**Reclassification:** the session's three persisted assets match the two enabled pairs, but the implementation does not satisfy the user's all-configured-pairs contract. This is a separate confirmed defect tracked in issue #667; it will be fixed in a separate focused PR. The intended snapshot is not the full 517-asset Binance wallet.

### 6. CLOSING audit and process lock

The CLOSING snapshot was correctly marked INCOMPLETE after the account-integrity failure. Shutdown must not report success or reopen trading merely because the owned BUY cancellation is confirmed. The retained lock is consistent with failed shutdown; verify PID 10208 on host lpv1 before any manual lock cleanup. Never delete the lock based only on file presence.

### 7. Final reclassification

**Confirmed correct/intentional:** no invalid tick/step/min-notional Harvester submission is demonstrated; no wrong-side Harvester order is demonstrated; duplicate fill delivery was ignored; the first DOGE recovery cycle's accounting is internally consistent; pre-existing external orders were not adopted; an unowned execution correctly triggered the global fail-closed gate; and the CLOSING audit remained incomplete.

**Confirmed defect fixed by PR #669:** acknowledged Harvester-owned BUY orders were not canceled after global account-integrity readiness closed, allowing DOGE BUY 1320270 to fill after the halt.

**Confirmed separate defect still open:** snapshot allowlists include only enabled markets rather than all configured market base/quote assets.

**Not a demonstrated standalone defect:** ZRO dust completion and the absence of a DOGE recovery SELL in this session are explained by the global account-integrity halt; the runtime correctly refrained from further strategy actions while that gate remained closed.

No exchange writes were performed during this review or verification.
