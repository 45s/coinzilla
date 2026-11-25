# Recovery Seller runtime audit — 2026-11-25 17:15 UTC

- Status: Active
- Type: Investigation
- Owner: harvester
- Observed: 2026-11-25 17:15:00 UTC
- Repository: `45s/coinzilla`
- Branch: `develop`
- Baseline commit: `ebeaf346fbaa44ae75ba6fd9256bfdd1ba01d765`
- Issue: [#1841](https://github.com/45s/coinzilla/issues/1841)
- Runtime diagrams and schemas: [Recovery Seller Runtime Flows](../../../domain/recovery-seller-runtime-flows.md)
- Owner-approved STOP decision: [#1780](https://github.com/45s/coinzilla/issues/1780)

## Scope

This audit traced the current Recovery Seller (RS) implementation from process startup through shared Trading Engine dispatch, market-price and user-data entry points, policy evaluation, account-wide authorization, durable submission, BUY fill accounting, terminal mixed-SELL reconciliation and STOP handling.

Included:

- Startup composition and durable STOP restoration.
- Actual evaluation entry points and the distinction between market-price, user-data, deferred and preflight/shutdown paths.
- Conservative-first / RS-second shared evaluator dispatch.
- RS runtime snapshot and cycle-state projection.
- SELL-first / BUY-fallback policy.
- Shared quote/base commitment allocation and order ownership.
- BUY fill application and terminal SELL fill-history reconciliation.
- Owner-approved STOP contract compared with the current runtime.
- Relevant application/domain tests and current configuration.

Excluded:

- Production code or test changes.
- TESTNET or LIVE sessions, broker writes, order placement/cancellation, account queries or exchange-state mutation.
- A full RS-001…RS-010 scenario-coverage certification.
- Process restart/replay design and third-asset commission valuation design.

## Executive summary

RS is composed into Harvester's shared serialized Trading Engine. Startup restores durable STOP and wires the shared accounting workflow, authorizer and submitter; startup itself does not place the first RS order. The normal recurring decision trigger is an accepted fresh market-price event. RS-owned execution reports update accounting and reconcile terminal orders, but the inspected RS order-status handler does not itself request an immediate new RS evaluation. A previously deferred symbol can be reevaluated when readiness returns.

Two confirmed implementation gaps require separate production fixes:

1. **STOP contract mismatch — [#1843](https://github.com/45s/coinzilla/issues/1843).** The owner-approved contract says STOP blocks additional RS BUY spending, preserves existing-order reconciliation/accounting, and permits an otherwise-valid first recovery SELL. Current runtime STOP is mapped to `strategyStopped`, persisted as an account-scoped blocker and blocks SELL as well as BUY. An internal evidence-backed resolver exists, but the operator facade does not expose the authorized administrator action.
2. **Terminal mixed-SELL lifecycle mismatch — [#1842](https://github.com/45s/coinzilla/issues/1842).** The application accounting workflow chooses `CLOSED` from profitability eligibility alone and does not require terminal order status `FILLED`. It also publishes a non-canonical cycle-outcome shape. A FILLED but under-target SELL becomes `UNRESOLVED` without the durable global STOP required by the specification.

The maintained [runtime flow map](../domain/recovery-seller-runtime-flows.md) contains the detailed entry-point, decision, submission, accounting, lifecycle and schema diagrams.

## Method and provenance

The source baseline was the exact `develop` commit recorded above. The audit read the production modules and their call sites, then inspected the relevant RS policy, workflow and domain test files. It followed the runtime composition rather than inferring behavior from filenames or test names alone.

Primary evidence:

- [start-harvester.js](../../../src/bootstrap/start-harvester.js) — startup composition, durable STOP restore, market metadata and legacy initialization.
- [create-recovery-seller-runtime-dispatch.js](../../../src/bootstrap/create-recovery-seller-runtime-dispatch.js) — evaluator, authorizer and submitter composition.
- [create-latest-transition-evaluator.js](../../../src/use-cases/create-latest-transition-evaluator.js#L370) — Conservative-first / RS-second dispatch and preflight/shutdown exclusions.
- [create-market-price-transition-handler.js](../../../src/use-cases/create-market-price-transition-handler.js) — fresh market-price entry.
- [conservative-trading-engine.js](../../../src/use-cases/conservative-trading-engine.js#L1117) — fresh market-book update only resumes an already-deferred symbol; the shared engine also owns the serialized `evaluateLatest` entry.
- [create-user-data-event-transition.js](../../../src/use-cases/create-user-data-event-transition.js#L788) — RS-owned order-status handling; [same file](../../../src/use-cases/create-user-data-event-transition.js#L976) — user-data transition.
- [create-user-data-event-handler.js](../../../src/bootstrap/user-data/create-user-data-event-handler.js) — conditional `reevaluate` and deferred-evaluation resumption.
- [create-recovery-seller-runtime-evaluator.js](../../../src/use-cases/create-recovery-seller-runtime-evaluator.js#L37) — runtime snapshot and readiness facts.
- [create-recovery-seller-transition-evaluator.js](../../../src/use-cases/create-recovery-seller-transition-evaluator.js#L65) — SELL eligibility and current STOP gate.
- [evaluate-buy-decision.js](../../../src/domain/strategies/recovery-seller/evaluate-buy-decision.js) and [evaluate-sell-decision.js](../../../src/domain/strategies/recovery-seller/evaluate-sell-decision.js) — pure policy decisions.
- [calculate-sell-plan.js](../../../src/domain/strategies/recovery-seller/calculate-sell-plan.js) and [calculate-profitability.js](../../../src/domain/strategies/recovery-seller/calculate-profitability.js) — mixed SELL plan and independent profitability gates.
- [create-recovery-seller-action-authorizer.js](../../../src/use-cases/create-recovery-seller-action-authorizer.js) and [create-recovery-seller-order-submitter.js](../../../src/use-cases/create-recovery-seller-order-submitter.js) — shared account allocation and durable submission.
- [create-recovery-seller-accounting-workflow.js](../../../src/use-cases/create-recovery-seller-accounting-workflow.js#L436) — terminal mixed-SELL outcome publication.
- [order-event-workflow.js](../../../src/use-cases/order-event-workflow.js#L117) — terminal RS SELL reconciliation result handling.
- [cycle-state.js](../../../src/domain/strategies/recovery-seller/cycle-state.js#L209) — canonical domain terminal-cycle transition and [state validation](../../../src/domain/strategies/recovery-seller/cycle-state.js#L295).
- [create-recovery-seller-stop-workflow.js](../../../src/use-cases/create-recovery-seller-stop-workflow.js#L162), [resolve-recovery-seller-stop.js](../../../src/use-cases/resolve-recovery-seller-stop.js) and [create-submission-gate.js](../../../src/use-cases/create-submission-gate.js#L255) — durable STOP, internal resolution and account-scoped admission.
- [RS global config](../../../config/strategies/rs-recovery-seller.js) and [per-market routes](../../../rs-recovery-seller.js).

Relevant tests inspected included the RS runtime-evaluator, transition-evaluator, accounting-workflow, order-event, STOP-workflow and pure cycle-state suites. The accounting-workflow test file did not provide an application-level CANCELED/REJECTED/EXPIRED terminal SELL regression for the outcome-publication branch described below.

## Findings

### F-01 — RS STOP implementation contradicts the owner-approved investment-only contract

**Status:** Confirmed implementation gap
**Disposition:** [#1843](https://github.com/45s/coinzilla/issues/1843)
**Confidence:** High

The owner decision recorded on 2026-11-24 in [issue #1780](https://github.com/45s/coinzilla/issues/1780) is explicit: STOP blocks additional BUY spending only; existing-order reconciliation and confirmed-fill accounting continue; an otherwise-valid first recovery SELL may proceed under all independent gates; and an authorized administrator may resolve STOP only after the cause is fixed and authoritative reconciliation/accounting is complete and durably acknowledged. There is no automatic clear or implicit resume.

The current implementation differs at multiple layers:

- `getRecoverySellerRuntimeSnapshot` folds durable STOPPED into `strategyStopped`.
- `createRecoverySellerTransitionEvaluator.canEvaluateSell` requires STOP to be clear, and the SELL transition returns early while STOP is active.
- `createRecoverySellerStopWorkflow` persists RS STOP as `scope: ACCOUNT` and activates the shared account admission blocker.
- The shared submission gate correctly treats a generic account-scoped blocker as a hard block on every order side. Consequently, the RS STOP currently prevents recovery SELL as well as BUY.
- The stop workflow has an evidence-backed internal `resolve` operation, but the operator facade exposes read-only STOP status and does not provide the authorized administrator action.

This must be fixed by separating the RS investment STOP from generic account-scoped safety blockers. Do not weaken the generic account blocker: it must continue to block every strategy and order side.

### F-02 — terminal mixed-SELL accounting can close a non-FILLED order and omits the required adverse-result STOP

**Status:** Confirmed implementation gap
**Disposition:** [#1842](https://github.com/45s/coinzilla/issues/1842)
**Confidence:** High

At [`publishTerminalMixedSellAccounting`](../../../src/use-cases/create-recovery-seller-accounting-workflow.js#L436), the application publishes:

```js
status: eligible ? "CLOSED" : "UNRESOLVED"
```

The decision does not also require `terminalRegisteredOrder.status === "FILLED"`. A terminal CANCELED/REJECTED/EXPIRED SELL with partial fills could therefore be marked CLOSED if those partial fills happen to satisfy the profitability calculation. That violates the one-SELL cycle contract: every terminal non-FILLED outcome remains UNRESOLVED and cannot authorize another SELL or a new BUY cycle.

There is a second branch of the same lifecycle defect. A FILLED SELL whose actual profitability gate fails becomes UNRESOLVED, but the accounting workflow returns a successful reconciliation result. [`reconcileRecoverySellerTerminalSell`](../../../src/use-cases/order-event-workflow.js#L117) marks the terminal order reconciled on that success path and does not latch the durable global STOP for the under-target result. The specification requires STOP for this adverse completed SELL outcome.

The application also publishes an application-only `cycleOutcome` shape containing `sellOrderClientId`, `sellOrderBrokerOrderId`, `appliedFillIds` and `eligible`, rather than the canonical domain cycle fields `sellOrderIdentity`, `terminalOrderStatus`, `terminalReconciled` and `profitabilityEligible`. The domain `reconcileRecoverySellerCycleSell` transition preserves those fields, while the BUY policy validates the canonical cycle-state shape. The application/domain projection boundary needs to use the canonical transition or produce an exactly equivalent validated state.

Required regressions must exercise the real accounting workflow and order-event path, not only the pure cycle-state helper.

### F-03 — RS order events are accounting/reconciliation entry points, not unconditional strategy reevaluation triggers

**Status:** Confirmed runtime behavior; not a defect by itself
**Confidence:** High

The accepted fresh market-price path calls the shared latest-transition evaluator. RS-owned BUY reports apply canonical fills and update the recovery Position/BUY VWAP. RS-owned SELL reports stage fills; terminal SELL updates fetch/reconcile complete canonical fill history and commit the mixed accounting boundary.

The RS-owned order-status handler does not set `reevaluate: true`. The user-data handler only calls `evaluateLatest` when the processed event explicitly requests it; deferred evaluation resumption is conditional on the symbol already being in the deferred set. Therefore the diagrams must not show every RS fill as directly starting a new BUY/SELL evaluation. The next normal decision generally waits for a fresh market-price event.

### F-04 — configuration and documentation status need to be distinguished

**Status:** Documentation drift
**Confidence:** High

The source config sets `RS_RECOVERY_SELLER_CONFIG.enabled` to `true`; the resolved market route still applies per-market `enabled` and `tradingEnvironment` filtering. The configured LINEAUSDT route is TESTNET-only. The current `develop` copy of the RS domain specification still says to keep the global flag false by default in §15, contradicting the source and earlier text in the same document. The open [PR #1823](https://github.com/45s/coinzilla/pull/1823) contains the owner-approved STOP and default-state documentation corrections, but it is unmerged at this audit snapshot.

The controlled TESTNET runbook remains CLOSED / PAUSED. A default-enabled strategy config is not exchange-session authorization.

## Unknowns and limitations

- Process restart/replay of RS cycle/accounting state remains deferred. This audit does not claim restart recovery is implemented.
- An authoritative execution-time quote valuation source for third-asset commissions remains deferred. An unknown third-asset fee must not be treated as zero.
- The complete RS-001…RS-010 scenario matrix is not verified by this audit.
- The scenario-coverage [PR #1823](https://github.com/45s/coinzilla/pull/1823) is open/unmerged at this observation time. Its branch-only TEST-MAPPED records are not merged or VERIFIED evidence.
- The user-data and market-data paths were traced from source; no live event stream was observed during this audit.

## Disposition and follow-up

- [#1841](https://github.com/45s/coinzilla/issues/1841) owns the maintained runtime flow map and this audit record.
- [#1842](https://github.com/45s/coinzilla/issues/1842) owns terminal mixed-SELL status, canonical cycle-state projection and adverse-profitability STOP corrections.
- [#1843](https://github.com/45s/coinzilla/issues/1843) owns the owner-approved investment-only STOP implementation and authorized operator resolution.
- [#1780](https://github.com/45s/coinzilla/issues/1780) remains the separate from-scratch RS scenario-coverage initiative.
- The earlier workflow-to-default-SELL-evaluator defect [#1809](https://github.com/45s/coinzilla/issues/1809) was fixed by merged [PR #1815](https://github.com/45s/coinzilla/pull/1815). All six applicable workflows passed on exact PR head `20963617c9d9d73c31b47865e0aa34c4a966cc8e`; merge commit `cbf07da54fd2e14fbeb3f96d4d9f8efe48d597c2` is on develop, and #1809 was closed.

## Verification boundary

- Source files and relevant tests were inspected against the exact baseline commit above.
- No production source or test files were changed by this audit.
- No application test suite was executed as part of the documentation-only task.
- Repository Markdown/style/anchor and changed-file checks are expected from the exact-head PR workflow; results must be recorded against the PR head before merge.
- No broker connection, account query, order submission/cancellation, TESTNET session, LIVE session or exchange-state mutation was performed.
