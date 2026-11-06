# Harvester Conservative Strategy Audit — Findings Register

**Parent:** [#645](https://github.com/45s/coinzilla/issues/645)  
**Baseline:** `develop` `4af3434f788b87139513921f220294ae90daf4d5`  
**Status vocabulary:** PASS / FAIL / PARTIAL / UNVERIFIED / CONFLICT. These labels distinguish evidence quality and reconciliation outcome; they are not a global release approval.

## F-001 — DOGE SELL order state conflicts with closing account state

<badge-placeholder>CONFLICT</badge-placeholder>

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

## F-004 — CLOSING audit correctly remains incomplete with unresolved owned orders

**Status:** PASS for the observed fail-closed audit result; PARTIAL for identifying both orders.

The CLOSING event is `auditStatus=INCOMPLETE` with `UNRESOLVED_OWNED_ORDERS:2`. The ZRO BUY 727905 is independently confirmed NEW and has 7.98 USDT locked. The DOGE 1,196 locked amount and order-history FILLED status conflict; without the raw logs and a CLOSING open-order identity list, do not assert that order 1276698 is definitively the second unresolved order.

Source inspection found bootstrap CLOSING-audit logic and regression coverage for an unresolved owned order / reconciliation failure. Tests were not run in this audit.

## F-005 — Conservative specification and Portfolio documentation are stale against current source

**Status:** CONFLICT (documentation/source mismatch); follow-up issue [#646](https://github.com/45s/coinzilla/issues/646).

Confirmed mismatches:
1. Conservative domain specification says use makerPercent alone for recovery SELL fee reserve; current code calls `calculateSellFeeRate` with makerPercent and takerPercent, and roadmap/README state the higher of the two is reserved.
2. Specification comparison table still describes a possible post-reset recovery SELL from residual inventory; current strategy requires positive outstanding recovery and a test covers residual inventory after ledger reset.
3. Portfolio documentation says automatic free allocation after recovery completion is not implemented; current bootstrap completion path allocates the exact free quantity and resets the ledger after eligibility.

No trading behavior was changed to resolve this documentation conflict. Issue #646 requests explicit specification alignment.

## F-006 — Prior user-data recovery fix is merged, but this run does not prove reconnect acceptance

**Status:** PARTIAL.

Issue #626 documents the 2026-11-05 repeated `recovered` / `recoveryRequired=true` deadlock. PR #627's merged implementation starts application reconciliation on `recovered`, drains accepted user-data events, durably audits account/open-order state, and acknowledges only after stable success. Five required workflows passed on PR head `d3307e473cb67b0a76dacb39fb2a0dd40935480b`.

The 2026-11-06 Journal contains no observed reconnect/recovery sequence; therefore live recovery behavior remains UNVERIFIED by this session.

## F-007 — Original application logs not parsed in this execution session

**Status:** UNVERIFIED.

The evidence inventory in #645 records:
- `harvester.log`: 16,878,030 bytes; 4,880 lines; SHA-256 `5be28db5f6bc998e1190c1bddf4a91c97703fe9e502e98422932511a56ff633d`.
- `harvester-trace.log`: 17,021,746 bytes; 5,739 lines; SHA-256 `4a030ccc4cd645b42ffdf01cb285d4cb1fa5d54417f8845a076448f1d20abcd3`.

The original conversation attachments were not mounted/exposed to the current tool session. These files were not read, their checksums were not recomputed, and no excerpts were substituted. The full-log correlation requirement remains open.

## F-008 — No confirmed runtime fix or additional test-gap issue from accessible evidence

**Status:** PARTIAL.

The accessible evidence establishes a DOGE order/account conflict, not its cause. The relevant recovery/commission/duplicate/account-audit tests are present in source, but not executed here. Do not create a speculative runtime defect issue or implement a speculative reconciliation change. The only child issue opened is the confirmed specification/documentation alignment item #646.
