# Harvester Conservative Strategy Audit — Findings Register

**Parent:** [#645](https://github.com/45s/coinzilla/issues/645)  
**Baseline:** `develop` `4af3434f788b87139513921f220294ae90daf4d5`  
**Status vocabulary:** PASS / FAIL / PARTIAL / UNVERIFIED / CONFLICT. These labels distinguish evidence quality and reconciliation outcome; they are not a global release approval.

## F-001 — DOGE SELL order state conflicts with closing account state

**Status: CONFLICT**

**Evidence**
- DOGE order history reports order 1276698 / client ID `h-971fc65d9a264984ab8aa7-11` as FILLED for 1,196 DOGE and 85.9326 USDT.
- Journal `order.submitted` records broker order 1276698 as OPEN; no DOGE SELL `execution.fill_applied` exists among the 12 applied fills.
- CLOSING balances contain 1,196 DOGE locked.
- The DOGE total balance delta is +1,198.8, exactly the net quantity from three 400-DOGE BUY fills less 1.2 DOGE commissions, with no SELL debit reflected.
- Closing audit is INCOMPLETE with two unresolved owned orders.

**Assessment:** The sources conflict. The numerical locked amount matches the reported SELL quantity, but the balance event alone does not prove order identity. Do not book the order-history quote amount as proceeds. No cause is established.

**Status:** CONFLICT for order terminal state; UNVERIFIED for SELL commission, realized net PnL, and final strategy-owned free/locked inventory.

**Next evidence:** Read the original `harvester.log` and `harvester-trace.log` attachments, verify the checksums in #645, correlate order 1276698 through submit/acknowledgement, user-data events, REST order history, CLOSING reconciliation and account snapshot. Do not place or cancel an order to investigate.

## F-002 — ZRO trade arithmetic and residual inventory reconcile

**Status:** PASS for execution arithmetic; PARTIAL for final account/order settlement.

**Evidence**
- Eight BUY trades total 40 ZRO gross, 64.02 USDT quote, and 0.04 ZRO base commission.
- SELL trade 11666/order 727904 executes 39.91 ZRO for 64.09546 USDT with 0.06409546 USDT commission.
- Net SELL proceeds 64.03136454 USDT; realized quote profit 0.01136454 USDT.
- Net base remaining is 40 − 0.04 − 39.91 = 0.05 ZRO.
- The Journal's recovery completion event records exactly 0.01 ZRO free and 0.01136454 USDT realized profit.
- The extra 0.04 ZRO remains active residual from the conservative fee reserve / quantity-step calculation; the strategy guard prevents residual-only recovery SELL creation.
- Account ZRO delta is +0.05, matching the trade ledger.

**Open item:** ZRO order 727905/client suffix -23 remains NEW for 5 ZRO at 1.596, with 7.98 USDT locked. The provided open-orders snapshot corroborates it. It is not a fill and is unresolved at shutdown.

## F-003 — ZRO quote cash flow reconciles exactly with account delta

**Status:** PASS.

DOGE BUY quote debit = 85.836 USDT. ZRO net quote cash flow = +0.01136454 USDT. Combined expected USDT delta = −85.82463546 USDT, exactly matching 8,868.29204995 − 8,954.11668541.

This account-level match is a cross-check, not a substitute for execution-level accounting or external activity attribution. In particular, it does not validate the DOGE SELL.

## F-004 — Duplicate-fill replay is detected without additional balance delta

**Status:** PASS for the observed accounting result; PARTIAL for runtime behavior beyond the Journal evidence.

The Journal records 13 duplicate notifications: ZRO trade 11661 is duplicated at 07:02:40.928Z, and all 12 distinct applied fills are replayed at CLOSING (07:58:11.075–07:58:11.077Z). No additional applied-fill records are created for those replays. The account balance deltas match the 12 unique fills (with the separate DOGE SELL conflict), and source tests cover idempotent duplicate application and conflicting replay identities. Tests were inspected, not executed.

## F-005 — CLOSING audit correctly remains incomplete with unresolved owned orders

**Status:** PASS for the observed `auditStatus=INCOMPLETE` snapshot; PARTIAL for source/test proof of shutdown fail-closed behavior and identification of both orders.

The CLOSING event is `auditStatus=INCOMPLETE` with `UNRESOLVED_OWNED_ORDERS:2`. The ZRO BUY 727905 is independently confirmed NEW and has 7.98 USDT locked. Parsed TRACE records show DOGE SELL 1276698 OPEN/zero-executed at the last runtime evaluations, while the closing snapshot has 1,196 DOGE locked and exchange order history reports FILLED. DOGE 1276698 is a strong candidate for the second unresolved order, but without the full CLOSING open-order identity list do not assert it is definitively that order.

Source inspection found bootstrap CLOSING-audit logic and regression coverage for an unresolved owned order / reconciliation failure. Tests were not run in this audit.

## F-006 — Conservative contract documents conflict with current implementation and roadmap

**Status:** CONFLICT (documentation/source mismatch); follow-up issue [#646](https://github.com/45s/coinzilla/issues/646).

Confirmed mismatches:
1. Conservative domain specification says use makerPercent alone for recovery SELL fee reserve; current code calls `calculateSellFeeRate` with makerPercent and takerPercent, and roadmap/README state the higher of the two is reserved.
2. Specification comparison table still describes a possible post-reset recovery SELL from residual inventory; current strategy requires positive outstanding recovery and a test covers residual inventory after ledger reset.
3. Portfolio documentation says automatic free allocation after recovery completion is not implemented; current bootstrap completion path allocates the exact free quantity and resets the ledger after eligibility.
4. The trading-config validator accepts `minProfit=0` and `keepQuantity=0`, while the recovery SELL planner requires positive minProfit and the recovery completion evaluator requires both positive minProfit and positive keepQuantity. The current TESTNET config uses positive values, so this did not affect the observed run; the accepted-input contract is inconsistent.
5. `ACCOUNTING_INVARIANTS.md` §9 still marks post-allocation residual-inventory strategy coverage as a gap, but `conservative-trading-engine.test.js` now contains `keeps post-recovery residual active inventory and does not issue another recovery SELL`. The matrix should be reconciled with the existing test, while preserving the separate exact-once/full-cycle gaps tracked in #648.
6. `ACCOUNTING_INVARIANTS.md` §9 labels `sell-fee-rate.test.js` as covering observed actual fee rates, configured ceilings, and actual-above-ceiling behavior. The current `sell-fee-rate.js` accepts only configured maker/taker percentages and returns their maximum; its tests cover zero, maker-higher, taker-higher, equality, and invalid percentages. Actual commission amounts are accounted per fill, but no observed fee-rate history is used by the planner. Correct the matrix to describe the current contract or approve a separate behavior change with tests.

No trading behavior was changed to resolve this documentation conflict. Issue #646 requests explicit specification alignment.

## F-007 — Prior user-data recovery fix is merged, but this run does not prove reconnect acceptance

**Status:** PARTIAL.

Issue #626 remains OPEN as of this audit and documents the 2026-11-05 repeated `recovered` / `recoveryRequired=true` deadlock. PR #627's merged implementation starts application reconciliation on `recovered`, drains accepted user-data events, durably audits account/open-order state, and acknowledges only after stable success. Five required workflows passed on PR head `d3307e473cb67b0a76dacb39fb2a0dd40935480b`.

The 2026-11-06 Journal contains no observed reconnect/recovery sequence; therefore live recovery behavior remains UNVERIFIED by this session.

## F-008 — Original application logs integrity-verified and parsed

**Status: PASS for file integrity and parsing; PARTIAL for complete incident resolution.**

The original attachments were read-only inspected and independently hashed:
- `harvester.log`: 16,878,030 bytes; 4,880 physical lines; SHA-256 `5be28db5f6bc998e1190c1bddf4a91c97703fe9e502e98422932511a56ff633d`.
- `harvester-trace.log`: 17,021,746 bytes; 5,739 physical lines; SHA-256 `4a030ccc4cd645b42ffdf01cb285d4cb1fa5d54417f8845a076448f1d20abcd3`.

Both files end with a newline and their checksums match #645. The logs were parsed; key source-line ranges and derived findings are preserved in [AUDIT_LOG_EVIDENCE_2026-11-06.md](./AUDIT_LOG_EVIDENCE_2026-11-06.md). The ZRO Portfolio/RecoveryLedger transition is directly observed. DOGE order 1276698 is OPEN/zero-executed at the final runtime evaluations and absent from the 12 shutdown execution records, which favors open/unfilled, but exchange order history separately reports FILLED. Therefore log integrity/parsing passes while DOGE terminal-state and complete CLOSING-order reconciliation remain unresolved.

## F-009 — Exact-once full-cycle recovery coverage is a concrete test gap

**Status:** PARTIAL; tracked in [#648](https://github.com/45s/coinzilla/issues/648).

The reviewed `apps/harvester/docs/domain/ACCOUNTING_INVARIANTS.md` §9 marks two gaps: exact-once recovery completion/ledger reset, and one complete BUY → partial fills → SELL partial/replacement → completion → next BUY contract test. Source inspection found substantial component coverage in `recovery-completion.test.js`, `conservative-trading-engine.test.js`, and `start-harvester.test.js`, including multiple SELL fills, publication after reset, cancel/replace, and residual inventory. However, the exact-once boundary and a single end-to-end partial-fill/replacement cycle are not directly asserted together. Issue #648 requests offline deterministic test-only coverage; it does not allege a runtime defect or authorize a behavior change. Tests were inspected, not run in this audit.

## F-010 — No runtime defect is confirmed from the accessible evidence

**Status:** PARTIAL.

The accessible evidence establishes a DOGE order/account conflict, not its cause. Do not create a speculative runtime defect issue or implement a speculative reconciliation change. The only follow-ups opened are #646 for confirmed spec/config-boundary drift and #648 for the documented regression-test gap.

## Clarification and closure playbooks

### F-001 — DOGE SELL 1276698 / 1,196 DOGE locked (CONFLICT)

1. Preserve order-history row: orderId 1276698, client ID h-971fc65d9a264984ab8aa7-11, SELL 1,196 at 0.07185, reported quote 85.9326, status FILLED.
2. Preserve Journal separately: broker acknowledgement OPEN and no applied DOGE SELL fill.
3. Obtain full CLOSING open-order list and original harvester.log / harvester-trace.log. Verify both SHA-256 checksums before parsing.
4. Obtain read-only exchange order detail, all DOGE trades from preflight to closing, actual commission amount/asset, and timestamped balances/open orders. Do not submit or cancel an order.
5. Correlate orderId, clientOrderId, tradeId, and timestamps. Preserve exchange milliseconds and Journal event time separately.
6. Build state timeline: intent → submit → acknowledgement → user-data update → trade/fill → cancel if any → REST terminal state → closing reconciliation. Mark absent transitions.
7. Recalculate BUY leg: 1,200 gross; 1.2 DOGE fee; 1,198.8 net; 85.836 USDT debit. Add SELL only when confirmed by trade history and commission evidence.
8. Reconcile free/locked/total DOGE and USDT. If SELL truly filled, explain the base debit and quote credit; if not, explain the FILLED history row.
9. Identify the second unresolved order independently; do not assume it is 1276698.
10. Only after a consistent ledger exists, classify root cause and create a narrow bug issue if warranted, with deterministic regression before implementation.

Closure: terminal state, fills, commissions, balances, reservations, Journal, and both unresolved-order identities reconcile with no unexplained delta.

### F-002 / F-003 — ZRO and account cash flow (PASS / PARTIAL)

1. Preserve BUY trades 11658–11665 and SELL trade 11666.
2. Recompute BUY gross 40; base fees 0.04; net BUY 39.96; SELL 39.91; residual 0.05.
3. Recompute SELL gross quote 64.09546; quote fee 0.06409546; net proceeds 64.03136454; BUY cost 64.02; net quote profit 0.01136454.
4. Tie 0.01 free allocation to cycle completion; verify 0.04 residual in actual Portfolio/RecoveryLedger state or replay. Arithmetic is consistent, but exact in-memory residual ownership remains PARTIAL until directly observed.
5. Tie order 727905 to open-order evidence and 7.98 USDT locked; verify terminal state at closing.
6. Never count standing BUY as execution or realized PnL.

Closure: balance, ledger, free allocation, BUY reservation, and completion agree; order 727905 terminal state known.

### F-004 — duplicate fills (PASS observed Journal; PARTIAL general guarantee)

1. Use canonical identity binance:<symbol>:<tradeId>.
2. Assert 13 duplicate notifications create no extra applied-fill records in this run.
3. Add deterministic cases for exact duplicate, conflicting same identity, REST/stream overlap, reordered fills, reconnect, and process restart.
4. Assert duplicate delivery changes Portfolio and RecoveryLedger by exactly zero; conflicting payload fails closed.
5. Record exact command, commit SHA, and CI for every PASS claim.

Closure: same canonical trade changes state once in all supported delivery/restart permutations.

### F-005 — closing audit (PARTIAL)

1. Retrieve full closing account snapshot and all open orders/reservations.
2. Identify both unresolved owned orders by symbol, orderId, clientOrderId, side, price, original/executed/remaining qty, and locked asset.
3. Reconcile reservations against free/locked balances and ownership registry.
4. Verify shutdown INCOMPLETE is fail-closed; it does not imply orders were canceled.
5. Add offline fixture for two unresolved orders, including one contradictory/unknown order, and assert readiness remains blocked.

Closure: both orders and reservations identified and reconciled, else remain INCOMPLETE.

### F-006 — fee/config contract (#646, CONFLICT)

1. Product/strategy owner chooses planned reserve: makerPercent only or max(makerPercent,takerPercent). Actual fill commissions remain authoritative either way.
2. Decide whether minProfit=0 and keepQuantity=0 are legal.
3. Align config validator with planner/completion preconditions so invalid values fail at config load, or explicitly support them end-to-end.
4. Align Conservative spec, trading-strategies, Accounting Invariants, Portfolio docs, README, and roadmap.
5. Correct test matrix: current fee tests cover configured maker/taker maximum, not observed commission-rate history. Actual fill fees are applied per trade.
6. Correct stale residual-inventory matrix: engine test already covers residual active inventory not creating a new recovery SELL.
7. Run focused tests and exact-head CI only after contract decision.

Closure: one approved policy, no contradictory docs, validator and domain support same values, test matrix reflects assertions.

### F-007 — full-cycle exact-once regression (#648)

1. Use deterministic offline engine + fake broker port; no network or credentials.
2. Submit initial BUY and apply multiple partial BUY fills with actual base/quote fees.
3. Assert inventory/cost and next standing BUY decision from execution data.
4. Create recovery SELL, partially fill, then cancel/replace. Exercise cancel-before-fill and fill-races-cancel orderings.
5. Apply replacement partial and terminal fills; assert actual commission asset/amount, net proceeds, min-profit gate, remaining inventory.
6. Trigger completion; assert one completion event, one keep/free allocation, one RecoveryLedger reset, one next-cycle eligibility transition.
7. Replay terminal SELL and canonical fills; assert no second allocation/reset, no duplicate BUY, and no accounting delta.
8. Assert residual active inventory alone does not create another recovery SELL.
9. Assert externally meaningful Portfolio/RecoveryLedger state and broker-port effects, not private call counts only.
10. Run focused test, Harvester suite, workspace coverage, syntax, and required CI; record exact head in #648/#645.

Closure: one test proves partial execution, replacement, terminal replay, exact-once completion, and next-cycle boundary without changing strategy behavior.

### F-008 — user-data recovery (#626)

1. Re-read original #626 acceptance criteria; do not infer closure from merged #627.
2. Map each criterion to source, deterministic regression, failure mode, and exact CI head.
3. Cover lost/late, duplicate/reordered events, reconnect/resubscribe, REST reconciliation, identity conflicts, and completion interrupted at every recovery boundary.
4. Assess #629 subscription ordering separately; it is not full recovery acceptance.
5. Keep #626 open until each criterion has a verified disposition and owner acceptance.

### Cross-finding order

1. Evidence integrity: original logs, closing open orders, trade history, config snapshot.
2. Exchange facts: resolve DOGE and identify both unresolved orders; no runtime edits while conflict remains.
3. Contract decision: resolve #646.
4. Regression coverage: implement #648 test-only and update invariant matrix.
5. Runtime fix only if a reproduced invariant violation is confirmed.
6. Exact-head CI, then update audit/roadmap/#645 to same commit.


## Clarification and closure playbooks

### F-001 — DOGE SELL 1276698 / 1,196 DOGE locked (CONFLICT)

1. Preserve history row: orderId 1276698, client ID h-971fc65d9a264984ab8aa7-11, SELL 1,196 at 0.07185, quote 85.9326, status FILLED.
2. Preserve Journal separately: acknowledgement OPEN and no applied DOGE SELL fill.
3. Obtain full CLOSING open-order list and original harvester.log / harvester-trace.log. Verify both SHA-256 checksums before parsing.
4. Obtain read-only order detail, all DOGE trades from preflight to closing, actual commission amount/asset, and timestamped balances/open orders. No new order/cancel operation.
5. Correlate orderId, clientOrderId, tradeId, and timestamps. Preserve exchange milliseconds and Journal event time separately.
6. Build state timeline: intent → submit → acknowledgement → user-data update → trade/fill → cancel if any → REST terminal state → closing reconciliation. Mark absent transitions.
7. Recalculate BUY leg: 1,200 gross; 1.2 DOGE fee; 1,198.8 net; 85.836 USDT debit. Add SELL only when confirmed by trade history and commission evidence.
8. Reconcile free/locked/total DOGE and USDT. If SELL filled, explain base debit and quote credit; otherwise explain the FILLED history row.
9. Identify the second unresolved order independently; do not assume it is 1276698.
10. Only after a consistent ledger exists, classify root cause and create a narrow bug issue if warranted, with deterministic regression before implementation.

Closure: terminal state, fills, commissions, balances, reservations, Journal, and both unresolved-order identities reconcile with no unexplained delta.

### F-002 / F-003 — ZRO and account cash flow (PASS / PARTIAL)

1. Preserve BUY trades 11658–11665 and SELL trade 11666.
2. Recompute BUY gross 40; base fees 0.04; net BUY 39.96; SELL 39.91; residual 0.05.
3. Recompute SELL gross quote 64.09546; quote fee 0.06409546; net proceeds 64.03136454; BUY cost 64.02; net quote profit 0.01136454.
4. Tie 0.01 free allocation to cycle completion; verify 0.04 residual in actual Portfolio/RecoveryLedger state or replay. Arithmetic is consistent, but exact in-memory residual ownership remains PARTIAL until directly observed.
5. Tie order 727905 to open-order evidence and 7.98 USDT locked; verify terminal state at closing.
6. Never count standing BUY as execution or realized PnL.

Closure: balance, ledger, free allocation, BUY reservation, and completion agree; order 727905 terminal state known.

### F-004 — duplicate fills (PASS observed Journal; PARTIAL general guarantee)

1. Use canonical identity binance:<symbol>:<tradeId>.
2. Assert 13 duplicate notifications create no extra applied-fill records in this run.
3. Add deterministic cases for exact duplicate, conflicting same identity, REST/stream overlap, reordered fills, reconnect, and process restart.
4. Assert duplicate delivery changes Portfolio and RecoveryLedger by exactly zero; conflicting payload fails closed.
5. Record exact command, commit SHA, and CI for every PASS claim.

Closure: same canonical trade changes state once in all supported delivery/restart permutations.

### F-005 — closing audit (PARTIAL)

1. Retrieve full closing account snapshot and all open orders/reservations.
2. Identify both unresolved owned orders by symbol, orderId, clientOrderId, side, price, original/executed/remaining quantity, and locked asset.
3. Reconcile reservations against free/locked balances and ownership registry.
4. Verify shutdown INCOMPLETE is fail-closed; it does not imply orders were canceled.
5. Add offline fixture for two unresolved orders, including one contradictory/unknown order, and assert readiness remains blocked.

Closure: both orders and reservations identified and reconciled, else remain INCOMPLETE.

### F-006 — fee/config contract (#646, CONFLICT)

1. Product/strategy owner chooses planned reserve: makerPercent only or max(makerPercent,takerPercent). Actual fill commissions remain authoritative either way.
2. Decide whether minProfit=0 and keepQuantity=0 are legal.
3. Align config validator with planner/completion preconditions so invalid values fail at config load, or explicitly support them end-to-end.
4. Align Conservative spec, trading-strategies, Accounting Invariants, Portfolio docs, README, and roadmap.
5. Correct test matrix: current fee tests cover configured maker/taker maximum, not observed commission-rate history. Actual fill fees are applied per trade.
6. Correct stale residual-inventory matrix: engine test already covers residual active inventory not creating a new recovery SELL.
7. Run focused tests and exact-head CI only after contract decision.

Closure: one approved policy, no contradictory docs, validator and domain support same values, test matrix reflects assertions.

### F-007 — full-cycle exact-once regression (#648)

1. Use deterministic offline engine + fake broker port; no network or credentials.
2. Submit initial BUY and apply multiple partial BUY fills with actual base/quote fees.
3. Assert inventory/cost and next standing BUY decision from execution data.
4. Create recovery SELL, partially fill, then cancel/replace. Exercise cancel-before-fill and fill-races-cancel orderings.
5. Apply replacement partial and terminal fills; assert actual commission asset/amount, net proceeds, min-profit gate, remaining inventory.
6. Trigger completion; assert one completion event, one keep/free allocation, one RecoveryLedger reset, one next-cycle eligibility transition.
7. Replay terminal SELL and canonical fills; assert no second allocation/reset, no duplicate BUY, and no accounting delta.
8. Assert residual active inventory alone does not create another recovery SELL.
9. Assert externally meaningful Portfolio/RecoveryLedger state and broker-port effects, not private call counts only.
10. Run focused test, Harvester suite, workspace coverage, syntax, and required CI; record exact head in #648/#645.

Closure: one test proves partial execution, replacement, terminal replay, exact-once completion, and next-cycle boundary without changing strategy behavior.

### F-008 — user-data recovery (#626)

1. Re-read original #626 acceptance criteria; do not infer closure from merged #627.
2. Map each criterion to source, deterministic regression, failure mode, and exact CI head.
3. Cover lost/late, duplicate/reordered events, reconnect/resubscribe, REST reconciliation, identity conflicts, and completion interrupted at every recovery boundary.
4. Assess #629 subscription ordering separately; it is not full recovery acceptance.
5. Keep #626 open until each criterion has a verified disposition and owner acceptance.

### Cross-finding order

1. Evidence integrity: original logs, closing open orders, trade history, config snapshot.
2. Exchange facts: resolve DOGE and identify both unresolved orders; no runtime edits while conflict remains.
3. Contract decision: resolve #646.
4. Regression coverage: implement #648 test-only and update invariant matrix.
5. Runtime fix only if a reproduced invariant violation is confirmed.
6. Exact-head CI, then update audit/roadmap/#645 to the same commit.


## F-011 — ZRO runtime Portfolio and RecoveryLedger cycle state directly observed

**Status: PASS for the observed in-memory accounting transition.**

Trace lines 4551–4563 record canonical SELL trade 11666/order 727904 applied exactly once, Portfolio active quantity 0.05 ZRO and quote cash flow +0.01136454 USDT, RecoveryLedger proceeds 64.03136454 USDT and outstanding 0, followed by eligible completion allocating 0.01 ZRO free, retaining 0.04 active residual, and resetting cycle totals. The following evaluation retains active 0.04/free 0.01/total 0.05. This directly establishes the runtime state previously inferred from Journal and arithmetic. It does not establish full account settlement or TESTNET acceptance. Full detail: [log evidence addendum](./AUDIT_LOG_EVIDENCE_2026-11-06.md).
