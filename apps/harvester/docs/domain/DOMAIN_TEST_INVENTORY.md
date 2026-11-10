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
| Fill identity and fees | `fills/fill-fingerprint.test.js`; commission validation is exercised by Portfolio and recovery-accounting tests | Stable fingerprints across commission ordering; changes to canonical execution facts; complete fee data, fee assets, quote valuation and aggregate commission bounds |
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

GREEN evidence on merged PR #917 head `85fc8e9080a45f1ab8509e26ce517380d9f11de2`: the full Harvester suite passed 872/872; Harvester coverage was 75.94% lines, 79.34% branches and 74.86% functions. Configured Harvester targeted tests, workspace unit tests and coverage, Utils tests, JavaScript syntax/agent policy/Markdown, actionlint, dependency audit and external documentation links passed. PR #917 merged into `develop` as `0c0e40c271e6a68b90ca7f7ce8753a295f974ffa`. The TESTNET integration probe was skipped; no exchange activity occurred.

### High — assertion diagnostics are inconsistent

Many existing domain tests omit the detailed assertion messages required by `ENGINEERING_STANDARDS.md`. New tests and every materially edited test case must include messages that explain the business invariant and scenario. Existing tests will be improved incrementally with their owning test-quality changes; this initiative will not perform a broad mechanical rewrite.

### Medium — expected arithmetic must remain independent

The Conservative residual-fill fixture and MAX_NOTIONAL assertion previously used production `multiplyDecimal` both to construct quoteQuantity and to calculate the expected capped notional. [PR #926](https://github.com/45s/coinzilla/pull/926) replaces fixture quote quantities with exact literals (10.78 and 10.8845) and asserts the expected 0.1 price / 0.6 quantity directly. Exact-head CI passed 872/872 Harvester tests; PR #926 remains open and unmerged.

### Medium — capital-limit boundaries need stronger decision assertions

The exact-cap decision matrix is added in open [PR #922](https://github.com/45s/coinzilla/pull/922): exact equality at 19.900 quote units (10.00 outstanding recovery + 9.90 next BUY notional) permits both the recovery SELL and next BUY; a limit of 19.899 blocks only the BUY; a materially lower limit of 15.00 also blocks only the BUY. Exact PR-head CI passed 872/872 Harvester tests and all required checks. PR #922 remains open and unmerged.

### Medium — Portfolio multi-market isolation assertions are incomplete

The existing Portfolio test used the same trade ID for ETHUSDT and SOLUSDT but asserted only that two Positions existed. It did not prove each Position retained its own executed quantity, quote cost basis, quote cash flow, or canonical market-scoped fill identity. The stronger regression is added in open [PR #924](https://github.com/45s/coinzilla/pull/924), with exact per-market state and distinct Fill IDs. Exact PR-head CI passed 872/872 Harvester tests; PR #924 remains open and unmerged. Existing application-level tests already cover multi-fill Portfolio/RecoveryLedger accounting and atomicity; those scenarios are not duplicated.

### Medium — lifecycle tests need complete-state assertions

The OrderRegistry suite already covers UNKNOWN, stale events, identity mismatch and late FILLED reports. [PR #927](https://github.com/45s/coinzilla/pull/927) strengthens late FILLED after CANCELED/EXPIRED with complete CanonicalOrder state, active/terminal membership and immutable snapshots; rejected decreasing-execution and stale-timestamp updates now prove the accepted state and commitment remain unchanged. Exact-head CI passed 872/872 Harvester tests; PR #927 remains open and unmerged.

### Medium — exchange filter equality boundaries need direct proof

Existing order-filter tests reject values just below MIN and above MAX, but do not directly prove inclusive equality for every supported MIN/MAX price, quantity and notional rule. The current PR adds an exact-equality matrix for all six filter bounds, plus market-readiness checks that accept investment exactly at MIN_NOTIONAL and a configured quantity of 1000.9 after rounding down to MAX_QUANTITY 1000. Complete validation results and independently specified notionals are asserted; exact-head CI verification is pending.

### Explicitly deferred — Aggressive grid behavior

Aggressive is deliberately blocked by unresolved product rules. Its current NO_ACTION contract and inventory gate are tested. Do not invent grid depth, pricing, SELL thresholds, reservations or risk fallback as part of this testing initiative.

## Execution order

1. **Strategy decisions:** blocked-recovery-SELL gating is fixed in merged PR #917; exact investment-cap boundaries are green in open PR #922; independent fixture arithmetic is green in open PR #926. Review active-order/market isolation matrices next.
2. **Portfolio and accounting:** exact multi-market isolation is green in open PR #924; then review commission-identity conflicts. Existing application-level multi-fill sequence/atomicity tests are already present and should not be duplicated.
3. **Order lifecycle:** complete-state and failed-update immutability assertions are green in open PR #927; next review accepted, stale, duplicate, conflicting and terminal transitions for remaining proof gaps.
4. **Market and configuration:** exact MIN/MAX price, quantity and notional equality cases are added in the current PR; then review missing/unsupported rule combinations.
5. **Domain failure handling:** cover existing retryability/integrity contracts, stale-result isolation and no mutation after rejected operations. Do not resume #626 or add runtime recovery behavior.

After each logical area, record exact test/CI evidence and remaining gaps here and in the Harvester roadmap. Mark work complete only after it is merged into `develop` and required checks pass.

## Verification baseline

The latest merged Harvester verification is PR [#917](https://github.com/45s/coinzilla/pull/917) exact head `85fc8e9080a45f1ab8509e26ce517380d9f11de2`: 872/872 unit tests passed; coverage was 75.94% lines, 79.34% branches and 74.86% functions. PR #917 merged into `develop` at `0c0e40c271e6a68b90ca7f7ce8753a295f974ffa`. The PR #909 figures remain historical evidence only.

The active `develop` ruleset requires six contexts: Run package tests, Workspace test coverage, Check JavaScript syntax, packages/utils tests, Audit production dependencies and actionlint. The Harvester coverage workflow measures coverage but does not enforce a Harvester-specific percentage threshold. Preserve all existing checks and thresholds; do not add a threshold without a measured baseline and meaningful enforcement design.
