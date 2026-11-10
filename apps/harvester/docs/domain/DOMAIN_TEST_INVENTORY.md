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

Reviewed baseline: `develop` at `429c815531cfaf96cfb9d99a6806681c98e645ea` (2026-11-10). The domain tree contains 28 production JavaScript files and 26 domain test files. PR #917 is the first Harvester domain-source change after the PR #909 baseline; it corrected Conservative BUY gating after RED regressions.

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

Some scenario fixtures calculate expected fill quote quantities by calling the same production decimal helper used by the implementation. Where practical, fixtures should use independently calculated exact decimal literals, so a shared arithmetic defect cannot make both setup and implementation agree incorrectly.

### Medium — capital-limit boundary assertions

The strategy regression now uses a table-driven decision matrix: exact equality at 19.900 quote units (10.00 outstanding recovery + 9.90 next BUY notional) permits both the recovery SELL and next BUY; a limit of 19.899 blocks only the BUY; a materially lower limit of 15.00 also blocks only the BUY. The test compares the complete ordered action list and resulting `PLACE_ORDERS` decision, so the capital guard cannot accidentally suppress the recovery SELL. Added in [PR #922](https://github.com/45s/coinzilla/pull/922). The initial PR head passed all 872 Harvester unit tests, configured targeted tests, and Harvester coverage (75.83% lines, 79.07% branches, 74.88% functions). The changed-file Markdown check identified one repeated blank line in this inventory; the whitespace-only correction passed on final exact PR head `25b3a3162fac9f3aa8453b45fb4b727abbacf481`. On that head, Harvester unit tests passed 872/872 and coverage was 75.58% lines, 78.94% branches and 74.88% functions. Workspace unit tests and coverage, configured Harvester targeted tests, Utils tests, JavaScript syntax/agent policy/Markdown, actionlint, production dependency audit and the advisory external documentation link check all passed. The Harvester-specific threshold-enforcement step is not configured and was skipped; no coverage threshold was changed or weakened.

### Medium — market trading-readiness boundaries are incomplete

The readiness policy checks configured quantity after rounding down to the exchange quantity increment and checks investment against MIN_NOTIONAL. Existing tests covered values below/above limits and a rounding-down example, but did not explicitly prove inclusive exact MIN_QUANTITY, MAX_QUANTITY and MIN_NOTIONAL boundaries. PR #930 adds deterministic equality/immediately-outside cases: exact MIN_QUANTITY and MAX_QUANTITY are accepted, below/above values are rejected after step rounding, exact MIN_NOTIONAL is accepted and 4.999 is rejected against a 5 minimum. Exact PR head `c433c345010c1cdc3596826eea3d2abd312c426a` passed 872/872 Harvester tests (75.91% lines, 79.06% branches, 74.88% functions), workspace tests and coverage, targeted tests, Utils tests, syntax/agent policy/Markdown, actionlint, dependency audit and external documentation links. TESTNET probe skipped; no exchange activity occurred.

### Medium — lifecycle tests need complete-state assertions

The OrderRegistry suite already covers many important transitions, including UNKNOWN, stale events, identity mismatch and late FILLED reports. Follow-up review should prioritize complete canonical order state, remaining commitment, and immutability after rejected/stale transitions rather than adding duplicate status-only scenarios.

### Explicitly deferred — Aggressive grid behavior

Aggressive is deliberately blocked by unresolved product rules. Its current NO_ACTION contract and inventory gate are tested. Do not invent grid depth, pricing, SELL thresholds, reservations or risk fallback as part of this testing initiative.

## Execution order

1. **Strategy decisions:** the blocked-recovery-SELL gap is fixed in merged PR #917 and the exact investment-cap boundary matrix is added in the current PR; next review active-order/market isolation matrices.
2. **Portfolio and accounting:** strengthen independent expected values, commission-identity conflicts and multi-fill sequence invariants.
3. **Order lifecycle:** improve complete-state assertions for accepted, stale, duplicate, conflicting and terminal transitions.
4. **Market and configuration:** PR #930 covers exact configured quantity and MIN_NOTIONAL boundaries; PR #932 covers exact pre-submission exchange-filter boundaries.
5. **Domain failure handling:** cover existing retryability/integrity contracts, stale-result isolation and no mutation after rejected operations. Do not resume #626 or add runtime recovery behavior.

After each logical area, record exact test/CI evidence and remaining gaps here and in the Harvester roadmap. Mark work complete only after it is merged into `develop` and required checks pass.

## Verification baseline

The latest merged Harvester verification is PR [#917](https://github.com/45s/coinzilla/pull/917) exact head `85fc8e9080a45f1ab8509e26ce517380d9f11de2`: 872/872 unit tests passed; coverage was 75.94% lines, 79.34% branches and 74.86% functions. PR #917 merged into `develop` at `0c0e40c271e6a68b90ca7f7ce8753a295f974ffa`. The PR #909 figures above remain historical evidence only.

The active `develop` ruleset requires six contexts: Run package tests, Workspace test coverage, Check JavaScript syntax, packages/utils tests, Audit production dependencies and actionlint. The Harvester coverage workflow measures coverage but does not enforce a Harvester-specific percentage threshold. Preserve all existing checks and thresholds; do not add a threshold without a measured baseline and meaningful enforcement design.
