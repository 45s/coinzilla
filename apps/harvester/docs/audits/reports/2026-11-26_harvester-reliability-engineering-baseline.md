# Harvester Reliability Engineering Baseline

**Assessment date:** 2026-11-26  
**Repository:** 45s/coinzilla  
**Baseline branch:** develop  
**Baseline commit inspected:** 5b495ed97e1965c857ad5cbadeddabc3f9d1835f  
**Tracking:** [Reliability umbrella issue #1639](https://github.com/45s/coinzilla/issues/1639)

## Executive assessment

Harvester is not starting from zero. It already has substantial safety-oriented architecture, explicit domain invariants, critical-behavior traceability, measured coverage enforcement, offline regression suites, structured diagnostics and documented operator boundaries.

The current risk is that these mechanisms are not yet sufficient evidence that failures are bounded at real runtime composition boundaries or that every critical lifecycle is bounded, independently recoverable and protected by required CI.

This report records verified observations and separates confirmed CI failures from hypotheses. It is a baseline, not a certification or a claim that the application is production-safe.

## Existing enforcement and architecture

| Capability | Existing source of truth | Baseline observation |
|---|---|---|
| Harvester-specific agent constraints | `apps/harvester/AGENTS.md` | Requires implementation, regression tests and same-commit docs; GitHub Actions is verification runner; no agent merge/auto-merge |
| Critical behavior inventory | `apps/harvester/docs/critical-behaviors.json` | Existing named source, invariant and test mappings |
| Critical behavior validator | `apps/harvester/scripts/check-critical-behavior-contract.js` | Checks named normal/failure tests, optional integration requirement, source ownership, path boundaries and coverage metadata |
| Critical module coverage | `apps/harvester/scripts/check-critical-module-coverage.js` | Checks measured line/branch/function floors for each listed module |
| Critical behavior checker tests | `apps/harvester/test/critical-behavior-contract.test.js` | Includes tests for missing behavior owners, missing regression names, invariant omissions and coverage metadata |
| Coverage checker tests | `apps/harvester/test/critical-module-coverage.test.js` | Includes below-floor and missing-module rejection |
| Shutdown lifecycle | `apps/harvester/src/bootstrap/shutdown/create-shutdown-handler.js` | Current develop contains ordered shutdown phases and incomplete-shutdown handling |
| Strategy shutdown coordination | `apps/harvester/src/bootstrap/shutdown/create-strategy-shutdown-coordinator.js` | Strategy participants own strategy safety proof; coordinator composes participants |
| Trading safety/domain rules | `apps/harvester/docs/TRADING_FIRST.md` and domain specifications | Existing source of truth; must be preserved rather than replaced with generic reliability rules |

**Important:** Do not create a second critical behavior inventory, duplicate coverage checker, parallel readiness state or generic runtime configuration framework. Extend the existing authoritative mechanisms only when a concrete gap is demonstrated.

## Verified CI evidence

### PR #1858 — shutdown, order ownership and recovery changes

Inspected head at assessment: `aa56bfb38e1934de3df82b26d2851a6eccbc3506`.

At inspection, compare against develop reported 167 commits ahead and 0 behind. The associated Harvester Targeted Tests run failed:

- Workflow run: [45788863581](https://github.com/45s/coinzilla/actions/runs/45788863581)
- Failed job: `Run configured Harvester regression tests`
- Job ID: `139802488875`
- Failing test: `src/bootstrap/shutdown/create-shutdown-handler.test.js`
- Reported test duration: 300.10 seconds
- Test runner result: TIMEOUT
- Unit Tests and Test Coverage workflows were cancelled.
- Repository Quality, Dependency Audit and External Documentation Links succeeded.

This is a confirmed CI failure on the inspected PR head. The child process output also reported: `Promise resolution is still pending but the event loop has already resolved`, followed by `spawnSync ... ETIMEDOUT` from `apps/harvester/scripts/run-targeted-tests.js`. The test runner did not identify an individual subtest in the captured output. The exact underlying cause is **not yet established**. Do not infer that the failure is necessarily the new CLOSING audit timeout test merely because that test is present in the PR. Reproduce the exact file on the current PR head with per-test diagnostics and isolate the unresolved promise/active handle before changing behavior.

The PR introduces or substantially modifies shutdown phase deadlines, pending-operation tracking, cancellation signals, CLOSING audit barriers and retry behavior. These require particular scrutiny for:
- unbounded waits hidden behind nested coordinators;
- timeout callbacks that do not settle the outer operation;
- cancellation signals ignored by participants;
- timers not cleared or referenced handles retaining the process;
- retry while a prior operation is still running;
- reporting STOPPED despite unresolved work;
- cleanup that disconnects the broker before required safety proof.

No production change is proposed by this report alone.

### PR #1861 — readiness report and startup composition

Inspected head: `8de9b7c6cd926dae6245a4109b951a821a1dd1c6`.

At inspection, compare against develop reported 48 commits ahead and 0 behind. All associated workflow results were `action_required`; these are not passing CI results and do not establish a source-code failure.

The PR adds:
- `src/application/operator/create-harvester-readiness-report.js` (1,531 additions);
- substantial startup orchestration changes in `src/bootstrap/start-harvester.js`;
- startup-readiness architecture documentation;
- readiness tests and status handling.

Required independent review:
- Is readiness evidence derived from authoritative existing subsystem state?
- Is there exactly one owner for each readiness fact?
- Are optional component failures distinguished from route/account blockers?
- Can any route report READY while account-wide reconciliation is unresolved?
- Does the report expose stale, missing or contradictory evidence rather than normalize it away?
- Does startup remain bounded if a readiness provider never settles?
- Can readiness diagnostics be added without creating a second orchestration authority?

Do not equate report size with a defect. The concern is correctness, ownership and maintainability, to be proven by source review and tests.

## Initial reliability risks to investigate

These are audit work items, not yet confirmed defects unless separately marked.

| ID | Priority | Classification | Area | Evidence / next proof |
|---|---|---|---|---|
| REL-HARVESTER-001 | P1 | confirmed-ci-failure, root cause unknown | Shutdown lifecycle | Reproduce 300.10s timeout on #1858 and isolate exact pending operation; no fix until reproduced |
| REL-HARVESTER-002 | P1 | design-risk | Readiness ownership | Independently inspect #1861 source and prove one authoritative owner for readiness facts |
| REL-HARVESTER-003 | P1 | missing-enforcement-to-verify | CI required checks | Inspect branch protection/rulesets; workflow presence alone is insufficient |
| REL-HARVESTER-004 | P1 | baseline-gap | Fault-domain isolation | Build source-backed map of optional component, market route and provider/account dependencies; test failure propagation through actual composition |
| REL-HARVESTER-005 | P1 | baseline-gap | Crash/restart | Verify which order, fill, reservation, portfolio and recovery facts are durable and what blocks trading when restoration is incomplete |
| REL-HARVESTER-006 | P1 | baseline-gap | Unknown broker outcomes | Trace submit/cancel timeout through durable intent, identity lookup, reconciliation and retry gates |
| REL-HARVESTER-007 | P2 | baseline-gap | Coverage provenance | Measure current exact-develop per-module coverage and validate that recorded baselines match the measured source tree |
| REL-HARVESTER-008 | P2 | baseline-gap | Operational observability | Trace correlation IDs and stable failure codes across broker, persistence, market and lifecycle boundaries |

Priorities are provisional risk rankings. Promote/demote only with source and runtime evidence.

## Fault-containment contract to apply during audit

Three fault domains are required:

1. **Optional component:** notification, dashboard and nonessential presentation. Failure degrades that capability. It must not block trading unless the component is explicitly a required dependency.
2. **Market/strategy route:** market data, candle history or one strategy-symbol route. Failure blocks the affected route. Other routes may continue only if shared account, inventory, ownership, persistence and reconciliation invariants remain proven.
3. **Provider/account:** user-data integrity, account snapshot, shared balances, order ownership and durable account state. Uncertainty blocks all operations that depend on that account/provider evidence.

The contract is intentionally a policy model, not a new runtime state machine. Existing strategy and account state machines remain authoritative.

## Required evidence format for each audit finding

~~~yaml
id: REL-HARVESTER-###
priority: P0 | P1 | P2 | P3
classification: confirmed-defect | missing-guard | missing-test | design-risk | external-blocker
fault_domain: component | market-route | provider-account
owner:
source_paths: []
reproduction:
expected_invariant:
observed_behavior:
risk:
corrective_change:
regression_tests:
integration_evidence:
coverage_evidence:
dependencies: []
release_impact:
status: open | in-progress | verified | blocked
verified_head_sha:
~~~

A finding is not verified by documentation alone or by a green unrelated workflow. Every verification records the exact commit SHA and relevant workflow/job/test evidence.

## Measurement and verification limitations

- This assessment did not execute local tests; GitHub Actions is the repository-prescribed verification runner for Harvester agent work.
- No current full package or per-critical-module coverage percentages are claimed in this report. Existing metadata must be checked against an exact develop-source coverage run before thresholds are changed or baseline claims are made.
- Branch protection and ruleset enforcement have not yet been independently verified. A workflow in the repository does not prove its status check is required.
- No live exchange activity was performed or authorized.
- TESTNET mutations remain subject to explicit operator coordination.

## Next actions

1. Refresh develop and PR heads before any implementation; the SHAs above are historical observations.
2. Reproduce and diagnose REL-HARVESTER-001 on an isolated current branch. Preserve the failing behavior contract; do not relax timeout or assertions to make CI green.
3. Independently review readiness changes and current develop composition before deciding whether to continue #1861, split it or request changes.
4. Verify CI required-check configuration and current coverage provenance.
5. Map the actual runtime fault domains, then add focused composition-level failure-isolation tests.
6. Convert confirmed findings into small PRs against develop. Keep PRs open for user review; never merge or enable auto-merge.

## Definition of done

- All P0/P1 findings are fixed or explicitly retained as release blockers with owner and evidence.
- Critical behavior invariants are tied to executable normal/failure and required integration tests.
- Fault containment is demonstrated at real application composition boundaries.
- Unknown outcomes and incomplete restoration remain blocked until authoritative reconciliation.
- Shutdown is bounded, truthful and retry-safe.
- CI gates are required, exact-head and green.
- Operational readiness and recovery claims are backed by controlled evidence.
