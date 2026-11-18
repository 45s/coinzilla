# Conservative Recovery Lifecycle Audit

**Tracking:** [#1359](https://github.com/45s/coinzilla/issues/1359), [#1362](https://github.com/45s/coinzilla/issues/1362)  
**Application:** `apps/harvester`  
**Strategy:** Conservative  
**Evidence baseline:** 2026-11-17 ADAUSDT Binance TESTNET session, preserved in [PR #1358](https://github.com/45s/coinzilla/pull/1358)  
**Implementation evidence:** [PR #1363](https://github.com/45s/coinzilla/pull/1363) for the MIN_NOTIONAL dust correction; [PR #1411](https://github.com/45s/coinzilla/pull/1411) for the deterministic ADA replay and TESTNET configuration correction.

## Purpose and safety boundary

This document maps the acceptance criteria in #1359 and #1362 to existing implementation and deterministic offline tests. It distinguishes confirmed defects from expected safety outcomes. A test passing is evidence for the behavior it exercises; it is not evidence that a live or TESTNET session was run.

No exchange orders, cancellations, account mutations, or broker integration session were performed for this audit. Automatic restart restoration remains disabled under [#654](https://github.com/45s/coinzilla/issues/654) and is not part of this work.

## Historical ADA facts

The incident record is preserved as historical evidence. The TESTNET pair configuration at the time used 0.075% maker/taker values by operator oversight; the execution records, not the later configuration, remain authoritative.

| Fact | Exact value |
|---|---:|
| BUY fill 1 | 50 ADA at 0.1524 |
| BUY base commission 1 | 0.05 ADA |
| BUY fill 2 | 50 ADA at 0.1519 |
| BUY base commission 2 | 0.05 ADA |
| Total BUY quote cost | 15.215 USDT |
| Recovery SELL | 99.8 ADA at 0.1531 |
| SELL gross proceeds | 15.27938 USDT |
| Actual SELL commission | 0.01527938 USDT |
| SELL net proceeds | 15.26410062 USDT |
| Realized net profit | 0.04910062 USDT |
| Configured minimum profit | 0.05 USDT |
| Profit shortfall | 0.00089938 USDT |
| Residual inventory | 0.1 ADA |
| Quantity step / minimum quantity | 0.1 ADA / 0.1 ADA |
| Minimum notional | 5 USDT |

The BUY commissions leave 99.9 ADA. The 99.8 ADA SELL leaves 0.1 ADA. That residual is quantity-valid, but its notional is far below 5 USDT. It is **MIN_NOTIONAL dust**, not quantity-step dust.

The 0.04910062 USDT realized profit is below the configured 0.05 USDT target. The correct outcome for this evidence is `CONTINUE_SELL_THROUGH` with reason `RECOVERY_PROFIT_TARGET_NOT_MET_CONTINUE_RECOVERY`; the pair must not falsely complete the recovery cycle.

## Findings and dispositions

| Finding | Classification | Disposition |
|---|---|---|
| ADA 0.1 residual was classified as quantity-increment dust even though it met quantity filters and failed minimum notional | Confirmed defect | Fixed and merged in [#1363](https://github.com/45s/coinzilla/pull/1363). Keep MIN_NOTIONAL distinct from QUANTITY_INCREMENT and validate the exchange evidence. |
| TESTNET pair configuration contained 0.075%/0% maker entries despite the documented account setting of 0.1% maker/taker | Operator configuration mismatch | Corrected in PR #1411 by explicit operator direction: every TESTNET pair entry, enabled or disabled, is 0.1%/0.1%; LIVE entries are preserved. Historical fills are not recalculated. |
| ADA realized profit is 0.00089938 USDT below minProfit | Expected strategy outcome | Continue recovery; do not allocate free inventory or mark the cycle complete. The replay verifies the explicit non-completed outcome. |
| The 0.1 ADA residual cannot satisfy MIN_NOTIONAL for a recovery SELL | Exchange constraint, not an accounting defect | Preserve the residual as validated MIN_NOTIONAL dust. Do not invent a SELL or relax exchange filters. |
| Shutdown cancels the pending next BUY but cannot prove a recovery SELL covers the incomplete cycle | Expected fail-closed safety outcome | Shutdown returns `CONSERVATIVE_SHUTDOWN_SAFETY_UNPROVEN` / `RECOVERY_SELL_COVERAGE_UNVERIFIED` and `SHUTDOWN_RECOVERY_REPLACEMENT_NOT_SUBMITTED`. Do not weaken this gate or claim clean shutdown. |
| Restart restoration | Explicitly out of scope | Remains disabled under #654. No restart-restoration behavior is claimed or enabled. |

## Acceptance evidence map

All test paths below are under `apps/harvester`.

| #1362 acceptance area | Deterministic evidence |
|---|---|
| Exact ADA offline lifecycle and accounting | `test/replays/ada-conservative-recovery-replay.test.js`: two BUY fills, actual base commissions, SELL replacement, actual quote commission, exact 0.04910062 USDT profit, 0.1 ADA MIN_NOTIONAL residual, duplicate SELL delivery, and shutdown. |
| Base-asset and quote-asset commissions | `src/domain/strategies/conservative/recovery-fill-accounting.test.js`: actual quote BUY commission, quote SELL commission, base-asset commissions, aggregated commission entries, and invalid/unvalued third-asset commission cases. The ADA replay exercises the real base-BUY / quote-SELL asset combination. |
| Partial/multiple SELL fills | `src/use-cases/conservative-trading-engine.test.js`: `reconciles multiple actual SELL fills before completing recovery` and `terminal recovery SELL reconciles partial fills and commissions before reevaluation`. |
| Duplicate evidence and exact-once accounting | `src/use-cases/create-portfolio-workflow.test.js`: `does not account the same canonical fill twice when deliveries overlap`; `src/use-cases/conservative-trading-engine.test.js`: `does not publish a Fill when accounting reports an idempotent duplicate`; the DOGE successful-cycle replay verifies one completion after replaying identical terminal SELL evidence; the ADA replay verifies unchanged accounting after duplicate delivery. |
| Below/equal/above minProfit | `src/domain/strategies/conservative/recovery-completion.test.js`: below-target pause when no sellable residual remains and continuation when sellable inventory remains; `src/domain/strategies/conservative/recovery-sell-plan-accounting.test.js`: one tick below target, exact equality after actual quote commission, and above-target realized profit; the ADA replay verifies its exact below-target outcome. |
| Valid residual and sell-through | `src/domain/strategies/conservative/recovery-completion.test.js`: `defers completion while any active residual remains above keepQuantity`; `src/use-cases/create-portfolio-workflow.test.js`: durable non-completion outcome before returning and unchanged accounting projections. |
| Dust classes and exchange evidence | `src/domain/strategies/conservative/recovery-completion.dust.test.js`: MIN_NOTIONAL, MIN_QUANTITY, QUANTITY_INCREMENT, fee-adjusted quantity-step dust, price-filter rejection, exact residual matching, and contradictory/non-limiting filter evidence. The merged #1363 regression covers the ADA 0.1 MIN_NOTIONAL case. |
| Reconciliation and unknown/stale exchange outcomes | `src/use-cases/conservative-trading-engine.test.js`: `keeps UNKNOWN exchange order states active and waits for authoritative resolution`; `terminal recovery SELL with incomplete or conflicting fill history cannot advance`; `terminal recovery SELL reconciles partial fills and commissions before reevaluation`; `preserves the existing recovery SELL when shutdown market data is stale`; `fails closed when shutdown recovery SELL cancellation or replacement submission is unresolved`. |
| Shutdown cannot fabricate completion | ADA replay asserts no `recovery.cycle_completed` event and verifies the fail-closed shutdown error. Engine tests cover unresolved cancellation/replacement, UNKNOWN orders, and recovery SELL coverage. |
| Durability before completion/reset | `src/use-cases/create-portfolio-workflow.test.js`: durable non-completion before return; completed outcome bound to the exact fully filled terminal SELL before reset; no completion/reset without canonical fully filled terminal SELL; and no projection mutation when durable outcome persistence fails. |

## TESTNET configuration correction

PR #1411 updates all configured TESTNET pair entries to `makerPercent: 0.1` and `takerPercent: 0.1`, including disabled pairs. Configured LIVE pair rates remain unchanged. A regression enumerates configured pairs by `tradingEnvironment` and verifies both rules.

This is the explicit static configuration correction requested by the operator. It is not a change to the general fee policy, does not establish exchange-side fee evidence, and does not retroactively recalculate historical fills. Every new execution must continue to use the actual commission amount and asset returned by the exchange.

## Verification and handoff

- [ ] PR #1411 merged to `develop`.
- [x] Exact-head Harvester unit tests pass.
- [x] Exact-head configured Harvester targeted tests pass.
- [x] Exact-head Harvester coverage and workspace coverage pass.
- [x] Exact-head strict ESLint, JavaScript syntax, dependency audit, and external documentation-link checks pass.
- [x] Offline ADA replay passes without exchange access.
- [ ] Human review of the final PR diff and acceptance map.

Latest verified PR head at the time of this audit update: `b87f5b4bc5de351a20a303093aa9d3d9e8ba9385`. CI status is tied to that exact commit; any later commit requires fresh exact-head verification.

## Handoff notes

The audit is intentionally evidence-led. If a later reviewer finds a criterion not covered by the cited assertion, add a focused RED → GREEN test and update this document, the domain test inventory, the accounting invariants, and the roadmap in the same commit. Do not weaken exchange-filter, minimum-profit, Journal durability, reconciliation, readiness, or shutdown gates.
