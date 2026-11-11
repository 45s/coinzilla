# Harvester Roadmap

> **Living roadmap:** Current priorities and blockers are maintained at the top of this file. Historical audit and implementation records are preserved in [the roadmap history archive](./docs/audits/ROADMAP_HISTORY.md); do not append new session logs or historical evidence here.

## Process-restart recovery — small-step delivery plan (#654)

**Status: PLANNED — NOT IMPLEMENTED.** Restart restoration remains disabled. This plan is intentionally incremental: one small, reviewable PR per step, each with RED → GREEN tests and exact-head CI. Do not combine phases or enable recovery early.

**Scope for the first safe version:** one Harvester process, one enabled market, deterministic offline tests, and a controlled startup restore. Keep the existing trading/domain behavior unchanged unless a specific regression proves a correction is required. No Binance/LIVE operations are part of implementation verification; any TESTNET exercise requires a separately approved, bounded plan.

### Delivery sequence

1. **[x] Step 1 — Freeze the recovery contract (docs/design only; merged in PR #1003).**
   - **Accepted:** [ADR-0001 — Application-owned durable facts for process-restart recovery](./docs/architecture/decisions/0001-application-owned-recovery-facts.md) defines the authoritative append-only fact stream, global sequence and committed-head integrity, minimum durable fact set, acknowledgement/failure boundary, candidate-state projection, closed readiness gate, external-order policy, and legacy Journal treatment.
   - **Authority boundary:** the new application-owned durable-fact port is the future restart-recovery authority; Journal remains a separate operational observer. Existing mandatory Journal PREFLIGHT/CLOSING and pre-side-effect order/cancel barriers remain unchanged until a separately audited migration. Domain code remains independent of Journal/EventBus/storage.
   - **State model:** persist immutable execution/order/cycle/control facts; derive Portfolio, Position, RecoveryLedger, active/free inventory, and reservations through the existing canonical accounting workflow rather than persisting competing mutable totals.
   - **Legacy boundary:** existing Journal sessions are forensic evidence, not automatically trusted complete history. A one-time baseline requires explicit operator-assisted reconciliation; unknown market-universe or retention coverage remains a hard blocker.
   - **Scope:** this is a documentation/design decision only. No runtime source, tests, configuration, exchange behavior, or restart readiness changed. PR #1003 is merged; Step 2 is the next implementation-preparation item.

2. **[ ] Step 2 — Build a deterministic recovery test harness (tests only).**
   - Create representative multi-session fixtures from real DTO shapes, without changing production behavior.
   - Add crash-point scenarios around order intent, broker acknowledgement, partial/final fill, accounting application, cycle completion, and pause/blocker publication.
   - Make every scenario assert the complete restored state, not only total wallet quantity.

3. **[ ] Step 3 — Assess legacy Journal sessions and ordering deterministically (F-035, F-040).**
   - Recursively discover nested process-session directories and preserve legacy flat-file compatibility for forensic review and any explicitly approved one-time baseline assessment.
   - Use explicit durable chronology where available; never use random session IDs or second-resolution filenames as ordering authority.
   - Reject missing, unreadable, duplicated, or ambiguously ordered sessions; never interpret an incomplete scan as an empty history.
   - Do not promote legacy Journal records to authoritative restart state merely because discovery and parsing succeed; apply the baseline/reconciliation rules in ADR-0001.

4. **[ ] Step 4 — Make replay understand every relevant fact (F-043, F-044).**
   - Classify known events as state facts, sticky safety blockers, or explicitly ignorable diagnostics; unknown stateful/safety events fail closed.
   - Accept and correctly order valid `RECOVERY` account/open-order snapshots emitted by normal reconnect handling.
   - Add DTO → projection → restore parity tests for every recovery-relevant event.

5. **[ ] Step 5 — Preserve accounting facts exactly (F-038, F-039, F-041).**
   - Restore Position cost basis and RecoveryLedger atomically, with exact active/free inventory allocation.
   - Preserve third-asset commission amount, asset identity, and historical quote valuation end to end; reconcile the related asset balance.
   - Represent cycle completion explicitly. A full SELL without a proven completed/not-completed cycle outcome is unresolved and must not silently restore stale basis or re-sell retained inventory.

6. **[ ] Step 6 — Add verifiable durable-fact integrity (F-037, F-042).**
   - Implement the smallest durable store/port needed by the agreed contract, with explicit durability acknowledgement before dependent state transitions proceed.
   - Detect missing/reordered/duplicated records using a monotonic sequence and a simple integrity mechanism (for example, a previous-record digest or committed manifest).
   - Do not claim legacy Journal files are complete when they lack integrity evidence; require reconciliation or operator resolution for ambiguous history.

7. **[ ] Step 7 — Reconcile one market against the exchange (F-036 and existing history gaps).**
   - Reconcile owned order identity/status, complete execution history, all relevant asset balances (including fee assets), locked funds, and current open orders.
   - Keep external orders unowned and untouched; detect and block only actual unsafe conflicts or unowned executions according to the agreed policy.
   - Treat incomplete exchange history, missing assets, mismatched quantities, unknown outcomes, and unexplained commitments as unresolved—not as zero.

8. **[ ] Step 8 — Restore behind a closed readiness gate.**
   - Project durable facts deterministically and idempotently into a candidate state; validate all domain invariants before publishing it.
   - Compare candidate state with authoritative exchange state. Publish READY only after every required reconciliation and safety check succeeds.
   - On any ambiguity, keep trading paused and provide actionable operator diagnostics. Never auto-adopt or auto-cancel external orders.

9. **[ ] Step 9 — Prove crash/restart behavior, then consider controlled TESTNET validation.**
   - Run the full crash-point matrix, duplicate/reordered event tests, missing-record/session tests, legacy-session tests, and restart-twice idempotency tests.
   - Verify no duplicate order, fill, reservation, cost-basis reset, or retained-inventory sale.
   - Review evidence and approve a separate small, bounded TESTNET plan before any exchange-connected validation. Live trading remains out of scope.

### Finding-to-step map

- F-035 → Step 3 (session discovery)
- F-036 → Steps 1 and 7 (external-order policy and reconciliation; not a blanket startup gate)
- F-037 → Steps 1 and 6 (durability contract)
- F-038 → Step 5 (atomic accounting restore)
- F-039 → Steps 5 and 7 (third-asset fee valuation and balance reconciliation)
- F-040 → Step 3 (chronological session ordering)
- F-041 → Step 5 (explicit cycle outcome)
- F-042 → Step 6 (record completeness/integrity)
- F-043 → Step 4 (event classification and sticky blockers)
- F-044 → Step 4 (RECOVERY snapshot parity)

**Implementation rule:** complete one numbered step, review its diff, run its focused RED/GREEN tests and required CI, update this checklist, then start the next step. No broad recovery rewrite, no speculative framework, and no enabling restart restoration until Step 9 is accepted.

---

## Conservative strategy correctness — prioritized fix plan (2026-11-11)

> **Status: PLANNED — findings require implementation and exact-head verification.** Scope: `apps/harvester`, Conservative strategy only. Financial correctness takes priority over trading availability. One behavior/invariant per PR; RED regression first, minimal GREEN correction second; focused tests and required CI on the exact final PR head. No Binance connection or TESTNET/LIVE operation is part of these steps. Do not enable unattended restart/resumption before its separate recovery gate is complete.

### Implementation order

1. **P0 — Prevent competing same-symbol orders when an external order is open** — [#985](https://github.com/45s/coinzilla/issues/985).
2. **P0 — Preserve exact fill accounting and commission valuation**, especially third-asset commissions and live/DTO/replay parity — [#654](https://github.com/45s/coinzilla/issues/654), finding F-039.
3. **P0 — Prove recovery SELL lifecycle and cycle completion** under partial fills, cancel/fill races, UNKNOWN outcomes and missing durable completion facts — [#654](https://github.com/45s/coinzilla/issues/654), finding F-041.
4. **P1 — Close residual quantity/notional/dust boundaries** and prevent unchanged invalid-order retry loops.
5. **P0 before unattended restart — Complete durable restore and exchange reconciliation** — [#654](https://github.com/45s/coinzilla/issues/654), umbrella [#626](https://github.com/45s/coinzilla/issues/626). This is a separate release gate; it does not authorize early resumption.

---

### P0.1 — Block new strategy orders when an unowned external order is open on the same symbol

**Problem:** the owned OrderRegistry is not the account-wide open-order set. A manually placed or otherwise unowned order can already be working while the strategy sees no owned order and submits a competing order. External orders must remain unowned and untouched, but must be considered by the strategy's safety gate. This is a symbol-level conflict, not a reason to disable unrelated markets.

**Tracking:** [issue #985](https://github.com/45s/coinzilla/issues/985).

**Relevant code:** [conservative-trading-engine.js](./src/use-cases/conservative-trading-engine.js) (decision/order-intent gates); [create-account-snapshot-manager.js](./src/bootstrap/account/create-account-snapshot-manager.js) (authoritative account/open-order snapshot); [subscribe-to-user-data.js](./src/bootstrap/user-data/subscribe-to-user-data.js) (updates/reconnect). Inspect current tests before adding coverage.

**Steps:**

1. [~] **RED — Reproduce conflict (test-only stage, PR [#987](https://github.com/45s/coinzilla/pull/987)):** deterministic manager and Conservative-engine regressions now express the same-symbol block and unrelated-symbol control. On PR head `0fcc159e8bf0d75cc7aa6d329507da3ffe9d2c29`, CI fails at the intended missing behavior: the snapshot manager has no symbol-query API and the engine submits one competing order. This is RED evidence only; it is not a passing test or production fix.
2. [ ] **GREEN — Add narrow symbol gate:** use a current authoritative account-wide open-order view; defer only the affected symbol while a conflicting unowned order is open. Never adopt, cancel, modify or claim ownership of it.
3. [ ] **RED/GREEN — Snapshot lifecycle:** startup snapshot, order update/terminal event, reconnect refresh, stale/missing snapshot and snapshot-read failure. Unknown/stale state must not mean “no open orders”.
4. [ ] **Regression — Isolation/diagnostics:** no duplicate intent; external order unchanged; unrelated symbols unaffected; actionable blocked-symbol reason.

**Current status (2026-11-11):** [#985](https://github.com/45s/coinzilla/issues/985) remains open. [PR #987](https://github.com/45s/coinzilla/pull/987) is open and currently contains only the two unit-test changes above; it does not yet contain the production guard, startup/reconnect integration coverage, or removal of the unused `blockOnExistingOrders` argument. Harvester unit tests and coverage are red on the expected new regressions; no required-green or merge claim is made. Continue with the smallest source fix, then add authoritative startup/reconnect lifecycle coverage before marking this item complete.

**Acceptance:** no conflicting same-symbol order can be submitted while an unowned order is open; external orders stay untouched/unowned; unrelated symbols remain independent; inability to establish current open-order state fails closed for that decision.

---

### P0.2 — Preserve exact commission facts and quote valuation through fill accounting

**Problem:** live commission validation supports third-asset commissions when historical quote valuation is supplied, but the lifecycle fill DTO drops `quoteValue` and the restore helper rejects third-asset commissions. The configured-market-only account snapshot filter can omit the commission asset. A fill accepted live must remain reconstructable and reconcilable. Missing valuation must never silently become a zero fee or be recomputed from today's price.

**Tracking:** [#654](https://github.com/45s/coinzilla/issues/654), forensic finding F-039. Keep live-accounting correction and durable-recovery integration as separate PRs if their contracts differ.

**Relevant code:** [position-accounting.js](./src/domain/portfolio/position-accounting.js) (Position cost/proceeds); [recovery-fill-accounting.js](./src/domain/strategies/conservative/recovery-fill-accounting.js); [lifecycle-event-dtos.js](./src/application/events/lifecycle-event-dtos.js) (safe DTO); [create-portfolio-workflow.js](./src/use-cases/create-portfolio-workflow.js) (live apply/restore); [create-account-snapshot-manager.js](./src/bootstrap/account/create-account-snapshot-manager.js) (fee-asset reconciliation).

**Steps:**

1. [x] **RED — Third-asset DTO round-trip:** canonical fill has commission asset different from base and quote, exact commission amount and historical quoteValue. Assert serialization/deserialization preserves every field exactly; expose current quoteValue loss.
2. [x] **GREEN — Preserve valuation in safe DTO:** extend only the relevant DTO schema/mapping/validation. Keep decimal representation exact; never substitute current market price for historical valuation.
3. [ ] **RED — Live BUY/SELL accounting:** assert quote-denominated cost/proceeds for base-, quote- and third-asset fees; include multiple and partial fills. Verify fee amount, asset and valuation.
4. [ ] **GREEN — One canonical accounting path:** use existing domain accounting; no parallel fee calculator. Missing, malformed, negative or contradictory valuation fails closed, without treating fee as zero.
5. [x] **RED — Fee-asset balance:** commission asset is not a configured trading pair. Regression proves the current snapshot/reconciliation path misses its debit and accepts an unexplained balance movement.
6. [x] **GREEN — Include required fee assets:** persist a targeted `COMMISSION_BASELINE` only for a non-zero third-asset commission actually used. Keep unrelated wallet assets excluded; compare the exact fee debit and preserve the fee asset's pre-existing locked balance.
7. [x] **Parity — Live versus DTO/projection/restore:** exact BUY/SELL fills with base-, quote- and third-asset commissions now produce identical complete Position and RecoveryLedger values through live accounting and DTO → projection → offline restore.
8. [x] **Atomicity — Invalid fee evidence:** missing historical valuation and contradictory commission/valuation asset identities fail before either immutable accounting projection is committed; regressions compare complete pre-fill Portfolio and RecoveryLedger snapshots.

**Implementation update — PR #990:** the DTO → journal projection → offline restore segment is implemented test-first. The original test-only RED PR #989 reproduced three failures (DTO valuation loss, projection valuation loss, and third-asset restore rejection) and was closed as superseded after the roadmap update merged. PR #990 preserves the exact third-asset commission amount/asset ID/code and historical quoteValue amount/quote-asset ID/code; it rejects missing valuation for non-zero third-asset fees, non-positive valuation for non-zero fees, contradictory asset identity, and valuation in the wrong quote asset. Zero-amount third-asset commission entries remain valid without an invented quote valuation. The projector retains exact decimal strings. Restoration rebuilds a canonical Commission with the original fee Asset and historical quoteValue; legacy positive third-asset records without quoteValue fail closed. BUY restoration regression verifies Position spent/quote cash flow and RecoveryLedger buyCost include the exact historical valuation. Exact-head CI at `289fb39981b6f496c6f3efabdb315ea5d9c8ecbc`: Harvester 942 passed/0 failed; all package unit tests, targeted tests, JavaScript syntax, dependency audit, coverage workflow and external documentation links passed. No Binance/TESTNET/LIVE operations were performed.

**Implementation update — PR #995:** targeted fee-asset reconciliation is implemented test-first. The RED regressions demonstrated that an unconfigured BNB debit was not included in the audit delta and that an unexplained BNB balance movement could pass. The account snapshot manager now retains the original PREFLIGHT balances in memory and writes a separate `COMMISSION_BASELINE` event only for a third-asset commission actually applied; unrelated assets remain excluded. `createPortfolioWorkflow` requests the baseline before committing the fill's Portfolio/RecoveryLedger projections. Journal remains optional: baseline persistence failure does not block valid fill accounting, but `auditRecoveredAccountState()` fails closed when a required baseline is absent. The audit merges targeted baselines with PREFLIGHT, subtracts exact fee amounts, preserves existing locked fee-asset balances, compares only configured market assets plus actually charged fee assets, and requires the baseline event to precede the first applied fill. Tests cover exact BNB debit, unexplained movement, missing/late baseline, locked balance preservation, unrelated XRP exclusion, and non-blocking Journal failure. Harvester unit tests: 950 passed/0 failed at original implementation head `34ce098f543a58cbdb124710c45a9d61c54e9b04`; full package tests, targeted tests, JavaScript syntax, dependency audit and workspace coverage passed. Exact final PR-head CI is required after synchronizing this branch. No Binance/TESTNET/LIVE operations were performed.

**Implementation update — PR #1002:** completed the remaining live-accounting and parity gates test-first. The RED stage exposed two accepted-invalid-fact cases: a third-asset commission could reuse an asset ID with a different code, and a historical quote valuation could reuse the quote asset ID with a different code. The shared `validateFillCommissions()` path now validates ID/code identity consistently against market assets and across commission entries before Position or RecoveryLedger accounting. New regressions cover multiple BUY/SELL fills, multiple third-asset fee entries, exact historical quote values, and identical complete Position/RecoveryLedger state across live accounting and DTO → Journal projection → offline restore for base-, quote- and third-asset commissions. Invalid fee evidence is rejected atomically; complete pre-fill Portfolio and RecoveryLedger snapshots remain unchanged, and the live workflow does not persist a fee baseline for an invalid fill. Harvester tests passed 956/956 and all seven workflows (unit tests, workspace coverage, Harvester targeted tests, JavaScript syntax/actionlint, Utils tests, production dependency audit, and external documentation links) passed on tested head `8b1ea0259e3fe14113a99ca9088ba826bd18d2db`. The final documentation-only commit is also subject to exact-head CI before merge. No Binance/TESTNET/LIVE operations were performed.

**Acceptance:** every accepted fill retains exact commission asset, amount and historical quote valuation through supported lifecycle representations; live and replay results match; fee assets reconcile; unavailable valuation is an explicit unresolved safety condition, never zero.

---

### P0.3 — Prove recovery SELL accounting and cycle completion use reconciled fills

**Problem:** order status is not proof of financial recovery. Submitted, acknowledged, partial, canceled or UNKNOWN SELLs cannot complete a cycle. Cancellation can race with fills. A full SELL whose durable cycle outcome is missing can leave replay with stale cost basis or incorrect retained-inventory allocation. Preserve existing serialized transitions, fill reconciliation, minimum-profit checks, dust evidence and atomic Portfolio/RecoveryLedger completion; extend rather than replace them.

**Tracking:** [#654](https://github.com/45s/coinzilla/issues/654), finding F-041. Check the current [Domain Test Inventory](./docs/domain/DOMAIN_TEST_INVENTORY.md) before adding duplicate tests.

**Relevant code:** [conservative-trading-engine.js](./src/use-cases/conservative-trading-engine.js); [recovery-completion.js](./src/domain/strategies/conservative/recovery-completion.js); [recovery-ledger.js](./src/domain/strategies/conservative/recovery-ledger.js); [recovery-sell-plan.js](./src/domain/strategies/conservative/recovery-sell-plan.js); [position-accounting.js](./src/domain/portfolio/position-accounting.js); recovery projector/Journal replay paths under #654.

**Steps:**

1. [ ] **RED — Status is not completion:** SUBMITTED, NEW/OPEN, PARTIALLY_FILLED, canceled with residual, REJECTED and UNKNOWN must not reset Position basis or RecoveryLedger.
2. [ ] **GREEN — Fill-driven completion:** allow completion only after authoritative execution reconciliation and all domain preconditions pass.
3. [ ] **RED — Cancel/fill interleavings:** execution before/during/after cancel response; duplicate/delayed report; UNKNOWN cancel; stale terminal report. Each canonical fill once; replacement never overdraws.
4. [ ] **GREEN — Reconcile before replace/complete:** use existing serialized transition and authoritative reconciliation; never infer final remaining quantity from cancel response alone.
5. [ ] **RED — BUY during recovery SELL:** partial BUY while SELL is open, cancel race and replacement. Assert no conflicting commitments, oversell or premature cycle reset.
6. [ ] **GREEN — Preserve approved lifecycle policy:** make only the smallest correction supported by failing behavior; no blanket prohibition without evidence.
7. [ ] **RED — Missing cycle outcome:** replay a full SELL without explicit durable completed/not-completed outcome. Restore must not guess, reset basis or re-sell retained inventory.
8. [ ] **GREEN — Explicit outcome in projection:** persist/project the minimum cycle outcome required; unresolved full SELL fails closed. Preserve legitimate residual sell-through.
9. [ ] **RED/GREEN — Profit/inventory matrix:** exact minimum-profit equality and immediately below; keepQuantity zero/nonzero; fee-adjusted proceeds; retained quantity plus validated dust; residual sellable quantity; consecutive cycles.
10. [ ] **Atomicity regression:** Portfolio and RecoveryLedger either both complete the cycle or neither changes.

**Acceptance:** completion requires reconciled canonical fills, sufficient net recovery/profit and exact active/free/dust allocation. Unresolved orders or missing cycle outcome block the next cycle. Retained inventory cannot be sold accidentally.

---

### P1 — Prevent invalid residual orders and minimum-notional retry loops

**Problem:** after partial execution or filter changes, remaining quantity may fall below MIN_QTY/MIN_NOTIONAL although the original order was valid. Rebuilding the same invalid trailing BUY or recovery SELL repeatedly creates noise and can hide a lifecycle/accounting defect. Expected post-only rejection is not a fill and is not success.

**Relevant code:** [recovery-sell-plan.js](./src/domain/strategies/conservative/recovery-sell-plan.js); [conservative-trading-engine.js](./src/use-cases/conservative-trading-engine.js); confirm current order-filter validator path before editing. Existing boundary work: [PR #929](https://github.com/45s/coinzilla/pull/929), [#930](https://github.com/45s/coinzilla/pull/930), [#932](https://github.com/45s/coinzilla/pull/932).

**Steps:**

1. [ ] **RED — Residual below MIN_NOTIONAL:** valid SELL partially fills, remainder is immediately below current minimum. Assert no invalid replacement is emitted.
2. [ ] **GREEN — Classify residual first:** retain it as explicitly classified inventory/dust or unresolved safety state under the existing contract; never discard or call it recovered.
3. [ ] **RED/GREEN — Exact boundaries:** below/equal/above min quantity and notional; max quantity/notional; step/tick rounding for BUY and SELL.
4. [ ] **RED/GREEN — No unchanged retry loop:** repeated identical market updates with unchanged price/rules/inventory do not repeatedly submit the same invalid order. Retry only after a relevant input changes and the new plan validates.
5. [ ] **RED/GREEN — Rejection classification:** post-only/LIMIT_MAKER rejection is distinct from unexpected broker failure; it creates no fill, does not clear unresolved intent/reset recovery, and is never logged as successful execution.
6. [ ] **Regression — Quantity conservation:** active, retained and dust quantities remain accounted for after every skipped/invalid replacement decision.

**Acceptance:** no invalid exchange order, no repeated identical invalid retry, residual inventory remains explicitly accounted for, and expected rejection never mutates fill/accounting state.

---

### P0 release gate — Complete restart restore and exchange reconciliation before unattended resumption

**Problem:** runtime startup currently creates fresh in-memory Position, RecoveryLedger and OrderRegistry; the offline restore path is not wired into runtime. Historical fills, fee valuations, unresolved intents and sticky blockers are not yet proven to survive restart. A fresh process with empty memory is not evidence of an empty exchange position.

**Tracking:** [#654](https://github.com/45s/coinzilla/issues/654), umbrella [#626](https://github.com/45s/coinzilla/issues/626).

**Detailed nine-step plan:** see “Process-restart recovery — small-step delivery plan (#654)” at the top of this roadmap. Its Step 5 and Step 7 depend on the commission work above: preserve third-asset valuation and reconcile its asset balance. Keep domain pure and Journal observer-only unless a deliberate contract decision changes that boundary.

**Acceptance before enabling restore:** complete chronological durable facts; exact DTO → projection → restore parity; explicit cycle outcomes; sticky blockers; all relevant balances/fees and owned orders reconciled; external orders remain unowned/untouched; ambiguous or missing history keeps readiness closed; crash/restart matrix and restart-twice idempotency pass. No exchange-connected validation without a separately approved bounded plan.

### Cross-step review checklist

- [ ] Confirm exact source path and existing test coverage before editing; roadmap paths are navigation aids, not proof.
- [ ] Identify authoritative domain fact/owner before adding state or abstractions.
- [ ] Add one narrowly scoped failing regression; record RED on exact test-only head.
- [ ] Implement minimal correction; record GREEN on exact final head.
- [ ] Assert complete immutable snapshots on failure paths, not just return values/logs.
- [ ] Run focused tests, full Harvester suite, required repository CI and relevant package coverage.
- [ ] Inspect final diff for unrelated refactors, config changes and unintended behavior.
- [ ] Update roadmap and linked issue with merged PR, exact merge SHA and verified test/CI evidence.
- [ ] Keep exchange-connected operations out of scope unless separately and explicitly authorized.

---

## Priority execution plan — current develop direction (2026-11-10)

### Critical runtime reliability — order acknowledgement and shutdown ownership (2026-11-10)

- [x] **Make incomplete-shutdown diagnostics actionable — PR [#977](https://github.com/45s/coinzilla/pull/977), merged as `597b01d3836d74d1c4a409005c844d76102e4a34`.** Preserve the pre-shutdown user-data status, report stage-specific reconciliation and cleanup failures, expose safe unresolved owned-order identities/quantities, and distinguish `SHUTDOWN_INCOMPLETE` from confirmed `STOPPED`. Existing fail-closed process-lock retention is unchanged. Exact-head verification: 935/935 Harvester tests; 75.83% line / 78.98% branch / 75.32% function coverage; all seven configured workflows passed. No exchange operations.

- [x] **Resolve UNKNOWN submissions from authoritative Binance NEW reports — issue [#962](https://github.com/45s/coinzilla/issues/962).** A matching exchange report carrying the original Harvester clientOrderId and assigned brokerOrderId is authoritative evidence that an ambiguous submission exists. Accept the first `UNKNOWN → OPEN` transition and attach the exchange ID; keep conflicting identities, stale terminal reports, and unresolved orders fail-closed. Regression coverage covers OrderRegistry and the Conservative engine.
- [x] **Prove shutdown cancellation after recovered acknowledgement.** The engine regression verifies that the recovered owned BUY is selected for cancellation using its exchange-assigned broker order ID. The existing runtime shutdown contract remains unchanged: reconcile before cancellation; cancel only acknowledged owned BUYs; keep user-data intake active for racing fills; reconcile again; preserve owned SELLs and external orders; and retain process locks when final reconciliation or the CLOSING audit is unresolved. No second cancellation pass or guessed broker ID.
- [x] **Report the actual exchange mode in startup status — issue [#963](https://github.com/45s/coinzilla/issues/963).** Pass the already validated `TRADING_MODE` value into user-data startup and use it for success and blocked-state messages. `NODE_ENV` must not select or relabel the exchange.
- **Broker dependency:** canonical Binance order placement requests `newOrderRespType: "RESULT"` to avoid the minimal default `ACK` for `LIMIT_MAKER`; broker-side implementation and documentation are tracked in [issue #960](https://github.com/45s/coinzilla/issues/960) and [PR #961](https://github.com/45s/coinzilla/pull/961).
- **Verification status:** all six required GitHub Actions workflows passed on synchronized PR #964 head `91d7d34f1b6c11e5a3b0513c91d974ffb93f977c`: workspace unit tests, workspace/package coverage, Harvester targeted tests, JavaScript syntax/actionlint, Utils tests and production dependency audit. The external documentation-links workflow was advisory and still running at merge. The read-only Binance TESTNET integration was skipped by workflow policy; no Binance TESTNET/LIVE connection or order mutation was performed. PR #964 merged at `ce7b5dfeddaaeed68f67ab8213520427b3777280`.

### In progress — domain logic test quality initiative

- [x] Establish the source-driven behavior-to-test inventory in [Domain Test Inventory](./docs/domain/DOMAIN_TEST_INVENTORY.md) — added and merged in PR #917.
- [~] Strengthen Conservative decision tests around blocked recovery SELLs before changing policy implementation; follow strict RED → GREEN → REFACTOR.
- [x] Conservative BUY-gating regression and correction merged in PR #917: a MAX_PRICE-blocked recovery SELL and PENDING/UNKNOWN recovery SELL prevent the next BUY; acknowledged OPEN/PARTIALLY_FILLED SELLs retain the approved coexistence behavior. Exact merged-head CI passed 872/872 Harvester tests and all required checks.
- [x] Conservative investment-cap equality and immediately-below boundary matrix merged in [PR #922](https://github.com/45s/coinzilla/pull/922). Exact PR head `8e234e2c18cb98b4b8562c62ef05d9f20f852102` passed 872/872 Harvester tests; coverage was 75.94% lines, 79.26% branches and 74.88% functions. All required CI checks passed.
- [x] Strengthen Portfolio multi-market isolation and conflicting-fill no-mutation assertions merged in [PR #924](https://github.com/45s/coinzilla/pull/924); exact-head CI passed.
- [x] Market trading-readiness quantity and minimum-notional boundary matrices merged in [PR #930](https://github.com/45s/coinzilla/pull/930); exact updated PR-head CI passed.
- [x] Exact inclusive pre-submission exchange-filter boundaries for MIN/MAX price, quantity and notional merged in [PR #932](https://github.com/45s/coinzilla/pull/932); existing immediately-outside rejection matrix retained.
- [x] Independent Conservative strategy fixture arithmetic merged in [PR #937](https://github.com/45s/coinzilla/pull/937); residual SELL quote totals and MAX_NOTIONAL expectations use independent exact values.
- [x] OrderRegistry complete-state and immutable-snapshot assertions merged in [PR #928](https://github.com/45s/coinzilla/pull/928); exact-head CI passed 874/874 Harvester tests.
- [x] Audit application-level Conservative engine coverage: 163 deterministic tests cover trailing BUY gates, stale/out-of-order events, serialized cancellation/fill races, retryable versus terminal failures and conflicting execution facts. No generation identity exists in the current contract; see Domain Test Inventory.
- [x] Extend OrderRegistry coverage for decreasing execution and stale timestamps; rejected reports preserve canonical state and commitment. Merged in [PR #927](https://github.com/45s/coinzilla/pull/927).
- [x] Precise account-snapshot failure classification, no partial result data and immutable input snapshots merged in [PR #931](https://github.com/45s/coinzilla/pull/931); exact-head CI passed 872/872 Harvester tests.
- [x] Cover equal broker trade IDs across different markets in the Conservative engine; the test harness deduplicates by canonical Fill ID. Merged in [PR #933](https://github.com/45s/coinzilla/pull/933).
- [x] Prove sequential Position inventory conservation across fee-adjusted BUYs, free allocation, a subsequent BUY and SELL commissions; also prove overdrawn SELL/commission and incomplete-commission failures preserve the complete Position snapshot. Merged in [PR #943](https://github.com/45s/coinzilla/pull/943); exact-head required CI passed, and all Position assertions include diagnostic failure messages.
- [x] Isolate exact exchange-filter equality boundaries with independent notionals and verify immutable market-readiness metadata. Merged in [PR #929](https://github.com/45s/coinzilla/pull/929) after all six required checks passed.
- [x] Complete focused offline test-quality PRs #943, #944, #947, #948 and #949. Exact-head required CI passed for each; see Domain Test Inventory for the 163-case application-level orchestration inventory and the explicit generation-isolation boundary.
- [x] Fix multiple UNKNOWN orders without broker IDs colliding during `OrderRegistry.applyUpdate()`; RED/GREEN regression and production correction merged in [PR #958](https://github.com/45s/coinzilla/pull/958), exact merged-head required CI passed (891/891 Harvester tests).
- [x] Reconcile account free balances with snapshot-relative total-Portfolio-base and active-order baselines — [issue #955](https://github.com/45s/coinzilla/issues/955), implemented in [PR #968](https://github.com/45s/coinzilla/pull/968) and merged as `dcb0b64ece84ea2f3a41f5a110e559a01797ac6d`. Snapshot baselines capture Portfolio quote cash flow, total base (active plus retained free), and active BUY/SELL commitments by shared asset ID. Allocation applies only post-snapshot deltas; pair investment and pair-owned active SELL inventory remain separate. The retained-free regression corrected an active-only baseline mistake. The expanded matrix covers pre/post-snapshot BUY and SELL locks, partial fills, shared quote/base assets, wallet shortfall, unpriced active MARKET BUY fail-closed behavior, terminal-order exclusion, and recovery event-sequence recapture. Exact final PR head `d0d52dddb8f3c8d9e73f9f6dc484c6b3987e22f2` passed 914/914 Harvester tests; coverage was 75.80% lines, 79.23% branches and 75.19% functions. All seven configured workflows and workspace package coverage passed. Read-only TESTNET integration was skipped; no exchange operation occurred. Issue #955 is closed.
- [x] Harden `allocateOrderCommitments()` against internally inconsistent inventory and commitment totals. Test-first regressions cover pair active inventory versus total Portfolio base, pair SELL commitments versus active inventory, pair commitments versus shared account aggregates, and aggregate SELL commitments versus total tracked base. The existing post-snapshot SELL-lock fixture is corrected to use a valid active/total inventory relationship without changing its expected balance result. RED was confirmed on exact PR #971 test-only head `74a1a9e22161a924d3f380f6842ee361f502ecae` (914 passed / 5 failed). Production validation now rejects the impossible relationships before action allocation. GREEN was confirmed on PR #971 implementation/test head `cd7b8bae666326453cc196ea20c5b52dabaf0043`: 920/920 Harvester tests; 76.03% lines, 79.41% branches and 75.19% functions; all seven configured workflows and workspace coverage passed. A further regression verifies post-snapshot partial BUY net-base credit (0.4 gross less 0.004 base commission = 0.396).
- [x] Make recovery-cycle completion atomic across Portfolio and RecoveryLedger. A failure in the final ledger reset must not leave retained-inventory allocation or cost-basis reset committed by itself. RED was confirmed on exact test-only PR #972 head `9b57ae42cb52f72003d95b50dc39715046d4da55` (920 passed / 1 failed). The implementation stages the next Portfolio and next RecoveryLedger map before assigning either reference. GREEN was confirmed on exact implementation/test head `5a020a8930a3c528d5ec9188a8725a48440dfa85`: 921/921 Harvester tests; 75.83% lines, 79.35% branches, 75.25% functions; all seven workflows and workspace coverage passed.
- [x] Guard `RecoveryLedger.resetCycle()` with the configured minimum-profit precondition and authoritative `Position.spent` quote Money. A direct domain caller cannot erase outstanding recovery capital, use a divergent legacy `buyCost` mirror, or reset below `minProfit`; fill identities survive. RED was confirmed test-first; GREEN passed on final PR #973 head after the full Harvester suite and all required CI workflows succeeded.
- [x] Keep journal replay identical to live completion: the durable event records configured `keepQuantity` and `minProfit`; replay validates the threshold and dust evidence, allocates every active coin as `keepQuantity + dust`, leaves no sellable active residual, resets `Position.spent` and RecoveryLedger totals together, and preserves cumulative quote cash flow and fill identities. Invalid or incomplete completion records fail closed. GREEN passed on final PR #973 head with full Harvester tests and all required CI workflows.
- **Scope boundary:** deterministic domain/application tests only. No Binance TESTNET/LIVE activity, no configuration changes, and no resumption or implementation changes for paused issue #626.

### Completed — per-session log directory layout (PR #874, 2026-11-10)

- [x] Group each process's DEBUG, TRACE, development terminal capture and Journal JSONL file under one UTC/session-ID directory.
- [x] Keep append-only cumulative DEBUG, TRACE and terminal histories under `logs/cumulative/`; keep process ownership locks under `~/.coinzilla/harvester/process-locks/`.
- [x] Preserve legacy flat log and Journal files in place; do not migrate, truncate or delete existing history. The Harvester balance-reconciliation CLI reads both legacy root-level Journal files and new session directories.
- [x] No Journal record schema, durability barrier, replay behavior or trading behavior changes. Journal filename-reader compatibility was completed separately in PR #880.

This section is the authoritative implementation order for current work. It supersedes older "current direction", P0/P1 and future-work notes below wherever their status or ordering conflicts. Historical incident records remain evidence, not active tasks. Harvester is the only application currently in this workspace.

### Completed — explicit Binance trading-mode propagation (PR #841)

- [x] Harvester reads and validates only `TRADING_MODE=testnet|live`, passes the resolved value explicitly through its Binance broker adapter, and supplies TESTNET explicitly in offline replay/test harnesses. `NODE_ENV` remains application runtime metadata and cannot select exchange endpoints. LIVE selection requires no second confirmation or enable flag.
- **Boundary:** this is endpoint-selection/configuration completion, not exchange acceptance or restart safety. Hosted read-only TESTNET acceptance remains externally blocked/unverified; process-restart reconciliation remains a separate critical issue tracked by [#654](https://github.com/45s/coinzilla/issues/654).

### CRITICAL — complete before unattended operation

1. **[x] Make Conservative trailing-BUY replacement failure-safe — PRs #751 and #753 merged.**
   - **Why:** the current replacement path can cancel the standing BUY before the replacement is known to be valid. If exchange-filter validation or submission then fails (including the observed `MIN_NOTIONAL` rejection), the market can be left without its intended standing order and repeated market ticks can repeat the failure.
   - **Do:** build the candidate replacement from a single fresh market/trading-rule snapshot; validate quantity, price, notional, precision, freshness and POST_ONLY constraints before canceling the existing order. Preserve the old order until the candidate is known to be admissible. Where exchange semantics require cancel-before-submit, represent the gap explicitly, pause/defer the pair on rejection or unknown outcome, and reconcile by canonical client order ID before retrying. Do not silently swallow validation callbacks.
   - **Verify:** add RED/GREEN regressions for below-min-notional candidates, stale book/price, cancel rejection, submit rejection, timeout/unknown acknowledgement, partial fills during replacement, and duplicate market ticks. Assert no duplicate order, no lost reservation, and no unbounded retry loop.
   - **Implementation in PR #751:** the serialized replacement transition now evaluates and allocates the exact replacement decision, constructs pending canonical orders, and runs the existing exchange-rule and post-only readiness validation before cancellation. Validation/readiness failure leaves the standing BUY registered and untouched. After confirmed cancellation, an uncertain or rejected replacement remains represented as UNKNOWN and the pair is paused for reconciliation.
   - **Regression coverage in PR #751:** production-path tests cover MIN_NOTIONAL, quantity and price increments, stale price and book data, unavailable and incomplete trading rules, cancellation failure, post-cancellation submission failure, repeated market events, and the existing valid Conservative replacement behavior. Verified on PR #751 head `d394b60271e858f376c4df4402df895cb7e5b7c4`: Harvester targeted tests, full Harvester suite (786/786), workspace package tests, workspace coverage, JavaScript syntax, dependency audit, Utils tests, and actionlint all passed. PR #751 was merged into `develop` as `8b35eb5b09234784c661213a52459ef325d210d2`.
   - **Current-rule refresh hardening in PR #753:** each trailing replacement now fetches exchange filters again before preflight; the Binance adapter no longer reuses a process-lifetime filter cache. The refreshed canonical market and TradingRules are used by both preflight and actual submission. Failed, incomplete, or mismatched refreshes pause the pair without canceling the standing BUY. Tests cover exchange-rule changes after startup and unavailable refresh responses.
   - **PR #753 verification:** exact head `0a15f5b94845fe703717374611e5a6784a3ed9b9` passed Harvester targeted tests, full Harvester suite (789/789), workspace package tests, workspace coverage, JavaScript syntax, dependency audit, Utils tests, and actionlint. PR #753 was merged into `develop` as `536c3b24cfd14e7538ea4e3e14aae37af862527b`.

2. **Close #626 recovery reliability with evidence, not assumptions.**
   - **Why:** reconnecting the transport is not the same as restoring application readiness. A premature READY transition can allow decisions against stale order/account state; a permanently closed gate harms liveness but is safer than trading on uncertain state.
   - **Do:** preserve generation/subscription fencing, queued user-data event handling, single-flight reconciliation, canonical order/fill history checks, and durable RECOVERY audit barriers. The F-032 diagnostic-only `rpcError` readiness and cause-aware error-deduplication behavior is already fixed in PR #824; do not reopen it without new evidence. Investigate only newly reproduced state-machine failures. Keep the gate closed on incomplete history, failed audit flush, stale acknowledgement, or conflicting state.
   - **Verify:** cover first and second disconnects, stale and current generations, diagnostic-only `rpcError` followed by an actual close, distinct empty-message error causes, preservation of an already unresolved gate and its status, contradictory/missing metadata, repeated reminders, queued BUY/SELL fills, multiple subscribers, history/API errors, Journal write failures and acknowledgement ordering. TESTNET acceptance remains **PAUSED / UNVERIFIED** after the regional HTTP 451 restriction; do not retry the same hosted path or claim exchange acceptance.
   - **Offline follow-up — F-033 (implemented and verified in PR #906):** permanent Journal write failures propagate as terminal recovery metadata; only a failed flush with explicit healthy-writer status remains retryable. Unclassified Journal health fails closed. The exact implementation head passed Harvester unit tests (870/870), workspace unit tests, coverage, JavaScript syntax, dependency audit, targeted tests, and process-lock checks. TESTNET acceptance remains separately PAUSED / UNVERIFIED.
   - **Offline follow-up — F-034 (implemented in PR #909):** failures from asynchronous recovery stages are applied only while the attempt generation remains current. A terminal account-snapshot failure arriving after a newer disconnect is logged with its original error and both generations, then discarded without poisoning the process-lifetime accounting latch; the latest generation must perform its own reconciliation and durable account/open-order audits before acknowledgement. PR #909 merged as `dc17f1f2c1fa6e45c08035ae6ae736eb821b90a5` (reconciled exact head `46de0a6f891deb9dc7d3960c7b36d1de0fe72eee`). Harvester unit tests passed (871/871); exact-head Harvester coverage was 75.98% lines, 79.32% branches, 74.85% functions. Workspace unit tests and coverage, configured Harvester regression tests, JavaScript syntax/policy/Markdown, external documentation links, dependency audit, actionlint and Utils tests also passed. TESTNET acceptance remains PAUSED / UNVERIFIED; the read-only TESTNET integration job and Harvester endpoint probe were skipped.
   - **Offline fix — PR #824:** diagnostic-only RPC errors preserve existing readiness/generation state; malformed and contradictory metadata remain fail-closed; error deduplication distinguishes cause/stack context. Test-first RED is confirmed; exact-head offline CI is recorded by the PR checks. TESTNET acceptance remains separately PAUSED / UNVERIFIED.

**Completed — [#774](https://github.com/45s/coinzilla/issues/774), [PR #786](https://github.com/45s/coinzilla/pull/786) merged:** the broker proves when cancellation was never sent; Harvester preserves the known canonical order state only for exact `NOT_SENT` on `ok: false`, publishes the lifecycle outcome, and keeps the pair safety-paused. Missing/ambiguous results remain UNKNOWN until authoritative reconciliation. Offline regressions and exact-head CI passed. TESTNET acceptance remains separately PAUSED / UNVERIFIED.

3. **#654 process-restart reconciliation — active forensic phase; implementation remains separate.**
   - **Why:** current Portfolio, RecoveryLedger and OrderRegistry state is process-local. A restart after an order/fill can lose ownership and reservations while Binance still has open orders or later executions. Same-process reconnect recovery does not solve process death.
   - **Current phase:** evidence/documentation only. The tested PR #606 helper stack remains in the repository but is not wired into current startup. The old integration failed closed because `marketUniverseComplete` was false; current runtime bypasses that gate and starts fresh. Do not modify application source/tests or re-enable replay in this phase.
   - **Future DDD/TDD implementation:** resolve historical market-universe completeness, crash-consistent fill/pause persistence, and startup restoration using the existing projection/restore/account/trade-history helpers. Restore ownership and pause state, resolve UNKNOWN orders by canonical clientOrderId lookup, reconcile balances/open orders/fills, and keep READY closed on any incomplete or conflicting evidence.
   - **Verify:** crash/restart at every order-submit, cancel, partial-fill, full-fill and recovery boundary; prove idempotent accounting and no duplicate order placement. Do not claim exactly-once transport delivery.

### Selected process provenance work — issue #763

- [x] **Harvester process identity and Journal correlation — PR #770.** Harvester captures one immutable process identity (package version, Git branch/full and short commit, commit subject/date, working-tree state, metadata source, PID, UTC process-entry time, runtime-session ID), attaches its sanitized allowlisted DTO to shared Logger context before startup diagnostics, and publishes `harvester.process_started` after Journal subscriber readiness. It remains distinct from `harvester.started`. Configuration-only/no-broker startup does not wait for optional Journal readiness. Startup-failure and shutdown paths do not separately await the process-start publication promise; the existing Journal close lifecycle remains unchanged and may wait for Journal readiness. Broker-connected startup admits the event before its existing PREFLIGHT flush; no new durability barrier, trading behavior, or process-restart recovery is introduced. If the Journal never becomes ready before process termination, trace-log context remains the immediate provenance evidence. Test-first RED was confirmed on PR #770's initial test-only commit. The final code-equivalent head passed all 29 GitHub check runs: workspace unit tests, workspace coverage, Harvester targeted tests and package coverage, Utils tests, JavaScript syntax, dependency audit, actionlint, and both process-lock platforms. The read-only TESTNET integration job was correctly skipped; no exchange operation was performed.

### IMPORTANT — improve correctness and operational confidence

- [x] **PR #866 — Journal startup diagnostics and operator error vocabulary (merged 2026-11-09).** Preserve the Journal package's fail-closed exclusive lock behavior while exposing the stable Harvester diagnostic identifier (`ErrorJournal001`) for `JOURNAL_DIRECTORY_LOCKED`. The [Error Vocabulary](./docs/error-vocabulary.md) documents the exact stale-lock verification/removal procedure and is linked from the operations indexes; the original machine-readable error code and cause remain intact. Exact PR head `3bba286588c930c65e4f6cedff0e707371b79821` passed all six required workflows, including 858/858 Harvester tests. The read-only TESTNET integration was skipped; no exchange operation or acceptance is claimed. Automatic stale-lock takeover remains unsupported.

4. **Keep Journal evidence complete without expanding trading-blocking behavior.**
   - **Why:** investigation requires decision, request, broker acknowledgement, execution, fee and account evidence to be correlated. Missing fields make incident analysis guesswork, but optional diagnostics must not become new trading gates.
   - **Do:** maintain the evidence coverage matrix and add only demonstrated gaps (including execution/trade IDs, per-fill commission amount/asset, last/cumulative quantities, order/client IDs and rejection/cancel outcomes). Preserve the existing mandatory PREFLIGHT/CLOSING and pre-side-effect durability barriers; keep additional evidence best-effort and explicitly report gaps.
   - **Verify:** fixtures and mapping/persistence tests cover populated, missing, malformed and sensitive fields, duplicate/replayed events and optional-write failure isolation. Issue #650 is completed by PR #652; do not reopen it without a newly demonstrated gap.

5. **Add consolidated trading-session statistics (C) as a separate reporting capability.**
   - **Why:** the operator needs a trustworthy post-session explanation of inventory, capital recovery, fees and realized result; current event logs and point-in-time Portfolio snapshots do not provide a complete session report.
   - **Do:** derive the report from confirmed, deduplicated fills and the existing Portfolio/RecoveryLedger accounting facts. Show BUY/SELL quantity and quote totals, actual commissions grouped by asset, invested quote, recovered net proceeds, outstanding recovery, realized net profit, retained inventory/dust and open/partial orders. Keep reporting read-only; do not create a second accounting source.
   - **Verify:** compare report values against deterministic fill fixtures, including partial/duplicate fills, multiple fee assets, retained inventory and exchange-constrained dust. Start with a concise CLI summary; persistence/export is a separate decision.

6. **Finish Conservative architecture decomposition after safety fixes.**
   - **Why:** the trading engine is a 2,243-line orchestration hotspot with a 5,499-line test. This makes state transitions hard to review and increases the chance that a focused change breaks unrelated lifecycle behavior.
   - **Do:** extract one cohesive workflow at a time (replacement, cancellation/reconciliation, fill application, deferred evaluation and pause/resume) behind explicit injected ports. Keep pure strategy decisions in the domain and broker I/O in application/infrastructure. Do not split by callback or introduce speculative frameworks.
   - **Verify:** write characterization/regression tests before each extraction; preserve event ordering, reservations, accounting atomicity and existing public behavior. Add Harvester dependency-boundary tests.

7. **Complete the multi-market acceptance matrix when an eligible TESTNET environment exists.**
   - **Why:** offline fake-broker tests cannot establish exchange filter, shared-asset reservation and real acknowledgement behavior across markets.
   - **Do:** verify markets sharing quote assets and base assets, investment limits, per-pair order/fill isolation, fee handling and shutdown/reconnect. Keep the operator runbook and evidence redacted.
   - **Verify:** use read-only checks first and explicitly authorized bounded test orders only in a separately agreed session. This remains blocked by the current regional eligibility pause.

8. **Keep operational notifications optional and isolated.**
   - **Why:** operators need high-signal lifecycle and safety alerts, but a Telegram outage must never block trading or recovery.
   - **Do:** the Telegram integration through `@coinzilla/notifiers` is already implemented (PR #734). Keep both credentials optional, preserve the explicit event allowlist, bounded serialized delivery and shutdown drain. Do not add automatic retries or a durable outbox without a concrete requirement.
   - **Verify:** retain offline tests for absent/partial credentials, setup failure, queue overflow, transport failure and shutdown. A live smoke test is operator-controlled and is not a CI prerequisite.

9. **[x] Fill identity and commission-conflict regression coverage — merged in PR #921.**
   - **Why:** a reused Fill ID with a changed commission amount or asset must never be accepted as an identical duplicate by either Portfolio or RecoveryLedger. A rejected conflict must leave the complete immutable projection unchanged.
   - **Implemented:** Portfolio rejects the same Fill ID with a changed quote-commission amount; RecoveryLedger rejects the same Fill ID with a changed commission asset. Both tests compare the complete immutable projection before and after rejection. No production code changed.
   - **Verified:** exact PR-head CI passed 873/873 Harvester tests, 75.87% line / 79.13% branch / 74.85% function coverage, and all required checks. PR #921 merged into `develop` at `6c4b1d421aac46b391f2de894153947545879ba9`. No broker, network, or exchange activity.

### DEFERRED — only after the critical Conservative path is safe

9. **Aggressive strategy:** keep disabled until Conservative restart/recovery and exchange acceptance are proven. Then specify unresolved policy, implement pure intents, reuse the shared engine/accounting/safety gates, and test grid repricing, partial fills, reservations, risk fallback and handover before TESTNET.
10. **Further reporting/notification channels:** do not add strategy-specific accounting, email/Discord, persistent notification delivery or speculative dashboards until a real consumer and acceptance contract exist.
11. **Log rotation and retention:** add bounded size-based rotation, archive naming, retention limits and cleanup tests for cumulative and per-session diagnostic files. Cumulative DEBUG, TRACE and development-terminal files append indefinitely, while per-session files are preserved without automatic cleanup. This can eventually exhaust disk space during long-running or frequent development sessions. Implement retention only after selecting an operator-friendly policy and validating crash-safe rotation across all three file destinations; never introduce startup/shutdown deletion as a substitute for a retention policy.

### Status corrections

- #702 per-subscriber recovery acknowledgement and generation-fencing work is implemented in merged Brokers/Harvester PRs #732, #735 and #740; do not list it as open work.
- #650 evidence work is complete in PR #652; additional evidence changes require a newly demonstrated gap.
- #654 is an active forensic/release-readiness investigation; runtime implementation remains a separate DDD/TDD workstream and a blocker for unattended process restarts.
- Remove obsolete references to the deleted legacy application; no extraction or migration work remains for it.

## Current blockers and work selection — 2026-11-09

This section is the current operational status and supersedes older statements below that describe TESTNET acceptance as the immediate next action.

### TESTNET regional eligibility pause

- [~] **Paused — external environment restriction, not an application defect.** The hosted TESTNET validation attempt was rejected with HTTP 451 by Binance Spot API due to regional eligibility restrictions.
- The operator cannot change location to work around this restriction. Do not ask them to do so, and do not repeatedly retry the same hosted TESTNET path.
- No exchange acceptance is claimed. Keep TESTNET validation explicitly **UNVERIFIED / PAUSED** until an eligible, authorized environment is available.
- [~] **Runbook/config pair-scope mismatch — separate hard blocker.** The committed config enables only ZROFDUSD, while the controlled runbook still describes the earlier DOGEUSDT/ZROUSDT plan. No replacement session scope is recorded. Preserve the old plan as historical evidence; do not alter pair configuration or use the runbook for execution until pair scope, quote-currency/fee assumptions, and order limits are explicitly reconciled. The standalone ZRO market-sell helper is hardcoded to ZROUSDT and the account-wide cancel helper has no interactive confirmation; neither is an approved cleanup path while the runbook is paused. See [the controlled TESTNET runbook](./docs/TESTNET_VALIDATION_RUNBOOK.md).
- Offline tests, source-level verification, and CI continue independently. This pause does not block code, documentation, or deterministic test work.
- No live exchange operations, credentials, order submissions, cancellations, or account-setting changes are authorized by this pause note.

### Portfolio stats and user-data lifecycle observability — 2026-11-08

- [x] Emit a compact Portfolio Stats snapshot only after a newly applied BUY/SELL fill changes inventory quantity. Include active, retained, and total base quantity plus exact quote-currency cost/recovery accounting. Do not mix exchange account balances into the in-memory Portfolio snapshot or refresh account balances after every fill.
- [x] Replace generic repeated user-data status logs with concise, deduplicated connected/disconnected/reconnecting/reconnected/subscription-restored/error transitions. Preserve actual broker error context and do not infer authentication expiry from an unspecified transport error.
- [x] Add deterministic offline regressions for partial BUY/SELL fills, duplicate fills, and repeated lifecycle status notifications; preserve existing readiness/recovery behavior.
- [x] Exact-head offline CI on PR #744 head `ae2b6435d0e038f53c8fb2a3869570a5fc2648e7`: Harvester unit tests 776/776, configured targeted tests 3/3, Harvester coverage, workspace coverage, JavaScript syntax, actionlint, Utils tests, and production dependency audit passed. Read-only Binance TESTNET integration was skipped; no exchange acceptance is claimed.

### Recovery contract work

- [x] **#702 — Broker per-subscriber recovery acknowledgement contract.** Owner decision approved on 2026-11-08; broker API and Harvester consumer integration are complete in PRs #732 and #735:
  1. Add an explicit per-subscriber acknowledgement result API while preserving the existing boolean API and its meaning.
  2. Distinguish accepted-but-pending, accepted-and-globally-completed, and stale/inactive rejection.
  3. Preserve one terminal `reconciled` notification per recovery generation for every still-active subscriber; disconnected subscribers receive none.
  4. Keep state-changing RPCs blocked until global recovery completion and keep reminder behavior bounded.
- [x] Implemented #702 with DDD/TDD in PRs #732 and #735: the Brokers Application owns the result contract, the Domain completion invariant is preserved, and Harvester readiness remains closed until the matching global reconciled status. The legacy boolean API remains compatible.
- [x] Follow-up generation fencing in PR #740: the broker emits a monotonic recovery-generation token; Harvester passes the token it reconciled to `acknowledgeRecoveryResult()` and requires the terminal status to match that token, its local recovery generation, and the active subscription ID. A missing token fails closed. The legacy no-argument boolean API remains available but cannot fence stale asynchronous work.
- [ ] **#626 — Harvester recovery reliability.** Offline code/test hardening is substantially complete. Keep the issue open for final acceptance traceability and the externally paused TESTNET acceptance; keep readiness fail-closed and preserve durable audit barriers. The bootstrap composition root is available for inspection and changes; the refactor is complete.
- [x] **PR #739 — 254-reminder recovery regression.** The offline Harvester integration test holds an owned-order canonical-history read pending, delivers 254 repeated `recovered` reminders for the same generation, queues a matching BUY fill, and proves single-flight reconciliation, one-time fill accounting, queued-event drain, durable RECOVERY account/open-orders audits before acknowledgement, one terminal completion, and readiness reopening. Existing failure and second-disconnect regressions remain in place. This does not claim a byte-for-byte replay of the full incident Journal.
- [x] **#667 — November 7 incident follow-up.** Closed after the owner-approved external-order policy and merged fixes for graceful shutdown (#663), unowned-order startup policy (#664), account-integrity BUY cancellation (#669), configured-asset snapshots (#670), Conservative dust/conformance (#653), and recovery-mode deferred evaluations (#673). TESTNET acceptance remains separately paused/unverified.

### Optional operational notifications

- [x] Integrate Telegram through the existing `@coinzilla/notifiers` package at the Harvester composition boundary. Harvester maps selected lifecycle, pause, applied-fill, recovery-completion, and accounting-failure events; the notifier package owns formatting, bounded serialized delivery, and transport.
- Notifications are disabled unless both `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are configured. Setup/delivery failures are isolated from trading. Shutdown drains accepted EventBus work before closing the notifier.
- Delivery is best-effort, in-memory, and not a durable outbox. No trading behavior, exchange integration, or financial accounting rules are changed.

### Other active and deferred work

- [x] **#650 — Journal evidence completeness:** completed in PR #652; required evidence matrix and allowlisted evidence coverage merged and verified. Preserve mandatory durability barriers; additional diagnostics remain best-effort.
- [x] **#646 / #656 — Conservative conformance and dust:** completed in PR #653; exact-head offline CI passed. Issues #646 and #656 are closed.
- [ ] **#654 — process-restart reconciliation:** active forensic investigation; runtime implementation remains a separate DDD/TDD workstream and a blocker for unattended restarts. See F-031 and the current session report.
- **Legacy application removal:** complete. No extraction, migration or maintenance work remains; keep its former implementation and terminology out of current Harvester documentation.

> **Conservative Strategy authority:** [CONSERVATIVE_DOMAIN_SPECIFICATION.md](./docs/domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md) is the sole authoritative rule definition. Roadmap items track implementation, evidence, and blockers only. Any older strategy-rule wording in historical sections is superseded and must not be used as current acceptance criteria. The canonical Mermaid flowchart is derived from the written specification and is not an independent authority.

**CURRENT DIRECTION — 2026-11-09: FORENSIC RESTART-RECOVERY PHASE.** The active task is to establish source/test evidence for #654, validate the retained PR #606 recovery helpers, document why current runtime wiring is absent, and resolve market-universe completeness and crash-consistency requirements. No application implementation or test changes are allowed in this phase.
>
> **Historical runtime decision — 2026-11-05:** durable Journal replay and process-restart recovery were intentionally disabled for the first Conservative TESTNET workflow. The user now explicitly requests forensic investigation, not implementation or replay enablement. Current `index.js` and `prepareOptionalJournal()` do not read prior sessions; `startHarvester()` creates fresh state. The separate PREFLIGHT/CLOSING account audit and pre-side-effect order/cancel intent flushes remain enabled. Any runtime integration must be a separate DDD/TDD phase after this investigation.
>
 > **Historical 2026-11-06 implementation snapshot — superseded by the current 2026-11-09 forensic direction stated above:** PR #513 and #515 established the incident lifecycle/accounting baseline. PR #545 added automatic account-wide PREFLIGHT auditing on every broker-connected startup; PR #546 corrected Binance WebSocket fill timestamps to use transaction time `T` for same-process reconciliation; PR #552 recorded the startup-audit completion; PR #553 reconciled the Journal durability policy; PR #554 fixed aggregate BUY/SELL commitment over-allocation; PR #559 added same-process canonical lookup and reconciliation for lost submission acknowledgements. All changes listed above are merged into `develop`; the remaining work is separately authorized TESTNET acceptance. PR-specific CI claims must be verified against each exact final PR head; historical green runs do not certify later commits.
>
> The startup audit is a required evidence gate: both full balances and account-wide open orders must be durably journaled before market subscriptions or trading-engine activation. Existing open orders are recorded as external/unowned but do not make the audit a trading-startup rejection. Broader Journal delivery remains asynchronous during trading; Journal is not trading-state authority.
>
 > At that time, the remaining critical milestone was joint Binance Spot TESTNET validation. Offline CI is not exchange acceptance. TESTNET remains paused/unverified under the regional eligibility restriction; this historical milestone does not supersede the current #654 forensic workstream.
>
> The historical twelve-BUY incident is established: twelve distinct 400 DOGE BUYs at 0.07598 USDT (4,800 DOGE / 364.704 USDT gross), client IDs `h-DOGEUSDT-32` through `h-DOGEUSDT-43`, all TAKER. The confirmed race was FILLED acknowledgements preceding canonical fill application. The merged engine awaits full execution reconciliation before releasing the serialized transition; offline regression coverage includes twelve sequential immediate fills and weighted execution-price references. TAKER execution alone does not explain the repeated BUYs.
>
> Actual TESTNET commission amounts/assets must be reconciled per trade. Historical fills reporting zero commission remain zero; never retroactively apply the later 0.1% setting. Existing account inventory (previous baseline: 517 non-zero assets, including 12,321 free DOGE) is not Harvester-owned by default.
>
> Older sections below are historical implementation notes. Where they conflict with this current post-merge status, follow this notice and the final handoff section at the end of this roadmap.

## Conservative domain rule extraction — PR #653

The Conservative policy now delegates its core state predicates to
`src/domain/strategies/conservative/helpers.js`. Each predicate has
a focused deterministic unit test in `helpers.test.js`; the policy
continues to own intent calculation and order economics, while the trading
engine continues to own broker lifecycle and I/O.

This is an internal organization change only. The canonical behavior contract
remains [CONSERVATIVE_DOMAIN_SPECIFICATION.md](./docs/domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md);
no strategy behavior change or TESTNET acceptance is claimed. The focused
tests and full Harvester suite still require execution on the exact PR head.

## Future improvements — planned, not implemented

These items are intentionally recorded for future work. They are not current trading requirements, do not block the Conservative strategy, and must not be implemented as part of unrelated work without selecting them explicitly.

### C. Consolidated trading-session statistics

- [ ] Design and implement a clear per-session/per-market trading report using confirmed, deduplicated fills and actual commission amounts/assets as the source of truth.
- [ ] Report total BUY/SELL quantities and quote values, actual commissions by asset, total invested quote, recovered net proceeds, remaining recovery amount, and realized net profit.
- [ ] Report retained/free inventory separately from active strategy inventory, including any exchange-constrained dust.
- [ ] Show current/open order status and partial execution quantities without treating unfilled orders as executions.
- [ ] Keep calculations consistent with Portfolio and RecoveryLedger; do not introduce a second accounting source or mutate trading state for reporting.
- [ ] Provide a readable CLI/session summary first; decide on export/persistence only when that work is selected.

### D. Optional Telegram notifications

- [x] Integrate Harvester with the existing @coinzilla/notifiers package for optional Telegram notifications (PR #734; optional, bounded and failure-isolated).
- [ ] Define a small allowlisted set of useful operational events (startup/connection status, trading pause or safety halt, order/fill lifecycle milestones, and shutdown) before implementation.
- [ ] Keep notification delivery asynchronous and isolated: missing credentials, Telegram outages, formatting errors, or subscriber failures must never block order handling, accounting, startup readiness, or shutdown safety.
- [ ] Reuse existing notifier and event-bus contracts; do not add Telegram SDK logic to Harvester domain/use-case code or duplicate the notifier package.
- [ ] Define configuration, credential handling, message content, and tests when this feature is selected. Notifications remain disabled unless explicitly configured.

## Current work selection

- [x] Close the 2026-11-07/08 session follow-up: source-level findings are resolved by PRs [#653](https://github.com/45s/coinzilla/pull/653), [#663](https://github.com/45s/coinzilla/pull/663), [#664](https://github.com/45s/coinzilla/pull/664), [#669](https://github.com/45s/coinzilla/pull/669), [#670](https://github.com/45s/coinzilla/pull/670), and [#673](https://github.com/45s/coinzilla/pull/673). Tracking audit [#667](https://github.com/45s/coinzilla/issues/667) is closed; evidence: [AUDIT.md session report](./docs/audits/reports/AUDIT.md#2026-11-0708-binance-spot-testnet-session-audit--issue-667). TESTNET acceptance is separate and paused/unverified.
- [x] Graceful shutdown: cancel acknowledged `CG_coinGrabber` BUY orders only, preserve all SELL orders, keep user-data intake active through cancellation/fill reconciliation, and retain the existing CLOSING audit/process-lock guarantees. Implemented and merged in [PR #663](https://github.com/45s/coinzilla/pull/663).
- [x] Account-integrity safety halt: after an unowned/invalid execution or accounting failure closes global readiness, reconcile Harvester-owned order identities and cancel only acknowledged BUY orders; preserve SELLs and external orders; keep the gate closed if any cancellation/fill reconciliation is unresolved. Tracking incident [#667](https://github.com/45s/coinzilla/issues/667), implementation PR [#669](https://github.com/45s/coinzilla/pull/669).

The former blanket TESTNET acceptance gate is removed. Explicitly selected Harvester work may proceed independently of TESTNET acceptance. Issue [#650](https://github.com/45s/coinzilla/issues/650) is the active Journal evidence workstream.

Trading safety requirements remain in force: the operator selects TESTNET or LIVE explicitly through `TRADING_MODE`; `live` means real Binance order execution. Keep order-safety protections, exact-order ownership, and the existing mandatory Journal durability barriers intact. Journal evidence beyond those barriers is bounded, allowlisted, and best-effort. Journal is not trading-state authority. Replay and process-restart recovery remain disabled unless separately requested.

## Strategy-scoped trading configuration

- [x] Keep Harvester configuration under `strategies.CG_coinGrabber`, including the strategy enabled flag, settings, and all market pairs.
- [~] Keep Conservative and Aggressive mode toggles under `CG_coinGrabber.settings`; Conservative remains enabled and Aggressive remains disabled/deferred.
- [x] Update runtime consumers, validation/bootstrap tests, and configuration documentation together — completed in [PR #839](https://github.com/45s/coinzilla/pull/839).

## Journal evidence workstream

- [x] **#923 — Journal DTO compatibility:** implemented and merged in [PR #925](https://github.com/45s/coinzilla/pull/925). Non-negative safe-integer timestamps excluding negative zero, finite numeric diagnostics, structured mapper-failure reporting and no-publication-on-failure are enforced at the DTO boundary. Exact PR head `9329fe2dc2fb1af785548261f23dff4757e0282b` passed 875/875 Harvester tests; coverage was 75.62% lines, 78.94% branches and 74.95% functions. All six required checks passed; no TESTNET/LIVE activity occurred.

Issue [#650](https://github.com/45s/coinzilla/issues/650) is active independently of TESTNET acceptance. Expand investigation evidence within the bounded, allowlisted, best-effort contract in [JOURNAL_EVIDENCE_CONTRACT.md](./docs/JOURNAL_EVIDENCE_CONTRACT.md). Keep Journal replay and process-restart recovery disabled unless separately requested.

## Mission and delivery priority

**Mandatory execution order:** follow [Trading First](./docs/TRADING_FIRST.md). The first deliverable is a working Conservative TESTNET trading loop. Journal, durable persistence, comprehensive restart recovery/reconciliation, operational hardening, and Aggressive are secondary; do not make them blockers for the first working cycle. Implement only the minimum safety needed for a controlled TESTNET order flow.

**First priority: implement Conservative and make Harvester execute a complete, safe, repeatable trading cycle.** The Harvester-owned Conservative Domain Specification is the source of truth. Implement the strategy through Harvester's own domain and application boundaries. Strategy availability is configured in `trading-config.json`: Conservative is enabled and Aggressive remains disabled until Conservative is working end to end on TESTNET. Architecture expansion, optional features, and optimization come after that.

The paragraph below was an earlier audit snapshot and is superseded by the current implementation status and checklist in this roadmap. On `develop`, Harvester now composes the Conservative trading engine when TESTNET trading is explicitly enabled, submits strategy intents through the engine, tracks owned orders, processes canonical fills, updates Portfolio/RecoveryLedger, and has fake-broker coverage for a complete recovery cycle. A real Binance TESTNET cycle is still unverified; do not treat the offline simulation as exchange proof.

### Definition of "Harvester can trade"

The Conservative runtime supports multiple explicitly enabled TESTNET pairs. Each enabled market is validated and subscribed independently; per-market strategy state is isolated while account-level asset balances and active-order commitments are shared by canonical asset identity. Multi-pair TESTNET acceptance still requires dedicated regression and exchange evidence.

A first-trading release is not complete until a TESTNET end-to-end scenario demonstrates:

1. Start from the documented command and load/validate configuration.
2. Connect to the selected broker and establish market-data and user-data streams.
3. Load account balances and exchange trading rules for every enabled pair.
4. Establish the minimum safe TESTNET starting state: fresh balances and exchange filters for enabled pairs and a known price. External inventory and orders remain unowned and are not silently adopted; a clean account is recommended for a controlled first-cycle run but is not a startup prerequisite. Comprehensive historical reconciliation and durable restart recovery are deferred.
5. Receive a valid market update and evaluate the selected executable strategy.
6. Convert the strategy decision into a validated order intent.
7. Apply shared risk, balance, reservation, precision, minimum-notional, and post-only checks.
8. Submit the order and track its acknowledgement or an unknown outcome.
9. Receive order updates and every partial/final fill; normalize, deduplicate, and account for actual quantities and commissions.
10. Re-evaluate the strategy from the latest consistent market, order, and Portfolio state and continue the cycle.
11. Pause new orders safely on disconnect, stale data, unknown order outcomes, unsupported commission, balance/risk violations, or other immediate execution hazards; resume only after the affected live state is refreshed and understood.
12. Shut down cleanly and do not report in-flight orders as completed. Durable restart recovery is a later hardening milestone.

`TRADING_MODE=testnet` selects Binance Spot TESTNET; `TRADING_MODE=live` selects Binance Spot LIVE and enables order execution without a separate trading-enable flag. The startup environment must explicitly contain one of these values; missing or invalid values must fail startup. TESTNET validation remains a separate evidence milestone and does not itself select LIVE.

## Runtime entrypoint hardening — current task

- [x] Remove public `runtime.placeOrder` and `runtime.broker` escape hatches.
      The broker port remains private to bootstrap and the Conservative engine;
      runtime consumers cannot submit orders outside the engine workflow.
- [x] Report the actual startup mode: Conservative TESTNET or LIVE trading enabled. Harvester requires an explicit `TRADING_MODE` and always connects to Binance; there is no read-only/no-broker runtime profile.
- [x] Add regression coverage for startup messages and the absence of public
      broker/order-submission methods.
- [x] Update the README and agent delivery rules in the same implementation
      commit as the code and tests.
- [ ] Run Harvester tests and repository CI on the PR head; do not treat source
      inspection or a successful GitHub write as test verification.

This hardening does not change strategy decisions or claim a successful real
TESTNET cycle. The next proof remains a controlled Binance TESTNET run.

## Historical implementation snapshot — initial TESTNET pair selection

> The default-pair statement in this snapshot records the earlier DOGEUSDT/ZROUSDT configuration. The committed config now enables only ZROFDUSD. This historical text is retained as evidence, not current operator guidance or TESTNET authorization.

At the time of this snapshot, the task branch had progressed beyond the initial `develop` audit described
below. The following first-cycle components were implemented and composed
when `TRADING_MODE=testnet` was selected:

- Conservative pure policy: initial/standing BUY and recovery SELL intents,
  exact tick/step rounding, duplicate suppression, partial-fill wait behavior,
  configured pair-investment limit, exchange-fee-aware recovery planning.
- Submission: local PENDING canonical order registration, exchange-rule
  validation, broker submission, canonical acknowledgement verification, and
  unknown-outcome pause behavior.
- In-process lifecycle: market prices invoke the policy; only registered
  Harvester orders are accepted; canonical TRADE fills update Portfolio and
  RecoveryLedger; terminal full fills trigger the next decision.
- Recovery completion: a fully filled SELL must satisfy the actual cumulative
  net-profit condition and leave at least `keepQuantity`; the retained amount
  moves to free inventory and the cycle ledger resets.
- Startup: explicit `TRADING_MODE=testnet` selection, one or more enabled pairs, and a fresh initial canonical account snapshot covering every enabled market's assets. Trading is enabled in either exchange mode; no separate trading-enable flag is used. External open orders and pre-existing inventory are not adopted; order checks use in-process cash flow, owned position quantity, and outstanding commitments. The then-current config enabled `ZROUSDT` and `DOGEUSDT`; FDUSD pairs were disabled.

Offline bootstrap coverage simulates the complete first recovery cycle:
initial BUY → actual full BUY fill → next BUY and recovery SELL → actual full
SELL fill → profit check → free-inventory allocation. This is a fake-broker
simulation, not evidence of exchange behavior by itself. Real Binance TESTNET
executions have since been observed, including a completed recovery SELL, but
the same run exposed rapid BUY re-submission and an invalid post-cycle
MIN_NOTIONAL intent. Reservations and the safe repeatable TESTNET acceptance cycle remain unfinished. Durable Journal replay/restart recovery is intentionally disabled and is not a blocker. Do not mark the first trading
milestone complete until the incident fixes, reconciliation, and required CI
checks pass.

## Automated TESTNET startup account audit

- [x] On every trading-enabled startup, fetch the full exchange account balance snapshot and durably journal the OPENING account event before the trading engine is activated.
- [x] Fetch open orders account-wide (`getOpenOrders({})`, no symbol filter), normalize the complete order facts into an allowlisted Journal event, and durably flush it before market subscriptions.
- [x] Fail closed if the open-order query is unavailable/malformed or any pre-existing open order is present. Do not adopt or cancel orders; restart ownership recovery is not implemented yet.
- [x] Add DTO and bootstrap regressions for full order facts, empty-account READY, pre-existing-order BLOCKED, and no market subscription/order activation after a block.
- [ ] Verify Harvester tests and repository CI on the feature branch.
- [ ] After merge, the user only needs to start Harvester; no repeated manual balances/orders output is required. Inspect the Journal automatically for account baseline and open-order audit results.

## Standalone read-only TESTNET account preflight

- [x] Add `pnpm run testnet:audit` to query account balances and account-wide open orders through the Binance WebSocket API without starting Harvester.
- [x] Journal and durably flush both account events with phase `PREFLIGHT`; keep the normal Harvester startup gate using phase `OPENING`.
- [x] Return READY when there are no open orders and BLOCKED (exit code 2) when any pre-existing order is found; never submit or cancel orders.
- [x] Add offline tests for full balance/order capture, blocked and ready results, TESTNET-only environment validation, query failure, and resource cleanup.
- [ ] Verify the standalone audit command and full repository CI on this PR head.

## P0 — Deliver the first working trading cycle

Work through these items in dependency order. Keep the scope limited to what is necessary to execute and verify the first strategy safely.

### P0.1 — Conservative strategy contract and implementation

- [x] Select Conservative as the first executable strategy; Aggressive remains deferred.
- [x] Establish one authoritative strategy contract: [CONSERVATIVE_DOMAIN_SPECIFICATION.md](./docs/domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md).
- [~] Align domain policy, application order lifecycle, configuration validation, and regression tests with that canonical contract.
- [~] Complete documentation consolidation under [the Harvester documentation migration plan](./docs/plans/DOCUMENTATION_MIGRATION.md) and [repository-wide governance](../../docs/DOCUMENTATION_GOVERNANCE.md); preserve historical audit evidence and verify no active competing Conservative rule definitions remain. Tracking: [#795](https://github.com/45s/coinzilla/issues/795).
- [ ] Pass the focused regression matrix and all required exact-head CI checks before acceptance.
- [ ] Keep PR #653 open and unmerged until acceptance criteria pass and the owner explicitly authorizes merging.

### P0.2 — Trading rules, account state, and startup readiness

- [x] Load and validate exchange symbol filters for enabled markets: price tick, quantity step, min/max quantity, min/max notional, and supported order types. POST-ONLY orders require fresh best-bid/best-ask data and validate BUY below best ask / SELL above best bid at both submission gates; missing/stale/crossed books defer broker I/O. Binance Spot's exact definite POST-ONLY rejection is handled without pausing, while other/unknown failures remain fail-closed.
- [x] Normalize broker filters into a stable Harvester-owned domain/application shape; do not leak exchange SDK payloads.
- [~] Load account balances and distinguish free, locked, and total balances. A canonical free/locked account snapshot is loaded and checked for every enabled-market asset; in-process allocation aggregates Harvester-owned inventory and active commitments by canonical asset ID. Periodic account refresh and external account-change reconciliation remain.
- [x] Enforce configured per-pair investment against available quote balance while coordinating shared quote assets across enabled pairs (e.g. multiple USDT markets) through the exact-decimal allocator.
- [x] Seed Conservative TESTNET market state after subscribing: use the existing Binance `ticker.price` request/response snapshot when no fresh aggregate-trade event arrived during startup. Reject invalid snapshots, fail startup when neither source provides a usable price, and reject WebSocket prices older than 5 seconds (or more than 1 second in the future). Enforce cached-price freshness at both order-submission gates, including after PENDING registration and before each action in a multi-order decision; defer broker I/O when the price expires.
- [x] Subscribe to user-data events and surface connection status. Startup uses one canonical account snapshot and known enabled-pair filters. External inventory/orders remain unowned; a clean account is a controlled-test recommendation, not a launch gate. Disconnect/recovery and unknown outcomes remain fail-closed; comprehensive history reconciliation is deferred.
- [x] Implement minimum process readiness for the first TESTNET cycle. When `TRADING_MODE=testnet` is selected, startup requires at least one enabled pair, exchange rules for every enabled market, an active user-data stream, and a fresh account snapshot covering every enabled market's assets. External open orders and inventory are not adopted or treated as a startup prerequisite; genuine reconnect/reconciliation requirements still fail closed.
- [x] Enable order execution after the selected `TRADING_MODE` is validated and strategy configuration, enabled-pair exchange filters, a fresh account snapshot, and an active user-data stream are ready. `testnet` selects Binance Spot TESTNET; `live` selects Binance Spot LIVE. The policy prevents a new BUY from taking outstanding recovery capital plus its quote notional beyond the configured pair investment. Before submission the engine checks BUY quote notional against snapshot free quote adjusted by actual quote cash flow and active BUY commitments; SELL quantity is capped by Harvester-owned active base inventory and available free base after active SELL commitments. A balance-limited BUY is deferred while a valid recovery SELL may still proceed.
- [x] Replace `trading-config.json` runtime profiles and `NODE_ENV`-based exchange selection with the single `TRADING_MODE=testnet|live` environment variable. Completed on [PR #841](https://github.com/45s/coinzilla/pull/841), merged 2026-11-09: Binance is the fixed broker; trading is enabled in either mode; missing or invalid mode fails startup; strategy and pair settings remain in `trading-config.json`. All six required exact-head CI contexts passed; the optional read-only Binance TESTNET integration check was skipped. This completes explicit mode/endpoint selection, not live-trading or TESTNET acceptance.
- [x] Validate enabled pair configuration against exchange assets/filters at startup: `orderQuantity` is rounded down by the actual base-asset step and checked against supported min/max quantity; quote-asset `investment` is checked against minimum notional. The symbol must match the exchange market metadata. Actual price/quantity/notional validation remains at order submission.

### P0.3 — Order intent, safety checks, and reservations

- [~] Define canonical Harvester order intent/command contracts using existing `@coinzilla/entities` types wherever suitable. `createPendingCanonicalOrder` builds immutable PENDING canonical orders; the complete engine command contract and lifecycle integration remain.
- [~] Implement pure order construction and validation functions for price/quantity precision, tick/step rounding, min/max quantity, min/max notional, and post-only constraints. `validateOrderAgainstTradingRules` enforces exchange increments and supported price/quantity/notional bounds with exact decimal arithmetic. Fresh book-based POST-ONLY crossing validation is enforced at both submission gates; complete order construction wiring and other runtime checks remain.
- [~] Implement shared pre-trade safety checks: enabled pair and READY state are enforced at runtime; fresh price/book, available quote/base, pair investment headroom, and active-order commitments are enforced by the engine and exact-decimal allocator. The Conservative engine aggregates quote cash flow, owned base inventory, and active BUY/SELL commitments across markets by canonical asset ID. Periodic account refresh/external account-change detection, generalized per-pair risk policy, and strategy takeover remain open.
- [x] Implement in-process BUY quote and SELL base reservations using active canonical orders as the reservation source. The engine registers PENDING before broker I/O and derives remaining commitments from PENDING/OPEN/PARTIALLY_FILLED/UNKNOWN orders; confirmed fills reduce the remaining order quantity while Portfolio/RecoveryLedger apply actual execution facts.
- [x] Use canonical order lifecycle states as reservation states rather than introducing a parallel reservation entity. PENDING, OPEN, PARTIALLY_FILLED, and UNKNOWN retain commitments; confirmed terminal states release the unfilled remainder, while late FILLED updates remain reconcilable.
- [x] Register each PENDING canonical order before broker submission and serialize market/order/fill/cancellation transitions. Unknown submission or cancellation outcomes remain active/paused until authoritative reconciliation; commitments are not released on an unconfirmed outcome.
- [x] Allocate each decision's order intents sequentially against remaining quote balance, pair investment headroom (outstanding recovery plus active BUY commitments), exchange-available base, and Harvester-owned active base. The allocator rejects an overcommitted SELL batch before any broker write and defers BUY intents that exceed remaining quote or investment headroom. Regression tests cover aggregate BUY and SELL intents.
- [~] Treat timeout/disconnect during place/cancel as UNKNOWN, not failed; the current process keeps the order commitment and pauses without retrying. During same-process recovery/shutdown, Harvester looks up a broker-acknowledged order by its original clientOrderId, attaches only a matching brokerOrderId, then reconciles canonical order history and actual fills. If lookup/history/fills are incomplete or conflict, the order remains UNKNOWN and the pair stays paused. Durable Journal-backed registry recovery after process restart remains unimplemented; the runbook requires abort/stop and operator investigation rather than restart.
- [~] Generate Binance-compatible client order IDs with a per-executor 88-bit random namespace and monotonic local sequence. Same-process client-ID lookup now reconciles a lost acknowledgement without retrying. Durable restart recovery, idempotent retries, and automatic resume remain unfinished.
- [x] The Conservative cancellation/replacement paths await broker confirmation, reconcile fills that raced with cancellation, and calculate replacement quantities from the reconciled Portfolio/RecoveryLedger. Deterministic engine regressions cover BUY and recovery-SELL cancellation/fill races.
- [x] Unknown submission/cancellation outcomes pause the affected pair and are not blindly retried. Same-process lost-ack reconciliation uses canonical lookup by clientOrderId followed by canonical order history and fill verification. Durable restart recovery and automatic resume remain deferred.

### P0.4 — Live order and fill lifecycle

- [x] Normalize user-data order/execution events at the broker adapter boundary. Binance TRADE execution reports are converted into canonical `Fill` entities using cached symbol metadata; non-trade order events remain normalized broker events. Normalization failures now include execution context and close the user-data trading gate.
- [x] Normalize actual fills with stable execution IDs, market, side, executed base and quote quantities, timestamps, and exchange-charged commission amount/asset. Missing/invalid execution IDs and incomplete fee facts fail closed.
- [x] Reject malformed or incomplete fills visibly; validate aggregate base/quote commission bounds and surface Binance normalization failures with an actionable pause reason. Third-asset commission quote valuation or fail-closed behavior is defined in the canonical specification and remains an implementation verification item.
- [x] Deduplicate fills using stable exchange execution identity and conflicting-fact fingerprints; serialize user-data event handling and Portfolio/RecoveryLedger updates in process memory. Fingerprint tests cover every mutable canonical execution fact and commission-entry order. Durable deduplication is explicitly deferred; it is not a P0.4 prerequisite.
- [x] **Verify order ownership before accounting:** the in-process engine applies updates only to orders registered with Harvester; unknown/manual executions pause only the affected pair and are not accounted. Deterministic multi-market tests cover cross-pair isolation, duplicate fills, and stale out-of-order order updates.
- [x] Handle NEW, PARTIALLY_FILLED, FILLED, CANCELED, REJECTED, EXPIRED, and exchange-specific terminal/unknown states. Adapter mapping, engine wait/pause/reevaluation behavior, and late FILLED-after-EXPIRED races have deterministic offline coverage.
- [x] Apply only incremental actual executions to shared Portfolio and Conservative RecoveryLedger in one immutable use-case transition; never apply requested order quantity or cumulative executed quantity twice. Regression coverage proves a rejected wrong-market fill cannot commit only the Portfolio projection.
- [x] Expose canonical per-order Binance WebSocket API history through the Harvester broker port. The application-owned broker port and Binance adapter forward the existing broker package's `CanonicalOrder[]` capability; reconnect-time reconciliation is tracked in the next item.
- [x] Reconcile WebSocket API trade history/open orders with user-data stream events to cover disconnect gaps and out-of-order delivery. After stream-level recovery, bootstrap reads WebSocket API request/response snapshots without blocking stream events, drains events received during those reads, then applies reconciliation of only in-memory owned orders in the serialized engine queue. It validates complete cumulative fill quantities, rejects WebSocket API history behind stream-updated order state, and requires every previously processed stream execution ID to appear in the WebSocket API history before applying missing fills through the existing idempotent accounting path. Incomplete/conflicting WebSocket API request/response state keeps the market paused and trading gate closed. External/manual orders are never adopted. Durable restart and balance reconciliation remain deferred.
- [x] Reconcile completed recovery SELL execution history before cycle completion: distinct actual fill quantities must equal both executed and original order quantity; missing/incomplete history pauses before free-inventory allocation or ledger reset.
- [x] Ensure cancel/fill races, duplicate events, late events, and out-of-order events cannot double-count fills or release commitments prematurely. BUY and recovery SELL cancellation fill races, duplicate events, and stale out-of-order reports have deterministic offline coverage. Active canonical order commitments remain until authoritative lifecycle/fill reconciliation; late FILLED updates remain reconcilable.
- [x] Feed successful fill/order transitions back into strategy evaluation. The engine emits a reevaluation outcome after a reconciled terminal full fill; bootstrap runs that evaluation from the serialized user-data event flow and deliberately waits after partial fills.
- [x] Ensure a completed BUY transition immediately evaluates and submits required orders without waiting for another market-price event.

### P0.5 — Trading Engine orchestration

- [x] Implement the first in-process Conservative trading workflow. `makeConservativeTradingEngine` connects market prices to the pure policy, order registry, validated broker submission, canonical order updates, ownership checks, fill accounting, and immediate reevaluation after terminal order updates. Bootstrap composes the user-data callback and account-readiness gate; in-process order-backed quote/base commitments are derived from active canonical orders. Durable restart and periodic account reconciliation remain separate work.
- [~] Inject strategy decision evaluation and trailing-BUY repricing through a broker-independent policy object composed by bootstrap. The engine no longer imports Conservative policy calculators; Conservative-specific order lifecycle sequencing remains in the engine and is not yet generalized.
- [~] Only the Conservative policy is currently composed for execution and startup rejects Aggressive enablement, so one strategy controls the first pair. A generalized strategy-ownership/takeover registry remains deferred.
- [x] Serialize concurrent market-price, book, user-data/order, fill, cancellation, and reconciliation transitions through the engine's process-local transition queue; bootstrap also serializes accepted user-data delivery. Deferred-promise regressions cover pending acknowledgements, cancellations, and concurrent market updates.
- [~] Enforce market-price and book freshness at evaluation and both submission gates, serialize transitions, and reconcile owned order/fill state before resuming. The startup account snapshot is not periodically refreshed for external account activity; the controlled one-pair run forbids manual account changes, and comprehensive account reconciliation remains open.
- [ ] Handle strategy takeover as a controlled workflow: stop outgoing intents, reconcile/cancel relevant orders, account for in-flight fills/reservations, then activate the incoming strategy.
- [~] Startup failure cleanup, process shutdown, and user-data recovery gates are observable and covered. Reconnect does not reopen trading until authoritative order/fill reconciliation succeeds; generalized pause/resume and durable restart recovery remain incomplete.
- [~] Replace the current price-only callback flow with the actual decision-to-order execution pipeline. A tested application use case now converts pure Conservative intents into registered, exchange-rule-validated broker submissions; bootstrap composition and event-driven lifecycle integration remain.
- [x] Do not expose `runtime.placeOrder` or `runtime.broker`; all order submission remains private to the composed Conservative engine and its broker port.

### Active forensic workstream #654 — Persistence, restart, and comprehensive recovery (implementation separate)

- [ ] Decide the minimum durable state required before enabling unattended trading: orders/client IDs, fills/deduplication IDs, reservations, Portfolio/Position, strategy control state, and relevant configuration/version.
- [ ] Reconnect and complete the existing PR #606 recovery helper pipeline in a separate DDD/TDD implementation phase after this forensic investigation; this is not implementation authorization for the current phase.
- [ ] Persist execution facts before acknowledging successful processing/recovery.
- [ ] On startup/reconnect, reconcile persisted state against exchange balances, open orders, and available order/trade history before READY.
- [ ] **History discovery:** enumerate all nested `logs/sessions/<process-session>/` directories and legacy flat Journal sessions. The current Journal reader scans only direct files in its configured directory; the new process-specific directory cannot discover prior sibling sessions.
- [ ] **Open-order readiness:** define and test the policy for unowned account-wide orders. Current PREFLIGHT can record `BLOCKED` while `subscribeToUserData()` still sets READY; same-symbol overlap must be tested with a market tick.
- [ ] **Durable fact contract:** resolve the conflict between crash-safe fill/pause persistence and the current rule that additional Journal evidence must not block fill accounting. Evaluate a separate application-owned durable-fact port before changing Journal's role.
- [ ] **History completeness:** do not override `marketUniverseComplete: false`; establish a provable owned-market/history scope and retention boundary, otherwise require operator reconciliation.
- [ ] **Recovery-cycle restoration:** replay must reproduce the live atomic completion transition: require exact `freeQuantity === activeQuantity`, allocate the complete retained inventory, reset `Position.spent`, and reset RecoveryLedger together. Current restore helper omits the Position cost-basis reset (F-038).
- [ ] Define behavior when exchange history is incomplete, retention-limited, or conflicts with local state; fail closed and require operator intervention where safe reconciliation is impossible.
- [ ] Test crash/restart at each order/fill transition and ensure no duplicate order or fill application.
- [ ] Do not claim exactly-once delivery; guarantee idempotent accounting through durable execution identity and reconciliation.

### Historical P0.7 — First strategy end-to-end verification (superseded status; evidence only)

- [x] Verify Conservative recovery SELL quantity/price rounding against actual base/quote commission fills at quantity-step, price-tick, and exact minProfit boundaries. Tests assert post-fill active inventory and realized net profit using exact decimal strings.

- [~] Add deterministic offline strategy-policy scenarios for initial BUY, duplicate suppression, combined standing BUY/recovery SELL intents, and missing exchange rules. Full broker-port lifecycle simulator scenarios remain.
- [ ] Add opt-in Binance TESTNET integration tests that place and cancel small, bounded test orders only when explicitly enabled.
- [~] Add a bootstrap-level TESTNET-mode fake-broker test that starts with a clean one-pair account, submits the initial Conservative BUY, applies its canonical full fill, and immediately submits the next BUY plus recovery SELL. The fake-broker bootstrap scenario now exercises the full first recovery cycle through BUY fill, simultaneous next BUY/recovery SELL placement, SELL fill, profit verification, and allocation of configured free inventory. A real Binance TESTNET run remains; the README now contains the controlled runbook, clean-account prerequisites, shutdown/restart warning, and expected order sequence.
- [ ] For end-to-end proof, exercise multiple enabled TESTNET pairs, including markets sharing quote assets and markets sharing base assets. Verify per-pair investment limits, account-level commitments, order/fill isolation, and that no pair can spend balances reserved by another.
- [~] Offline coverage verifies pre-submit quote/investment/base budget enforcement, min-notional and precision validation, fresh-book POST-ONLY crossing checks, stale price/book deferral, stream-loss trading gates, and unknown-outcome pause/no-retry behavior. Real Binance rejection, timeout, and recovery behavior remains NOT OBSERVED until the controlled TESTNET session.
- [ ] Verify loss protection and Conservative takeover do not force a loss-making sale or operate the same Position concurrently.
- [~] Provide a documented, reproducible TESTNET runbook and evidence for the first successful cycle. The runbook exists; a full recovery SELL fill and `recovery.cycle_completed` are now evidenced, but the same run exposed a rapid-BUY burst and a post-cycle MIN_NOTIONAL failure. A safe next-cycle BUY and repeatable cycle are not verified.
- [~] LIVE execution is explicitly selected by `TRADING_MODE=live` and uses real funds. This code path is implemented, but no live exchange activity is authorized or claimed by this PR; operator selection and separate operational approval remain required.

## P1 — Implement Aggressive after Conservative is proven

- [x] Keep Aggressive disabled through `strategies.CG_coinGrabber.settings.aggressive.enabled=false` in `trading-config.json`; configuration validation rejects attempts to enable it. Conservative is the only default evaluator and the only strategy composed for order execution.

Aggressive work must not delay P0. Start this phase only after Conservative has completed and passed the documented TESTNET end-to-end cycle.

- [ ] Review the remaining Aggressive decisions in [Trading Strategies](./docs/trading-strategies.md), ask one plain-language product question at a time, and update the specification before implementing unresolved behavior.
- [ ] Implement the Aggressive policy as plain pure domain functions that return order intents; do not copy broker/runtime code from another app.
- [ ] Implement exactly one BUY grid per market, with all configured BUY levels placed together when the cycle starts.
- [ ] Preserve the agreed grid math: lower BUY levels remain fixed percentages from the grid reference; upward repricing steps compound from the previous level and advance only by fully crossed steps.
- [ ] Implement per-BUY-order cumulative fill thresholds: create a separate SELL only after that BUY order is more than 50% filled and eligible unreserved quantity is worth strictly more than $5 USD equivalent; otherwise wait for full fill or more quantity.
- [ ] Implement multiple independent SELL orders against one shared Position, with explicit reservations so the same base quantity cannot be sold twice.
- [ ] Implement the agreed partial-SELL threshold for considering a new BUY, including duplicate-trigger prevention.
- [ ] Implement risk fallback to Conservative when either the investment limit or maximum price-drop limit is reached: stop new BUYs, cancel/reconcile all active orders, and consolidate remaining inventory into one Conservative SELL without forcing a loss.
- [ ] Add deterministic domain tests for grid construction/repricing, partial fills, reservations, cancel/fill races, risk fallback, and strategy handover.
- [ ] Verify Aggressive end to end on TESTNET using the same shared Trading Engine, Portfolio, order lifecycle, and safety gates as Conservative.
- [ ] Add strategy-specific statistics only after shared Position accounting and attribution semantics are stable.

## P2 — Operational hardening and improvements

- [ ] Complete the staged operational Journal integration described in [Journal Integration Roadmap](./docs/JOURNAL_INTEGRATION_ROADMAP.md). Optional operational evidence must not add blocking I/O to strategy evaluation, market processing, broker-event handling or fill accounting. Preserve the existing required broker-connected PREFLIGHT and pre-order/cancel durability barriers. Process-restart recovery is separate under [#654](https://github.com/45s/coinzilla/issues/654); do not silently extend the Journal observer into trading-state authority or add a new fill-persistence barrier without an explicit architecture decision.
- [ ] Add actionable health/status reporting for process and each pair without exposing credentials or raw exchange payloads.
- [ ] Add bounded reconnect/backoff, timeouts, stream liveness/staleness detection, and resource cleanup tests.
- [ ] Add operator controls for pause/resume/stop and safe behavior when a pair is disabled while orders or inventory exist.
- [ ] Add alerts for unsafe states, rejected orders, reconciliation discrepancies, unsupported commissions, and repeated broker failures.
- [ ] Add performance optimization only after profiling a correct end-to-end implementation.
- [ ] Review dependency/security findings and shared package contracts as part of regular maintenance.

## Product and architecture decisions already recorded

- [x] Harvester is an independent Node.js process with shared engine and strategy-specific policies.
- [x] Domain, application use cases, infrastructure adapters, and bootstrap have explicit responsibilities.
- [x] Meaningful deterministic calculations and decisions MUST be plain pure functions in focused modules.
- [x] Classes are for domain concepts that own state and protect invariants (e.g. Fill, Position, Portfolio).
- [x] Use cases are dependency-injected functions; strategies decide and never perform broker I/O.
- [x] Harvester owns its application-facing broker port and adapts `@coinzilla/brokers`.
- [x] One shared Position per market; Conservative and Aggressive share accounting but only one controls the pair at a time.
- [x] Confirmed canonical fills, including exchange-charged commissions, are the only source of Portfolio holdings changes.
- [x] Third-asset commissions require reliable quote valuation or fail-closed handling; see the canonical Conservative specification.
- [x] BUY prices round down and SELL prices round up to exchange tick rules.
- [x] Live exchange tests are opt-in and TESTNET-only; default tests never need credentials or network access.
- [x] Use shared `@coinzilla/utils` decimal functions and `defaultLogger`; do not duplicate generic utilities or call global console from Harvester.

## Open product decisions

- [x] Conservative owner decisions are closed and recorded in the canonical specification. No additional Conservative product decisions are pending.
- [ ] Finalize shared application reservation timing/release rules for submitted, partially filled, cancelled, rejected, expired, and uncertain orders; do not duplicate Conservative strategy policy.
- [ ] Finalize cross-pair account balance allocation and quote-asset contention behavior.
- [x] Optional operational Journal evidence integration is implemented; it remains an observer and does not itself restore trading state. See [Journal Operations](./docs/JOURNAL_OPERATIONS.md) and [Journal Evidence Contract](./docs/JOURNAL_EVIDENCE_CONTRACT.md).
- [ ] Resolve the durable execution-fact source and fill/pause persistence contract for #654 without silently changing the Journal observer contract.
- [ ] Decide whether strategy-specific P/L attribution is required.
- [ ] Decide operator intervention behavior for unreconcilable exchange/local-state discrepancies.

## Delivery rules

- Follow repository root guidance and `apps/harvester/AGENTS.md`.
- Work from `develop` using a short-lived task branch and target PRs to `develop`; do not commit task work directly to `develop` or `main`.
- **Mandatory:** follow [Trading First](./docs/TRADING_FIRST.md); implement the next missing step in the actual trading loop before any secondary infrastructure work.
- Keep durable recovery, comprehensive reconciliation, and optimization separate from operational observability. EventBus/Journal lifecycle logging may proceed without waiting for a Conservative TESTNET cycle.
- Do not implement unresolved financial/risk behavior by assumption; close the decision first.
- Do not mark an item complete until implementation, meaningful tests, required checks, and documentation are complete on the target branch.
- Keep LIVE execution behind the explicit `TRADING_MODE=live` selection; never infer LIVE from `NODE_ENV` or a deployment profile.
- Report exact checks actually run; source inspection is not runtime verification.

### CI lockfile repair

The 2026-11-02 CI failure was caused by a malformed root importer in
`pnpm-lock.yaml`: after removing the Coin Farmer workspace, two dependency
entries were left indented under the empty root importer. This made the second
pnpm 12 lockfile document invalid YAML and blocked dependency installation,
unit tests, coverage, and audit. The root importer has been restored to the
empty form matching the root manifest; the full CI suite must be rerun on the
updated PR head before treating this repair as verified.

## Historical records archive

The detailed historical audit snapshots, implementation progress reports, incident notes, evidence corrections and completed delivery records have been preserved in [ROADMAP_HISTORY.md](./docs/audits/ROADMAP_HISTORY.md). The original section headings are retained below as compatibility anchors for existing links; the historical bodies live in the archive. These stubs are not current status or implementation guidance.

## Historical audit snapshot (superseded by the current implementation status above)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Implemented and verified by source inspection

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Confirmed blockers / gaps found in the audit

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Historical P0.7 implementation record — superseded by the canonical Conservative specification

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### P0.7 implementation progress — CI passed; local TESTNET startup confirmed; awaiting first price

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Historical behavior summary — rules now defined only by the canonical specification

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Scope A — Remove unnecessary execution-readiness barriers

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Scope B — Reconcile recovery SELLs without cancelling PENDING orders

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Scope C — Diagnostics and failure classification

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Required tests

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Out of scope for P0.7

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Acceptance

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## P0.6 — Fix Binance order lifecycle race and diagnostic errors

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Problem statement and evidence

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### P0.6.1 — Reproduce and pin down the lifecycle ordering

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### P0.6.2 — Serialize engine state transitions

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### P0.6.3 — Enforce cancellation identity and lifecycle preconditions

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### P0.6.4 — Make Error and AggregateError logging lossless

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### P0.6.5 — Documentation and verification

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Acceptance criteria

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Implementation boundaries

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### P0.6 implementation progress — engine transition serialization

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### P0.6 implementation progress — cancellation eligibility

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### P0.6 verification snapshot — 2026-11-03

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### P0.7 ownership-failure diagnostics — 2026-11-03

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### P0.7 ownership correlation comparison — 2026-11-03

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Order ownership audit — 2026-11-03

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### TESTNET rejected-event evidence — 2026-11-03 16:24

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

#### Additional adapter finding: Binance original client order ID is discarded

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

#### 16:24:48 TRADE event

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

#### Updated diagnosis and required evidence

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Order identity alignment — 2026-11-03

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## DDD and Clean Architecture audit follow-up

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### DDD-01 — Audit documentation reconciliation (documentation)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### DDD-02 — Harvester domain glossary and context map

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### DDD-03 — Portfolio / RecoveryLedger consistency contract

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### DDD-04 — Extract accounting/recovery workflows from bootstrap

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Startup configuration and read-only policy extraction — 2026-11-08

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Broker connection lifecycle extraction — 2026-11-08

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Market subscription coordinator extraction — 2026-11-08

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Shutdown handler extraction — 2026-11-08

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### User-data subscription/startup gate extraction — 2026-11-08

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### User-data recovery coordinator extraction — 2026-11-08

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### User-data status/recovery handler extraction — 2026-11-08

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### User-data event handler extraction — 2026-11-08

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Market-data freshness policy extraction — 2026-11-08

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Market metadata loading extraction — 2026-11-08

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Account snapshot manager extraction — 2026-11-08

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Bootstrap resource-cleanup extraction — 2026-11-08

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### DDD-05 — Decompose Conservative Trading Engine incrementally

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### DDD-06 — Executable architecture fitness checks

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### DDD-07 — Strategic boundary review (later, evidence-driven)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Conservative next-BUY execution-price correction — 2026-11-03

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Conservative BUY-completion submission ordering — 2026-11-03

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Conservative recovery SELL completion reconciliation — 2026-11-03

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Historical commission and order-type policy decision — 2026-11-03 (superseded)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### POST-ONLY book-ticker subscription lifecycle regression — 2026-11-04

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## TESTNET live progress — 2026-11-04 (initial partial snapshot; superseded by later incident record)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Runtime observations

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Later read-only open-orders snapshot

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Interpretation and remaining proof

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## TESTNET incident and account snapshot — 2026-11-04 (supersedes earlier partial-progress status)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### What the run actually demonstrated

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Source remediation progress — PR #513

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Incident A — repeated BUY submissions around immediate FILLED acknowledgements

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Historical Incident B — residual-suppression defect (superseded by canonical sell-through)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Account reconciliation — still incomplete

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Updated acceptance status and execution gate

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Follow-up source review — conflicting duplicate execution records

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### TESTNET commission configuration change — 2026-11-04

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Latest PR #513 review — 2026-11-04

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## 2026-11-04 TESTNET incident — investigation progress and blockers

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Evidence established

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Source changes now made in PR #513

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Remaining investigation — actual blockers

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Acceptance blockers before any TESTNET restart

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## TESTNET incident — account balance audit implementation (2026-11-04)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## PR #515 offline follow-up progress — 2026-11-04

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Deterministic lifecycle acceptance evidence

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## PR #515 finalization and controlled TESTNET handoff — 2026-11-04

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Branch synchronization correction — 2026-11-04

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Post-PR #515 TESTNET handoff — 2026-11-04

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Live reconciliation incident follow-up — 2026-11-04

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Findings and implementation status

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### SELL 698745 cancellation — strategy path CONFIRMED; raw event identifier NOT REPRODUCED

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Preserved accounting evidence

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Remaining evidence / status

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### CI iteration — 2026-11-04

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Acknowledgement recovery domain-state correction — 2026-11-04

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Accounting and Journal regression follow-up — 2026-11-04

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Post-review hardening — 2026-11-04

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Binance duplicate-fill timestamp parity — 2026-11-05

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Automatic startup account audit — 2026-11-05

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Journal restart recovery — runtime integration disabled 2026-11-05; forensic investigation resumed 2026-11-09

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Durable exchange-write intent barriers — retained P0 safety

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Single-writer process ownership — P0, 2026-11-05

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## P0 — Durable restart recovery (#654; historical PR #606 helper stack, current runtime wiring disabled)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Standalone TESTNET order-cancellation operator tool — 2026-11-05

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Scoped development logging — explicitly authorized 2026-11-05

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Historical Conservative strategy evidence audit — 2026-11-06 (evidence snapshot; contract superseded)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Conservative audit closure sequence — 2026-11-06

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Gate 0 — evidence integrity

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Gate 1 — reconstruct each order

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Gate 2 — accounting

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Gate 3 — canonical contract and documentation consolidation (#646)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Gate 4 — canonical Conservative regression coverage (#648)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Gate 5 — user-data recovery (#626)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Gate 6 — release decision

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## 2026-11-06 original-log verification update

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Conservative audit — 2026-11-06 post-CLOSING trade-history update

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Audit continuation checkpoint — 2026-11-06 11:57 UTC

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Evidence correction — previously supplied balances and open-orders snapshot (2026-11-06)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Historical account snapshots from the original Journal

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Operator-supplied latest open-orders snapshot

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Corrected evidence classification

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Evidence chronology correction — post-CLOSING DOGE/ZRO executions (2026-11-06)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Conservative owner decisions — canonical reference only

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Conservative Strategy audit — current implementation gate (2026-11-06)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Documentation consistency gate — PASS (2026-11-06)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Implementation and regression gate

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Current CI baseline

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Operator workstation lifecycle clarification — 2026-11-06

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Historical audit continuation — source-verified residual and restart blockers (2026-11-06; superseded status)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Residual sell-through — implementation IN PROGRESS

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Current audit work ordering

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Deferred — process-restart recovery (last roadmap item; not an active audit blocker)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Conservative Strategy audit — canonical authority and current status (2026-11-06)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Conservative accounting conformance follow-up — 2026-11-06

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Conservative Strategy — actual DOGE/ZRO outcome conformance (2026-11-06)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Execution order

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Known starting arithmetic (exchange evidence, not yet a full strategy verdict)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## 2026-11-06 — actual DOGE/ZRO conformance checkpoint

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## 2026-11-06 lifecycle audit — partial BUY while recovery SELL is open

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Lifecycle audit refinement — partial BUY replacement path (2026-11-06)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## 2026-11-06 audit continuation — partial BUY policy regression

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## 2026-11-06 audit continuation — dust plus subsequent BUY regression

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## 2026-11-06 audit finding — dust disposition is not durably recorded

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## 2026-11-06 audit continuation — conflicting partial-BUY lifecycle assertion

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## 2026-11-06 audit continuation — lifecycle regression precision

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Conservative lifecycle audit continuation — 2026-11-06 21:05 +02:00

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Conservative audit — F-011 test coverage added (2026-11-06)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Current Conservative audit status — 2026-11-06

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Conservative Strategy owner clarification — dust is a retained keep bonus (2026-11-06)

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Conservative Strategy implementation audit closure — 2026-11-07

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### CI regression fixes — 2026-11-08

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Bootstrap composition follow-up — 2026-11-08

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## Harvester recovery hardening follow-up — 2026-11-08

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Completed offline recovery regressions

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### Confirmed risks and remaining proof gaps

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## 2026-11-08 second-disconnect Harvester lifecycle proof — complete

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## 2026-11-08 F-017 malformed REST-envelope regression follow-up

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## 2026-11-08 PR #688 account-wide open-orders timeout regression

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## 2026-11-08 F-016 native broker Error-cause preservation — complete

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## 2026-11-08 recovery roadmap closeout — PR #719 merged

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## 2026-11-09 forensic follow-up — November 8 evening session

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

### 2026-11-09 current forensic findings — #654

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## 2026-11-09 forensic restart-recovery status

> Historical details are preserved in the [Harvester roadmap history archive](./docs/audits/ROADMAP_HISTORY.md). This heading remains as a compatibility anchor.

## 2026-11-09 — F-023 failure-classification TDD

- Added RED regressions for a matched owned order whose downstream recovery-SELL cancellation fails, permanent ownership/accounting-integrity failures, terminal fill-history REST timeout classification, and the exact `recovered → executionPending (both broker flags false) → owned BUY event` interleaving.
- Added recovery-coordinator regressions proving a queued retryable transition failure blocks acknowledgement until a later authoritative retry, while a permanent accounting-integrity mismatch remains terminal.
- These test-first changes belong to [#769](https://github.com/45s/coinzilla/issues/769) under recovery umbrella [#626](https://github.com/45s/coinzilla/issues/626). Production behavior is unchanged in this commit.

## 2026-11-09 — F-023 failure-classification implementation

- Ported the test-first recovery classification work onto a branch based on current `develop`, including the newer Journal publish/close changes; the stale PR #788 branch remains untouched.
- Bootstrap retries only recognized retryable categories with a non-empty stage and matching retry policy. Missing or malformed metadata becomes terminal `ACCOUNTING_INTEGRITY`.
- Engine snapshot collection distinguishes explicit broker REST read failures from malformed successful payloads and ownership/accounting contradictions. Unknown snapshot errors default terminal, not retryable.
- Account snapshot and account-wide open-order reads, both RECOVERY durability barriers, and broker-generation acknowledgement have explicit failure stages.
- No TESTNET or live exchange operations. Exact-head CI and review remain required.

## 2026-11-09 — F-023 failure-classification implementation

- Ported the test-first recovery classification work onto a branch based on current `develop`, including the newer Journal publish/close changes; the stale PR #788 branch remains untouched.
- Bootstrap retries only recognized retryable categories with a non-empty stage and matching retry policy. Missing or malformed metadata becomes terminal `ACCOUNTING_INTEGRITY`.
- Engine snapshot collection distinguishes explicit broker REST read failures from malformed successful payloads and ownership/accounting contradictions. Unknown snapshot errors default terminal, not retryable.
- Account snapshot and account-wide open-order reads, both RECOVERY durability barriers, and broker-generation acknowledgement have explicit failure stages.
- No TESTNET or live exchange operations. Exact-head CI and review remain required.

## 2026-11-09 recovery failure-classification closeout — PR #794 merged

- [x] **[#769](https://github.com/45s/coinzilla/issues/769) — distinguish accounting-integrity failures from order-transition/reconciliation failures.** Implemented test-first and merged in [PR #794](https://github.com/45s/coinzilla/pull/794), merge commit `ff061dd6b73b4d1ba9a314c1e75ddf447814f4bc`.
- [x] Exact synchronized PR head `fcfa8c4c282b414ccd616b69a54b6e3a8ada5681): all six required offline CI workflows passed. TESTNET integration was skipped intentionally; TESTNET acceptance remains PAUSED / UNVERIFIED.
- [x] Unknown/malformed failure metadata defaults terminal; only explicitly classified retryable REST, order-transition, and durability failures may retry after a complete fresh authoritative recovery. Queued-event failures block broker-generation acknowledgement.
- **Safety:** no TESTNET/live exchange operations were performed. Recovery umbrella [#626](https://github.com/45s/coinzilla/issues/626) remains open for independent work.

## 2026-11-10 independent process-restart audit continuation — F-039–F-044 (#654)

- **F-039 — HIGH:** the live commission validator supports third-asset commissions with historical quote valuation, but the fill DTO drops `quoteValue` and the restore helper rejects third-asset commissions. The configured-market-only account snapshot filter also omits an unconfigured third commission asset. Recovery cannot safely reconstruct all currently accepted Fill accounting. Preserve historical quote valuation and reconcile the related asset balance before any replay integration.
- **F-040 — HIGH:** process identities retain millisecond `startedAt`, but session directory/file names truncate it to seconds. The Journal reader sorts same-second sessions by random UUID suffix; the Harvester recovery projector does not re-sort by the process-start timestamp. Sequential starts within one second can be replayed in reverse chronology. Add deterministic offline coverage and reject ambiguous ordering.
- **F-041 — HIGH:** if a full SELL is followed by an eligible in-memory cycle reset but `RECOVERY_CYCLE_COMPLETED` is lost, the projection retains an unmatched full SELL but does not reject it at end-of-input. Restore then keeps the old cost basis and fails to allocate retained inventory to the free bucket; wallet reconciliation compares total base quantity and quote net cash flow, so it cannot detect either mismatch. Record an explicit durable cycle evaluation outcome or fail closed on unresolved full SELLs; preserve the legitimate residual sell-through case.
- **F-042 — HIGH:** Journal records use random IDs and timestamps without a monotonic sequence, previous-record digest or committed manifest. Deleting one complete valid JSONL line can leave a structurally valid file that reads successfully with no evidence of the gap. The authoritative recovery store needs sequence/integrity validation; legacy records without it are not proven complete.
- **F-043 — HIGH:** the recovery projector silently skips known Harvester safety events including unowned-order, invalid-fill and accounting-failure evidence. If the separate pause event is missing, recovery may not restore a sticky blocker. Add explicit event classification and fail closed on unknown Harvester events.
- **Architecture decision before implementation:** keep domain pure. Prefer a minimal application-owned durable-fact port with explicit fsync acknowledgement, monotonic sequence and integrity chain; keep Journal observer-only unless its contract is deliberately revised. Persist canonical fills before in-memory application, explicit completed/not-completed cycle outcomes before basis transitions, and sticky safety blockers. Recursively discover sessions, reconcile all owned orders/fills/assets and fail closed on any unproven history.
- **F-044 — HIGH:** DTOs and the same-process recovery handler emit account and open-order snapshots with phase `RECOVERY`, but the recovery projector rejects that phase in both validators. Any normal reconnect session can therefore make restart projection fail. Add phase-parity regression coverage and define RECOVERY snapshot ordering/semantics.
- **Next audit gates:** inspect all remaining recovery DTO/domain projection parity, session ordering and schema migration paths; prove each accounting fact survives DTO → projection → restore without information loss. No source or test modifications are authorized. #654 remains OPEN; no TESTNET/LIVE validation is authorized by this audit.
- **Baseline:** exact `develop` HEAD `3ffaaa21c6543cc042087307b01c40630320e903`; PR #974 merged documentation-only. This update is an audit proposal, not implementation acceptance.

### External open-order strategy isolation — #985

- [x] Preserve external open orders as unowned and untouched; retain their symbols only after the account-wide open-orders audit has been durably flushed.
- [x] Defer Conservative strategy evaluation and broker submission for a symbol while an unowned open order exists for that symbol. Unrelated enabled symbols remain eligible.
- [x] Replace the symbol set on each authoritative startup/reconnect snapshot, including clearing it only after a durable snapshot confirms the order is gone.
- [x] Remove the unused `blockOnExistingOrders` recovery argument. Regression coverage is in `src/bootstrap/account/create-account-snapshot-manager.test.js` and `src/use-cases/conservative-trading-engine.test.js`.
- [ ] Exact-head CI verification and merge of this implementation PR; no live/TESTNET operations or process restart are part of this task.



