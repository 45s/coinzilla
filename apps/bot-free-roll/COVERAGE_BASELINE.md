# Free-Roll coverage baseline

**Captured:** 2026-10-31  
**Commit:** `fc12c8fc907588bd77fa6ffbc371a717e032fa17` (PR #280 head)  
**Workflow:** [Test Coverage run](https://github.com/45s/coinzilla/actions/runs/41188613086)  
**Runtime:** Node.js 22, built-in test runner and coverage reporter

This is a source-file baseline for `apps/bot-free-roll`, captured after the helper, fill-reconciliation, order-execution, and event-handling extractions.

## First-party source baseline

| Source file | Lines | Branches | Current gate |
|---|---:|---:|---:|
| `bot-free-roll.js` | 97.45% | 87.78% | 95% / 75% |
| `event-handling.js` | 100.00% | 96.15% | 90% / 90% |
| `fill-reconciliation.js` | 100.00% | 83.33% | 95% / 75% |
| `helpers/accounting.js` | 100.00% | 100.00% | 90% / 85% |
| `helpers/decimal.js` | 98.55% | 96.00% | 95% / 90% |
| `helpers/order-planning.js` | 100.00% | 100.00% | 90% / 60% |
| `helpers/price.js` | 96.90% | 95.83% | 80% / 65% |
| `helpers/trading-rules.js` | 95.06% | 93.94% | 90% / 90% |
| `order-execution.js` | 100.00% | 79.71% | 95% / 75% |
| `prepare-broker.js` | 89.58% | 100.00% | 80% / 70% |
| `validate-config.js` | 94.52% | 92.86% | 90% / 90% |

The gate values are conservative floors below the captured results. They are intended to prevent regressions while leaving room for normal refactoring; they are not aspirational coverage targets. The existing 95% / 75% gate for the main bot orchestrator is preserved.

## Highest-value uncovered paths

The latest report is from PR #280's final CI run. PRs #270, #272, #273, #274, and #280 have already closed the earlier price, broker-preparation, planning, accounting, event-envelope, and fill-input gaps.

1. **Strategy orchestration — `bot-free-roll.js` (97.45% lines, 87.78% branches).** Remaining uncovered lines include the rising-reference-price path, cancel-in-flight event handling, and non-positive next-BUY threshold guard. Prioritize tests only where they exercise a real state transition or safety invariant.
2. **Order lifecycle — `order-execution.js` (100.00% lines, 79.71% branches).** Branch coverage is the largest remaining gap in this safety-critical module. Focus on meaningful cancel/replace outcomes and race conditions, not line execution for its own sake.
3. **Fill reconciliation — `fill-reconciliation.js` (100.00% lines, 83.33% branches).** The latest follow-up covers missing state and malformed fill objects. Remaining branch cases should be assessed for distinct accounting or idempotency behavior.
4. **Trading rules — `helpers/trading-rules.js` (95.06% lines, 93.94% branches).** A few validation branches remain; add tests only where they correspond to distinct configuration or exchange-rule failures.
5. **Other small gaps.** Decimal and price helpers are already strongly covered; broker preparation now has full branch coverage. Do not chase the remaining uncovered lines unless they protect a meaningful contract.

## Interpreting the workspace report

The workspace coverage workflow runs package tests separately. The Free-Roll app's own test process also loads workspace dependencies, so its unfiltered `all files` row includes broker-package code that is not exercised by the app's tests (the captured app-run aggregate was 80.88%). Do not use that dependency-inclusive aggregate as the Free-Roll app's source score. The gates instead target named first-party app modules, while each workspace package is covered by its own test job.

## Policy

- Keep coverage reporting and thresholds on Node's built-in test runner; add no coverage dependency.
- Gate the safety-critical first-party modules individually so one well-covered file cannot hide an uncovered module.
- Do not add tests solely to execute lines. Tests must assert observable behavior and safety invariants.
- Raise thresholds only after the next relevant tests are merged and the new baseline is measured.
- Review this baseline after substantial module extraction or changes to the Node test runner.
