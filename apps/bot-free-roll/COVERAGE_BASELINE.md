# Free-Roll coverage baseline

**Captured:** 2026-10-31  
**Commit:** `6b8fb6f20cb77bf988aa5dc24daf2e0fb9e2c1d8` (merge of PR #266)  
**Workflow:** [Test Coverage run](https://github.com/45s/coinzilla/actions/runs/41182635099)  
**Runtime:** Node.js 22, built-in test runner and coverage reporter

This is a source-file baseline for `apps/bot-free-roll`, captured after the helper, fill-reconciliation, order-execution, and event-handling extractions.

## First-party source baseline

| Source file | Lines | Branches | Current gate |
|---|---:|---:|---:|
| `bot-free-roll.js` | 97.45% | 87.78% | 95% / 75% |
| `event-handling.js` | 94.12% | 92.31% | 90% / 90% |
| `fill-reconciliation.js` | 97.09% | 80.00% | 95% / 75% |
| `helpers/accounting.js` | 93.65% | 89.47% | 90% / 85% |
| `helpers/decimal.js` | 98.55% | 96.00% | 95% / 90% |
| `helpers/order-planning.js` | 91.84% | 63.64% | 90% / 60% |
| `helpers/price.js` | 81.40% | 70.97% | 80% / 65% |
| `helpers/trading-rules.js` | 95.06% | 93.94% | 90% / 90% |
| `order-execution.js` | 100.00% | 79.71% | 95% / 75% |
| `prepare-broker.js` | 80.43% | 75.00% | 80% / 70% |
| `validate-config.js` | 94.52% | 92.86% | 90% / 90% |

The gate values are conservative floors below the captured results. They are intended to prevent regressions while leaving room for normal refactoring; they are not aspirational coverage targets. The existing 95% / 75% gate for the main bot orchestrator is preserved.

## Highest-value uncovered paths

1. **Price planning — `helpers/price.js` (81.40% lines, 70.97% branches).** The largest gap among the strategy's pure decision helpers. Prioritize invalid/missing price inputs, boundary handling, and alternate price-source branches.
2. **Broker preparation — `prepare-broker.js` (80.43% lines, 75.00% branches).** Cover setup failures and cleanup/error paths; this is a boundary where a false success could let the bot start without a usable broker.
3. **Order planning — `helpers/order-planning.js` (91.84% lines, 63.64% branches).** Branch coverage is the main weakness. Add focused boundary and rejection cases without changing the financial rules.
4. **Accounting — `helpers/accounting.js` (93.65% lines, 89.47% branches).** Close remaining validation and fee-accounting branches, especially missing/unsupported commission facts and exact quantity/proceeds boundaries.
5. **Execution/event orchestration.** The extracted modules already have strong line coverage, but remaining branches in `order-execution.js`, `fill-reconciliation.js`, and `event-handling.js` concern cancellation races, malformed fills, and event routing. Only add tests where they exercise meaningful safety behavior.

## Interpreting the workspace report

The workspace coverage workflow runs package tests separately. The Free-Roll app's own test process also loads workspace dependencies, so its unfiltered `all files` row includes broker-package code that is not exercised by the app's tests (the captured app-run aggregate was 80.88%). Do not use that dependency-inclusive aggregate as the Free-Roll app's source score. The gates instead target named first-party app modules, while each workspace package is covered by its own test job.

## Policy

- Keep coverage reporting and thresholds on Node's built-in test runner; add no coverage dependency.
- Gate the safety-critical first-party modules individually so one well-covered file cannot hide an uncovered module.
- Do not add tests solely to execute lines. Tests must assert observable behavior and safety invariants.
- Raise thresholds only after the next relevant tests are merged and the new baseline is measured.
- Review this baseline after substantial module extraction or changes to the Node test runner.
