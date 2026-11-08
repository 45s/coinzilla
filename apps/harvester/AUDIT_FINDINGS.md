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

**Status:** The earlier multi-document conflict is superseded by the owner-approved canonical contract. The sole current rule authority is [CONSERVATIVE_DOMAIN_SPECIFICATION.md](./docs/domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md). Old maker-only fee, residual-suppression, portfolio completion, and zero-value statements preserved in historical records must not be used as current policy.

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

Both files end with a newline and their checksums match #645. The logs were parsed; key source-line ranges and derived findings are preserved in [AUDIT_LOG_EVIDENCE_2026-11-06.md](./AUDIT_LOG_EVIDENCE_2026-11-06.md). The ZRO Portfolio/RecoveryLedger transition is directly observed. DOGE order 1276698 is OPEN/zero-executed at the final runtime evaluations and absent from the 12 shutdown execution records, which favors open/unfilled, but exchange order history separately reports FILLED. Therefore log integrity/parsing passes while DOGE terminal-state and complete CLOSING-order reconciliation remain unresolved.

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

Owner decisions are closed and recorded in the canonical Conservative specification. This old decision checklist is retained only as history. Current rules and acceptance requirements are defined exclusively in [CONSERVATIVE_DOMAIN_SPECIFICATION.md](./docs/domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md).

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

Trace lines 4551–4563 record canonical SELL trade 11666/order 727904 applied exactly once, Portfolio active quantity 0.05 ZRO and quote cash flow +0.01136454 USDT, RecoveryLedger proceeds 64.03136454 USDT and outstanding 0, followed by eligible completion allocating 0.01 ZRO free, retaining 0.04 active residual, and resetting cycle totals. The following evaluation retains active 0.04/free 0.01/total 0.05. This directly establishes the runtime state previously inferred from Journal and arithmetic. It does not establish full account settlement or TESTNET acceptance. Full detail: [log evidence addendum](./AUDIT_LOG_EVIDENCE_2026-11-06.md).


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


**Priority correction (2026-11-06):** This finding is retained only as a future roadmap note. Do not implement restart recovery during the current audit. The active work is Conservative strategy/policy correctness, residual sell-through, actual commission accounting, exact `keepQuantity`, exchange filters/dust, and order lifecycle regression coverage. See the final Deferred section in `ROADMAP.md`.


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
- **Verdict:** CONFIRMED; implementation fix verified by PR #673 CI on code/test head `aa9196fb8b9121a95d0a566fbc2fc7585408bd3c`; TESTNET acceptance remains pending.
- **Evidence:** 2026-11-08 Journal events #266, #269–270, #285, #288–289, and #397–399; DEBUG lines 9307, 9351, 9362, 9398–9400, 9470, 9699–9703; TRACE lines 10942–10943, 11005–11006, 11024–11026, 11080–11084, 11186–11187, 11489–11498. Original artifact hashes and full parsed evidence are in [AUDIT_SESSION_2026-11-08.md](./AUDIT_SESSION_2026-11-08.md).
- **Expected contract:** no order submission, cancellation, replacement, or retry while authoritative user-data recovery is unresolved; queued execution facts may be reconciled, and any required strategy evaluation must be retained until the broker recovery acknowledgement reopens readiness.
- **Observed:** after transport reported `recovered`, DOGE BUY trade 231208 and ZRO BUY trade 12374 were applied exactly once. Their subsequent duplicate/replayed execution events were processed through the normal engine path. That path requested cancellation of owned recovery SELLs 1323350 (797 DOGE) and 749343 (24.94 ZRO) while the broker still rejected order changes because the user-data stream was unavailable. Both cancellations became UNKNOWN/UNCONFIRMED, both markets paused, and application recovery failed at 03:23:00.631Z.
- **Root cause 1:** bootstrap did not pass the engine's existing `recoveryMode` option to queued user-data order-event processing.
- **Root cause 2:** recovery-mode terminal order events could return `reevaluate: true` without adding the affected symbol to `state.deferredEvaluations`; bootstrap correctly suppressed normal evaluation while reconciliation was pending, but the required evaluation could then be lost.
- **Impact:** trading remained blocked for the rest of the session. CLOSING audit reported `UNRESOLVED_OWNED_ORDERS:2` and `USER_DATA_OR_ACCOUNTING_RECONCILIATION_INCOMPLETE`; shutdown failed closed and retained the process lock.
- **Fix:** PR #673 passes recovery mode based on the reconciliation gate/active recovery task and exposes that context to the observer callback; recovery-mode terminal events retain a deferred strategy evaluation for the existing post-acknowledgement resume path. Durable reconciliation, exact-once accounting, stale-generation protection, and fail-closed readiness remain unchanged.
- **Regression tests:** bootstrap recovery-mode classification and engine deferred-evaluation retention. Both were observed RED on test-only PR head `4368c5d65651b55dd5c34bea619ca6b99160264d`: actual `undefined` vs expected `true`, and actual `[]` vs expected `["DOGEUSDT"]`. Exact-head GREEN/CI verification remains pending.
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

## F-016 — Harvester recovery REST wrappers discard original broker error context

- **Severity:** Medium — production diagnostic and incident-triage impact; current recovery behavior remains fail-closed.
- **Verdict:** CONFIRMED source-level behavior.
- **Reproduction:** a broker REST method returns `{ ok: false, errors: [typedBrokerError] }` during account snapshot or owned-order reconciliation.
- **Actual behavior:** `createAccountSnapshotManager.refreshAccountSnapshot()` creates a new generic `Error` from the broker error message without a `cause`. `collectOwnedOrderSnapshots()` similarly creates generic errors for failed open-order, canonical-order-history, and fill-history results; the fill-history path can discard the original broker error message entirely. The application recovery handler logs only the wrapper's `errorName`, `errorMessage`, and `errorStack`, so the original typed error class, stack, and cause are not available in the structured recovery diagnostic.
- **Expected behavior:** preserve the original broker Error as the wrapper's native `cause`, retain existing outer contextual messages, and pass the Error object as structured log data. The shared logger already serializes native Error cause/stack recursively; no new logger or logging file is needed.
- **Impact:** a transient RPC timeout can become indistinguishable from malformed/missing REST data, reducing diagnostic quality and making failure classification harder. This does not currently authorize trading or acknowledge recovery prematurely.
- **Relevant locations:** `src/bootstrap/account/create-account-snapshot-manager.js`; `src/use-cases/conservative-trading-engine.js`; `src/bootstrap/user-data/create-user-data-recovery-handler.js`.
- **Test-first regressions added:** account snapshot and account-wide open-orders wrappers must retain the exact broker Error as native `cause`; owned-order open-orders, canonical-history, and fill-history wrappers must do the same; the recovery failure log must include the Error object so the shared logger can serialize its recursive cause. These tests are on `fix/harvester/preserve-rest-error-causes`; expected-RED CI verification is pending. Production source is unchanged.
- **TDD RED evidence:** exact test-only head `918a3a6644c92cbe089919874177cba7b8193249` ran 758 Harvester tests: 752 passed and 6 failed. All six failures were the expected missing native `cause` or missing structured `error` field; no syntax/fixture failures occurred.
- **Implementation added and verified:** native `Error.cause` now carries the first broker Error through account snapshot, account-wide open-orders, owned-order open-orders, canonical order-history, and fill-history wrappers. The application recovery log now includes the original contextual Error object while retaining existing flattened fields for compatibility. Existing messages and recovery/trading behavior are unchanged. PR #711 exact head `e68da711eb44bc64bfeb5b1e8027f1f0a19f58dc` passed Harvester unit tests 758/758, configured targeted tests 3/3, and all six required offline CI contexts. Workspace coverage passed; Harvester threshold enforcement is not configured. TESTNET integration was skipped.
- **Disposition:** COMPLETE — PR #711 merged into `develop` as `2a57a8e291bb54a2474df525a4cd20e8d51747e8`. Native broker Error causes and structured recovery Error objects are covered by exact-head passing tests. Existing retry/readiness/trading behavior is unchanged.

- **Related retry regression:** PR #688 adds an application-level account-wide open-orders timeout/retry case, passing on exact head `d52dad2347e8f9a76aa17b1f3def309e4d45f230` (Harvester unit tests 754/754; all six required offline CI contexts passed) and merged into `develop` as `a66e5f9114395fbc1ab776ccdffc55bdcb2a8f5a`. It proves the market remains blocked, no recovery audits or acknowledgement occur after the failed read, the task slot is released, the timeout message remains in the contextual wrapper, and a later reminder succeeds. It does **not** preserve the original typed broker Error as native `cause`; the F-016 diagnostic fix remains open.

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
- **Harvester-side regressions added:** the account snapshot manager test verifies a failed flush leaves the first published event intact and a retry publishes a distinct second event; the recovery-handler test verifies the gate stays closed, no open-orders audit or broker acknowledgement occurs, the task slot is released, and a later reminder completes the same generation with at-least-once audit publication. Exact-head verification is pending on `test/harvester/retry-after-transient-journal-flush`.
- **Disposition:** COMPLETE — Journal PR #714 and Harvester PR #716 are merged. The Journal package test proves transient sync retry preserves both event IDs; Harvester manager/recovery tests prove the first uncertain audit remains published, the gate stays closed with no acknowledgement, and a later reminder retries the same generation and completes the remaining durable audit. No Journal or Harvester production source changed. Do not deduplicate uncertain records or introduce another log file.

## F-019 — Multi-subscriber broker acknowledgement result can strand Harvester recovery

- **Severity:** Medium — conditional recovery liveness risk; fail-closed safety is preserved.
- **Verdict:** CONFIRMED contract interaction; requires multiple active local subscribers sharing one broker user-data session.
- **Actual behavior:** `UserDataSession.#acknowledgeRecovery(id)` marks the caller's subscriber acknowledged, then returns the global `completeRecoveryIfAcknowledged()` result. The first subscriber therefore receives `false` while other subscribers remain pending, despite its own acknowledgement having been recorded. Harvester currently interprets `false` as rejection, restores `requiresReconciliation=true`, and does not record its generation. When the final subscriber acknowledges, the broker emits `reconciled` and stops reminders, but Harvester does not clear its application gate from that status.
- **Impact:** Harvester can remain blocked indefinitely in a supported multi-subscriber session. This does not create an unsafe trading window. The current Harvester subscriber count is unverified; `start-harvester.js` was intentionally not inspected while under active refactoring. The liveness exposure is conditional on multiple local subscribers sharing one session.
- **Consumer-side second-disconnect proof:** complete in [PR #718](https://github.com/45s/coinzilla/pull/718), exact head `a28bd72585a8b9d7c50b883b980a185b99711f49`, merge `6236f49dca53a2938b016b52802f907c90611b44`. The end-to-end Harvester status/recovery composition test proves a second `connectionClosed` supersedes generation one, stale work publishes no audits or acknowledgement, and a later reminder reconciles/acknowledges only generation two. Harvester tests 761/761 and all six required offline contexts passed.
- **Disposition:** CROSS-DOMAIN REQUEST OPEN — [Brokers issue #702](https://github.com/45s/coinzilla/issues/702). The exact terminal broker `reconciled` notification count and per-subscriber acknowledgement result remain broker-owned. Do not patch the broker contract privately or reinterpret the boolean without owner coordination.
