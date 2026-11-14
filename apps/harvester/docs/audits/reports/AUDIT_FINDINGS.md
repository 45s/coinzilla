# Harvester Conservative Strategy Audit — Findings Register

**Parent:** [#645](https://github.com/45s/coinzilla/issues/645)  
**Baseline:** `develop` `4af3434f788b87139513921f220294ae90daf4d5`  
**Status vocabulary:** PASS / FAIL / PARTIAL / UNVERIFIED / CONFLICT. These labels distinguish evidence quality and reconciliation outcome; they are not a global release approval.

## F-001 — DOGE SELL 1276698 filled after shutdown; historical snapshots are time-consistent

**Status: PASS for exchange execution arithmetic and post-shutdown chronology; UNVERIFIED for the complete historical CLOSING order identity list and later in-process application (non-blocking; #654 owns restart reconciliation).**

**Evidence**
- DOGE order history reports order 1276698 / client ID `h-971fc65d9a264984ab8aa7-11` as FILLED for 1,196 DOGE and 85.9326 USDT.
- Journal `order.submitted` records broker order 1276698 as OPEN; no DOGE SELL `execution.fill_applied` exists among the 12 applied fills.
- CLOSING balances contain 1,196 DOGE locked.
- The DOGE total balance delta is +1,198.8, exactly the net quantity from three 400-DOGE BUY fills less 1.2 DOGE commissions, with no SELL debit reflected.
- Closing audit is INCOMPLETE with two unresolved owned orders.

**Assessment (superseding the initial conflict):** The full trade export identifies order 1276698 through trades 221990 and 221991: 1,196 DOGE sold, 85.9326 USDT gross, 0.0859326 USDT quote commission, and 85.8466674 USDT net proceeds. Both fills occurred after the ~07:58Z shutdown/CLOSING snapshot. The Journal OPEN/zero-executed state and earlier CLOSING balances are therefore valid snapshots from before the fills, not contradictory simultaneous states. Same-session Portfolio/RecoveryLedger application was not expected while the workstation process was stopped.

**Historical limitation:** The complete CLOSING open-order payload was not preserved, so the identity of the second unresolved order cannot be proven. This remains UNVERIFIED and non-blocking; safe application of post-shutdown fills on a later startup belongs to #654. Do not reconstruct a missing snapshot or claim later in-process application.

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

**CLOSING snapshot:** ZRO order 727905/client suffix -23 was NEW for 5 ZRO at 1.596, with 7.98 USDT locked. The supplied later trade export records trade 12182 filling this order after shutdown: 5 ZRO gross, 0.005 ZRO base commission, 4.995 ZRO net credit, and 7.98 USDT quote debit. This is expected downtime behavior, not a current unresolved order. Later in-process reconciliation is outside this audit and tracked in #654.

## F-003 — ZRO quote cash flow reconciles exactly with account delta

**Status:** PASS.

DOGE BUY quote debit = 85.836 USDT. ZRO net quote cash flow = +0.01136454 USDT. Combined expected USDT delta = −85.82463546 USDT, exactly matching 8,868.29204995 − 8,954.11668541.

This account-level match is a cross-check, not a substitute for execution-level accounting or external activity attribution. The DOGE SELL is independently reconciled by the later order-specific trade export in F-001; that post-CLOSING fill is not part of the earlier CLOSING cash-flow snapshot.

## F-004 — Duplicate-fill replay is detected without additional balance delta

**Status:** PASS for the observed accounting result; PARTIAL for runtime behavior beyond the Journal evidence.

The Journal records 13 duplicate notifications: ZRO trade 11661 is duplicated at 07:02:40.928Z, and all 12 distinct applied fills are replayed at CLOSING (07:58:11.075–07:58:11.077Z). No additional applied-fill records are created for those replays. The account balance deltas match the 12 unique fills (with the separate DOGE SELL conflict), and source tests cover idempotent duplicate application and conflicting replay identities. Tests were inspected, not executed.

## F-005 — CLOSING audit correctly remained incomplete at shutdown

**Status:** PASS for the observed `auditStatus=INCOMPLETE` snapshot; historical identity of the second unresolved order remains UNVERIFIED and non-blocking.

The CLOSING event correctly recorded `auditStatus=INCOMPLETE` and `UNRESOLVED_OWNED_ORDERS:2`. The later trade exports establish that DOGE SELL 1276698 and ZRO BUY 727905 both filled after shutdown. The missing full CLOSING order list prevents definitive identification of the second unresolved order at that historical instant. This limitation is now explicitly dispositioned as non-blocking; the original INCOMPLETE status is not retroactively changed. Restart reconciliation remains #654.

## F-006 — Historical Conservative documentation conflict (superseded 2026-11-06)

**Status:** The earlier multi-document conflict is superseded by the owner-approved canonical contract. The sole current rule authority is [CONSERVATIVE_DOMAIN_SPECIFICATION.md](../../domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md). Old maker-only fee, residual-suppression, portfolio completion, and zero-value statements preserved in historical records must not be used as current policy.

All owner decisions are closed and recorded in the canonical specification; no further product decisions are pending.

Issue #646 and PR #653 track implementation conformance, documentation consolidation, and regression verification—not unresolved product decisions. This finding remains as historical provenance only.

## F-007 — Prior user-data recovery fix is merged, but this run does not prove reconnect acceptance

**Status:** PARTIAL.

Issue #626 remains OPEN as of this audit and documents the 2026-11-05 repeated `recovered` / `recoveryRequired=true` deadlock. PR #627's merged implementation starts application reconciliation on `recovered`, drains accepted user-data events, durably audits account/open-order state, and acknowledges only after stable success. Five required workflows passed on PR head `d3307e473cb67b0a76dacb39fb2a0dd40935480b`.

The 2026-11-06 Journal contains no observed reconnect/recovery sequence; therefore live recovery behavior remains UNVERIFIED by this session.

## F-008 — Original application logs integrity-verified and parsed

**Status: PASS for file integrity and parsing; PARTIAL for complete incident resolution.**

The original attachments were read-only inspected and independently hashed:
- `harvester.log`: 16,878,030 bytes; 4,880 physical lines; SHA-256 `5be28db5f6bc998e1190c1bddf4a91c97703fe9e502e98422932511a56ff633d`.
- `harvester-trace.log`: 17,021,746 bytes; 5,739 physical lines; SHA-256 `4a030ccc4cd645b42ffdf01cb285d4cb1fa5d54417f8845a076448f1d20abcd3`.

Both files end with a newline and their checksums match #645. The logs were parsed; key source-line ranges and derived findings are preserved in [AUDIT_LOG_EVIDENCE_2026-11-06.md](../evidence/AUDIT_LOG_EVIDENCE_2026-11-06.md). The ZRO Portfolio/RecoveryLedger transition is directly observed. DOGE order 1276698 is OPEN/zero-executed at the final runtime evaluations and absent from the 12 shutdown execution records, which favors open/unfilled, but exchange order history separately reports FILLED. Therefore log integrity/parsing passes while DOGE terminal-state and complete CLOSING-order reconciliation remain unresolved.

## F-009 — Exact-once full-cycle recovery coverage is a concrete test gap

**Status:** PARTIAL; tracked in [#648](https://github.com/45s/coinzilla/issues/648).

The reviewed `apps/harvester/docs/domain/ACCOUNTING_INVARIANTS.md` §9 marks two gaps: exact-once recovery completion/ledger reset, and one complete BUY → partial fills → SELL partial/replacement → completion → next BUY contract test. Source inspection found substantial component coverage in `recovery-completion.test.js`, `conservative-trading-engine.test.js`, and `start-harvester.test.js`, including multiple SELL fills, publication after reset, cancel/replace, and residual inventory. However, the exact-once boundary and a single end-to-end partial-fill/replacement cycle are not directly asserted together. Issue #648 requests offline deterministic test-only coverage; it does not allege a runtime defect or authorize a behavior change. Tests were inspected, not run in this audit.

## F-010 — Historical evidence snapshot: no runtime defect confirmed from the then-accessible evidence (superseded)

**Status:** PARTIAL.

The initial evidence snapshot was incomplete and appeared conflicting. The later full trade export established post-shutdown DOGE execution chronology; no simultaneous order/account contradiction or speculative runtime defect is asserted. The missing historical CLOSING open-order payload remains explicitly UNVERIFIED and non-blocking.

## Clarification and closure playbooks

### F-001 — historical DOGE CLOSING identity gap (dispositioned; no further evidence request)

Historical disposition: the available order-specific export reconciles the DOGE SELL's two fills and actual quote commission after shutdown. The complete CLOSING open-order payload and post-fill balance snapshot were not preserved; do not request or infer them as prerequisites. Record those two facts as historically UNVERIFIED and non-blocking. Safe restart reconciliation is separate in #654. No exchange action is required for this finding.

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

### F-006 — fee/config contract (#646; historical, superseded)

Owner decisions are closed and recorded in the canonical Conservative specification. This old decision checklist is retained only as history. Current rules and acceptance requirements are defined exclusively in [CONSERVATIVE_DOMAIN_SPECIFICATION.md](../../domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md).

### F-007 — full-cycle exact-once and lifecycle regression (#648)

1. Use deterministic offline engine + fake broker port; no network or credentials.
2. Apply multiple partial BUY fills with actual commission facts; verify quantity, full accumulated spent, and exact-once accounting.
3. Prove a partial SELL without a new BUY keeps the same exchange order and same price.
4. When a new BUY fills during an OPEN/PARTIALLY_FILLED recovery SELL, cancel it, reconcile terminal state and all fills/commissions, update accounting, then plan the replacement.
5. Cover fill-during-cancel including terminal FILLED, cancellation, expiry, rejection, unknown state, incomplete history, and conflicting duplicate fills.
6. Verify full accumulated cost recovery without proportional reduction, at least 0.01 realized net profit, exact keepQuantity, residual sell-through, and explicit dust with basis preserved.
7. Verify exact-once completion/reset only when position quantity equals keepQuantity; keepQuantity=0 requires the full end-to-end workflow.
8. Assert externally meaningful Portfolio/RecoveryLedger state and broker-port effects, not private call counts only.
9. Run focused test, Harvester suite, workspace coverage, syntax, and required CI; record exact head in #648/#645.

Closure: focused regressions prove the canonical lifecycle and accounting contract; tests do not define a competing strategy rule.

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

## F-011 — ZRO runtime Portfolio and RecoveryLedger cycle state directly observed

**Status: PASS for the observed in-memory accounting transition.**

Trace lines 4551–4563 record canonical SELL trade 11666/order 727904 applied exactly once, Portfolio active quantity 0.05 ZRO and quote cash flow +0.01136454 USDT, RecoveryLedger proceeds 64.03136454 USDT and outstanding 0, followed by eligible completion allocating 0.01 ZRO free, retaining 0.04 active residual, and resetting cycle totals. The following evaluation retains active 0.04/free 0.01/total 0.05. This directly establishes the runtime state previously inferred from Journal and arithmetic. It does not establish full account settlement or TESTNET acceptance. Full detail: [log evidence addendum](../evidence/AUDIT_LOG_EVIDENCE_2026-11-06.md).


## F-010 — post-CLOSING exchange fills are not reflected in the stopped runtime snapshot

**Classification:** PARTIAL (exchange-side terminal executions confirmed; internal post-shutdown reconciliation unverified). **Scope:** DOGEUSDT order 1276698 and ZROUSDT order 727905.

**Expected:** order/trade history, runtime state, and account snapshots must be compared on a common timeline; later fills must be reconciled before any subsequent trading readiness or accounting claim.

**Observed:** DOGE order 1276698 was OPEN/0 executed at the final runtime evaluations (~07:57:19Z) and remained in the ~07:58:11Z CLOSING snapshot; actual SELL trades 221990/221991 executed at 08:03:01.841Z and 08:03:18.202Z for 1,196 DOGE. ZRO order 727905 was NEW with 7.98 USDT locked at CLOSING; actual BUY trade 12182 executed at 08:38:24.782Z for 5 ZRO less 0.005 ZRO commission.

**Independent calculations:** DOGE gross proceeds 85.93260000 USDT less 0.08593260 USDT quote commission = 85.84666740 USDT net. ZRO BUY 727905: 5.00000000 gross base less 0.00500000 ZRO commission = 4.99500000 net base; quote debit 7.98000000 USDT.

**Impact:** the earlier apparent DOGE runtime/order-history conflict is explained by event chronology, not a same-time contradiction. However, the fills occurred after Harvester shutdown; internal Portfolio/RecoveryLedger processing, later account balances, and any subsequent controller reconciliation are not proven. The later ZRO BUY also resolves only one of two CLOSING unresolved orders; the other identity remains unknown.

**Next action:** obtain fresh read-only balances/open orders and canonical order detail; inspect any subsequent Journal/runtime session for processing of these post-shutdown fills. Keep TESTNET acceptance closed until account-wide reconciliation is complete. Raw 50-row exports and calculations are in the two linked trade-evidence addenda.


## Verification appendix — 2026-11-06 11:57 UTC

**Repository/PR verification:** PR #653 remains open and unmerged on `docs/harvester-log-evidence-2026-11-06`; the branch matched HEAD `94650284a05e0e18cda662d5a41bce0a47788ac8` when checked. All seven expected evidence/audit files are in the PR diff and were fetched from the branch. Five exact-HEAD PR workflow runs completed successfully (JavaScript Syntax, Test Coverage, Dependency Audit, Unit Tests, Utils Unit Tests). The read-only Binance TESTNET integration job was skipped. The separate commit-status endpoint reports pending with zero statuses; this is not conflated with Actions conclusions. No PR review or inline review thread was present.

**Current evidence gaps remain unchanged:** later DOGE 1276698 and ZRO 727905 exchange fills are verified by bounded 50-row exports, but later Harvester processing and current balances are UNVERIFIED. The full historical CLOSING open-order payload is still absent, so the complete two-order identity set is not proven. No all-time trade-history claim is made. The original CLOSING snapshot is not rewritten.

**Cross-workstream state (superseding update):** #646 owner decisions are CLOSED; the canonical specification is the sole rule source. #626 remains a separate user-data recovery workstream. PR #653 is open and unmerged on the current audit branch; at the starting head Unit Tests and Test Coverage failed while Syntax, Utils Unit Tests, and Dependency Audit passed. The documentation commits have not yet been reverified by CI. TESTNET acceptance remains NOT ACCEPTED.


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


## F-001 disposition update — DOGE exchange execution occurred after CLOSING (2026-11-06)

Updated status: PARTIAL — exchange execution chronology reconciled; post-shutdown application/account settlement UNVERIFIED.

The original F-001 same-time conflict interpretation is superseded by the two preserved DOGE actual-trade rows: trade 221990 (278 DOGE SELL at 08:03:01.841Z) and trade 221991 (918 DOGE SELL at 08:03:18.202Z), both for order 1276698. The original TRACE final OPEN/zero-executed observation (~07:57:19Z) and CLOSING account snapshot (~07:58:11Z) both precede these fills. The exchange later filled 1,196 DOGE; gross proceeds were 85.93260000 USDT, quote commission 0.08593260 USDT, and net proceeds 85.84666740 USDT.

This resolves the apparent runtime-versus-history contradiction by chronology. It does not establish a later Harvester accounting application: the process had stopped before the exchange fills. No later Portfolio/RecoveryLedger evidence or timestamped post-fill account snapshot is available. The full historical CLOSING open-orders payload is still missing, so the complete identities of both CLOSING unresolved orders are not proven. Do not backfill these later fills into the historical CLOSING snapshot or infer post-shutdown application.


## Finding disposition — offline exchange fills are expected (2026-11-06)

**Correction to earlier wording:** Harvester is operated on the owner's personal PC, not a continuously running server. The owner may stop the process with live exchange orders still resting. Those orders remain on Binance and may fill while Harvester is offline. This is an expected lifecycle condition, not a defect, policy violation, or evidence of incorrect owner operation.

For DOGE order 1276698, the final runtime/CLOSING observations correctly showed OPEN / zero executed before shutdown; exchange trades 221990 and 221991 filled the order later. For ZRO BUY 727905, the order was NEW at CLOSING and filled later as trade 12182. Neither later fill should be inserted into the earlier CLOSING snapshot. The absence of an in-process Portfolio/RecoveryLedger update while the process was stopped is expected.

**Audit classification:** downgrade/remove “post-CLOSING Portfolio/RecoveryLedger application not evidenced” as a same-session defect or operator acceptance blocker. Keep a distinct restart-reconciliation verification item: on next startup Harvester must fetch and idempotently apply all owned fills since its last durable checkpoint, reconcile current balances/open orders/commissions, and keep trading disabled until complete. Classify this behavior UNVERIFIED until source/tests or a controlled restart scenario establish it; do not claim failure based solely on missing post-shutdown runtime logs.


## F-011 — durable restart reconciliation (2026-11-06)

**Status: DEFERRED — outside the active Conservative strategy/policy audit. Not a blocker for issue #645, issue #646, or PR #653 acceptance.**

**Owner-approved lifecycle:** Harvester runs on a personal workstation and may be stopped while Binance orders remain open. Exchange orders can partially or fully fill while Harvester is offline. This is expected. On the next startup, before any new trading, Harvester must reconcile every owned fill since the last durable checkpoint, actual commissions, partial/terminal order states, balances, locked funds, and open orders; update Portfolio/RecoveryLedger exactly once; restore reservations; and remain fail-closed until all checks succeed.

**Source observation:** `apps/harvester/src/bootstrap/start-harvester.js` explicitly states that durable Journal replay is disabled and that startup uses fresh in-process trading state. The startup path does not invoke `restoreHarvesterJournalState` or wire its restored Portfolio, RecoveryLedger, and OrderRegistry into the trading engine. The repository contains separate offline primitives (`projectHarvesterJournalRecovery`, `restoreHarvesterJournalState`, `auditRecoveredTradeHistory`, and `auditRecoveredAccountState`), but no proof that these are integrated into process startup. This is stronger than an absence of later runtime logs: the inspected startup path explicitly bypasses replay.

**Impact:** a process restart after DOGE SELL 1276698 and ZRO BUY 727905 filled while offline cannot currently be claimed to reconstruct those fills from durable state before trading. The historical CLOSING snapshot remains correct and immutable; no same-session update was expected while the process was stopped. This is a startup-safety defect, not an operator uptime issue.

**Required fix and tests:**
- Restore the durable Journal projection before activating the trading engine.
- Fetch complete exchange trade history since the durable checkpoint for every relevant symbol/market, with pagination exhaustion and market-universe completeness proven.
- Correlate fills to owned broker/client order IDs; apply each missing fill atomically to Portfolio and RecoveryLedger exactly once, including base/quote commission amounts and assets.
- Reconcile partial and terminal order states, canceled orders with late fills, open-order reservations, account free/locked/total balances, and snapshot timestamps.
- Durably record successful reconciliation/checkpoint before opening the trading gate. Missing/incomplete history, unknown ownership, duplicate-ID conflicts, unsupported commissions, or contradictory balances/orders must leave trading blocked.
- Add deterministic restart tests for offline DOGE/ZRO fills, partial fills, terminal orders, commissions, repeated startup/replay, duplicate prevention, balance/open-order mismatch, incomplete pagination, and fail-closed readiness.

**Evidence discipline:** no TESTNET acceptance is inferred from source inspection or offline tests. No exchange writes, bot restarts, or account mutations were performed.


**Historical priority correction (2026-11-06):** implementation was deferred during the Conservative TESTNET workflow. The 2026-11-09 user request reactivates forensic investigation only; implementation remains separate. Current status and evidence are tracked by F-030. The active work is Conservative strategy/policy correctness, residual sell-through, actual commission accounting, exact `keepQuantity`, exchange filters/dust, and order lifecycle regression coverage. See the final Deferred section in `ROADMAP.md`.


**2026-11-09 status update:** The offline helper stack and tests remain in the repository, but current runtime wiring is absent. The historical PR #606 startup integration passed `marketUniverseComplete: false` into an audit that requires true and therefore failed closed for prior trading activity. See F-031 and the current session report.

## F-012 — Conservative residual sell-through and lifecycle conformance (2026-11-06)

**Status: IMPLEMENTATION PRESENT; ACCEPTANCE NOT VERIFIED.**

The branch contains a residual sell-through implementation that plans SELLs above exact keepQuantity after cumulative proceeds secure the minimum profit, retains the original cost/proceeds basis while residual remains, uses current-market residual pricing, checks minimum quantity/notional, reports exchange-constrained dust, and suppresses duplicate active SELL intents. Existing focused tests cover several of these paths.

This is not a claim that the full Conservative contract is implemented. Remaining audit scope includes:

- Actual base/quote/third-asset commission valuation and fail-closed behavior when third-asset quote valuation is unavailable.
- Full accumulated cost recovery without proportional reduction.
- Exact keepQuantity and keepQuantity=0 complete workflow verification.
- Decision B across OPEN and PARTIALLY_FILLED SELLs, including PENDING acknowledgement, fill-during-cancel, terminal FILLED during cancellation, complete fill/commission reconciliation, and replacement from updated accounting.
- Same SELL order and same price after a partial SELL when no new BUY has filled.
- Terminal FILLED/CANCELED/EXPIRED/REJECTED/UNKNOWN outcomes, dust, duplicate prevention, and exact-once completion.

### Verification status

The older exact code head 1e4bf3272983411b5e8c2224b3fd4371baec86f9 passed five workflows; the read-only TESTNET integration job was skipped. That historical checkpoint does not establish current-head acceptance. At the starting PR #653 head 5f2b88f1697b36225c4579212bf8044c2527c2f2, Unit Tests and Test Coverage failed; JavaScript Syntax, Utils Unit Tests, and Dependency Audit passed. Re-run every required check on the exact final head.

Restart reconciliation remains separate in #654. PR #653 remains open and unmerged; no TESTNET acceptance or merge is authorized.


## F-001 follow-up — post-CLOSING DOGE execution established; strategy conformance still to be checked

**Updated status:** exchange execution arithmetic RESOLVED; C-strategy quantity/price/inventory conformance PARTIAL pending comparison with the exact session configuration and decision inputs.

The bounded DOGE trade export establishes that order 1276698 filled after the ~07:58 UTC CLOSING snapshot: 278 + 918 = 1,196 DOGE, gross quote 85.93260000 USDT, actual quote commission 0.08593260 USDT, net proceeds 85.84666740 USDT. The three preceding BUY fills acquired 1,198.8 net DOGE after 1.2 DOGE base commissions and cost 85.836 USDT. Exchange-side arithmetic therefore gives +0.01066740 USDT net profit and a simple remaining-quantity difference of 2.8 DOGE.

This supersedes the earlier interpretation that the exchange order-history FILLED state directly conflicted with the ~07:58 runtime OPEN/zero-executed observation: the fills happened later. It does **not** establish whether the submitted 1,196-DOGE quantity and 0.07185 price conformed to the exact configured keepQuantity, fee reserve, symbol filters, and Conservative calculation at decision time. Reconstruct those inputs and compare them. Do not book post-shutdown fills into the earlier in-memory state.

## F-002 follow-up — ZRO completion arithmetic and residual disposition

The bounded ZRO trade export confirms BUY cost 64.02 USDT, net acquired quantity 39.96 ZRO, SELL net proceeds 64.03136454 USDT, and realized profit +0.01136454 USDT. The historical completion record retained 0.01 ZRO while 0.04 ZRO remained. The audit must now prove whether that 0.04 remainder was exchange-constrained dust under the actual ZROUSDT quantity/notional filters or a strategy sell-through defect; do not assume either outcome without filter and decision evidence. Later BUY order 727905 (4.995 net ZRO credited) filled after CLOSING and is a separate post-snapshot event.

## Required next action — DOGE/ZRO expected-versus-actual matrix

For each symbol and each decision/order, produce a compact row set containing: config snapshot; pre-decision Position.quantity and Position.spent; cumulative net SELL proceeds; strategy intent quantity/limit price/order type; exchange filters and fee reserve; broker order lifecycle; distinct actual fills and actual commissions; post-fill quantity/spent/proceeds; exact keepQuantity/dust disposition; and realized net profit. Label each comparison FOLLOWED / VIOLATED / UNVERIFIED. Every VIOLATED row requires root-cause identification, a regression test, and a code fix before acceptance. Raw trade exports remain immutable; this finding register records only derived interpretation.

 
## F-012 — actual DOGE/ZRO outcome conformance and ZRO premature completion

**Status:** DOGE submitted SELL/exchange execution FOLLOWED; exact historical filter calculation and post-shutdown accounting/dust UNVERIFIED. ZRO submitted SELL/exchange execution FOLLOWED; exact historical filter calculation UNVERIFIED; ZRO completion VIOLATED. Root cause confirmed; correction and exact-evidence regressions added on the audit branch.

The audit-baseline config confirms DOGE `keepQuantity=1`, ZRO `keepQuantity=0.01`, `minProfit=0.01`, and 0.1% maker/taker rates. Under candidate quantity steps of 1 DOGE and 0.01 ZRO, both actual ordinary LIMIT SELLs match the canonical 0.1%-reserve calculation: DOGE 1,196 @ 0.07185; ZRO 39.91 @ 1.606. The exact historical exchange filter payload was not preserved; the original logs only state that trading rules were validated. Therefore historical tick/step/minimum-filter conformance is UNVERIFIED, even though both submitted orders were accepted by the exchange.

DOGE: 1,200 gross BUY less 1.2 DOGE base fees = 1,198.8 net; spent 85.836 USDT. Order 1276698 filled in two distinct post-CLOSING trades (221990: 278; 221991: 918). Gross 85.9326, actual quote fees 0.0859326, net proceeds 85.8466674, net profit +0.0106674, remaining 2.8 DOGE. Planning/order FOLLOWED. Because the fills happened after the local process stopped, same-session Portfolio/RecoveryLedger application is not expected. The 1.8 DOGE above keepQuantity has no preserved historical filter snapshot, so final dust classification is UNVERIFIED and restart reconciliation remains deferred to #654.

ZRO: 40 gross BUY less 0.04 ZRO base fees = 39.96 net; spent 64.02 USDT. Order 727904 sold 39.91; gross 64.09546, actual quote fee 0.06409546, net proceeds 64.03136454, profit +0.01136454, remaining 0.05 ZRO. The runtime recorded free allocation 0.01 and RecoveryLedger reset while 0.04 remained active. Immediately afterward, repeated Conservative evaluations returned NO_ACTION with actions=[] while 0.04 remained active, proving residual SELL was suppressed. This violates the canonical exact-keep completion gate and preservation of basis for dust/residual.

**Root cause proven against the audit baseline:** the old completion predicate checked only `activeQuantity < keepQuantity`; any larger active balance was eligible. The old strategy also gated SELL creation on `outstandingRecovery > 0`, preventing sell-through after the profit target was secured. At that baseline, Position had no accumulated-spent field, so RecoveryLedger.buyCost was the only recorded recovery cost basis; resetting the ledger discarded the 64.02 USDT basis while 0.04 ZRO remained active. The current branch corrects both conditions: completion is deferred whenever active quantity exceeds keepQuantity, and the strategy plans residual SELLs above keepQuantity even after profit is secured, subject to exchange filters and explicit dust classification.

Regression coverage added:
- Exact historical ZRO completion inputs (spent 64.02, proceeds 64.03136454, active 0.05, keep 0.01) must defer completion.
- Actual DOGE fill identities/commissions and 2.8 remaining quantity; no residual SELL below MIN_NOTIONAL, with 1.8 excess explicitly classified as dust in the test filter fixture.
- Actual ZRO eight BUY fills and SELL fill/quote commission; 0.04 excess remains active and is classified as MIN_NOTIONAL dust in the test filter fixture.

The actual historical MIN_NOTIONAL/quantity-step snapshots were not preserved in the supplied logs, so the test fixtures prove current policy behavior under their stated filter values, not the exact historical exchange filter snapshot. No exchange writes or bot restarts were performed.


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


## 2026-11-06 audit continuation — partial BUY policy regression

Source/spec comparison found one stale regression in `src/domain/strategies/conservative/conservative-strategy.test.js`: it expected a PARTIALLY_FILLED BUY to suppress both strategy sides. The canonical contract requires active orders to suppress duplicate intents, but does not suppress a valid recovery SELL; the BUY remains active and no duplicate BUY is created. Current `evaluateConservativeStrategy` already plans the SELL while `hasActiveBuy` prevents another BUY. Updated the test to assert that behavior (commit `b1f28cb4dbe49e1d51cf110db1f1307e3d2644e1`). This is a test/spec alignment change, not a recovery, Journal, or broker implementation change. Exact-head CI/test execution is still pending; no pass is claimed.


## 2026-11-06 audit continuation — dust plus subsequent BUY regression

Added a domain regression covering the canonical dust lifecycle: a profitable SELL leaves 0.05 above `keepQuantity` that is below the quantity step; a later BUY is then applied to both Position and RecoveryLedger; the test asserts the old dust remains in active quantity, the original spent basis is preserved and increased by the new BUY cost, prior net SELL proceeds remain included, and the combined inventory produces a valid aggregate recovery SELL. Test-only change: `f8ff57f7170cb0750ee540862e393c1aadad6590`. No recovery, Journal, or broker implementation was changed. Exact-head CI/test execution remains pending.


## 2026-11-06 audit finding — dust disposition is not durably recorded

The canonical specification requires recording the exact `EXCHANGE_CONSTRAINED_DUST` quantity and limiting exchange filter. `evaluateConservativeStrategy` returns `inventoryDisposition`, but the engine's no-action path returns before publishing `STRATEGY_DECISION`; its evaluation log records `reason` and `actions` but omits `inventoryDisposition`. The lifecycle decision DTO also accepts only strategy, symbol, reference price, and actionable order facts. Therefore the dust quantity/filter classification is transient in the returned decision and is not evidenced in the lifecycle event/log path. **AUDIT GAP / NOT FIXED.** The Position quantity and spent basis remain active; the newly added later-BUY regression covers their aggregation. Per owner instruction, no Journal, event DTO, broker, or recovery implementation was changed. Track the missing durable dust disposition record separately from the completed test-only accounting regression.


## 2026-11-06 audit continuation — conflicting partial-BUY lifecycle assertion

A second stale test was found in the full-cycle `conservative-trading-engine.test.js` scenario. It asserted that a partial fill of the second BUY must leave the existing recovery SELL untouched until the BUY becomes FILLED. This directly contradicted canonical specification §5 (owner decision B: any new BUY fill while SELL is OPEN/PARTIALLY_FILLED requires cancel, full reconciliation, and replacement) and the current engine branch that performs that sequence on PARTIALLY_FILLED BUY. Updated the test to expect cancellation/reconciliation/replacement after the partial fill, preserve the BUY's PARTIALLY_FILLED state, then cancel/reconcile that replacement again when the remaining BUY fills. The expected order sequence now includes both replacement SELLs. Test-only commits: `fad7f3165b9ee3d515406693489923aeee753179`, `445c20d0441e56ea5c8126aa44d0a66b4938f9ae`, `03f27ac273b371e219bf358fd7df510d847eabfd`. No recovery, Journal, or broker implementation was changed. Exact-head tests remain unverified.


## 2026-11-06 audit continuation — lifecycle regression precision

After aligning the full-cycle partial-BUY scenario with owner decision B, its fill-count, order-count, and cancellation assertions were updated for both cancellation/reconciliation cycles (follow-up test commit `9c9b0d12fcd04d2ce08915a09e4431241bfd7f9f`). The partial-SELL/no-new-BUY regression was also strengthened to assert the same SELL remains PARTIALLY_FILLED with unchanged limit price and original quantity, with no duplicate SELL or cancellation after a market-price event (test commit `bbeb8ce4f39111bc0f076b99b9dc2001766332c6`). These are test-only changes. Exact-head CI remains unverified.


## F-011 — Terminal recovery-SELL outcome regression coverage

**Status: PARTIAL — source path present; focused regression coverage missing.**

At audited HEAD `8c1bdfda34c9f3e9fc0aaf4a5635ecf7cbb570ff`, `processUserDataEventTransition` routes terminal orders through `reconcileTerminalOrderFills` before further strategy action. For SELL orders with CANCELED, EXPIRED, or REJECTED status, it then reevaluates the strategy. The reconciliation helper checks complete distinct fill quantity against the broker-reported executed quantity and verifies terminal status/quantity consistency before applying fills.

Existing tests directly exercise unfilled CANCELED/EXPIRED and REJECTED **BUY** orders, recovery SELL fill-during-cancel, FILLED SELL completion, and terminal fill reconciliation failures. They do not directly exercise the terminal CANCELED, EXPIRED, and REJECTED **SELL** branches or assert that partial terminal SELL executions and actual commissions are reconciled before replacement.

**Impact:** this is a proof gap, not a confirmed runtime defect. The implementation appears to perform the required reconciliation, but the critical SELL-specific terminal branches are not independently regression-proven.

**Next test-only action:** add focused offline engine cases for SELL CANCELED, EXPIRED, and REJECTED; include zero-fill and partial-execution cases where valid, complete actual commission facts, and missing/conflicting fill-history failures. Assert no replacement occurs until reconciliation succeeds, then assert replacement uses the updated full Position.spent and cumulative net proceeds. Run focused tests and exact-head CI before changing this finding to PASS.

No recovery, Journal, broker, or exchange implementation changes are authorized by this finding. No test was added or executed in this pass.

## F-011 — Terminal recovery-SELL outcome regression coverage (updated 2026-11-06)

**Status: TESTS ADDED — execution pending. No source defect confirmed.**

Offline engine tests now cover partial terminal SELL fills for CANCELED, EXPIRED, and REJECTED. They verify fill quantity and actual quote commission are reconciled before subsequent strategy action; Position quantity and cumulative net SELL proceeds update, while accumulated Position.spent remains unchanged. REJECTED retains the existing fail-closed pause after reconciliation. Separate missing-history and conflicting-duplicate cases assert no accounting mutation and no replacement SELL.

Test-only commits: `d936f823e96499e6f586f98847bf5bfa536fb76a`, `bf753cb8f63bc33a868f69aeace460718ddfe7c2`, `8a0483ad8f208236afa8d86be642497aab6038b8`, `0a276483479bc9d11867018a857a3f3b2f2d33bb`. These tests have not yet been executed in a local environment or verified by exact-head CI. Do not mark F-011 PASS until focused tests and the Harvester suite pass on the exact PR head.


## Superseding lifecycle coverage status — 2026-11-06

The current branch regression inventory now includes the formerly missing focused terminal recovery-SELL cases for CANCELED, EXPIRED, and REJECTED, including partial terminal executions, actual quote commission, and fail-closed handling of missing/conflicting fill history (engine test file, around lines 2619–2745). The current branch also contains tests for unchanged partial SELL behavior without a new BUY, decision-B cancellation/reconciliation/replacement, residual sell-through, quantity-step/MIN_NOTIONAL dust, and dust combined with a later BUY while preserving Position.spent and prior net SELL proceeds.

This supersedes earlier historical statements in this file that terminal SELL cases or the dust-plus-later-BUY regression were still missing. It does **not** mean tests passed: no focused or full test suite has been executed on the current code head, and no exact-head Actions runs or commit statuses are reported.

At this historical checkpoint, exact dust quantity/filter persistence was unresolved. Superseded by the 2026-11-07 completion validation and durable lifecycle event changes recorded below.

## Owner clarification — dust is retained above keepQuantity (2026-11-06)

**Canonical rule:** exchange-constrained dust is a bonus on top of configured `keepQuantity`. If `K = 1.00` and unsellable dust is `0.04`, retain `1.04`. Do not discard it, force a SELL that violates exchange filters, or count it as sold. Dust does not itself block recovery completion after all exchange-sellable quantity has been sold and the other completion conditions pass. Preserve the retained dust quantity and its accounting provenance.

This supersedes older findings text that treated above-`keepQuantity` dust as active recovery inventory that must block completion/reset or await a later BUY. Such text is historical, not the current contract.

**Historical checkpoint (superseded 2026-11-07):** completion/accounting conformance was still under review. The audit-closure section below records the subsequent source and regression changes; exact-head CI is still pending.

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

## Current audit disposition — 2026-11-07

**In-scope Conservative implementation audit: CLOSED.** This section supersedes older historical checkpoint statements above that described residual sell-through, dust persistence, partial-BUY replacement, terminal SELL coverage, or exact-once lifecycle coverage as still missing.

Current source and regression inventory:
- Residual sell-through continues after the minimum profit target is reached, using current market price for additional residual quantity and retaining the original full cost/proceeds basis until completion.
- Residual SELL sizing respects quantity steps, MIN/MAX quantity, MIN/MAX notional, price bounds, fee reserve, and the configured order type. A blocked price is not reclassified as dust.
- Dust evidence is validated against exact active quantity above `keepQuantity` and the actual limiting filter. Quantity-step, MIN_QUANTITY, and MIN_NOTIONAL cases have focused domain coverage. The completion lifecycle DTO records dust quantity, reason, and relevant evaluated/threshold values; completion allocates `keepQuantity + dust`.
- A later BUY can make previously unsellable dust sellable without losing prior spent cost or net SELL proceeds.
- Partial SELL with no new BUY preserves the same order and price. Any BUY fill during an active recovery SELL triggers cancellation, terminal-state/fill/commission reconciliation, and replacement planning.
- CANCELED, EXPIRED, and REJECTED recovery SELL outcomes have focused partial-terminal-fill, actual-commission, missing-history, and conflicting-fill regressions.
- Full-cycle engine coverage asserts partial BUY/SELL fills, both SELL replacement sequences, acknowledgement ordering, exact-once fill application, and exact-once completion/reset. A second full-cycle variant now covers `keepQuantity = 0`; the positive-reserve variant remains covered.
- Actual DOGE/ZRO fill fixtures cover the observed trade quantities and commissions and verify residual handling under explicit test filter fixtures.

**Historical evidence limitations (non-blocking):**
- Actual decision-time exchange filter payloads were not preserved in the original runtime logs. Historical DOGE 1.8 excess and ZRO 0.04 excess cannot be retrospectively proven to have been MIN_NOTIONAL dust. The trade arithmetic and exchange executions are confirmed; exact historical filter-based disposition remains UNVERIFIED.
- The complete historical CLOSING open-order payload and a post-fill account snapshot were not preserved. Do not infer the missing second order identity or later balances. The CLOSING audit remains INCOMPLETE at its original timestamp.
- DOGE SELL 1276698 and ZRO BUY 727905 filled after the workstation process stopped. This is expected; later process reconciliation is a separate deferred workstream in #654.

**Verification boundary:** source and regression coverage are now present and mapped in `docs/domain/ACCOUNTING_INVARIANTS.md`. The newly added zero-`keepQuantity` full-cycle test and the rest of the Harvester suite have not yet been executed on the current PR head. Exact-head CI is intentionally the next phase; no passing test/CI claim is made here. TESTNET acceptance remains NOT CLAIMED.



## F-013 — User-data events during reconnect recovery trigger normal cancel/replace effects

- **Severity:** High — trading availability and order-lifecycle safety.
- **Verdict:** RESOLVED by [PR #673](https://github.com/45s/coinzilla/pull/673), merged 2026-11-08; final PR head `24c2b9fdc67cf7ce64fc586141ea0dd60fe9c83d` passed all six required offline CI workflows. TESTNET acceptance remains separately PAUSED / UNVERIFIED.
- **Evidence:** 2026-11-08 Journal events #266, #269–270, #285, #288–289, and #397–399; DEBUG lines 9307, 9351, 9362, 9398–9400, 9470, 9699–9703; TRACE lines 10942–10943, 11005–11006, 11024–11026, 11080–11084, 11186–11187, 11489–11498. Original artifact hashes and full parsed evidence are in [AUDIT_SESSION_2026-11-08.md](../sessions/AUDIT_SESSION_2026-11-08.md).
- **Expected contract:** no order submission, cancellation, replacement, or retry while authoritative user-data recovery is unresolved; queued execution facts may be reconciled, and any required strategy evaluation must be retained until the broker recovery acknowledgement reopens readiness.
- **Observed:** after transport reported `recovered`, DOGE BUY trade 231208 and ZRO BUY trade 12374 were applied exactly once. Their subsequent duplicate/replayed execution events were processed through the normal engine path. That path requested cancellation of owned recovery SELLs 1323350 (797 DOGE) and 749343 (24.94 ZRO) while the broker still rejected order changes because the user-data stream was unavailable. Both cancellations became UNKNOWN/UNCONFIRMED, both markets paused, and application recovery failed at 03:23:00.631Z.
- **Root cause 1:** bootstrap did not pass the engine's existing `recoveryMode` option to queued user-data order-event processing.
- **Root cause 2:** recovery-mode terminal order events could return `reevaluate: true` without adding the affected symbol to `state.deferredEvaluations`; bootstrap correctly suppressed normal evaluation while reconciliation was pending, but the required evaluation could then be lost.
- **Impact:** trading remained blocked for the rest of the session. CLOSING audit reported `UNRESOLVED_OWNED_ORDERS:2` and `USER_DATA_OR_ACCOUNTING_RECONCILIATION_INCOMPLETE`; shutdown failed closed and retained the process lock.
- **Fix:** PR #673 passes recovery mode based on the reconciliation gate/active recovery task and exposes that context to the observer callback; recovery-mode terminal events retain a deferred strategy evaluation for the existing post-acknowledgement resume path. Durable reconciliation, exact-once accounting, stale-generation protection, and fail-closed readiness remain unchanged.
- **Regression tests:** bootstrap recovery-mode classification and engine deferred-evaluation retention. Both were observed RED on test-only PR head `4368c5d65651b55dd5c34bea619ca6b99160264d`: actual `undefined` vs expected `true`, and actual `[]` vs expected `["DOGEUSDT"]`. Exact final PR head `24c2b9fdc67cf7ce64fc586141ea0dd60fe9c83d` passed all six required offline CI workflows.
- **Related issue:** #626. No new duplicate issue created.
- **Safety boundary:** no TESTNET/production order actions, process restart, account change, or lock cleanup was performed. Original empty-message TypeError cause remains UNKNOWN; close code 1006 is not treated as proof of the lower-level cause.


## F-014 — Repeated recovered acknowledgement reminders duplicate application diagnostics

- **Severity:** Low — operational observability noise; repeated status publication obscures meaningful lifecycle transitions and grows Journal/log volume during a prolonged acknowledgement wait.
- **Verdict:** CONFIRMED; regression reproduced on PR #674 test-only head and implementation added in the follow-up commit.
- **Evidence:** `UserDataSession.#notifyRecoveryReady()` sends the same `recovered` status to subscribers while `#scheduleAcknowledgementReminder()` continues its bounded exponential reminder schedule (capped at 30 seconds). The Harvester status handler previously published `broker.status_changed` and an INFO record for every callback. The November 8 incident recorded 47 `recovered` notifications in one process session.
- **Required behavior:** report an unchanged `recovered` state once per application recovery generation, while continuing to process reminders as retry triggers. A new generation must produce a new lifecycle event and diagnostic. Acknowledged generations must remain ignored.
- **Fix:** the status handler tracks the last reported recovered generation and suppresses only duplicate lifecycle publication and INFO logging. It still invokes `startUserDataRecovery()` for every reminder, preserves the status observer callback, and leaves all readiness/reconciliation gates unchanged.
- **Regression coverage:** repeated reminders publish/log once but invoke recovery twice; a new generation publishes a fresh status; an acknowledged generation ignores later reminders.
- **Related issue:** #626. This closes the repeated-status diagnostic portion of its acceptance criteria, not the complete issue.
- **Documentation impact:** architecture and recovery roadmap now describe generation-scoped diagnostics and reminder-driven retry semantics.


## F-015 — Node/Undici WebSocket failures emit an empty TypeError and discard handshake cause

- **Severity:** Medium — diagnostic/incident-response impact across market-data and user-data WebSockets. The broker's fail-closed behavior preserves trading safety; missing transport context delays diagnosis.
- **Verdict:** CONFIRMED source-level runtime behavior. The opening-handshake diagnostic gap is fixed by PR #721. The established-socket 1006 path is now deterministically characterized as a runtime observability limitation by PR #725; no underlying cause is exposed for the reproduced peer reset, and the diagnostics channel does not provide a reliable correlation mechanism.
- **Original evidence:** November 8 `harvester-trace(1).log` lines 10944–11003. The 03:20:30.119Z stack follows the established-socket close path and reports code 1006. Stacks at 03:20:35.148Z, 03:20:40.162Z, 03:20:50.177Z, and 03:21:10.199Z include `failWebsocketConnection → failHandshake → processResponse`. The surrounding Node frames match v24.22.2 source line locations: `events.js:526`, `net.js:362`, and `internal/tls/wrap.js:779`.
- **Original source cause:** Node v24.22.2 bundled Undici's [`connection.js:316-329`](https://github.com/nodejs/node/blob/v24.22.2/deps/undici/src/lib/web/websocket/connection.js#L316-L329) calls `handler.onSocketClose()` without forwarding the handshake reason/cause. Its [`websocket.js:575-609`](https://github.com/nodejs/node/blob/v24.22.2/deps/undici/src/lib/web/websocket/websocket.js#L575-L609) leaves `reason` empty when no close-frame parser information exists and emits `new TypeError("")`.
- **Handshake fix:** [Brokers PR #721](https://github.com/45s/coinzilla/pull/721) merged into `develop` as `07cb9d3caef5232cfaa9c51954de91b3bc1ccd59`; exact tested head `ad48ae4bb71d81d0318a031f101f582a67cca083`. The native transport now retains a sanitized underlying Error as `cause`, preserves safe HTTP upgrade status when exposed, and attaches close code/reason/clean-close state before rejecting a failed handshake. Structured diagnostics keep phase and underlying error fields separate; credential-like text and URLs are redacted.
- **Handshake coverage and runner evidence:** PR #721 tests the blank-message Undici-style `TypeError`, optional HTTP status, abnormal close metadata, underlying cause, and redaction. Exact-head Brokers tests passed 414/414; coverage was 98.72% statements, 93.39% branches, and 94.98% functions. All six required offline CI workflows passed. The credential-free probe used Node.js v24.22.2 with bundled Undici 7.30.1: Spot TESTNET API upgrade returned HTTP 451 with Binance's restricted-location eligibility response; Streams returned HTTP 101 with a valid accept hash. No credentials, signatures, RPC requests, or order operations were sent. Manual read-only account/recovery integration was skipped; no TESTNET acceptance is claimed.
- **Established-socket characterization:** [Brokers PR #725](https://github.com/45s/coinzilla/pull/725) merged into `develop` as `bf9e51e298535cf14f113343a5216f4b8a1ec80f`; exact tested head `b50d453d8846e82a2918b5d4752dfc8d81412ceb`. Its loopback-only Node 24.x test opens a native WebSocket and then resets the peer without sending a close frame. The client receives close code 1006; Undici emits `websocket:open` and `websocket:close` diagnostics carrying the WebSocket instance, but emits no `websocket:socket_error` event for this reset. The first test attempt expected a socket-error event and failed with 414/415 tests passing; the corrected test asserts the observed silent-channel behavior and passed 415/415.
- **Runtime limitation and correlation:** Undici documents `undici:websocket:socket_error` as publishing an Error object only, without a WebSocket identity. The reproduced 1006 peer reset does not publish that event at all. With the API and Streams sockets active concurrently, no safe per-client attribution is available through these channels. Do not infer a network/TLS cause from code 1006, use timing/last-socket heuristics, or introduce a global monkey-patch. No production subscriber, transport change, dependency, or public broker contract change was justified.
- **Verification:** PR #725 exact head `b50d453d8846e82a2918b5d4752dfc8d81412ceb` passed Brokers tests 415/415, Brokers coverage, and all six required offline CI workflows. No authenticated account request, order operation, or TESTNET acceptance is claimed.
- **Ownership:** `packages/brokers`; no Harvester workaround or broker public contract change was made.
- **Related issue:** #626. Opening-handshake cause preservation and deterministic established-socket/runtime-limitation characterization are complete. TESTNET account/recovery acceptance remains a separate, unclaimed requirement.

## F-016 — Harvester recovery REST wrappers discarded original broker error context — resolved

- **Severity:** Medium — historical production diagnostic and incident-triage impact; recovery behavior remained fail-closed.
- **Verdict:** HISTORICAL DEFECT; RESOLVED by PR #711.
- **Reproduction:** a broker REST method returns `{ ok: false, errors: [typedBrokerError] }` during account snapshot or owned-order reconciliation.
- **Pre-PR #711 behavior:** `createAccountSnapshotManager.refreshAccountSnapshot()` created a new generic `Error` from the broker error message without a `cause`. `collectOwnedOrderSnapshots()` similarly creates generic errors for failed open-order, canonical-order-history, and fill-history results; the fill-history path can discard the original broker error message entirely. The application recovery handler logs only the wrapper's `errorName`, `errorMessage`, and `errorStack`, so the original typed error class, stack, and cause are not available in the structured recovery diagnostic.
- **Expected behavior:** preserve the original broker Error as the wrapper's native `cause`, retain existing outer contextual messages, and pass the Error object as structured log data. The shared logger already serializes native Error cause/stack recursively; no new logger or logging file is needed.
- **Impact:** a transient RPC timeout can become indistinguishable from malformed/missing REST data, reducing diagnostic quality and making failure classification harder. This does not currently authorize trading or acknowledge recovery prematurely.
- **Relevant locations:** `src/bootstrap/account/create-account-snapshot-manager.js`; `src/use-cases/conservative-trading-engine.js`; `src/bootstrap/user-data/create-user-data-recovery-handler.js`.
- **Test-first regressions:** account snapshot and account-wide open-orders wrappers retain the exact broker Error as native `cause`; owned-order open-orders, canonical-history, and fill-history wrappers do the same; the recovery failure log includes the Error object so the shared logger can serialize its recursive cause. These regressions were merged and verified by PR #711; there is no outstanding implementation branch.
- **TDD RED evidence:** exact test-only head `918a3a6644c92cbe089919874177cba7b8193249` ran 758 Harvester tests: 752 passed and 6 failed. All six failures were the expected missing native `cause` or missing structured `error` field; no syntax/fixture failures occurred.
- **Implementation added and verified:** native `Error.cause` now carries the first broker Error through account snapshot, account-wide open-orders, owned-order open-orders, canonical order-history, and fill-history wrappers. The application recovery log now includes the original contextual Error object while retaining existing flattened fields for compatibility. Existing messages and recovery/trading behavior are unchanged. PR #711 exact head `e68da711eb44bc64bfeb5b1e8027f1f0a19f58dc` passed Harvester unit tests 758/758, configured targeted tests 3/3, and all six required offline CI contexts. Workspace coverage passed; Harvester threshold enforcement is not configured. TESTNET integration was skipped.
- **Disposition:** COMPLETE — PR #711 merged into `develop` as `2a57a8e291bb54a2474df525a4cd20e8d51747e8`. Native broker Error causes and structured recovery Error objects are covered by exact-head passing tests. Existing retry/readiness/trading behavior is unchanged.

- **Related retry regression:** PR #688 adds an application-level account-wide open-orders timeout/retry case, passing on exact head `d52dad2347e8f9a76aa17b1f3def309e4d45f230` (Harvester unit tests 754/754; all six required offline CI contexts passed) and merged into `develop` as `a66e5f9114395fbc1ab776ccdffc55bdcb2a8f5a`. It proves the market remains blocked, no recovery audits or acknowledgement occur after the failed read, the task slot is released, the timeout message remains in the contextual wrapper, and a later reminder succeeds. It did not itself preserve the original typed broker Error as native `cause`; that separate diagnostic fix was subsequently completed by PR #711. The earlier conclusion that F-016 remained open is obsolete.

## F-017 — Malformed REST response-envelope regression coverage — complete

- **Severity:** Low/Medium — regression-proof gap.
- **Verdict:** CONFIRMED test-coverage gap; closed by regression coverage. No accepted-invalid-data defect was confirmed.
- **Existing source guards:** account snapshots validate canonical Balance records, safe source time, unique assets, non-negative quantities, and required configured market assets. Owned-order reconciliation validates open-order arrays/records, exactly one canonical order-history record per owned order, fill arrays/records, pagination bounds, duplicate fill facts, and cumulative fill/history/stream consistency.
- **Existing regressions:** missing configured account asset, duplicate/negative/invalid account snapshot values, stale account snapshots, incomplete cumulative fill history, conflicting fill IDs, stale REST history, missing Journal fills, and overlapping stream/REST delivery.
- **Direct envelope injections added:** eight focused regressions in `src/use-cases/conservative-trading-engine.test.js` cover non-array and malformed `getOpenOrders()`; zero, multiple, and non-`CanonicalOrder` `getCanonicalOrderHistory()`; and non-array, non-`Fill`, and oversized `getFills()` pages.
- **Expected failure behavior asserted:** each malformed envelope fails owned-order reconciliation, leaves the market paused and order UNKNOWN, applies no fills, and issues no cancel/replace or new order.
- **Disposition:** COMPLETE — eight regression tests passed on PR #708 exact head `b3f5ed25d11ab093836dc50d563b8c590b09439f`; PR #708 merged into `develop` as `982ddc8c4366658ce75a9cfac9432b4f3e81381e`. Harvester package tests passed 753/753, configured targeted tests 3/3, and all six required offline CI contexts passed. The Harvester coverage job passed; its package threshold-enforcement step is not configured. TESTNET integration was skipped. No production change was justified or made.

## F-018 — Journal sync failure can produce at-least-once recovery audit records

- **Severity:** Medium — audit duplication/operational diagnosis; no premature broker acknowledgement found.
- **Verdict:** CONFIRMED behavior from the current Journal and recovery publication sequence.
- **Reproduction:** lifecycle event publication and Journal write succeed, but the subsequent file sync in `Journal.flush()` fails; a later recovery reminder retries the audit and its flush succeeds.
- **Actual behavior:** the first record may already be present in the process file cache even though durability was not confirmed. The retry publishes a new event with a new ID. If the later sync succeeds, both records can become durable. This is at-least-once audit publication; the current recovery audit has no generation idempotency key.
- **Separate permanent failure mode:** a Journal `writeFile()` failure sets `writeFailed=true`; future writes/flushes for that Journal instance continue failing. Recovery remains safely blocked and unacknowledged, but reminders can cause repeated futile REST/audit attempts until an operator-level recovery/restart path exists.
- **Expected safety behavior:** never acknowledge until `flush()` confirms `durable: true`; never delete, overwrite, rotate, or deduplicate the uncertain first record. Duplicate audit evidence is preferable to silently assuming an unconfirmed write was durable.
- **Journal-side characterization merged:** [PR #714](https://github.com/45s/coinzilla/pull/714) verifies a transient file-sync failure returns non-durable, a later flush on the same instance succeeds, and both the original and retry event IDs remain in append order (43/43 Journal tests passed).
- **Harvester-side regressions added:** the account snapshot manager test verifies a failed flush leaves the first published event intact and a retry publishes a distinct second event; the recovery-handler test verifies the gate stays closed, no open-orders audit or broker acknowledgement occurs, the task slot is released, and a later reminder completes the same generation with at-least-once audit publication. PR #716 exact head `ae021f8f9fac071ebf3844069d5321ed11f8d0a3` passed all six required offline CI workflows.
- **Disposition:** COMPLETE — Journal PR #714 and Harvester PR #716 are merged. The Journal package test proves transient sync retry preserves both event IDs; Harvester manager/recovery tests prove the first uncertain audit remains published, the gate stays closed with no acknowledgement, and a later reminder retries the same generation and completes the remaining durable audit. No Journal or Harvester production source changed. Do not deduplicate uncertain records or introduce another log file.

## F-019 — Multi-subscriber broker acknowledgement result can strand Harvester recovery — resolved

- **Severity:** Medium — conditional recovery liveness risk; fail-closed safety is preserved.
- **Historical verdict (before PRs #732/#735):** CONFIRMED contract interaction; it required multiple active local subscribers sharing one broker user-data session. The implementation and consumer behavior described below are the pre-fix state.
- **Actual behavior:** `UserDataSession.#acknowledgeRecovery(id)` marks the caller's subscriber acknowledged, then returns the global `completeRecoveryIfAcknowledged()` result. The first subscriber therefore receives `false` while other subscribers remain pending, despite its own acknowledgement having been recorded. Before PR #735, Harvester interpreted `false` as rejection, restored `requiresReconciliation=true`, and did not record its generation. When the final subscriber acknowledged, the broker emitted `reconciled` and stopped reminders, but the old consumer did not clear its application gate from that status.
- **Historical impact:** Harvester could remain blocked indefinitely in a supported multi-subscriber session. This was a liveness failure, not an unsafe trading window. The original subscriber-count uncertainty was not used as a reason to weaken the fail-closed gate.
- **Consumer-side second-disconnect proof:** complete in [PR #718](https://github.com/45s/coinzilla/pull/718), exact head `a28bd72585a8b9d7c50b883b980a185b99711f49`, merge `6236f49dca53a2938b016b52802f907c90611b44`. The end-to-end Harvester status/recovery composition test proves a second `connectionClosed` supersedes generation one, stale work publishes no audits or acknowledgement, and a later reminder reconciles/acknowledges only generation two. Harvester tests 761/761 and all six required offline contexts passed.
- **Broker-owned terminal notification proof:** complete in [PR #729](https://github.com/45s/coinzilla/pull/729), exact tested head `fc7467a260f7813e27fe1a7506317e18fe044e53`, merge `ba0992116a34b91ac907218203562880475c9dfd`. The two-subscriber recovery regression proves exactly one terminal `reconciled` notification per still-active subscriber, no terminal notification to a removed subscriber, acknowledgement-reminder cancellation, and no duplicate after a repeated acknowledgement. Brokers tests passed 416/416 and all six required offline CI contexts passed. No production source or public contract changed.
- **Disposition: RESOLVED.** [Brokers issue #702](https://github.com/45s/coinzilla/issues/702) was closed after the broker API and Harvester consumer changes merged.
  - [PR #729](https://github.com/45s/coinzilla/pull/729) proves one terminal `reconciled` notification per active subscriber, none for removed subscribers, reminder cancellation, and repeated-acknowledgement idempotence. Exact tested head `fc7467a260f7813e27fe1a7506317e18fe044e53`, merge `ba0992116a34b91ac907218203562880475c9dfd`; Brokers tests 416/416 and all six required offline CI contexts passed.
  - [PR #732](https://github.com/45s/coinzilla/pull/732) added `acknowledgeRecoveryResult()` while preserving the legacy boolean API. It distinguishes accepted/pending, accepted/completed, and rejected stale/inactive or no-recovery-pending calls. Exact tested head `1eb0c1a0d3cb6f7e0f957f2c10308f4510995abf`, merge `adb3639e6c1a1b03e885d394a07f8ce4c05356dd`; all six workflow runs succeeded.
  - [PR #735](https://github.com/45s/coinzilla/pull/735) consumes the additive result without treating accepted/pending as rejection. Harvester records local acceptance but keeps readiness closed until a global `reconciled` status matches the active recovery generation and subscription ID. Exact tested head `541bf9d65e5fd4f073e3619fdba5c6d36734deaa`, merge `899b939e471a4d11b2fdfff0aaedb145da61c420`; all six workflow runs succeeded.
  - No `start-harvester.js` change was required for this contract integration. TESTNET integration was skipped on both PRs; no TESTNET recovery acceptance is claimed. The application readiness gate remains fail-closed until global completion.


---

## F-020 — Per-symbol market-data liveness is not independently observable

**Classification:** PARTIAL / UNVERIFIED  
**Severity:** High investigation priority; no confirmed market-data outage  
**Tracking:** [#760](https://github.com/45s/coinzilla/issues/760)

**Evidence:** In the 2026-11-08 16:33:33–22:42:05 UTC session, DOGEUSDT produced 1,494 `Harvester market price event received` records (median interval 8.819 seconds; maximum 111.729 seconds). ZROUSDT produced 61 (median interval 88.908 seconds; maximum 3,242.118 seconds). The longest ZRO interval ran from 20:31:06.687 to 21:25:08.805 UTC. DOGE events continued during the gap; no error-level or market-stream error was logged in the afternoon session.

**Expected:** Operators and the application should be able to distinguish an active transport, a confirmed subscription, a recently delivering per-symbol stream, and a stale/silent stream. A connected socket alone is not proof that every desired stream is fresh.

**Actual:** The inspected Streams client retains desired subscriptions, confirms initial subscription state, and reconnects after observed transport closure. The supplied runtime logs do not expose per-symbol last-event age or a silent-stream watchdog. The 54-minute ZRO gap could be low `aggTrade` activity or a delivery/subscription problem; there is no independent exchange feed in the supplied evidence to decide.

**Impact:** A symbol-specific feed stall could be hidden while another symbol continues to trade, and current logs cannot distinguish that from a genuinely quiet market. Do not assert that stale-price decisions occurred; that is not demonstrated.

**Required follow-up:** trace the adapter-to-Harvester path, identify an independent freshness signal (for example bookTicker freshness or a documented exchange heartbeat), add bounded per-symbol/per-stream last-event-age and stale/recovered diagnostics, and define any trading gate only through an explicit domain policy. Instrument successful bookTicker receipt/freshness in a bounded way; do not infer delivery health from the current absence of receipt logs. Add fake-clock tests for one symbol stalling while another remains active, recovery, repeated notifications, and legitimate quiet periods. No TESTNET writes are required.

## F-021 — Shutdown repeats complete fill-history reconciliation

**Classification:** SOURCE-EXPLAINED / LATENCY STRONGLY CORRELATED  
**Severity:** Medium operational concern  
**Tracking:** [#766](https://github.com/45s/coinzilla/issues/766)

**Evidence:** Shutdown began at 22:38:29.849 UTC. At approximately 22:40:15 and 22:41:59 UTC, the runtime emitted two batches of 48 duplicate-fill observations. Both batches contained the same 48 fill identities already applied during the process. The accounting path reported `applied: false`, `duplicate: true`, and zero delta. Shutdown captured a complete CLOSING balance snapshot and completed successfully at 22:42:05.491 UTC.

**Owned-order reconstruction:** The Journal records 90 unique submitted orders, 40 unique cancellations without fills, 48 distinct fill-bearing orders (all latest statuses `FILLED`), and two remaining OPEN SELL orders: DOGEUSDT 1333893 and ZROUSDT 756212. Thus 50 owned orders remained in the registry for shutdown reconciliation.

**Source correlation (corrected RPC count):** `create-shutdown-handler.js` invokes `reconcileOwnedOrders()` before BUY cancellation and again after cancellation/user-data queue drain. Each pass calls `collectOwnedOrderSnapshots()`. It fetches open orders once per symbol (2 RPCs), then canonical order history sequentially for each of 50 owned orders. Each `getCanonicalOrderHistory()` call performs both an `allOrders` RPC and an `exchangeInfo` RPC (100 RPCs total). It then fetches fill history sequentially for each order; each `getFills()` page performs both an `exchangeInfo` RPC and a `myTrades` RPC (100 RPCs in this session; one page per order). This is **202 sequential broker REST RPCs per pass, or 404 across both passes**, not the earlier undercount of 102/204. The two 48-record batches align with the two passes and represent idempotent re-observation, not duplicate accounting.

**Latency assessment:** The first batch appears about 105 seconds after shutdown start; the second appears about 104 seconds later. The corrected 202 sequential RPCs per pass strongly correlate with these waits (about 0.52 seconds per RPC if evenly distributed), but the logs do not contain per-request timings. Exact latency attribution is not measured.

**Required follow-up:** [#766](https://github.com/45s/coinzilla) tracks bounded stage/RPC timing and evaluation of safe bounded concurrency/batching. Preserve both reconciliation passes, full order/fill validation, pagination, idempotent accounting, and fail-closed behavior. Do not cancel open SELLs or skip historical fills.

## F-022 — CLOSING balance audit omits the final open-order set

**Classification:** SOURCE-CONFIRMED EVIDENCE GAP / HISTORICAL ORDER SET UNVERIFIED  
**Severity:** Medium evidence gap  
**Tracking:** [#764](https://github.com/45s/coinzilla/issues/764). Process-restart reconciliation #654 remains separately deferred.

**Evidence:** The supplied Journal contains one PREFLIGHT `account.open_orders_captured` event and no CLOSING open-orders payload. The CLOSING account snapshot is marked COMPLETE and includes five asset balances, but this is a balance audit, not an independently recorded final order list. CLOSING locked balances were 3,189 DOGE and 59.87 ZRO.

**Source confirmation:** The current shutdown handler invokes `publishAccountSnapshot()` with `phase: "CLOSING"`, but its injected dependencies and shutdown sequence do not include `publishOpenOrdersSnapshot()`. The missing CLOSING order payload is therefore an implementation-level evidence gap, not merely a suspected missing log line.

**Impact:** Exact final exchange order IDs, client IDs, prices, quantities, and statuses cannot be reconstructed from the supplied three artifacts. Locked balances are clues, not a substitute for an open-orders response. A COMPLETE CLOSING balance audit must not be interpreted as a COMPLETE final-order audit.

**Required follow-up:** decide and implement, with DDD/TDD, whether CLOSING should durably capture the complete account-wide open-order set while broker REST remains connected. Specify completeness/failure semantics and preserve open SELL orders; this is read-only evidence capture, not permission to mutate orders. Keep the decision separate from deferred process-restart reconciliation #654.


## F-023 — Recovery event-processing failures are mislabeled and overclassified as accounting failures

**TDD RED (2026-11-09):** regressions now cover retryable matched order-transition failure, terminal ownership/accounting-integrity failure, terminal fill-history REST timeout, queued-event failure preventing acknowledgement until a later authoritative retry, permanent integrity failure remaining terminal, and the exact `recovered → executionPending` interleaving. Production behavior is unchanged in this commit.

**Classification:** CONFIRMED DIAGNOSTIC MISCLASSIFICATION; historical recovery-side-effect failure also observed  
**Severity:** Medium — incident triage can point operators at the wrong failure class  
**Tracking:** [#769](https://github.com/45s/coinzilla/issues/769), under recovery umbrella [#626](https://github.com/45s/coinzilla/issues/626)

**Runtime evidence (2026-11-08 03:21–03:23 UTC):** During application recovery, a DOGE BUY TRADE event for broker order `1323351` / client order `h-932a1bcc2b7646df8f4166-29` failed while the engine attempted to cancel the existing DOGE recovery SELL (`1323350`). The broker rejected the cancellation because the user-data stream was unavailable. The subsequent log at 03:21:48.944 UTC was nevertheless labeled `rejected an unowned or invalid order event`, while both `registryMatchedByClientOrderId` and `registryMatchedByBrokerOrderId` were `true`, and both matched registry records identified the same FILLED order. At 03:22:24 UTC, ZRO recovery reconciliation encountered the same blocked-cancellation failure for recovery SELL `749343`; the pair was paused and the recovery attempt ultimately failed at 03:23:00.631 UTC with `User-data accounting failed during recovery`.

**Source confirmation (pre-PR #794 baseline):** `apps/harvester/src/bootstrap/user-data/create-user-data-event-handler.js` still uses the message `rejected an unowned or invalid order event` and sets `state.accountingFailed = true` for every failed `processUserDataEvent()` result, including downstream transition/cancellation/reconciliation failures after the incoming order has matched the registry. Its diagnostic fields can therefore contradict its message, and a non-accounting transition failure can set the sticky flag that prevents `createUserDataRecoveryHandler()` from starting or retrying recovery. The current handler test covers a generic engine rejection described as `unowned order`; it does not distinguish a matched-order transition failure after successful fill application. The recovery-handler tests explicitly refuse to start while `accountingFailed` is true, so the broad latch is a retry barrier by design. The missing proof is whether each engine failure category should set that barrier, not whether the guard exists. **Latch-reset audit:** in the inspected current bootstrap, `accountingFailed` is initialized to `false` in `start-harvester.js` and is only assigned `true` by the event/status handlers; no reset-to-false path exists. `createUserDataStatusHandler()` also requires `!state.accountingFailed` before clearing `requiresReconciliation` on a matching `reconciled` acknowledgement. Therefore, once set, this flag is process-lifetime terminal: later successful transport reconnects or owned-order reconciliation cannot clear it, and the recovery coordinator refuses to retry. That may be intentional for genuine accounting-integrity corruption, but it is too broad for known downstream transition failures unless a deliberate operator/process restart is required. Future design must define explicit, evidence-based reset criteria without weakening fail-closed accounting safety.

**Important historical/current-source distinction:** the direct DOGE user-data-event cancellation path is already explained by earlier finding F-013 and fixed by [PR #673](https://github.com/45s/coinzilla/pull/673): bootstrap previously failed to pass the existing `recoveryMode` option to queued user-data order-event processing. Current `start-harvester.test.js` includes an integration regression that reproduces 254 recovery reminders and asserts the queued BUY fill is processed once with `recoveryMode:true`. Do not reopen that already-fixed direct-event defect as an unfixed current-source bug. Current `develop` also derives `recoveryMode` from `requiresReconciliation || recoveryTask !== null`, and the status handler clears the application gate only for the matching acknowledged `reconciled` generation. The narrower remaining test gap is the exact status interleaving (`recovered` → `executionPending` with both broker flags false → owned BUY fill); `create-user-data-status-handler.test.js` has no explicit `executionPending` case. F-024/#773's separate safety-halt path has since been fixed in current `develop` and its regression coverage; see the disposition below.

**Failure-category map from current engine source:**

| Failure path | What it means | Why a single `accountingFailed` flag is too coarse |
|---|---|---|
| `OrderRegistry.applyUpdate()` reports an unknown order | Ownership/identity failure; event is not a Harvester-owned order | This is a genuine ownership-integrity failure and should remain fail-closed. |
| Missing/non-canonical fill or fill/order identity mismatch | Invalid execution facts | Accounting cannot safely trust the event; fail-closed is appropriate. |
| `updateTradingAccounting()` fails | Canonical fill could not be committed to accounting projections | This is a direct accounting-integrity failure; fail-closed is appropriate. |
| Terminal fill history unavailable, conflicting, or quantity-incomplete | The final order state cannot be reconciled to complete distinct executions | Accounting completeness is uncertain; fail-closed is appropriate, but the diagnostic should say fill-history reconciliation. |
| Recovery SELL cancellation rejected after the BUY fill is applied/deduplicated | Accounting may be correct while an exchange order transition is unresolved/UNKNOWN | Trading must remain blocked, but the failure is not itself proof that fill accounting failed; retry policy must preserve authoritative order reconciliation. |
| Durable cancellation intent cannot be flushed or recovery-cycle completion fails | Workflow/state transition failed at a different stage | Preserve fail-closed safety, but report the exact stage and do not call it unowned-order or accounting failure without evidence. |

This map is derived from `processExecutionFillTransition()`, `reconcileTerminalOrderFills()`, `processUserDataEventTransition()`, and `cancelAndReconcileRecoverySells()` in `conservative-trading-engine.js`. The exact failure category must be propagated from the engine rather than guessed by the outer event handler.

**Recovery safety context:** Current `develop` passes `recoveryMode` through `reconcileOwnedOrders()` and user-data event processing. The engine regression around lines 4318–4399 verifies that canonical recovery reconciliation does not cancel or replace an existing SELL; the event-handler regression around lines 5040–5110 verifies that recovery mode is passed through to the engine. The status handler also preserves the application reconciliation gate until the matching broker-wide `reconciled` acknowledgement. These are useful protections, but the tests are split across units and do not reproduce the exact historical status/event interleaving. Keep these contracts and add an integration regression before treating the historical cancellation path as fully closed.

**Required follow-up:** distinguish identity/ownership rejection, accounting-integrity failure, and downstream order-transition/reconciliation failure; include the actual processing stage/reason and preserve matched identity evidence. Define retryability explicitly: a reclassified failure must never reopen trading by itself, but transient downstream failures should not be mislabeled as irrecoverable accounting corruption or silently make all future recovery reminders no-ops. Add deterministic handler/recovery tests for (1) unknown/mismatched order identity, (2) matched owned order with downstream cancellation failure after an already-applied fill, (3) terminal fill-history timeout, (4) retry after transient failure, and (5) permanent accounting mismatch. Keep recovery-mode fill processing read-only with respect to exchange order mutations until application/broker recovery is fully acknowledged. No runtime changes are part of this audit.


**Implementation checkpoint (PR #794, merged 2026-11-09):** the pre-PR #794 source confirmation above is historical. The test-first implementation now propagates explicit engine failure categories, stages, and retryability; distinguishes matched order-transition failures from ownership/accounting-integrity failures; and covers the `recovered → executionPending` interleaving. Bootstrap retries only recognized retryable categories with valid stages and policy. Unknown or malformed metadata is terminal. Owned-order REST transport failures are explicitly retryable, while malformed successful payloads, ownership conflicts, Journal/fill parity conflicts, and unclassified snapshot failures fail closed. Account/open-order reads, both durable audit flushes, and broker acknowledgement carry explicit stages. PR #794 merged as `ff061dd6b73b4d1ba9a314c1e75ddf447814f4bc`; all six required offline CI workflows passed on exact synchronized head `fcfa8c4c282b414ccd616b69a54b6e3a8ada5681`. TESTNET acceptance remains PAUSED / UNVERIFIED.

## F-024 — Account-integrity safety-halt reconciliation used normal trading mode — fixed

**Classification:** HISTORICAL DEFECT; CURRENT SOURCE AND REGRESSION TEST PASS  
**Severity:** High at time of discovery; remediation is present in current `develop`  
**Tracking:** [#773](https://github.com/45s/coinzilla/issues/773) — closed as completed; recovery umbrella [#626](https://github.com/45s/coinzilla/issues/626)

**Historical behavior and November 8 evidence:** The original source path called `reconcileOwnedOrders()` with its default `recoveryMode:false`. Applying a recovered FILLED BUY could therefore enter normal strategy transitions and attempt recovery-SELL cancellation before the safety halt's explicit BUY-only cancellation stage. The November 8 ZRO stack through `applyOwnedOrderSnapshotsTransition()`, followed by the safety-halt reconciliation-failed log, strongly correlates with that path, but the logs do not identify the caller or runtime source revision. The broker's `userDataUnavailable` guard rejected the observed cancellation before the state-changing `order.cancel` RPC; the evidence establishes an unnecessary attempt and local UNKNOWN transition, not a confirmed exchange-side SELL cancellation.

**Current source path (fixed):**
1. `createUserDataEventHandler()` triggers the account-integrity safety-halt workflow after a failed engine order event.
2. `createAccountIntegritySafetyHalt()` now calls `tradingEngine.reconcileOwnedOrders({ recoveryMode: true })`.
3. Recovery-mode reconciliation applies canonical broker order/fill facts while deferring strategy-driven recovery-SELL cancellation/replacement.
4. Only after reconciliation does the workflow call `cancelOwnedBuyOrdersForSafetyHalt()`, which retains the owned-BUY-only mutation policy.

**Regression coverage:**
- `create-account-integrity-safety-halt.test.js` asserts that `recoveryMode:true` is always passed, that concurrent triggers share one in-flight reconciliation, and that explicit BUY cancellation follows reconciliation.
- `conservative-trading-engine.test.js` includes an end-to-end safety-halt regression with a recovered FILLED BUY, a remaining active owned BUY, and an active recovery SELL. It asserts the BUY fill is accounted, only the active owned BUY is cancelled, and the recovery SELL remains OPEN.
- A separate engine test verifies that the explicit safety-halt cancellation method cancels only owned BUYs and preserves recovery SELLs.

**Disposition:** The current source/test defect is fixed and #773 is closed. The November 8 logs remain historical incident evidence; no TESTNET or production exchange acceptance is claimed. Do not describe the old default-mode path as current behavior.
 
## F-025 — Known preflight cancellation rejection was recorded as UNKNOWN outcome — resolved

**Classification:** HISTORICAL STATE-CLASSIFICATION DEFECT; RESOLVED by PR #786  
**Severity:** High — a known not-sent cancellation can create artificial unresolved owned-order state  
**Tracking:** [#774](https://github.com/45s/coinzilla/issues/774), under recovery umbrella [#626](https://github.com/45s/coinzilla/issues/626)

**Pre-PR #786 source path:** Binance `cancelOrder()` checked `userDataUnavailable` and returns an error before invoking the state-changing `order.cancel` RPC. The adapter propagates this as `ok:false`. In both `cancelAndReconcileRecoverySells()` and `cancelOwnedBuyOrders()`, every non-ok cancellation result is currently routed to `markCancellationUnknown()`, which changes the local registry status to `UNKNOWN`, publishes an `UNCONFIRMED` cancellation failure, and pauses the pair. The same ambiguity therefore affects recovery SELL cancellation and explicit owned-BUY safety/shutdown cancellation. The engine does not distinguish a local preflight refusal (request definitely not sent) from a timeout/disconnect after request submission (outcome genuinely unknown).

**November 8 runtime evidence:** At 03:21:48.940 UTC, broker `cancelOrder()` rejected DOGE recovery SELL `1323350` with `Cannot change Binance orders while the user-data stream is unavailable`; the broker guard runs before the `order.cancel` request. At 03:21:48.944, the next Harvester market-price record shows this same order in the active-order registry with status `UNKNOWN`. A second order, ZRO recovery SELL `749343`, hit the same preflight guard at 03:22:24.731 UTC; at 03:29:02.493, the next ZRO market-price record shows it as `UNKNOWN`. Thus both attempted SELL cancellations are followed by local UNKNOWN status. The CLOSING audit later reported `UNRESOLVED_OWNED_ORDERS:2`, exactly matching the count of these two observed UNKNOWN owned orders. The CLOSING record itself does not include order IDs, so the identity match is strongly supported by the complete trace but is not directly encoded in the CLOSING audit payload.

**Remediated — [PR #786](https://github.com/45s/coinzilla/pull/786) merged into `develop` on 2026-11-09.** The broker reports `NOT_SENT` only for its local preflight guard before invoking `order.cancel`, and `OUTCOME_UNKNOWN` when a dispatched cancellation cannot produce an authoritative canonical order result. Harvester accepts `NOT_SENT` only on an unsuccessful result (`ok: false`), preserves the known canonical order state, publishes the distinct lifecycle outcome, and retains the pair safety pause. Missing, unknown, or contradictory success-shaped metadata remains fail-closed. Exact-head unit, targeted, coverage, syntax/actionlint, Utils, and dependency checks passed. No TESTNET or exchange operations were performed; TESTNET acceptance remains PAUSED / UNVERIFIED.


## Cross-finding reconstruction — 2026-11-08 recovery failure chain (F-023/F-024/F-025)

The combined runtime and source evidence supports this sequence:

1. **03:21:48.331 — DOGE fill applied.** Fill `binance:DOGEUSDT:231208` (broker order `1323351`) is applied successfully: `applied:true`, `duplicate:false`.
2. **03:21:48.937 — duplicate observation triggers a transition.** The same fill is correctly deduplicated with zero accounting delta, but the event path requests cancellation of recovery SELL `1323350`.
3. **03:21:48.940–48.944 — known not-sent refusal becomes UNKNOWN.** Binance rejects before the `order.cancel` RPC because `userDataUnavailable` is true. The next market-price record shows DOGE SELL `1323350` as `UNKNOWN`.
4. **After the DOGE processing failure — broad accounting latch and safety halt.** Current handler source sets `accountingFailed=true` for every failed engine order transition and invokes the account-integrity safety halt. The recovery coordinator refuses to start/retry while this sticky flag is true.
5. **03:22:24.725–24.732 — ZRO safety-halt reconciliation attempts another SELL cancellation.** ZRO BUY fill `12374` is applied while snapshot application is running; recovery SELL `749343` cancellation is requested and rejected by the same broker preflight guard. The stack includes `applyOwnedOrderSnapshotsTransition()`, followed by the safety-halt reconciliation-failed log. This strongly correlates with the safety halt's `reconcileOwnedOrders()` call under the historical source behavior at the time of the incident; exact caller attribution is not present in the trace. Current `develop` has since changed this call to `recoveryMode:true` and added a regression preserving the recovery SELL.
6. **03:29:02.493 — ZRO order also observed UNKNOWN.** The next ZRO market-price record shows recovery SELL `749343` as `UNKNOWN`.
7. **03:45:19–03:45:24 — shutdown remains incomplete.** CLOSING audit reports `UNRESOLVED_OWNED_ORDERS:2` and `USER_DATA_OR_ACCOUNTING_RECONCILIATION_INCOMPLETE`; shutdown fails and retains the process lock. The two observed UNKNOWN SELLs match the unresolved count, but the CLOSING audit payload does not contain order IDs.

**Confidence and caveats:** The two preflight rejections, zero-RPC broker guard, and subsequent UNKNOWN local states are directly evidenced. Current source explains how both cancellation paths classify the failures. The two UNKNOWN orders matching the CLOSING count is strong count-level corroboration, not direct CLOSING ID evidence. The DOGE event's historical non-recovery mode and the exact caller of the ZRO snapshot-application transition remain unproven because the logs lack the runtime source revision and `recoveryMode` argument. Current `develop` contains the F-024 safety-halt recovery-mode fix. The F-023 broad error latch and F-025 NOT_SENT/UNKNOWN classification remain open.


## F-026 — Public Streams error-without-close is diagnostic-only; no stale-stream transition

**Classification:** CONFIRMED CURRENT-SOURCE LIVENESS/RECOVERY GAP; not a proven cause of the November 8 ZRO gap  
**Severity:** Medium — a post-open transport error that is not followed by close leaves the client without an automatic reconnect or stale-state transition  
**Tracking:** [#760](https://github.com/45s/coinzilla/issues/760)

**Current source:** `packages/brokers/src/infrastructure/binance/broker-websocket/utils/streams-client.js` attaches transport `onError` to `#reportError()` and transport `onClose` to `#handleClose()`. `#reportError()` only calls the configured observer; it does not change client state, mark subscriptions unhealthy, or schedule reconnect. `#handleClose()` is the path that marks the client closed and schedules reconnect/resubscription. The broker's `createMarketClient()` supplies an `onError` callback that only logs `Binance market stream error`. No per-stream last-receipt watchdog or stale/recovered state transition is present in this path.

**Test boundary:** `packages/brokers/src/infrastructure/binance/broker-websocket/utils/transport.test.js` explicitly tests that a post-open socket error is surfaced to observers without the transport itself silently replaying/reconnecting. That is a transport-level contract, not proof that the higher-level Streams client has a fatal-error recovery policy. The Streams client currently treats error and close as separate signals; a nonfatal error should not automatically force reconnect, but a persistent error with no close needs an explicit health policy.

**Impact and caveat:** If a public stream error occurs after open and no close event follows, the client can remain reported as open while receiving no useful data. Without per-symbol/per-stream receipt-age monitoring, this can be indistinguishable from an exchange market with no trades. This is a current-source liveness gap, but it is **not evidence** that the November 8 ZRO 54-minute aggTrade gap was caused by an error-without-close; no such afternoon error was logged.

**Required follow-up:** distinguish recoverable/fatal transport errors from message/observer errors; expose transport error state and per-stream last-receipt age; define when an error should close/reconnect versus remain diagnostic-only; add deterministic tests for post-open error with no close, error followed by close, stream activity continuing after an error, and one logical stream stalling while another remains active. Do not introduce unconditional reconnect loops or false stale alerts during quiet markets.


## F-027 — Per-order reconciliation repeats exchange metadata RPCs

**Classification:** CONFIRMED CURRENT-SOURCE PERFORMANCE INEFFICIENCY  
**Severity:** Medium operational latency contributor  
**Tracking:** [#766](https://github.com/45s/coinzilla/issues/766)

**Source evidence:** In the current Binance broker, each `getCanonicalOrderHistory({symbol, orderId})` call performs `allOrders` and then a separate `exchangeInfo({symbol})` request to construct the canonical market. Each `getFills({symbol, orderId, fromId, limit})` page similarly performs `exchangeInfo({symbol})` followed by `myTrades`. Neither method reuses metadata across orders/pages in the inspected path. Notably, the same broker already has `getCanonicalMarket()` backed by `canonicalMarkets` and `canonicalMarketRequests` per-symbol caching/concurrent-request sharing, but the canonical-history and fill-history methods bypass that helper and issue direct `exchangeInfo` requests. The existing broker `get-fills.test.js` models the metadata request on each call.

**November 8 shutdown count:** With 50 owned orders and one fill-history page per order, each reconciliation pass therefore performs 2 open-orders RPCs + 50 `allOrders` + 50 canonical-history `exchangeInfo` + 50 fill-history `exchangeInfo` + 50 `myTrades` = **202 sequential RPCs**. The two required passes total **404 RPCs**. The 100 per-order `exchangeInfo` lookups per pass are repeated for only two symbols; across both passes that is 200 metadata RPCs. If any order requires additional fill-history pages, each additional page adds another `exchangeInfo` + `myTrades` pair. There is an additional payload inefficiency in the 50 `allOrders` requests: `collectOwnedOrderSnapshots()` supplies an exact `orderId` but no `limit`; `createOrderHistoryParams()` defaults the page size to 100, and `getCanonicalOrderHistory()` filters the lower-bound cursor page to the one exact order only after the response arrives. Each request can therefore transfer up to 100 order records to retain one. The logs do not record response page lengths, so the actual number of over-fetched records is unknown; the configured upper bound is 5,000 records per pass across 50 queries.

**Required follow-up:** evaluate a safe per-reconciliation/per-symbol metadata reuse boundary or an adapter contract that accepts already-resolved canonical market metadata. Preserve metadata freshness/validation, exact symbol identity, complete fill pagination, rate limits, and fail-closed semantics. Measure per-RPC timings before deciding whether metadata reuse, bounded concurrency, or both provide the greatest benefit. No implementation is part of this audit.


## F-031 — current process-restart recovery integration gap (updated 2026-11-09)

**Status: CONFIRMED STARTUP INTEGRATION GAP; runtime consequence STRONGLY INDICATED; no end-to-end process-death/restart reproduction.** The current authoritative roadmap makes #654 a critical release-readiness requirement before unattended restarts. This is an investigation-only phase; no implementation is authorized here.

**Owner-approved lifecycle:** Harvester runs on a personal workstation and may be stopped while Binance orders remain open. Exchange orders can partially or fully fill while Harvester is offline. This is expected behavior, not an uptime or operator failure. On the next startup, before new trading, Harvester must reconcile offline fills, commissions, partial/terminal order states, balances, locked funds, reservations and open orders. Historical CLOSING snapshots remain immutable; later fills belong to next-session reconciliation.

**Confirmed current-source evidence**

1. `apps/harvester/src/bootstrap/start-harvester.js` initializes a new `Portfolio`, empty `recoveryLedgers` map, `OrderRegistry.empty()`, and empty recovery/session collections (including `journalFills: []`). It explicitly comments that durable Journal replay is disabled and startup uses fresh in-process state.
2. `apps/harvester/src/use-cases/create-portfolio-workflow.js` creates a new Portfolio and RecoveryLedger map unless initial state is injected. Portfolio and RecoveryLedger fill IDs/fingerprints are part of those in-memory projections.
3. `apps/harvester/src/use-cases/conservative-trading-engine.js` implements `reconcileOwnedOrders()` over the current registry. When there are no registered owned orders, it returns `{ reconciled: 0, symbols: [] }` without querying canonical order or fill history. Its per-order reconciliation cannot discover prior-process orders without restored identities.
4. `apps/harvester/src/bootstrap/account/create-account-snapshot-manager.js` and `subscribe-to-user-data.js` capture and durably flush PREFLIGHT account balances and account-wide open orders. The snapshot classifies unmatched orders as `BLOCKED` / `UNOWNED_OPEN_ORDERS`; this is an audit classification, not a trading-readiness gate.
5. `apps/harvester/src/bootstrap/start-harvester.test.js` explicitly tests that a pre-existing unowned order is recorded but not adopted/cancelled and does not prevent runtime startup. Its “starts from fresh in-memory state without replaying historical Journal records” test supplies a malformed `journalRecoveryRecords` argument, instruments historical broker reads, then asserts no historical reads occurred and `runtime.userDataReady === true`.
6. `packages/journal/README.md` documents bounded read/replay, but replay is at-least-once and requires an idempotent consumer. `apps/harvester/src/infrastructure/journal/prepare-optional-journal.js` starts, flushes and closes Journal; it does not read/replay prior sessions. `apps/harvester/src/index.js` passes only the event publisher into `startHarvester`, not a restored projection.

**Graceful versus unexpected termination**

- `apps/harvester/src/index.js` registers SIGINT and SIGTERM handlers that invoke the runtime shutdown.
- `apps/harvester/src/bootstrap/shutdown/create-shutdown-handler.js` performs owned-order reconciliation before and after the owned-BUY cancellation pass, drains user-data, preserves open SELLs, writes the durable CLOSING balance audit, and disconnects.
- The process then closes Journal/EventBus and releases process locks only after shutdown is confirmed.
- SIGKILL, process crash and power loss cannot run these handlers or the graceful CLOSING path. Same-host locks are reclaimed only when the recorded PID is demonstrably absent and PID/hostname/token still match on immediate re-read. Foreign-host, unreadable, permission-denied, or possibly-live locks fail closed and require operator verification.



**Broker history discovery — capability versus current integration**

- The current `@coinzilla/brokers` contract exposes canonical `getFills({ symbol, orderId?, fromId?, startTime?, endTime?, limit? })`. Symbol-wide queries are possible without an `orderId`, so an empty Harvester registry does not make exchange-side fill discovery technically impossible.
- Binance's official Spot WebSocket API `myTrades` documentation specifies an inclusive `fromId` cursor, a maximum `limit` of 1,000, and time filters whose interval cannot exceed 24 hours. `fromId` cannot be combined with `startTime`/`endTime`; `orderId` cannot be combined with time filters but can be combined with `fromId`. With no condition, only the most recent trades up to the limit are returned. See [Binance Account Trade History — Spot WebSocket API](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/ws-api/account).
- The broker package contract validates trade/fill cursor IDs and rejects values outside JavaScript's safe-integer range rather than rounding int64 identifiers. This is a hard pagination boundary until the transport supports exact int64 representation.
- Current Harvester `reconcileOwnedOrders()` does not perform a symbol-wide scan: it queries fills only after it has a registered owned order ID, and it returns immediately for an empty registry.
- **Unresolved:** the official endpoint documentation inspected here does not state a guaranteed historical-retention horizon. Therefore a symbol-wide cursor scan is a possible recovery building block, not proof that every offline execution is always retrievable. A durable per-symbol cursor, page-exhaustion proof, retention policy, market-universe coverage, and fallback/operator procedure are still required.

**Additional persistence boundary discovered — F-028:** the applied-fill path publishes `FILL_APPLIED` after accounting but does not call `eventPublisher.flush()`. Event publisher documentation defines publication as synchronous admission only; EventBus subscriber handlers are asynchronous; Journal `record()` acknowledges `durable: false`, while `flush()` waits for subscribers/write queue and performs fsync. Graceful close drains and syncs, but abrupt termination has no equivalent guarantee. See F-028 in `AUDIT.md`. This confirms a missing durability guarantee, not a reproduced historical lost-fill incident.



**Existing offline recovery helper pipeline — retained, tested, not wired into current startup**

- `projectHarvesterJournalRecovery({ records })` validates Journal session boundaries, lifecycle transitions, order intents/acknowledgements/cancellation outcomes, fill identity/deduplication, recovery cycles, pause state, PREFLIGHT/CLOSING account snapshots and open-order snapshots.
- `restoreHarvesterJournalState({ projection, marketMetadata })` reconstructs Portfolio, RecoveryLedger, OrderRegistry, pause/recovery-managed state, replacement/trailing-reprice intents, cancellation identities, completed-cycle identities and Journal fill identities. Unresolved orders are restored conservatively and require canonical exchange reconciliation before trading.
- `fetchAccountTradeHistory()` paginates exchange `myTrades` for a supplied Market list, beginning at the durable baseline and advancing with `fromId`. It cannot discover symbols outside that list; `marketUniverseComplete` is a caller-supplied assertion.
- `auditRecoveredTradeHistory()` verifies exact Journal/exchange fill and commission parity, duplicate IDs/trade IDs, ownership attribution and complete pages; it rejects unless `marketUniverseComplete === true`.
- `auditRecoveredAccountState()` verifies the durable PREFLIGHT baseline against current balances, active open-order ownership/status/quantities and exact locked-asset reservations.

Focused tests exist in `project-harvester-journal-recovery.test.js`, `fetch-account-trade-history.test.js`, `audit-recovered-trade-history.test.js` and `audit-recovered-account-state.test.js`. These helpers are not called by the current `index.js`, `prepareOptionalJournal()` or `startHarvester()` composition.

**Historical PR #606 integration limitation:** its caller passed `marketUniverseComplete: false` to `fetchAccountTradeHistory()`, while `auditRecoveredTradeHistory()` rejects unless that flag is true. Thus the prior trading-enabled integration deliberately failed closed when historical trading state required a complete account-wide history audit. The current Binance symbol catalog cannot prove the universe of historical symbols, including delisted markets. The current runtime later removed the recovery read/replay gate rather than solving this completeness problem; it now starts fresh and can proceed with unowned open orders. That bypass is not a safe equivalent to the previous fail-closed behavior.



**Order-state behavior in the retained PR #606 helper pipeline:**

| State at process exit / durable Journal facts | Offline restoration behavior | Canonical startup reconciliation requirement |
|---|---|---|
| `OPEN` / `PARTIALLY_FILLED` | `restoreHarvesterJournalState()` restores the order with its client ID, any known broker ID, cumulative executed quantity and fill identities, but conservatively sets status to `UNKNOWN`. | Resolve a missing broker ID through canonical `clientOrderId` lookup; compare canonical order history, current open orders and complete fill history; fail closed on mismatch or incomplete quantity/history. |
| Submission outcome `UNKNOWN` | Durable submission intent preserves `clientOrderId`; broker ID may be absent if acknowledgement was lost. | `reconcileOwnedOrders()` queries `broker.getCanonicalOrder({ symbol, clientOrderId })`; unresolved or mismatched lookup remains UNKNOWN and blocks readiness. |
| Cancellation `REQUESTED` / `UNKNOWN` (including `CANCEL_PENDING`) | Restored as UNKNOWN plus the durable cancellation identity, recovery-managed pause, and replacement/trailing-reprice intent when applicable. | Canonical order/history/fill reconciliation must establish whether the order remains open, was canceled, or partially filled. Unresolved intents keep the market paused and startup fails closed. |
| `CANCELED` with partial execution | Restored as CANCELED only with a broker ID; the helper re-adds a durable market pause for the partial-fill case. | Verify complete canonical fill history and retain the pause until recovery state is resolved. |
| `FILLED` / `EXPIRED` or other non-rejected terminal hint | Conservatively restored as UNKNOWN unless the Journal facts establish a specifically supported terminal state. | Canonical order history and fill history establish the authoritative terminal state; missing history or quantity mismatch fails closed. |
| `REJECTED` | Restored as REJECTED only when submission outcome or exchange hint establishes rejection; a rejected order with nonzero cumulative fill is rejected as invalid recovery data. | Reconcile the terminal fact and account snapshot before allowing readiness. |

The current runtime does not execute this restoration/reconciliation matrix because it supplies an empty registry and never invokes the helper pipeline. The historical PR #606 path also retained the account-wide `marketUniverseComplete: false` blocker described above.

**Order-ID recovery boundary:** durable submission intent preserves `clientOrderId`; broker `brokerOrderId` is captured by acknowledgement/cancellation/fill events or recovered by `reconcileOwnedOrders()` through `broker.getCanonicalOrder({ symbol, clientOrderId })` for restored registry entries without a broker ID. The engine validates the returned symbol/client ID and attaches the canonical broker ID. Tests cover lost acknowledgements, unresolved lookups, mismatched IDs and immutable-intent conflicts. If lookup fails, the order remains UNKNOWN and the account audit fails closed. The current runtime cannot use this capability after restart because it does not restore the registry entry containing the client ID.



**PREFLIGHT BLOCKED versus trading readiness — important test boundary**

`subscribeToUserData()` publishes the account-wide open-order audit, drains queued user-data events, and then sets `state.ready = true` when user-data/accounting flags are otherwise safe. It does not reject startup based on `account.open_orders_captured.readiness === "BLOCKED"`. The existing test “journals pre-existing account-wide orders and allows trading startup without adopting or changing them” verifies market subscriptions proceed and the runtime starts with the external order unowned.

The test's fake broker emits no market-price tick, so its `placeCalls === 0` assertion proves only that observing an external order does not itself submit an order. It does **not** prove that later market data cannot trigger a new strategy order while the prior order remains unowned. A live execution event for an unowned order can still trip accounting safety; an order that filled entirely while Harvester was offline produces no new user-data event on the restarted stream and is absent from the current open-order snapshot.

**Strategy duplicate-order guard — strongly indicated risk:** `processMarketPriceTransition()` obtains `activeOrdersBefore` only from `state.registry.getActiveOrders()`. `evaluateLatestTransition()` passes only this registry list to `conservativeStrategyPolicy.evaluate()`, and calculates `allActiveOrders`, `committedQuote` and `committedBase` from the same registry. The policy's `hasActiveBuy`/`hasActiveSell` checks only its `activeOrders` input; with an empty registry and Portfolio, its initial BUY path can emit `INITIAL_BUY`. The account snapshot supplies exchange free balances (so locked funds are excluded), but if sufficient free quote remains the action can still be allocated. The submission `canSubmit` guard checks pause/readiness, market-price freshness and post-only crossing, not account-wide unowned open orders. Therefore, if a prior-process same-symbol order remains open but is unowned, a new same-symbol order may be submitted when the strategy emits an action and funds permit. This is strongly indicated by source, not reproduced: the existing startup test does not emit a market-price tick. The strategy unit tests prove that active orders suppress duplicate intents only when present in the supplied registry list.


This is an explicit current startup policy for external orders, not a reproduced duplicate-order incident. In a restart scenario, a formerly Harvester-owned order is indistinguishable from an external order because the registry is empty. Treat this as a high-priority #654 reconciliation requirement.

**Additional safety-state finding — F-029:** the startup composition passes empty `pausedMarkets`, `durablePausedMarkets`, `recoveryManagedPausedMarkets`, cancellation IDs and replacement/reprice intents into the engine. The engine's `pause()` only mutates in-memory Sets and publishes `STRATEGY_PAUSED` without a flush. A previous per-market strategy safety pause/recovery intent is therefore not restored on restart; if PREFLIGHT/live events do not rediscover the original condition, readiness may become true. The separate `accountingFailed` process-lifetime latch reset is already tracked by F-023/#769; F-029 records the additional engine pause/recovery-intent state gap. Actual post-restart unsafe order placement is not reproduced. See F-029 in `AUDIT.md`.

**Operational consequence and confidence**

- **Confirmed:** previous-process Portfolio/Position, RecoveryLedger totals, fill deduplication identities and owned-order registry are not restored by the current Harvester startup composition.
- **Confirmed:** current open orders are observed as unowned; the existing startup test allows runtime startup without adopting or cancelling them.
- **Strongly indicated:** a fill occurring while Harvester is stopped can be absent from the new in-memory accounting projection. A now-terminal order will not appear in the PREFLIGHT open-order list; an empty registry gives `reconcileOwnedOrders()` no order IDs from which to request its fill history. Separately, the strategy active-order/commitment guard reads only the registry; with no restored order, an initial BUY can be submitted while an old same-symbol order remains open if free quote remains.
- **Not yet proven:** a deterministic end-to-end restart scenario producing an actual duplicate new order, missed accounting delta, double application, or incorrect reservation/balance decision. Do not report these consequences as reproduced incidents.
- The November 8 DOGE/ZRO post-shutdown fills remain expected downtime behavior. Their absence from the earlier CLOSING snapshot is not a defect.

**Documentation inconsistency**

The earlier `apps/harvester/docs/JOURNAL_OPERATIONS.md` text incorrectly described prior-session Journal reads and a trading-startup gate that are not present in the current composition. This documentation-only PR corrects it: current `prepareOptionalJournal()` starts the writer without reading prior sessions, and `main()` calls `startHarvester({ eventPublisher })` without a recovery snapshot. The retained PR #606 helper pipeline and its historical fail-closed limitation are now documented separately.

**Required future DDD/TDD work (not implementation in this phase)**

- Define a versioned durable checkpoint covering client/broker order IDs, immutable order intent and terminal state, fill/trade IDs and fingerprints, exact commission facts, reservations, Portfolio/Position, RecoveryLedger/cycle state, strategy ownership, pause/replacement state, and config/schema version.
- Define crash-consistent ordering for submission/cancellation intents, broker acknowledgements, fills, accounting application and checkpoint advancement. Do not claim exactly-once transport delivery.
- Restore and validate the complete Journal projection before engine activation; make replay idempotent across a crash between projection application and checkpoint commit.
- Discover and reconcile orders/fills changed while offline, including OPEN, PARTIALLY_FILLED, FILLED, CANCELED, EXPIRED, REJECTED and UNKNOWN; prove pagination exhaustion and history-retention coverage for every relevant market/order.
- Reconcile balances, locked funds, reservations and external/unowned activity without silently adopting unrelated assets/orders.
- Fail closed on missing/invalid history, retention gaps, ownership ambiguity, duplicate identity conflicts, unsupported commission facts or contradictory balances/orders; define explicit operator intervention.
- Specify first-run versus returning-run behavior, Journal-missing behavior, schema upgrades, stale locks, graceful SIGINT/SIGTERM, abrupt termination, and restart after every order/fill/recovery boundary.
- Add deterministic tests for crash/restart after submit-before-ack, ack-before-fill, partial/full fill, cancel-before-ack, cancel/fill race, recovery completion, duplicate/conflicting replay, incomplete pagination, stale/malformed Journal, and balance/open-order mismatch. Assert no duplicate order, no missed/double accounting, restored reservations, and no READY before reconciliation.

**Test limitations**

The inspected tests characterize fresh-state startup and graceful lifecycle behavior; they do not reproduce a real process death followed by restoration and exchange reconciliation. No test command was executed during this source-only review.

**Safety:** no source or test files changed; no process restart, private account query, exchange write, order mutation, credential/configuration change, or TESTNET action performed.


**Disposition — RESOLVED by PR #794 (2026-11-09):** the implementation and regression coverage described above close the code/test requirements in #769. The process-lifetime accounting latch remains terminal for ownership/accounting-integrity failures; transient order-transition, REST-reconciliation, and durability failures are generation-scoped and retry only through a fresh authoritative single-flight recovery. A failed queued event prevents generation acknowledgement. Transport reconnect or reclassification alone never reopens readiness. The issue is ready to close; broader recovery umbrella #626 remains open for its independent work.


## F-032 — Diagnostic-only user-data RPC errors invalidate readiness and collapse distinct causes

**Status:** IMPLEMENTED in [PR #824](https://github.com/45s/coinzilla/pull/824); exact-head offline verification is recorded by the PR's required checks. TESTNET acceptance remains PAUSED / UNVERIFIED.

**Evidence:** Brokers `UserDataSession.#handleError()` forwards the original error as `{ type: "rpcError", recoveryRequired: false }`. This path does not mark the broker user-data subscription unavailable, increment its recovery generation, or schedule reconnect. The broker's `#handleClose()` path separately marks recovery required, emits `connectionClosed` / `recovering`, and schedules reconnect.

Before PR #824, Harvester's `createUserDataStatusHandler()` included every `rpcError` in both `connectionUnsafe` and `recoveryInvalidated`, regardless of the explicit `recoveryRequired: false` status. That behavior incremented the application recovery generation, discarded the current subscription/broker-generation identity, closed readiness, and required reconciliation. The recovery coordinator is started by a subsequent `recovered` status, which the diagnostic-only broker path does not produce.

Before PR #824, the handler's bounded-log deduplication key included the outer error name/message but omitted the underlying cause identity. Two empty-message `TypeError` instances with different causes can therefore collapse into one log entry, hiding distinct available transport evidence.

**Impact:** an error event that does not result in a transport close can leave Harvester permanently blocked even though the broker has not entered its recovery lifecycle. Separately, repeated empty-message errors can lose distinct cause diagnostics. This finding does not establish the root cause of the original November 5 TypeError.

**Expected behavior:** honor an explicit `recoveryRequired: false` on `rpcError` as diagnostic-only. Preserve the current readiness and generation state unless reconciliation was already required. Missing or malformed recovery metadata must remain fail-closed. A subsequent `connectionClosed` must invalidate the generation and close readiness exactly once. Deduplicate only equivalent error context; distinct underlying causes must remain observable.

**Test-first regression:** the test-only PR #824 head `1eae58ff11ca3d72508c0fd7e4e36c8a16c8a70f` reproduced three expected failures: diagnostic-only readiness was closed, distinct causes were deduplicated together, and a subsequent close incremented the generation twice. The missing-metadata fail-closed test passed. The implementation now treats only explicit `recoveryRequired: false` with no contradictory reconciliation flag as diagnostic-only, preserves all state in that case, and includes bounded error/cause stack and cause identity in the deduplication key. Actual closes, contradictory flags, and unknown/malformed metadata retain the fail-closed path. Additional tests verify that a diagnostic-only error cannot clear an already unresolved application gate or overwrite the existing operational status.

**Scope:** Harvester status handling only. No broker contract change, retry timer, reconnect heuristic, order mutation, TESTNET operation, or process-restart recovery is introduced.



## F-033 — Permanent Journal write failure is incorrectly treated as retryable recovery work

**Status:** IMPLEMENTED and verified in [PR #906](https://github.com/45s/coinzilla/pull/906), implementation head `9d6283de604ddcaefe9cd9faabce29489fb896ea`.

- **Evidence:** `prepareOptionalJournal()` exposes `status.writeFailed` from the Journal writer. `Journal.record()` sets the writer's `writeFailed` latch after an append/write failure; later records and flushes on that instance continue failing. A file-content sync failure does not set this latch and may succeed on a later flush.
- **Harvester propagation gap — resolved in PR #906:** the composition boundary classifies a failed flush from the public Journal wrapper status. A poisoned writer (`writeFailed: true`) is terminal; an active, unclosed writer with no write-error latch is explicitly retryable; missing/contradictory health facts are terminal. The event publisher preserves this classification, and the account snapshot manager accepts only the two explicit classifications.
- **Recovery impact:** the coordinator correctly remains fail-closed and does not acknowledge the broker, but later `recovered` reminders can repeat owned-order reconciliation, account reads and audit publication even though the same Journal writer cannot recover.
- **Implemented behavior:** explicitly poisoned writers are terminal `DURABILITY / JOURNAL_WRITE_FAILURE` (`retryable: false`); an active unpoisoned writer's failed flush is `DURABILITY / JOURNAL_FLUSH_FAILURE` (`retryable: true`). Unclassified writer health is terminal. The account snapshot manager preserves the original Journal error as `cause`, and the recovery coordinator accepts terminal `DURABILITY` failures without reopening readiness or retrying later reminders.
- **TDD RED:** test-only PR #906 head `58af1e9e1cbfdebbb803f9f2ddce119c80a43777` reproduced four expected failures in 867 Harvester tests (863 passed, 4 failed): the composition boundary omitted Journal failure metadata, the event publisher discarded it, the account snapshot manager downgraded it to retryable, and the recovery classifier rejected terminal `DURABILITY` metadata. The earlier 3-failure run exposed and corrected a mutable-object alias in the recovery assertion.
- **TDD GREEN:** implementation head `9d6283de604ddcaefe9cd9faabce29489fb896ea` passed all 870 Harvester tests (870 passed, 0 failed), all workspace unit-test jobs, all workspace coverage jobs, JavaScript Syntax, Dependency Audit, Harvester Targeted Tests, and Harvester Process Lock. Harvester coverage: 75.92% lines, 79.26% branches, 74.85% functions. The final PR head adds only this documentation closeout.
- **Safety:** no Journal package API or persistence semantics change; no Journal replay, process-restart recovery, TESTNET/live trading, or exchange action.
- **F-018 follow-up:** the transient sync retry behavior remains intact; the separate permanent-writer futile-retry gap is resolved by this F-033 change.

## F-035 — Per-process Journal layout is not discoverable through the current Journal reader path

**Status:** CONFIRMED integration blocker. **Severity: HIGH.** See the [2026-11-10 restart-recovery audit](2026-11-10_18-44-49_restart-recovery-audit.md).

Harvester writes each process Journal under `logs/sessions/<timestamp>-<runtime-session-id>/`, and `prepareOptionalJournal()` passes the new process's session directory to the Journal. `Journal.read()` and `FileSystemJournalStore.listSessions()` enumerate direct files only; they do not recurse into sibling process-session directories. A restart-recovery reader must explicitly enumerate nested process sessions and legacy flat files, validate the complete set, and fail closed on missing or corrupt history. Additionally, `readJournalRecords()` skips every non-`.jsonl` entry; pointing it at the `logs/sessions` parent silently returns a successful empty record set because all immediate children are directories. Never interpret that empty result as proof of no prior trading history. The older PR #606 read path predates the PR #874/#880 directory layout.

## F-036 — External open-order ownership audit is distinct from trading readiness

**Status:** owner-confirmed external-order startup policy; same-symbol interaction risk is strongly indicated but not reproduced. **Severity:** HIGH potential risk, not a confirmed readiness bypass. See the [2026-11-10 restart-recovery audit](2026-11-10_18-44-49_restart-recovery-audit.md) and the explicit policy disposition in [issue #667](https://github.com/45s/coinzilla/issues/667#issuecomment-6717086777).

`createAccountSnapshotManager()` classifies unmatched account-wide open orders as `readiness: BLOCKED` with `UNOWNED_OPEN_ORDERS` reasons. This is an **ownership-audit classification**, not the global trading-startup gate. The owner explicitly confirmed that external orders are allowed at startup, remain external/unowned, and must never be adopted, canceled, or modified. Accordingly, `subscribeToUserData()` may set global `state.ready = true` after the durable PREFLIGHT audit and all independent user-data/accounting checks pass. Do not change this into a global startup rejection merely because the ownership audit says BLOCKED.

The remaining concern is narrower: the Conservative engine's active-order and commitment guards use only the in-memory OrderRegistry. The existing startup regression permits an unowned ZROUSDT order while BTCUSDT is enabled and emits no market-price tick. It proves that the external order is preserved and does not globally block startup; it does **not** prove the behavior when an external order is on an enabled symbol and that symbol later receives a strategy-triggering price. A conflicting same-symbol interaction is therefore strongly indicated by source, not reproduced. Any future mitigation must preserve global startup with unrelated external orders and must not adopt/cancel/modify them; test and choose the narrowest symbol/asset-scoped behavior before changing source.

The recovery coordinator passes `blockOnExistingOrders`, but the account snapshot manager does not consume that option. Do not infer a recovery gate from the unused argument. External open orders alone are not proof that account-wide reconciliation failed. An actual unowned execution event is different: current ownership/accounting handling raises a terminal safety halt and the owned-BUY safety workflow runs; that process-wide fail-closed latch is not cleared merely by a transport reconnect. The external order itself remains untouched.

Required follow-up: add a deterministic same-symbol startup/reconnect regression before changing this policy. Verify that unrelated symbols remain eligible, external orders remain unowned and untouched, and any affected-symbol restriction is explicitly justified by the strategy/accounting invariant. Do not claim a reproduced duplicate-order incident.
 
## F-037 — Crash-safe fill persistence conflicts with the current non-blocking Journal evidence contract

**Status:** CONFIRMED durability gap; target architecture decision accepted in [ADR-0001](../../architecture/decisions/0001-application-owned-recovery-facts.md); implementation remains outstanding. **Severity: HIGH.** See the [2026-11-10 restart-recovery audit](2026-11-10_18-44-49_restart-recovery-audit.md).

Harvester agent/trading/Journaling contracts say optional Journal evidence must not add blocking I/O to fill accounting or broker-event handling and that Journal is not trading-state authority. Process-restart safety requires durable execution facts and safety pauses before the application can safely progress. The current `processExecutionFillTransition()` ignores the result of `publishLifecycleEvent(FILL_APPLIED)`; `publishLifecycleEvent()` is explicitly best-effort, and the fill path does not flush before returning success. Thus accounting and subsequent strategy progression can continue even if no Journal fill event was accepted. **Design disposition — 2026-11-11:** ADR-0001 selects a separate application-owned durable-fact port/store as the future restart-recovery authority. Journal remains a separate observer, and the current mandatory Journal barriers remain unchanged until a separately audited migration. The accepted contract requires a global sequence, committed-head integrity, explicit append/fsync acknowledgement, durable order/cancel intents, canonical execution facts before accounting progression, explicit cycle outcomes, sticky blockers, and a closed startup reconciliation gate. This resolves the architecture choice only; no runtime source or tests changed and the F-037 durability gap remains until the port is implemented and integrated.

## Documentation correction — Journal serialization failure propagation

`JOURNAL_OPERATIONS.md` contained a stale description that Journal serialization failures were only logged and omitted from flush results. Journal issue #889 was fixed in PR #920: lossy payloads are rejected before append, failures are retained in writer state, and flush/close surface the failure without claiming durable success. The 2026-11-10 documentation update corrects that statement.

## F-038 — Restoring a completed recovery cycle does not reset Position cost basis

**Status:** CONFIRMED latent domain-logic defect in the retained recovery helper; current runtime replay is disabled. **Severity: HIGH.** See the [2026-11-10 restart-recovery audit](2026-11-10_18-44-49_restart-recovery-audit.md).

`createPortfolioWorkflow.completeRecoveryCycle()` allocates the exact retained quantity, calls `portfolio.resetRecoveryBasis({ marketId })`, and resets the RecoveryLedger. `restoreHarvesterJournalState()` replays the same cycle event but only allocates `freeQuantity` and resets the RecoveryLedger. It does not reset `Position.spent`, which is the authoritative Conservative recovery basis. A restored completed cycle therefore retains the prior cycle's cost basis while the RecoveryLedger is reset; the account-balance audit cannot detect this because cost basis is not a wallet balance.

The restore helper also accepts `freeQuantity < position.baseQuantity`; it only rejects an allocation larger than active inventory. The live completion rule requires the entire remaining active quantity to equal `keepQuantity` plus any classified dust and transfers that exact amount to free inventory. Restoration must reject a mismatch and must reproduce the live basis reset. Add a direct RED/GREEN restore-helper regression for both conditions before re-enabling replay.


## F-039 — Third-asset commission valuation and fee-asset reconciliation

**Status:** LIVE/DTO/projection/offline-restore parity and invalid-fee atomicity implemented by [PR #1002](https://github.com/45s/coinzilla/pull/1002), following the DTO/restore correction in [PR #990](https://github.com/45s/coinzilla/pull/990) and targeted fee-asset balance reconciliation in [PR #995](https://github.com/45s/coinzilla/pull/995). **Severity: HIGH.** The accounting path is covered; automatic process-restart replay remains disabled and is a separate release gate. See the [2026-11-10 restart-recovery audit](2026-11-10_18-44-49_restart-recovery-audit.md).

Live `validateFillCommissions()` accepts non-zero third-asset commissions only when a historical quote-currency valuation is supplied, and both Position and RecoveryLedger accounting include that value. PR #990 updates `mapFillAppliedData()` to persist exact commission amount/asset ID/code plus optional historical `quoteValue` amount/quote-asset ID/code; the mapper fails closed when a non-zero third-asset commission has no valuation or when asset identities contradict the market. `projectHarvesterJournalRecovery.requireFill()` retains and validates the exact valuation fields. `restoreHarvesterJournalState.restoreFill()` rebuilds a canonical third-asset Commission with the original fee Asset and historical quoteValue; missing, malformed, non-positive-for-a-nonzero-fee, or wrong-quote-asset valuation fails closed. Zero-amount commission entries remain valid without inventing a quote valuation. Legacy positive third-asset records without quoteValue remain unrestorable; never infer a historical value from current prices.

PR #995 adds a targeted `COMMISSION_BASELINE` account snapshot for each non-zero third-asset commission asset actually used. The account snapshot manager retains the original PREFLIGHT balances in memory, but persists only the relevant fee asset's original free/locked/total balance; unrelated wallet assets remain excluded. `createPortfolioWorkflow` requests the baseline before committing the new fill accounting projection. Journal remains optional: if baseline publication fails, valid fill accounting still proceeds and logs a warning; the later account audit fails closed because the required baseline is absent. `auditRecoveredAccountState()` merges targeted baselines with the original PREFLIGHT snapshot, subtracts exact third-asset commission amounts from expected balances, preserves pre-existing locked fee-asset balances, and compares only configured market assets plus actual third-asset fee assets. Regressions cover a BNB debit (1.0000 → 0.9999), unchanged locked balance, unexplained balance movement, missing baseline, and exclusion of unrelated XRP.

**F-039 completion update — PR #1002:** the shared commission validator now verifies asset ID/code identity against both market assets and across all commission entries, and requires third-asset historical quote valuations to use the exact market quote asset identity. RED regressions reproduced acceptance of contradictory third-asset and quote-valuation identities. GREEN tests cover multi-fill BUY/SELL accounting with exact third-asset historical quote values, plus complete live Position/RecoveryLedger parity against DTO → projection → offline restore for base-, quote- and third-asset fees. Invalid fee identity fails before either accounting projection changes; full Portfolio and RecoveryLedger snapshots are asserted unchanged, and the live workflow does not request a fee baseline for an invalid fill. Harvester suite: 956 passed, 0 failed. Required repository workflows and external documentation-link validation passed on the tested PR head; see [PR #1002](https://github.com/45s/coinzilla/pull/1002). This does not enable runtime replay or process-restart recovery.

## F-040 — Same-second process sessions are ordered by random session ID, not chronology

**Status:** CONFIRMED Journal-reader ordering weakness. **Severity: HIGH.** See the [2026-11-10 restart-recovery audit](2026-11-10_18-44-49_restart-recovery-audit.md).

Process identity captures millisecond `startedAt` but generates a UUID session ID. Both Harvester log-session paths and Journal filenames truncate start time to seconds. `readJournalRecords()` sorts same-second filenames by the UUID suffix, while `projectHarvesterJournalRecovery()` consumes that order and does not use the `harvester.process_started` event timestamp to reorder sessions. Two sequential starts in the same second can therefore replay in reverse chronology. The existing `journal-recovery.test.js` explicitly tests lexical ordering for identity suffixes, not chronological ordering. `auditRecoveredAccountState.getInitialTradingSnapshot()` selects its baseline from the first trading session in that projection order, so it can also select the wrong PREFLIGHT balance baseline. Required test: same-second sessions with reversed lexical UUID order and distinct millisecond start times; verify chronological replay or fail closed on ambiguity. Preserve legacy filename compatibility; do not use random IDs or wall-clock time alone as chronology. Prefer a global durable sequence across restarts or a manifest that links session sequence ranges.

## F-041 — Missing recovery-cycle completion can silently restore stale accounting

**Status:** CONFIRMED recovery-integrity gap; current runtime replay is disabled. **Severity: HIGH.** See the [2026-11-10 restart-recovery audit](2026-11-10_18-44-49_restart-recovery-audit.md).

When a completed SELL makes recovery eligible, `completeRecoveryCycle()` resets `Position.spent` and the RecoveryLedger in memory. The engine then publishes `RECOVERY_CYCLE_COMPLETED` through best-effort `publishLifecycleEvent()` and ignores the result; there is no durable acknowledgement before strategy progression. The projector tracks a fully filled SELL in `lastFullyFilledSellBySymbol` and deletes it only on a later completion event. It rejects a second full SELL before that event, but silently discards any unmatched entry at end-of-input. `restoreHarvesterJournalState()` only resets the basis for projected cycle events, while `auditRecoveredAccountState()` cannot detect stale cost basis from wallet balances. A crash/publication failure after the in-memory reset but before durable cycle event can therefore produce a successful projection and restore the prior cost basis without allocating retained inventory to the free bucket. `auditRecoveredAccountState()` compares total base quantity and quote net cash flow, not the active/free split or `Position.spent`, so the wallet audit can pass. The retained quantity can remain classified as active/sellable inventory. Record an explicit durable cycle evaluation outcome (completed or not completed) before progression, or fail closed on an unresolved full SELL. Do not infer completion from a SELL fill: residual sell-through is a legitimate non-completion case. Required regression: orphan fully filled SELL without a cycle event must be surfaced as unresolved and must not restore READY.

## F-042 — Journal cannot detect deletion of a complete, otherwise valid record

**Status:** CONFIRMED evidence-integrity limitation; Journal is not an authoritative recovery ledger. **Severity: HIGH.** See the [2026-11-10 restart-recovery audit](2026-11-10_18-44-49_restart-recovery-audit.md).

EventBus events receive random UUIDs and timestamps, not a monotonic per-session sequence. Journal serialization adds schema/identity metadata but no sequence, previous-record digest or committed manifest. `readJournalRecords()` checks encoding, JSONL shape, duplicate IDs and resource bounds, but cannot detect a whole valid line removed from the middle of a file. A three-record session A/B/C with B deleted can therefore read successfully as A/C. Domain checks may catch some missing order/fill facts, but not every missing pause or cycle transition. Add a regression that removes a complete middle record. The authoritative recovery store should use a global monotonic sequence across restarts and a verifiable integrity chain or committed manifest linking rotated session sequence ranges; legacy records without completeness evidence require external reconciliation and cannot be presumed complete.

## F-043 — Recovery projector silently ignores recorded safety-failure events

**Status:** CONFIRMED recovery-projection gap; current runtime replay is disabled. **Severity: HIGH.** See the [2026-11-10 restart-recovery audit](2026-11-10_18-44-49_restart-recovery-audit.md).

`HARVESTER_EVENT_NAMES` includes `execution.unowned_order`, `execution.invalid_fill`, `execution.accounting_failed`, `execution.duplicate_fill`, and `broker.execution_report`. The engine publishes these for ownership, invalid-fill, accounting and duplicate-fill conditions. `projectHarvesterJournalRecovery()` recognizes only a subset and silently continues for every other name (`if (!Object.values(EVENT).includes(name)) continue`); it does not classify known diagnostic events separately from unknown Harvester events. If a safety-failure event is recorded but its separate `strategy.paused` event is absent, the projector can ignore the failure and restore no sticky blocker. Add regressions proving unowned-order, invalid-fill and accounting-failure events block even without a pause event; unknown Harvester events must fail closed. Use an explicit versioned event registry separating authoritative facts, sticky safety blockers and diagnostic-only events.

## F-044 — Normal reconnect snapshots are rejected by the recovery projector

**Status:** CONFIRMED DTO/projector compatibility defect. **Severity: HIGH.** See the [2026-11-10 restart-recovery audit](2026-11-10_18-44-49_restart-recovery-audit.md).

The account-snapshot and account-open-orders DTO mappers both accept phase RECOVERY. The same-process recovery handler publishes both snapshot types with that phase during normal broker recovery. However, the recovery projector accepts only PREFLIGHT/OPENING/CLOSING for account snapshots and only OPENING/PREFLIGHT for open-order snapshots. A normal reconnect session therefore fails restart projection with an invalid phase. Add an offline Journal projection test containing PREFLIGHT, RECOVERY account snapshot, RECOVERY open-order snapshot and CLOSING records. Explicitly support RECOVERY and define its chronology/ownership semantics; do not skip the records.

## F-045 — Shutdown can finish with stale recovery SELL coverage

**Status:** CONFIRMED shutdown lifecycle gap. **Severity: HIGH.** **Tracking:** [#1097](https://github.com/45s/coinzilla/issues/1097). See [2026-11-12/13 LIVE session audit](../sessions/AUDIT_SESSION_2026-11-12_19-27-13Z.md).

Shutdown began at 03:51:04.844Z. A 20 WLD BUY and a 30 ADA BUY filled after the stopped flag was set. The order-event workflow returns at its isStopping guard before recovery-SELL cancellation/recalculation. The shutdown handler reconciles before selecting still-active BUYs for cancellation; a BUY that becomes FILLED in that window is no longer cancellable. The existing recovery SELLs remained last-observed OPEN at 219.9 WLD and 359.9 ADA, while the final active positions required 239.9 WLD and 389.9 ADA after keepQuantity. The CLOSING snapshot still reported COMPLETE with no audit reasons. The CLOSING audit allows open SELLs but does not verify that their quantity/proceeds cover the final Position and RecoveryLedger. Add a deterministic offline shutdown-race regression and make the close policy explicit: reconcile/replan the SELL or fail CLOSING with an actionable unresolved-recovery reason.

## F-046 — ADAFDUSD was enabled at runtime while disabled in the tracked config

**Status:** CONFIRMED runtime/config provenance mismatch; exact override source UNKNOWN. **Severity: HIGH.** See [2026-11-12/13 LIVE session audit](../sessions/AUDIT_SESSION_2026-11-12_19-27-13Z.md).

The runtime validated and traded ADAFDUSD. The tracked strategy config at the runtime commit 2238e3f8 has ADAFDUSD disabled. The process metadata reports a dirty working tree, but no working-tree diff or full effective-config snapshot was supplied. An uncommitted local edit or external override may explain the difference; the supplied evidence cannot distinguish them. Before another LIVE run, identify the actual change and persist an effective-config snapshot/digest in the run evidence.

## F-047 — Same-symbol external WLDFDUSD orders coexisted with strategy orders

**Status:** OBSERVED current-policy/roadmap gap; no external fill or accounting mismatch proven. **Severity: MEDIUM.** See [2026-11-12/13 LIVE session audit](../sessions/AUDIT_SESSION_2026-11-12_19-27-13Z.md) and roadmap P0.1.

PREFLIGHT found four unowned WLDFDUSD BUY orders. The runtime pair policy was IGNORE, so Harvester left them untouched but still submitted and filled WLDFDUSD strategy orders while they remained open. The four external orders were later reported cancelled as unowned events. This matches the configured IGNORE policy but demonstrates that the planned same-symbol external-order gate remains incomplete. Keep external orders unowned and untouched; block only the affected symbol when the P0.1 acceptance rule is implemented.

## 2026-11-13 LIVE session findings addendum

The following findings are derived from a separate supplied session. Full evidence and the exact order/fill ledger are in [the 2026-11-13 session audit](../sessions/AUDIT_SESSION_2026-11-13_15-50-59Z.md) and [ledger](../sessions/AUDIT_SESSION_2026-11-13_15-50-59Z_ORDER_FILL_LEDGER.md). Do not merge this session with the distinct 2026-11-12/13 incident session.

### F-048 — Separate session did not reproduce the shutdown recovery SELL race

**Status:** NOT REPRODUCED in this session; prior F-045 / #1097 remains CONFIRMED and OPEN. **Severity:** Informational.

No new `execution.fill_applied` event occurred after shutdown began at 19:42:26.967Z; the last new applied fill was at 19:03:52.940Z. During shutdown reconciliation, 180 prior fill notifications were recorded as duplicates and the accounting traces show `applied: false`, `duplicate: true`, and zero accounting delta. The final active strategy quantity and outstanding recovery amount were zero. This is positive session evidence, not a source fix, test of the stopping-flag race, or closure of #1097.

### F-049 — Telegram fill-notification delivery failures

**Status:** CONFIRMED. **Severity:** Medium (operational observability). **Tracking:** [#1103](https://github.com/45s/coinzilla/issues/1103).

Two Telegram delivery attempts for `fill.received` failed with `fetch failed` at 16:12:19.530Z and 16:15:35.126Z. Final counters were 254 accepted, 252 delivered, 2 failed, 0 overflow and 0 pending. The underlying transport failure is confirmed; its network/API root cause is UNKNOWN. No trading/accounting failure is evidenced.

### F-050 — Local stale-book submission deferral lacks an explicit Journal outcome

**Status:** CONFIRMED evidence gap. **Severity:** Medium. **Tracking:** [#1104](https://github.com/45s/coinzilla/issues/1104).

LINKFDUSD SELL client `h-fa576fd67e08430298f142-24` has a durable `order.submission_requested` at 16:12:15.928Z. Evaluation 116 later returned `deferred: true`, `deferralReason: MARKET_BOOK_STALE`, and no submitted orders. A later evaluation created client `...-26`, which was acknowledged as broker order `616704528`. This is a local pre-submission deferral, not an ambiguous exchange outcome. The Journal lacks an explicit terminal deferral event for the original request.

### F-051 — Shutdown phase timing gap

**Status:** UNVERIFIED. **Severity:** Low / investigation. **Tracking:** [#1105](https://github.com/45s/coinzilla/issues/1105).

The application log records shutdown started at 19:42:26.967Z; the first visible shutdown-reconciliation execution processing appears at 19:44:35.014Z, a 128.047-second interval. Available evidence does not identify the cause. Do not attribute it to a broker request, lock, queue or timer without further instrumentation.

**Follow-up — PR #1120:** Monotonic phase instrumentation now records shutdown request, operator-control cleanup, stop-state establishment, market-work drain, reconciliation, BUY cancellation, user-data drain, recovery SELL repair, CLOSING audit, Journal durability barrier, broker disconnect and process-stop durability. The original 128.047-second interval remains **UNKNOWN**: the original raw log, trace and Journal artifacts were not available in the repository or searched Library sources during this follow-up; the preserved audit report and source hashes do not identify which phase consumed the interval. No historical cause is assigned.

### F-052 — Effective configuration evidence absent with dirty runtime provenance

**Status:** CONFIRMED evidence gap; no enabled-market mismatch proven in this session. **Severity:** High (configuration integrity). **Tracking:** [#1101](https://github.com/45s/coinzilla/issues/1101).

Runtime provenance reports `workingTree: dirty`. Enabled markets and effective pair settings are visible in logs, but no sanitized effective-config snapshot or deterministic digest is recorded. The historical cause of the earlier ADAFDUSD configuration mismatch remains UNKNOWN; this session does not prove a new mismatch. A dirty working-tree flag alone cannot distinguish local modifications, environment overrides or configuration composition.

### F-053 — Same-symbol external-order policy remains unexercised

**Status:** UNVERIFIED collision behavior in this session; configured policy CONFIRMED. **Severity:** Medium. **Tracking:** [#1102](https://github.com/45s/coinzilla/issues/1102).

All four enabled pair configurations record `externalOrdersPolicy: ignore`. PREFLIGHT found zero account-wide open orders, so no external-order collision occurred in this session. This does not close prior F-047: four unowned WLDFDUSD BUY orders coexisted with Harvester WLD strategy activity in the separate 2026-11-12/13 audit. Manual orders must remain unowned and untouched; the same-symbol blocking policy remains separate work.

