# Scenario Runner phased implementation roadmap

**Tracking:** Issue #1836 · PR #1837 · Initial adapter: RS · Strategy-neutral core

## Updated permission and branch safety
Trading-domain logic and trading services may be modified/refactored when required for faithful reuse of production flow. Preserve behavior and trading safety; document the change, regression tests, and affected call paths. Work only on the dedicated task branch/PR; never commit directly to `develop` or `main`, merge, or enable auto-merge. User reviews and merges.

**Mandatory first step:** read root `AGENTS.md` and every applicable nested `AGENTS.md) before code exploration or edits. Issue, PR and roadmap must explicitly retain this rule. Continue autonomously; routine execution or verification availability must not be cited as a blocker or handed back to the user.

## Phase 0 — Audit
Read applicable AGENTS/workflow/engineering docs; map existing RS scenarios, entry points, dependencies, config/market-metadata pipeline and worker isolation feasibility. Identify protected files and blockers without editing them. Deliver evidence-based boundary map.

## Phase 1 — Generic core/contracts
Define framework-independent contracts for adapters, capabilities, scenarios, requests, validated config, lifecycle, results, trace, diagnostics. Generic orchestration only, no strategy branches. Unit/architecture tests without Angular or trading-side effects.

## Phase 2 — RS adapter
Integrate the existing registry and executable subcases; derive fields/events/assertions from source. Preserve provenance. Initially use existing supported event/scenario inputs; defer arbitrary timeline authoring.

## Phase 3 — Simulation infrastructure/isolation
Dedicated worker per run, separate from live trading process; fresh state and simulation-only broker/order gateway, market/event source, clock and persistence as needed. Prove no credentials, live account, production persistence or real broker fallback. Fail closed if isolation cannot be verified. Trading-service refactoring is permitted on this task branch with behavior-preservation and regression tests.

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
- Production-flow reuse demonstrated; necessary trading-service refactors are documented and regression-tested.
- Isolation verified; worker cannot reach live trading infrastructure.
- Existing RS scenarios run and produce real assertions/results/trace.
- Temporary inputs pass production validation and cannot alter source scenario.
- REST/WS lifecycle, cancel/timeout, bounded history and complete debug JSON tested.
- Docs/issue/PR accurately reflect implementation and verified evidence.
