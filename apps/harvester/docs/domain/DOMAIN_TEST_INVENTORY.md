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

Reviewed baseline: `develop` at `631e82c4630f7b57d47fd6fd43adfdbb8656bd95` (2026-11-10). The domain tree contained 28 production JavaScript files and 26 domain test files. The branch contained no Harvester domain-source changes after the PR #909 baseline; the four intervening commits changed roadmap/documentation and Markdown tooling only.

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

### Medium — capital-limit boundaries need stronger decision assertions

The existing Conservative strategy suite tests a BUY blocked when outstanding recovery plus the next BUY exceeds the configured investment. It does not yet establish both exact-cap equality and the immediately-over-cap outcome as a decision matrix, including the resulting SELL/BUY intents.

### Medium — lifecycle tests need complete-state assertions

The OrderRegistry suite already covers many important transitions, including UNKNOWN, stale events, identity mismatch and late FILLED reports. Follow-up review should prioritize complete canonical order state, remaining commitment, and immutability after rejected/stale transitions rather than adding duplicate status-only scenarios.

### Explicitly deferred — Aggressive grid behavior

Aggressive is deliberately blocked by unresolved product rules. Its current NO_ACTION contract and inventory gate are tested. Do not invent grid depth, pricing, SELL thresholds, reservations or risk fallback as part of this testing initiative.

## Execution order

1. **Strategy decisions:** close the blocked-recovery-SELL decision gap; then add exact investment-cap boundary cases and review active-order/market isolation matrices.
2. **Portfolio and accounting:** strengthen independent expected values, commission-identity conflicts and multi-fill sequence invariants.
3. **Order lifecycle:** improve complete-state assertions for accepted, stale, duplicate, conflicting and terminal transitions.
4. **Market and configuration:** review price/quantity/notional boundaries and missing/unsupported rule combinations.
5. **Domain failure handling:** cover existing retryability/integrity contracts, stale-result isolation and no mutation after rejected operations. Do not resume #626 or add runtime recovery behavior.

After each logical area, record exact test/CI evidence and remaining gaps here and in the Harvester roadmap. Mark work complete only after it is merged into `develop` and required checks pass.

## Verification baseline

The latest recorded Harvester verification is from PR [#909](https://github.com/45s/coinzilla/pull/909): 871/871 unit tests passed; coverage was 75.98% lines, 79.32% branches and 74.85% functions on the recorded exact PR head. This is historical baseline evidence, not a claim that the current `develop` head was re-run.

The active `develop` ruleset requires six contexts: Run package tests, Workspace test coverage, Check JavaScript syntax, packages/utils tests, Audit production dependencies and actionlint. The Harvester coverage workflow measures coverage but does not enforce a Harvester-specific percentage threshold. Preserve all existing checks and thresholds; do not add a threshold without a measured baseline and meaningful enforcement design.
