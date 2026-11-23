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
| Recovery SELL filter freshness | RED reproduced on the exact test-only head: startup MIN_NOTIONAL `5` was used instead of refreshed `1000`, and failed filter retrieval did not block evaluation. PR #1670 adds `create-market-metadata-cache.js` with per-symbol 30-second freshness, forced refresh support, market-identity validation, and clock injection. `create-market-metadata-cache.test.js` covers first refresh, TTL reuse/expiry, per-symbol isolation, forced refresh, unavailable/mismatched filters, invalid clocks, and clock rollback; `create-latest-transition-evaluator.test.js` verifies refresh-before-evaluation and fail-closed behavior. `conservative-trading-engine.multi-market.test.js` composes the actual engine with an active recovery Position/ledger and proves changed MIN_NOTIONAL reaches strategy evaluation and blocks an invalid SELL, unavailable filters pause the market and block submission, and valid refreshed filters permit a recovery SELL. Typed `MarketMetadataRefreshError` codes preserve exchange causes and safe market context. Existing trailing-BUY refresh/error behavior remains covered and unchanged. Exact-head CI is pending. Tracked under [#1359](https://github.com/45s/coinzilla/issues/1359) and [#1362](https://github.com/45s/coinzilla/issues/1362). |
| Reconciliation and unknown/stale exchange outcomes | `src/use-cases/conservative-trading-engine.test.js`: `keeps UNKNOWN exchange order states active and waits for authoritative resolution`; `terminal recovery SELL with incomplete or conflicting fill history cannot advance`; `terminal recovery SELL reconciles partial fills and commissions before reevaluation`; `preserves the existing recovery SELL when shutdown market data is stale`; `fails closed when shutdown recovery SELL cancellation or replacement submission is unresolved`. |
| Shutdown cannot fabricate completion | ADA replay asserts no `recovery.cycle_completed` event and verifies the fail-closed shutdown error. Engine tests cover unresolved cancellation/replacement, UNKNOWN orders, and recovery SELL coverage. |
| Durability before completion/reset | `src/use-cases/create-portfolio-workflow.test.js`: durable non-completion before return; completed outcome bound to the exact fully filled terminal SELL before reset; no completion/reset without canonical fully filled terminal SELL; and no projection mutation when durable outcome persistence fails. |

## TESTNET configuration correction

PR #1411 updates all configured TESTNET pair entries to `makerPercent: 0.1` and `takerPercent: 0.1`, including disabled pairs. Configured LIVE pair rates remain unchanged. A regression enumerates configured pairs by `tradingEnvironment` and verifies both rules.

This is the explicit static configuration correction requested by the operator. It is not a change to the general fee policy, does not establish exchange-side fee evidence, and does not retroactively recalculate historical fills. Every new execution must continue to use the actual commission amount and asset returned by the exchange.

## Resolved acceptance gap — broader recovery lifecycle proof

A source review of `develop` at `543753da5938eba2d95ad19d74c3f98a991e6461` on 2026-11-18 confirmed that recovery SELL planning and dust completion do not require a fresh exchange-filter read. In `src/use-cases/conservative-trading-engine.js`, `createMarketMetadataCache()` returns refreshed metadata when present and otherwise falls back to the process-start `getMarketMetadata()` snapshot. `refreshTrailingBuyMarketMetadata()` calls `broker.getSymbolFilters()` and updates the refreshed metadata only in the trailing-BUY replacement path. `src/use-cases/create-latest-transition-evaluator.js` builds strategy inputs from `getCurrentMarketMetadata()` without refreshing filters first. The architecture guide, [Broker–Harvester trading flow](architecture/BROKER_HARVESTER_TRADING_FLOW.md), also states that bootstrap loads the map once and no background refresh is claimed.

The 2026-11-18 recovery-filter freshness defect is closed by merged PR #1670. The 2026-11-22 archive then confirmed two additional implementation defects: missing durable submission-intent/outcome facts and current-process-owned BUYs surviving safety-critical strategy pauses. Those are fixed by merged PR #1750 and PR #1755. This follow-up adds the sanitized 2026-11-22 archive fixture and exact accounting evidence test, and records the historical filter/shutdown limitations without fabricating missing evidence. The #1362 acceptance matrix is ready for closure after this follow-up's exact-head CI; parent issue #1359 remains open for its broader scope. Do not weaken exchange-filter, minimum-profit, reconciliation, durability, readiness, or shutdown gates.

PR #1411's merged scope is complete: TESTNET pair configuration is aligned to 0.1% maker/taker while LIVE entries remain unchanged; the offline ADA replay and duplicate-terminal-fill evidence are implemented; historical execution facts are preserved. The PR did not implement the recovery-SELL filter refresh and must not be described as doing so.

## Verification and handoff

- [x] PR #1411 merged to `develop` as `88b89995a4f9e62a6fe4b0451ea675ce0495b539`; final PR head `c676e0254269b70b21bfaddbc43eb14d24ad7014` passed all six required CI contexts and the advisory External Documentation Links workflow (the TESTNET integration job was skipped).
- [x] Exact-head Harvester unit tests pass.
- [x] Exact-head configured Harvester targeted tests pass.
- [x] Exact-head Harvester coverage and workspace coverage pass.
- [x] Exact-head strict ESLint, JavaScript syntax, dependency audit, and external documentation-link checks pass.
- [x] Offline ADA replay passes without exchange access.

Historical verification baseline: PR #1411 head `c676e0254269b70b21bfaddbc43eb14d24ad7014`, merged to `develop` as `88b89995a4f9e62a6fe4b0451ea675ce0495b539`. Current lifecycle verification is recorded in the 2026-11-23 follow-up below; every later commit still requires fresh exact-head verification.

## Handoff notes

The audit is intentionally evidence-led. If a later reviewer finds a criterion not covered by the cited assertion, add a focused RED → GREEN test and update this document, the domain test inventory, the accounting invariants, and the roadmap in the same commit. Do not weaken exchange-filter, minimum-profit, Journal durability, reconciliation, readiness, or shutdown gates.

## 2026-11-21 — Recovery SELL filter freshness test-first checkpoint

- Added deterministic engine regressions for an active Conservative recovery position: the strategy must receive a refreshed same-market filter snapshot, reuse it only within 30 seconds, and refresh after expiry.
- Added a failure regression proving that an unavailable filter read blocks strategy evaluation, prevents order submission, and pauses only the affected market with `RECOVERY_SELL_FILTERS_UNAVAILABLE`.
- Exact-head targeted CI confirmed RED on commit `6f8718f4a204f7eff8a1a62cedf7f70ae471f53e`: the fresh-rule assertion observed `5` instead of `1000`, and the unavailable-filter assertion observed `ok: true` instead of `false`. The GREEN implementation merged in PR #1670 at exact head `bfc0fe6df389827c42d9e5d1a8fcb91c87d7dafe`; all six configured workflow runs succeeded on that exact head.
- No TESTNET/LIVE API calls, order placement/cancellation, or account mutations were performed.

## 2026-11-21 — Recovery filter freshness implementation

- The Conservative engine now refreshes validated exchange filters on demand before evaluating an active recovery Position whenever the per-symbol snapshot is older than 30 seconds.
- The refresh validates the configured pair and exact market identity, shares the same cache with forced trailing-BUY refresh, and fails closed with `RECOVERY_SELL_FILTERS_UNAVAILABLE` when current evidence cannot be obtained.
- No background polling was introduced. Existing acknowledged exchange orders are not canceled or replaced by this filter-read path.
- Exact-head GREEN verification passed on PR #1670 head `bfc0fe6df389827c42d9e5d1a8fcb91c87d7dafe`; this closes the filter-freshness item only. Submission durability and strategy-pause BUY cancellation were subsequently fixed by PRs #1750 and #1755.

## 2026-11-21 — GREEN implementation follow-up

- The first GREEN CI attempt exposed missing `getSymbolFilters` support in the multi-market broker fake. The fixture now supplies deterministic same-market metadata and honors explicit per-test overrides; no production fallback to startup metadata was added.
- The recovery-filter integration tests live in the focused multi-market engine suite, not the oversized single-market test file. They seed a real Portfolio/RecoveryLedger Position and use the production Conservative policy with the reconciled completed-BUY reference supplied by the test fixture.
- The valid-filter scenario proves a recovery SELL is submitted; the changed-MIN_NOTIONAL scenario proves the refreshed rules reach strategy evaluation and suppress an inadmissible SELL; the retrieval-failure scenario proves market pause and no SELL submission.
- `MarketMetadataRefreshError` exposes stable codes for unavailable filters, wrong-market metadata, and clock rollback while preserving the original exchange error as `cause`. The existing trailing-BUY wrapper preserves its historical error result and continues to force-refresh filters.
- Exact-head targeted tests, strict ESLint, full unit tests, coverage, syntax, and dependency audit are pending for the corrected commit. The RED evidence from `6f8718f4a204f7eff8a1a62cedf7f70ae471f53e` remains the source-gap proof.


## 2026-11-23 — 2026-11-22 archive reconstruction and lifecycle disposition

### Source integrity and fixture provenance

- Immutable source: [`45s/coinzilla-archive`](https://github.com/45s/coinzilla-archive) commit `f283c90db9143c74683ae5bf9c7bb52e09590d56`, directory `archives/2026-11-22T17-35-17Z_77213df6`.
- Recovery runtime session: `ebe7c1d3-ff7d-47db-b2fe-2e5ec9594c1c`. The original `PROCESS_STARTED` fact does not record the runtime source commit; `dataCommitHash` is archive-data provenance, not a verified source-code commit.
- The 49-record Operational State fact stream is intact: `facts.jsonl` SHA-256 `1b923c1a090904df601463d14681090165b7f8d50a3806e96655699d90a97295`; its manifest SHA-256 is `3063f9ce829cce8a66a471672abee6b77ff52b6647b0b786381adc1db5f264bc`; final sequence is 48.
- Selected cumulative terminal log: `terminal.log` SHA-256 `6ec912690afbfeb1d9c87c674647a34e11d855b2d59337c34ac58d54d2a93d33` (429 lines). The archive manifest says cumulative logs are only the final 5% and only the newest session directory is retained. The newest session directory belongs to a separate startup retry, `403b10b2-17aa-4760-a6e9-c36453cd73e2`, not the original recovery runtime.
- The database dump is listed in the archive manifest but was not readable through the repository file reader in this audit. Therefore the historical filter state is **unverified**, not proven absent from every archived artifact.
- The sanitized, source-hashed projection is preserved at `test/audits/fixtures/2026-11-22-conservative-recovery.json`. It retains exact fill/order identifiers, timestamps, commission amounts/assets, selected log line numbers and fact hashes; it omits account identifiers, balances, provider-instance identifiers and unrelated log content. The fixture's recovery runtime session ID comes from `PROCESS_STARTED`; the separately retained newest session directory is the later startup retry, not the recovery runtime.

### Exact archived fill accounting

All amounts below are exact decimal strings. BUY commissions were charged in the base asset and reduce inventory; SELL commissions were charged in USDT and reduce net SELL proceeds.

| Market | Cycle fills | BUY cost | Net SELL proceeds | Realized net profit | Residual | Keep | Min profit |
|---|---:|---:|---:|---:|---:|---:|---:|
| ZROUSDT | 4 BUY / 1 SELL | 23.37 USDT | 23.3978787 USDT | +0.0278787 USDT | 0.03 ZRO | 0.01 ZRO | 0.01 USDT |
| DOGEUSDT | 4 BUY / 1 SELL | 87.64 USDT | 87.65320905 USDT | +0.01320905 USDT | 3.4 DOGE | 1 DOGE | 0.01 USDT |
| ADAUSDT | 1 BUY / 1 SELL | 7.2 USDT | 7.25318955 USDT | +0.05318955 USDT | 0.05 ADA | 0 ADA | 0.05 USDT |

Commission details:
- ZRO: four BUY fees of 0.005 ZRO; SELL fee 0.0234213 USDT.
- DOGE: four BUY fees of 0.4 DOGE; SELL fee 0.08774095 USDT.
- ADA: BUY fee 0.05 ADA; SELL fee 0.00726045 USDT.

All three `RECOVERY_CYCLE_NOT_COMPLETED` facts record `CONTINUE_SELL_THROUGH` with reason `RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH`. Each realized profit is at or above its configured minimum, but each residual is above `keepQuantity`. The current `evaluateRecoveryCompletion` contract therefore returns `eligible: false`, `pause: false`, and `RESIDUAL_INVENTORY_REQUIRES_SELL_THROUGH` when no dust disposition is supplied. These are valid non-completed cycle outcomes, not evidence that profit alone should have completed the cycle.

The archive does not preserve the historical LOT_SIZE, step-size, MIN_NOTIONAL or equivalent filter values at those decision timestamps in the recovered facts or selected terminal log. The terminal log only records that exchange trading rules were validated at startup, without their values. The database dump is present in the archive manifest but remains uninspected. Consequently, the historical sellability/dust classification of the three residuals is **INSUFFICIENT HISTORICAL EVIDENCE**. Do not backfill guessed filters or classify these residuals as dust from current exchange metadata. Current recovery planning now refreshes and validates filters through merged PR #1670.

### Order, pause and reconciliation chronology

- ZRO BUY `1001164` / client ID `h-dff68008c72c47a59368ad-16` was submitted and accepted at 08:56:41Z, before the ZRO pause at 09:03:57Z. It remained in the RECOVERY open-orders snapshot at 09:28:49Z and filled at 09:44:28.650Z. No cancellation-intent/outcome fact exists for this order. This is a confirmed strategy-safety-pause cancellation defect, fixed by merged PR #1755.
- LINK BUY `3029796` / client ID `h-dff68008c72c47a59368ad-23` was submitted and accepted at 09:49:42Z, before the `UNKNOWN_OR_EXTERNAL_ORDER_EVENT` pause at 09:50:53Z. It was canceled at 09:51:22Z under a separate `ACCOUNT_INTEGRITY_FAILURE` path, about 29 seconds after the pause. PR #1755 now cancels current-process-owned BUYs as part of safety-critical pause handling.
- The LINK and DOGE unowned SELL events in terminal-log lines 405 and 417 were rejected as unowned/invalid; they were not adopted as strategy orders. The associated safety-blocker facts are retained.
- The ADA SELL fill `binance:ADAUSDT:145942` executed at 09:53:32.976Z, 795 ms before the ADA `REST_STREAM_RECONCILIATION_FAILED` pause at 09:53:33.771Z, but its fact was recorded at 09:53:33.814Z. This is a delayed fill report, not evidence that the exchange execution occurred after the pause.
- Ten cancellation-intent facts have matching cancellation-outcome facts. None is for ZRO BUY `1001164`.
- The ZRO and DOGE `RECOVERY_CYCLE_COMPLETION_FAILED` pauses follow valid `CONTINUE_SELL_THROUGH` cycle facts. The available selected trace does not establish the downstream cause of those generic pauses. Their historical cause is **UNRESOLVED**; do not infer a dust or accounting defect from the reason label alone.
- The archive also contains an incomplete account-integrity reconciliation warning and repeated `HARVESTER_ORDER_HISTORY_RECORD_INVALID` diagnostics, a ZRO startup exchange-history synchronization failure, and a later Binance market-stream error. The full trace/database evidence was not available for root-cause attribution. These are recorded as separate historical diagnostics, not used to alter fill accounting or ownership conclusions.

### Durable submission facts and shutdown disposition

- The 49-record fact stream contains zero `ORDER_SUBMISSION_INTENT` and zero `ORDER_SUBMISSION_OUTCOME` facts, although the terminal log records SUBMITTED/ACCEPTED order events. The later startup retry failed closed because the legacy ledger could not project a provider-attributed fill without its preceding submission intent. PR #1750 fixes the callback-name mismatch and makes both durable callbacks mandatory when the Operational State Store is configured. The old archive remains unchanged.
- The original runtime has a `PROCESS_STARTED` fact and PREFLIGHT/RECOVERY snapshots, but no CLOSING account snapshot, no CLOSING open-orders snapshot and no `PROCESS_STOPPED` fact. The terminal log records shutdown-safety start at 11:10:28Z but no completion proof. Safe shutdown is therefore **UNPROVEN**; it must not be reported as successful.
- The separate startup retry at 11:10:47Z failed on the missing submission intent and retained the process lock because runtime shutdown was not confirmed. This is fail-closed evidence, not authorization to clear the lock, repair/backfill the archive or enable process-restart restoration. Restart restoration remains separately deferred under #654.
- The 2026-11-22 archive is a forensic input, not proof of a successful shutdown or a complete exchange-filter history.

### Fix mapping and verification

- Recovery SELL filter freshness: merged [PR #1670](https://github.com/45s/coinzilla/pull/1670), exact head `bfc0fe6df389827c42d9e5d1a8fcb91c87d7dafe`; all six configured workflows succeeded.
- Durable submission-intent/outcome barrier: merged [PR #1750](https://github.com/45s/coinzilla/pull/1750), exact head `6150d93bff4c12b30cf1eb598f6ec2e9a22bd59a`; all six configured workflows succeeded.
- Strategy safety-pause BUY cancellation/reconciliation: merged [PR #1755](https://github.com/45s/coinzilla/pull/1755), exact head `1638e83c033826050cc5b9a845819f626992bbe4`; all six configured workflows succeeded, including full workspace unit tests and coverage.
- This follow-up adds a deterministic offline archive-accounting test using production `Portfolio`, `RecoveryLedger`, `updateTradingAccounting` and `evaluateRecoveryCompletion`. It does not replace the full runtime-composition regressions in the ADA and DOGE/ZRO replay suites. Exact-head CI for this follow-up is pending.
- No Binance/TESTNET API calls, order placement/cancellation, account mutation, archive rewrite, source-ledger backfill or restart-restoration change was performed.
