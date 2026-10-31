# Free-Roll coverage baseline

**Captured:** 2026-10-31  
**Commit:** `e90d093302366ba7d62565d93c2ab6f54dd823ce` (PR #282 head)  
**Workflow:** [Test Coverage run](https://github.com/45s/coinzilla/actions/runs/41190093220)  
**Runtime:** Node.js 22, built-in test runner and coverage reporter

This is a source-file baseline for `apps/bot-free-roll`, captured after the helper, fill-reconciliation, order-execution, and event-handling extractions.

## First-party source baseline

| Source file | Lines | Branches | Current gate |
|---|---:|---:|---:|
| `bot-free-roll.js` | 97.45% | 87.78% | 95% / 75% |
| `event-handling.js` | 100.00% | 96.15% | 90% / 90% |
| `fill-reconciliation.js` | 100.00% | 83.33% | 95% / 75% |
| `helpers/accounting.js` | 100.00% | 100.00% | 90% / 85% |
| `helpers/decimal.js` | 98.55% | 95.96% | 95% / 90% |
| `helpers/order-planning.js` | 100.00% | 100.00% | 90% / 60% |
| `helpers/price.js` | 96.90% | 95.83% | 80% / 65% |
| `helpers/trading-rules.js` | 95.06% | 93.94% | 90% / 90% |
| `order-execution.js` | 100.00% | 81.94% | 95% / 75% |
| `prepare-broker.js` | 89.58% | 100.00% | 80% / 70% |
| `validate-config.js` | 94.52% | 92.86% | 90% / 90% |

The gate values are conservative floors below the captured results. They are intended to prevent regressions while leaving room for normal refactoring; they are not aspirational coverage targets. The existing 95% / 75% gate for the main bot orchestrator is preserved.

## Highest-value uncovered paths

The latest report is from PR #282's final CI run. PRs #270, #272, #273, #274, #280, and #282 have closed the earlier price, broker-preparation, planning, accounting, event-envelope, fill-input, and order-cancellation/replacement gaps.

1. **Strategy orchestration — `bot-free-roll.js` (97.45% lines, 87.78% branches).** The remaining uncovered executable paths are the post-reference BUY trigger (`514–515`), cancel-in-flight event handling (`574–584`), the unused `#placeSell` wrapper (`673–677`), and the defensive non-positive next-BUY guard (`699–701`). The `#placeSell` wrapper has no caller; the non-positive guard is unreachable with validated positive price/step inputs. Do not add artificial tests for unreachable defensive paths. Assess the remaining trigger and cancellation paths only through realistic public-API state transitions.
2. **Order lifecycle — `order-execution.js` (100.00% lines, 81.94% branches).** PR #282 added cancellation/replacement outcomes and improved branch coverage from 79.71%. Remaining branches should be pursued only when they protect a distinct safety invariant or race outcome.
3. **Fill reconciliation — `fill-reconciliation.js` (100.00% lines, 83.33% branches).** Missing state and malformed fill objects are covered. Remaining branch cases should be assessed for distinct accounting or idempotency behavior.
4. **Trading rules — `helpers/trading-rules.js` (95.06% lines, 93.94% branches).** A few validation branches remain; add tests only where they correspond to distinct configuration or exchange-rule failures.
5. **Other small gaps.** Decimal and price helpers are already strongly covered; broker preparation now has full branch coverage. Do not chase remaining uncovered lines unless they protect a meaningful contract.

## Interpreting the workspace report

The workspace coverage workflow runs package tests separately. The Free-Roll app's own test process also loads workspace dependencies, so its unfiltered `all files` row includes broker-package code that is not exercised by the app's tests (the captured app-run aggregate was 80.88%). Do not use that dependency-inclusive aggregate as the Free-Roll app's source score. The gates instead target named first-party app modules, while each workspace package is covered by its own test job.

## Policy

- Keep coverage reporting and thresholds on Node's built-in test runner; add no coverage dependency.
- Gate the safety-critical first-party modules individually so one well-covered file cannot hide an uncovered module.
- Do not add tests solely to execute lines. Tests must assert observable behavior and safety invariants.
- Raise thresholds only after the next relevant tests are merged and the new baseline is measured.
- Review this baseline after substantial module extraction or changes to the Node test runner.

## Follow-up: exact free-inventory allocation (PR #330)

PR #330 adds `src/bot/inventory-allocation.js` as a dedicated pure source module. The Test Coverage workflow for PR #330 passed the newly added strict **100% line / 100% branch** gate for this module:

- Source: `inventory-allocation.js`
- Verified coverage: **100.00% lines / 100.00% branches**
- Workflow: [Test Coverage run #41222339144](https://github.com/45s/coinzilla/actions/runs/41222339144)
- Regression coverage includes exact allocation, retained residual inventory, repeated cycles, zero keep quantity, invalid amounts, insufficient inventory, deterministic output, and input immutability.
