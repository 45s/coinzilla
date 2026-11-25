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
- REST/WS lifecycle, cancel/timeout, bounded history and complete debug JSON tested. Current WebSocket updates refresh the selected run or background-run history, and reconnect performs REST recovery; cursor-based event replay and end-to-end outage/race acceptance remain open.
- Docs/issue/PR accurately reflect implementation and verified evidence.

## Agent preflight and branch safety (mandatory)

Read repository-root `AGENTS.md` and every applicable nested `AGENTS.md` before exploration or edits. Repeat this rule in the issue, PR and roadmap. All work stays on the task branch and PR; no direct `develop`/`main` commits, merge or auto-merge. Trading logic/services refactors are permitted for this task where required to reuse production flows, with regression tests and behavior preservation.

## Implementation progress (2026-11-25)

- [x] Strategy-neutral lifecycle orchestration, bounded in-memory run history, two-worker concurrency cap, ten-run FIFO queue and lifecycle notifications.
- [x] Dedicated process-worker adapter, minimal worker environment, IPC, bounded termination and fail-closed unsupported dispatch.
- [x] RS-004-011 is a provisional PRELIMINARY candidate derived from open PR #1823; it invokes only production `calculateRecoverySellerProfitability`, not the full strategy lifecycle. The source registry and mapped tests are not merged into `develop`.
- [x] The deterministic production SELL dispatch integration fixture was moved to `apps/harvester/test/scenarios/recovery-seller/rs-runtime-dispatch-fixture.js`. It exercises production runtime dispatch/accounting/authorization/submission with a run-local simulated broker, but has no scenario ID and is not part of the public catalogue.
- [x] The public catalogue excludes synthetic runtime fixture IDs. The host requires an explicitly simulation-only adapter and a matching OS-level sandbox attestation; no production launcher supplies one, so no RS scenario is executable.
- [x] Harvester sanitizes run inputs, outputs and diagnostics recursively before exposing snapshots; raw validated input is kept private only until adapter execution begins. Dashboard debug-package redaction provides a second layer.
- [x] Adapter promise rejections are normalized into terminal failure results. If worker cleanup cannot be confirmed, the runner retains the execution slot, reports the cleanup failure, and rejects shutdown rather than silently releasing capacity.
- [x] Local REST run/catalog/history/status/cancel routes and WebSocket lifecycle hints.
- [x] Framework-independent Dashboard application orchestration for catalog/history, executable-scenario gating, JSON/schema validation, submit/refresh/cancel/history retrieval, trace graph and debug-package preparation; Angular is limited to presentation state and transport adaptation.
- [ ] Full RS registry integration (the separate registry work in PR #1823 is not merged into develop), additional source-mapped scenarios, production configuration readiness, schema-driven config/Playground/replay, persistent history, exact-revision replay, complete report provenance, resource/concurrency limits and end-to-end OS isolation remain incomplete.

## Execution-first/no-fake-blocker commitment

Implementation agents must complete all approved phases autonomously. No routine local environment/tooling absence may be reported as a blocker or used to stop work; use remote GitHub operations and Actions where supported. Blockers must be genuine, evidenced and narrowly described. Continue independent work, never ask the user to perform coding or routine verification, and never claim unverified results. This is a durable workflow requirement, not a reason to weaken safety or CI.

## 2026-11-25 — Runner lifecycle and CI corrections

The Harvester lifecycle now keeps a run in `Cancelling` until the adapter execution settles, rather than treating delivery of an abort signal as proof that its worker has exited. Adapter cancellation is required by the runner contract. The Dashboard API and component source also require real line breaks in object literals and declarations; escaped source-text sequences are not valid TypeScript syntax.

## Dashboard integration corrections

The current Dashboard integration is a local-development client for the Harvester REST/WS adapter. The history action loads a prior run's recorded inputs; it is not original-revision replay. The debug JSON display is a selectable-text fallback, and clipboard success is shown only after the clipboard promise resolves. Recursive redaction currently covers API/access/private keys, secrets, passwords/passphrases, tokens, credentials, authorization/bearer values, cookies, sessions, JWTs and signatures; this does not establish complete package provenance or replace a full security review. The implementation remains incomplete until persistent bounded history, exact-revision replay, complete provenance/evidence, and the remaining MVP acceptance gates are implemented and verified.

## Workflow-policy correction — 2026-11-25

A cross-document audit found that the Dashboard agent instructions still required a Task Preflight run when scope crossed into another domain, contradicting the root policy and the merged Task Preflight retirement. The nested instruction now requires reading the affected domain's instructions, roadmap, source, consumers and tests; Task Preflight remains optional and is not a gate. The same correction removes an obsolete approval requirement: the approved Scenario Runner task explicitly permits necessary trading-service/domain refactoring on its task branch, with behavior preservation, regression tests and no real exchange operations. This does not authorize unrelated trading changes.

## Current branch synchronization checkpoint — 2026-11-25

- Task branch: `docs/dashboard/gc-strategy-lab-spec`.
- Current branch head after the policy correction: `2583dbd134da8c6b241b0e88de535712efb57c97`.
- Current `develop`: `1f55d5989e8122421f4d9e37693f68f32e0c29ed`.
- GitHub compare reports 86 commits ahead and 42 commits behind, with merge base `24132a3f485efdc0a75c3bbcf4fd0e94778c79b9`. The branch is materially diverged; it is not current with develop. Synchronization and conflict review are required before final acceptance.
- PR #1837 remains Draft and unmerged. The full approved MVP is not complete; all previously listed isolation, production-flow, persistence, replay, trace/report, configuration and E2E gates remain applicable.
- No CI success is claimed for `2583dbd` until exact-head GitHub Actions results are available.
