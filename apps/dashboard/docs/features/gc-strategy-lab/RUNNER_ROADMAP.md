# Scenario Runner phased implementation roadmap

**Tracking:** Issue #1836 · PR #1837 · Initial adapter: RS · Strategy-neutral core

## Approved branch-only refactoring and agent preflight

Trading domain logic and services may be refactored as required to reuse production flow faithfully. Preserve real-trading behavior and safety invariants; document changed call paths and add regression tests. Keep all work on the task branch/PR; never commit directly to `develop`/`main`, merge or auto-merge.

**Mandatory preflight:** before any exploration or edits, read repository-root `AGENTS.md` and every applicable nested `AGENTS.md`. Issue #1836, PR #1837 and this roadmap explicitly require it. Re-read instructions whenever scope expands.

## Phase 0 — Audit
Read applicable AGENTS/workflow/engineering docs; map existing RS scenarios, entry points, dependencies, config/market-metadata pipeline and worker isolation feasibility. Identify production-flow seams and isolation requirements; refactor as needed on the branch, with tests and evidence-based boundary mapping.

## Phase 1 — Generic core/contracts
Define framework-independent contracts for adapters, capabilities, scenarios, requests, validated config, lifecycle, results, trace, diagnostics. Generic orchestration only, no strategy branches. Unit/architecture tests without Angular or trading-side effects.

## Phase 2 — RS adapter
Integrate the existing registry and executable subcases; derive fields/events/assertions from source. Preserve provenance. Initially use existing supported event/scenario inputs; defer arbitrary timeline authoring.

## Phase 3 — Simulation infrastructure/isolation
Dedicated worker per run, separate from live trading process; fresh state and simulation-only broker/order gateway, market/event source, clock and persistence as needed. Prove no credentials, live account, production persistence or real broker fallback. Fail closed if isolation cannot be verified. Trading-service refactoring is permitted within this task branch and scope when required for faithful production reuse.

## Phase 4 — Lifecycle + transport
REST commands and authoritative status/results/diagnostics; WebSocket lifecycle/progress. Server-owned queued/starting/running/cancelling and terminal completed/failed/cancelled/timed-out/blocked states. Cooperative cancellation then forced termination, distinct timeout, bounded resources, cleanup and REST recovery after socket loss. Strict loopback-only unauthenticated local binding; remote access deferred pending auth.

## Phase 5 — Playground/configuration
Schema-driven inputs/config; temporary run-local overrides, never modify original scenario. File and Playground config use the same production parse/validate/normalize/metadata pipeline. Invalid input blocks before execution. Replay exact original code revision/configuration; no newer-revision comparison.

## Phase 6 — Trace/results/assertions
Capture execution-produced events, steps, calculations, decisions, reasons, trace and outputs. Evaluate assertions; compare expected/actual; distinguish intent, simulated broker outcome and simulated fill. Renderer-neutral graph model and inspectable trace.

## Phase 7 — Bounded history
Harvester-side retention of simulation-only run records, snapshots, lifecycle, event order, results, assertions, trace and diagnostics. Bounded and configurable; no secrets, live data or production state.

## Phase 8 — AI Debug Package
One-click complete, versioned JSON with scenario, overrides, effective config, revision, metadata, events, status, results, trace, assertions and diagnostics. Redact secrets; never silently truncate; provide complete export fallback.

## Phase 9 — Dashboard/end-to-end acceptance
Framework-neutral client core and typed API/WS adapters; Angular presentation only. Setup, run, lifecycle, graph/trace inspection, history and copy/export. Test isolation, production-flow reuse, validation, cancellation, timeout, reconnect, report completeness and framework-swap invariance.

## Phase 10 — Hardening/future adapters
Security/resource/redaction/retention/race audit. Add GC Conservative/Aggressive, futures, grid or other adapters only when executable scenarios/contracts exist. Arbitrary event timeline, saving Playground changes, newer-version comparisons and remote/shared execution remain deferred.

## MVP gates

- Production-flow reuse demonstrated with necessary refactoring documented and regression-tested.
- Isolation verified; worker cannot reach live trading infrastructure.
- Existing RS scenarios run and produce real assertions/results/trace.
- Temporary inputs pass production validation and cannot alter source scenario.
- REST/WS lifecycle, cancel/timeout, bounded history and complete debug JSON tested.
- Docs/issue/PR accurately reflect implementation and verified evidence.

## Agent preflight and branch safety (mandatory)

Read repository-root `AGENTS.md` and every applicable nested `AGENTS.md` before exploration or edits. Repeat this rule in the issue, PR and roadmap. All work stays on the task branch and PR; no direct `develop`/`main` commits, merge or auto-merge. Trading logic/services refactors are permitted for this task where required to reuse production flows, with regression tests and behavior preservation.

## Implementation progress (2026-11-25)

- [x] Strategy-neutral lifecycle orchestration, bounded in-memory run history, two-worker concurrency cap, ten-run FIFO queue and lifecycle notifications.
- [x] Dedicated process-worker adapter, minimal worker environment, IPC, bounded termination and fail-closed unsupported dispatch.
- [x] RS-004-011 adapter invokes production `calculateRecoverySellerProfitability`, produces actual trace and assertion comparison; catalogue advertises only this executable case.
- [x] Local REST run/catalog/history/status/cancel routes and WebSocket lifecycle hints.
- [x] Framework-independent Dashboard graph/debug-package core and Runner presentation workspace.
- [ ] Full RS registry integration and scenario coverage beyond RS-004-011; config schema pipeline/Playground/replay; persistent history; complete report provenance/completeness; resource/concurrency limits; end-to-end isolation and CI acceptance remain incomplete.


## Execution-first/no-fake-blocker commitment

Implementation agents must complete all approved phases autonomously. No routine local environment/tooling absence may be reported as a blocker or used to stop work; use remote GitHub operations and Actions where supported. Blockers must be genuine, evidenced and narrowly described. Continue independent work, never ask the user to perform coding or routine verification, and never claim unverified results. This is a durable workflow requirement, not a reason to weaken safety or CI.
