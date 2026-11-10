---
title: Harvester domain logic test inventory
status: active
type: testing
owner: harvester
created: 2026-11-10
last_verified: 2026-11-10
---

# Harvester domain logic test inventory

## Purpose and scope

This is the source-driven inventory for deterministic tests under `apps/harvester/src/domain/`. It maps business responsibilities to existing tests, records test-quality risks, and sequences follow-up work. It does not define trading behavior; the [Conservative Domain Specification](CONSERVATIVE_DOMAIN_SPECIFICATION.md) remains authoritative.

Reviewed baseline: `develop` at `d07a51446ac4116d307896a8559b033a6e62f06b` (2026-11-10). The domain tree contains 28 production JavaScript files and 26 domain test files. PR #917 is the first Harvester domain-source change after the PR #909 baseline; it corrected Conservative BUY gating after RED regressions.

All test improvements in this initiative must remain deterministic and offline. Issue [#626](https://github.com/45s/coinzilla/issues/626) and its user-data recovery implementation remain paused and outside this initiative.

## Existing behavior-to-test inventory

| Area | Existing test files | Behaviors already protected |
| --- | --- | --- |
| Account | `account/account-snapshot.test.js`, `account/reconcile-account-snapshot-deltas.test.js` | Canonical balance snapshots, duplicate/missing/negative balances, quote cash-flow baselines, market-asset coverage, exact per-asset delta reconciliation and invalid snapshot ordering |
| Fill identity and fees | `fills/fill-fingerprint.test.js`, `portfolio/portfolio.test.js`, `strategies/conservative/recovery-ledger.test.js` | Stable fingerprints across commission ordering; Portfolio rejects same-ID changed commission amounts; RecoveryLedger rejects same-ID changed commission assets; both preserve the complete accepted projection; complete fee data, fee assets, quote valuation and aggregate commission bounds |
| Market | `market-price.test.js`, `market/is-market-data-fresh.test.js`, `market/validate-market-trading-readiness.test.js` | Positive exact-decimal prices, symbol/timestamp validation, inclusive freshness boundaries, required exchange rules, order-type support, configured quantity and investment constraints |
| Orders | `orders/allocate-order-commitments.test.js`, `orders/create-pending-canonical-order.test.js`, `orders/order-registry.test.js`, `orders/validate-cancellation-eligibility.test.js`, `orders/validate-order-against-trading-rules.test.js` | Sequential BUY allocation, aggregate SELL limits, shared base/quote commitments, PENDING construction, broker/client identity, duplicate and stale reports, partial/terminal/UNKNOWN transitions, cancellation eligibility and exchange filters |
| Portfolio | `portfolio/portfolio.test.js`, `portfolio/position.test.js` | Immutable fill application, BUY/SELL accounting, base/quote/third-asset commissions, free inventory isolation, duplicate/conflicting fill identity, market isolation and recovery-basis reset |
| Conservative policy | `strategies/conservative/helpers.test.js`, `initial-buy-price.test.js`, `recovery-completion.test.js`, `recovery-completion.dust.test.js`, `recovery-fill-accounting.test.js`, `recovery-ledger.test.js`, `recovery-sell-plan.test.js`, `recovery-sell-plan-accounting.test.js`, `sell-fee-rate.test.js`, `strategy.test.js`, `trailing-buy-repricing.test.js` | BUY/SELL intents, duplicate suppression, recovery economics, fee reserves, exact tick/step rounding, actual fill accounting, dust/completion, residual sell-through and trailing price thresholds |
| Aggressive policy | `strategies/aggressive-strategy.test.js` | Current contract is explicitly non-executable: NO_ACTION blockers, active-position gating and exclusion of retained free inventory |
| Configuration | `trading-config.test.js` | Strategy/pair configuration validation and explicit TESTNET/LIVE mode selection |

The domain suite is supplemented by application-level engine and use-case tests for serialized lifecycle ordering, multi-market composition, cancellation/fill races and broker interaction. Those tests are not substitutes for pure domain-policy tests, but they provide distinct integration protection.

## Quality findings and priorities

### High — blocked recovery SELL must not be bypassed by a new BUY

Two decision-path defects are confirmed in `strategies/conservative/strategy.js`: (1) after recording `PRICE_FILTER_BLOCKED` for a required recovery SELL, the function continued into standing-BUY planning; and (2) an active recovery SELL in `PENDING` or `UNKNOWN` state suppressed duplicate SELL intent but still permitted a new BUY. The canonical specification permits the next standing BUY alongside an acknowledged OPEN/PARTIALLY_FILLED recovery SELL, not an unacknowledged or unresolved SELL.

RED evidence: PR #917 head `59003fc8ae6fafe6dc5f7528f3356adf03372cdc` ran the full Harvester suite with 870 passed / 2 failed (872 total). The MAX_PRICE failure showed an unexpected `NEXT_STANDING_BUY` at `0.099` for quantity `100`; the PENDING failure showed the same unexpected BUY. The PENDING/UNKNOWN regression is table-driven; its first PENDING assertion fails before the UNKNOWN row executes. The implementation on PR #917 now suppresses BUY intents for both unsafe states and for a `PRICE_FILTER_BLOCKED` required recovery SELL. The OPEN/PARTIALLY_FILLED matrix explicitly protects the approved coexistence behavior.

GREEN evidence on PR head `ffb611507b14efc87338f64521766fbdff9434b3`: the full Harvester suite passed 872/872; Harvester coverage passed at 75.80% lines, 79.05% branches and 74.86% functions; configured Harvester targeted tests passed. All six required checks passed: package unit tests, workspace coverage, JavaScript syntax/Markdown enforcement, Utils tests, production dependency audit and actionlint. The advisory external documentation link check also passed. The TESTNET integration probe was skipped; no exchange activity occurred. The coverage workflow measures Harvester coverage but skips a package-specific threshold enforcement step; no threshold was changed.

### High — assertion diagnostics are inconsistent

Many existing domain tests omit the detailed assertion messages required by `ENGINEERING_STANDARDS.md`. New tests and every materially edited test case must include messages that explain the business invariant and scenario. Existing tests will be improved incrementally with their owning test-quality changes; this initiative will not perform a broad mechanical rewrite.

### Medium — projection-level commission identity conflicts now protected

The Portfolio and RecoveryLedger regressions now prove that a reused Fill ID with changed commission amount or asset is rejected and that the complete original projection remains unchanged. The underlying fingerprint and projection guards were already correct; this closes a test-quality gap without production changes.

### Medium — expected arithmetic must remain independent

The recovery SELL planner tests still calculated fee-reserved base debits and the next-step boundary with production `addDecimal`, `multiplyDecimal`, and `compareDecimal`. The SELL accounting integration fixtures also derived canonical `quoteQuantity`, quote commission, and one-tick-lower price using production decimal helpers. These independent broker facts and expected arithmetic now use exact literals in `recovery-sell-plan.test.js`, `recovery-sell-plan-accounting.test.js` and the exchange-constrained dust outcome in `use-cases/conservative-trading-engine.test.js` (`0.05` dust + `0.1` keepQuantity = `0.15` retained). No production code changes. Exact-head CI passed on open PR #944; merge remains pending.

The Conservative residual-fill fixture and MAX_NOTIONAL assertion previously reused production `multiplyDecimal` for both setup and expected values. [PR #937](https://github.com/45s/coinzilla/pull/937) replaces those coupled expectations with independent exact values (98 × 0.11 = 10.78; 98.95 × 0.11 = 10.8845; 0.1 × 0.6 = 0.06). The exact updated PR head passed 874/874 Harvester tests and required CI; no production behavior changed.

### Medium — capital-limit boundary assertions

The strategy regression uses a table-driven decision matrix: exact equality at 19.900 quote units (10.00 outstanding recovery + 9.90 next BUY notional) permits both the recovery SELL and next BUY; a limit of 19.899 blocks only the BUY; a materially lower limit of 15.00 also blocks only the BUY. The test compares the complete ordered action list and resulting `PLACE_ORDERS` decision, so the capital guard cannot accidentally suppress the recovery SELL. Added in [PR #922](https://github.com/45s/coinzilla/pull/922), merged to `develop` at `0d7112c92478cb3b3e1eca309a663b28d9687c7f`. Exact PR head `8e234e2c18cb98b4b8562c62ef05d9f20f852102` passed 872/872 Harvester tests, configured targeted tests, workspace unit tests and coverage, JavaScript syntax/agent policy/Markdown, actionlint, Utils tests, dependency audit, and advisory external-link checks. Harvester coverage was 75.94% lines, 79.26% branches, and 74.88% functions. The Harvester-specific threshold-enforcement step is not configured and was skipped; no threshold was changed.

### Medium — Portfolio multi-market isolation assertions are incomplete

The original Portfolio test reused the same broker trade ID for ETHUSDT and SOLUSDT but asserted only that two Positions existed. PR #924 now asserts market-scoped Fill IDs and exact independent Position quantity, quote cost basis and quote cash flow for both markets. It also proves a conflicting replay with changed execution facts is rejected without changing the existing Position accounting or applied fill IDs. Existing application-level tests already cover multi-fill Portfolio/RecoveryLedger atomicity and engine multi-market order isolation; those scenarios are not duplicated here. The exact PR head `9b8d4d8a20cd5843c7b0211be0fd8e81cf7636c4` passed 872/872 Harvester tests (75.51% lines, 79.02% branches, 74.88% functions), workspace tests and coverage, targeted tests, Utils tests, syntax/agent policy/Markdown, actionlint, dependency audit and external documentation links. TESTNET probe skipped; no exchange activity occurred. PR #924 merged into `develop`; the exact PR head passed 872/872 Harvester tests and all required checks.

### Medium — market trading-readiness boundaries are incomplete

The readiness policy checks configured quantity after rounding down to the exchange quantity increment and checks investment against MIN_NOTIONAL. Existing tests covered values below/above limits and a rounding-down example, but did not explicitly prove inclusive exact MIN_QUANTITY, MAX_QUANTITY and MIN_NOTIONAL boundaries. PR #930 adds deterministic equality/immediately-outside cases: exact MIN_QUANTITY and MAX_QUANTITY are accepted, below/above values are rejected after step rounding, exact MIN_NOTIONAL is accepted and 4.999 is rejected against a 5 minimum. Exact PR head `17a157c338659ba3009fa634fb732bae9ab7b159` passed 874/874 Harvester tests (75.79% lines, 78.93% branches, 74.88% functions), workspace tests and coverage, targeted tests, Utils tests, syntax/agent policy/Markdown, actionlint, dependency audit and external documentation links. TESTNET probe skipped; no exchange activity occurred. PR #930 merged into `develop` after its updated head passed all six required checks.

### Medium — exchange filter equality boundaries

[PR #932](https://github.com/45s/coinzilla/pull/932) adds exact inclusive MIN/MAX price, quantity and notional equality cases while retaining the existing immediately-outside rejection tests. The updated PR head passed all six required checks and merged into `develop`.

### Medium — exchange filter equality boundaries need independent proof

[PR #932](https://github.com/45s/coinzilla/pull/932) adds exact inclusive equality for MIN/MAX price, quantity and notional while retaining the existing immediately-outside rejection matrix. [PR #929](https://github.com/45s/coinzilla/pull/929) adds independent numeric combinations so each filter equality is isolated from the other notional boundaries, and strengthens readiness assertions for exact MIN_NOTIONAL, quantity rounded down to MAX_QUANTITY, canonical Market binding and immutable supported-order metadata. The synchronized PR #929 head passed all six required checks and merged into `develop`.

### Medium — lifecycle tests need complete-state assertions

The OrderRegistry suite already covered UNKNOWN, stale events, identity mismatch and late FILLED reports, but principal assertions were status-only or checked only remaining quantity. [PR #928](https://github.com/45s/coinzilla/pull/928) strengthens accepted partial-fill and late CANCELED/EXPIRED-to-FILLED transitions with exact original/executed/remaining quantities, broker/client identity, timestamps and active/terminal classification. It also proves earlier immutable snapshots remain unchanged and stale, duplicate or rejected conflicting updates preserve accepted state and commitment. PR #928 merged after the synchronized head passed all six required checks; the exact PR head passed 874/874 Harvester tests. [PR #927](https://github.com/45s/coinzilla/pull/927) adds explicit no-mutation assertions after decreasing-execution and stale-timestamp reports, and verifies late FILLED update flags and the complete terminal order value. PR #933 merged after the synchronized head passed all six required checks.

### Medium — account snapshot reconciliation failures need precise diagnostics and immutability assertions

[PR #931](https://github.com/45s/coinzilla/pull/931) replaces production-derived fixture totals with exact literals and asserts precise errors, no partial result data, and unchanged opening/closing snapshots for invalid out-of-order, inconsistent, negative and duplicate-asset cases. Exact PR-head CI passed 872/872 Harvester tests; PR #931 merged after all six required checks passed. No production code changed.

### Explicitly deferred — Aggressive grid behavior

Aggressive is deliberately blocked by unresolved product rules. Its current NO_ACTION contract and inventory gate are tested. Do not invent grid depth, pricing, SELL thresholds, reservations or risk fallback as part of this testing initiative.

### Medium — engine-level multi-market fill identity is not tested with reused trade IDs

The multi-market engine suite tested separate symbols and duplicate replay, but its accounting stub deduplicated on raw `fill.tradeId` rather than canonical market-scoped `fill.id`. RED was confirmed on PR #933 test head `09fa07923b38eb757449d8347e4c6d5b77ef7f99`: the new same-trade-ID DOGEUSDT/SOLUSDT regression failed because only DOGEUSDT reached accounting; the second market's distinct Fill ID was suppressed by the fixture. The harness now deduplicates on `fill.id`, matching the production accounting contract. No production code changed; the synchronized PR #933 head passed all six required checks and merged into `develop`.

## Execution order

1. **Strategy decisions:** blocked-recovery-SELL gating, exact investment-cap boundaries and independent strategy fixture arithmetic are merged in PRs #917, #922 and #937.
2. **Portfolio and accounting:** PR #924's exact multi-market accounting and conflicting-fill no-mutation assertions are merged; continue reviewing independent expected values and commission-identity conflicts.
3. **Order lifecycle:** PRs #927 and #928 merged complete-state, stale-report and immutable-snapshot assertions.
4. **Market and configuration:** PRs #929, #930 and #932 merged isolated equality values, readiness metadata immutability and exchange-filter boundaries.
5. **Domain failure handling:** PR #931's precise account-snapshot failure classification and no-mutation assertions are merged. Continue with existing retryability/integrity contracts and stale-result isolation; do not resume #626 or add runtime recovery behavior.

After each logical area, record exact test/CI evidence and remaining gaps here and in the Harvester roadmap. Mark work complete only after it is merged into `develop` and required checks pass.

## Verification baseline

The latest merged Harvester verification is PR [#922](https://github.com/45s/coinzilla/pull/922) exact head `8e234e2c18cb98b4b8562c62ef05d9f20f852102`: 872/872 unit tests passed; coverage was 75.94% lines, 79.26% branches, and 74.88% functions. PR #922 merged into `develop` at `0d7112c92478cb3b3e1eca309a663b28d9687c7f`. PR #921 and PR #917 figures above remain historical baseline evidence only.

The active `develop` ruleset requires six contexts: Run package tests, Workspace test coverage, Check JavaScript syntax, packages/utils tests, Audit production dependencies and actionlint. The Harvester coverage workflow measures coverage but does not enforce a Harvester-specific percentage threshold. Preserve all existing checks and thresholds; do not add a threshold without a measured baseline and meaningful enforcement design.
