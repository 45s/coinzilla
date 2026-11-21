# Harvester Reliability Baseline — 2026-11-21

**Status:** Baseline established; reliability implementation remains in progress.
**Repository:** `45s/coinzilla`
**Target:** `develop`
**Tracking issue:** [#1639](https://github.com/45s/coinzilla/issues/1639)
**Implementation PR:** [#1642](https://github.com/45s/coinzilla/pull/1642)

## Measurement provenance

- Exact `develop` source baseline: `7767ea8ce871b658a4bd68a03cc4c4999f582b49`.
- Coverage was measured by [Test Coverage run #44883479973](https://github.com/45s/coinzilla/actions/runs/44883479973), Harvester job `136783705310`.
- The measurement ran on PR #1642 head `23e5aa3211ef324866f305eaf7bdef2c0f0fdc50`. At that measured revision, the PR diff contained no `apps/harvester/src/**` changes, so the production source under test was byte-for-byte the `develop` source at the recorded base SHA. Later commits in this PR add a narrowly scoped process-lock input-validation fix; they do not change the provenance of the recorded baseline.
- The package coverage command includes `src/**/*.js` and excludes `src/**/*.test.js`; the additional test and validation scripts in PR #1642 do not alter production-source coverage.
- The run completed successfully with **90.35% lines, 83.22% branches, and 96.00% functions** across the Harvester package.

The full measured baseline and per-module minimums are machine-readable in [critical-behaviors.json](./critical-behaviors.json). It currently records 14 critical behaviors and 30 production modules. The floors are rounded down to five-percentage-point increments and capped at 95% where a baseline is 100%; this leaves bounded room for new branches while preventing larger regressions. A floor is never set above its measured baseline.

## Critical coverage gaps

| Critical module | Baseline lines | Baseline branches | Baseline functions | Minimum lines / branches / functions |
| --- | ---: | ---: | ---: | ---: |
| `recovery-fill-accounting.js` | 82.61% | **53.85%** | 100.00% | 80 / 50 / 95 |
| `project-harvester-operational-state.js` | 81.97% | 76.39% | 82.05% | 80 / 75 / 80 |
| `restore-harvester-operational-state.js` | 92.21% | 73.68% | 100.00% | 90 / 70 / 95 |
| `acquire-harvester-process-lock.js` | 83.33% | 74.42% | 72.73% | 80 / 70 / 70 |
| `portfolio.js` | 85.54% | 75.65% | 100.00% | 85 / 75 / 95 |
| `conservative-trading-engine.js` | 85.51% | 79.60% | 95.65% | 85 / 75 / 95 |

These are coverage measurements, not confirmed defects. The lowest branch baseline is recovery fill accounting. PR #1642 adds five focused validation-boundary regressions for missing market/fill identity, market mismatch, unsupported side, missing or wrong-asset quote notional, and non-positive quote notional; the next coverage run will quantify the branch improvement. The state projection/restoration branches are the next candidates. PR #1642 adds four restore-use-case failure simulations for missing ports, returned read errors, and thrown read/projection failures; the next coverage run will quantify the improvement. PR #1642 also hardens process-lock input validation against dot-path lock names and adds malformed-lock, external-removal, and stale-owner replacement-race regressions. The stale-owner recheck is extracted into a bounded helper without changing its fail-closed re-read-before-unlink behavior. Floors should be raised only after tests add meaningful evidence; they must not be lowered to accommodate a regression.

## Active runtime scope and hard limits

The current configuration enables `CG_coinGrabber` with Conservative mode enabled. Aggressive mode and the CG recovery-restoration setting are disabled. `RS_recoverySeller` is disabled and its operator pair map is empty. The behavior inventory therefore maps the active CG Conservative execution path; it does not present dormant strategy modules as active runtime guarantees.

The durable Operational State Store and crash matrix provide offline evidence only. The runtime restore use case returns a candidate that requires exchange reconciliation; default startup does not restore Portfolio/RecoveryLedger/OrderRegistry from that candidate and does not resume trading from Journal history. The inventory explicitly records this as offline-only/disabled. Do not enable Journal replay or runtime restoration as part of this initiative without completing the separate #654 acceptance gates.

The controlled Binance TESTNET runbook is **CLOSED / PAUSED**. Its current blockers include the prior HTTP 451 regional-eligibility response and a mismatch between the old two-pair validation plan and the currently enabled TESTNET pair set. Offline engineering and deterministic CI may continue. This task has performed no TESTNET mutation, no order submission/cancellation, no account-setting change, and no LIVE operation.

## Existing test and integration evidence

| Evidence | What it proves | What it does not prove |
| --- | --- | --- |
| `src/use-cases/conservative-trading-engine.test.js` | Deterministic engine behavior with an injected harness broker, including submission, cancellation, fill, and recovery failure paths. | Full bootstrap composition or exchange protocol behavior. |
| `src/bootstrap/start-harvester.test.js` | Real `startHarvester` composition with deterministic broker/stream test doubles, startup audits, lifecycle, and recovery readiness. | Connectivity to a live Binance TESTNET endpoint. |
| `test/replays/doge-zro-conservative-replay.test.js` plus its harness | Real `startHarvester` and Binance broker-adapter composition driven by deterministic exchange/user-data replay; verifies actual order request sequencing and recovery accounting. | Actual exchange matching, rate limits, account state, or external network reliability. |
| `test/recovery/operational-state-crash-matrix.test.js` | Real append-only Operational State Store files, integrity validation, crash-boundary projection, and offline candidate restoration. | Runtime process restart restoration or authorization to trade from restored state. |
| `src/index.test.js` and process-lock tests | Process lock acquisition, startup ordering, and shutdown retention/release behavior under deterministic failures. | Abrupt host/power loss behavior on an actual deployment filesystem. |

The read-only Binance TESTNET integration workflow was skipped in the recorded CI run. No exchange acceptance claim is made.

## CI and local verification commands

The package scripts are:

- `pnpm --filter @coinzilla/harvester test` — complete Harvester test suite.
- `pnpm --filter @coinzilla/harvester test:targeted` — configured targeted regression suite.
- `pnpm --filter @coinzilla/harvester test:coverage` — full suite with package-wide 80% line/branch/function floors.
- `pnpm --filter @coinzilla/harvester run check:reliability` — behavior/invariant/source/test/runtime/coverage inventory validation.
- `pnpm --filter @coinzilla/harvester run check:critical-coverage <coverage-report>` — per-module floors against a captured Node coverage report.

The required Unit Tests workflow runs the behavior inventory check before the complete Harvester package suite. The required Test Coverage workflow captures the Harvester coverage output and enforces every module floor. The existing JavaScript Syntax workflow retains strict changed-file ESLint and full-workspace lint; no required status-context name or branch ruleset was renamed or weakened. Harvester Targeted Tests remains an additional focused suite.

Recorded baseline-run results: Unit Tests, Test Coverage, and Harvester Targeted Tests passed on PR head `23e5aa3211ef324866f305eaf7bdef2c0f0fdc50`. A separate JavaScript Syntax run caught a missing H1 in the newly edited Harvester roadmap; that heading was restored. Final exact-head verification is tracked by PR #1642 and must be green before merge.

## Confirmed guarantees and unresolved audit questions

- The stale Binance `FILLED → OPEN` order-report regression (F-054) is already fixed in current `develop`; the OrderRegistry regression test verifies the terminal state and executed quantity remain monotonic. It is not an open defect in this baseline.
- No new P0 defect is confirmed by this baseline evidence alone. This is not a declaration that the full source reliability audit is complete.
- Earlier passing test logs contained expected-looking failure-path diagnostics for backwards canonical executed quantity during cancellation and incomplete REST fill reconciliation during shutdown. Their test assertions must be reviewed before classifying these as defects or merely noisy expected-failure evidence.
- The current behavior inventory is the canonical source for critical invariants, source ownership, named regressions, runtime status, and module coverage floors. Update it with every in-scope behavior change.

## Next audit/implementation priorities

1. Raise recovery-fill-accounting branch coverage with meaningful commission, fee-asset, partial-fill, and invalid-input regressions.
2. Inspect the untested failure branches in operational-state projection and candidate restoration; keep runtime restoration disabled until the independent acceptance gate is complete.
3. Review process-lock and shutdown failure paths, including ownership-token changes, unresolved cancellation, CLOSING durability failure, and cleanup retention.
4. Exercise user-data disconnect/reconnect, missing-event recovery, stale snapshots, incomplete history, and queued-event draining with deterministic runtime-composition tests.
5. Keep actual TESTNET validation separate and paused until the runbook's pair-scope and regional-eligibility blockers are resolved by an explicitly authorized session.

This report is a dated baseline checkpoint, not a completion certificate for issue #1639.
