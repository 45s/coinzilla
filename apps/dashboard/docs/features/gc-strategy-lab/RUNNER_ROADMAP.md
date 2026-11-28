# Scenario Runner phased implementation roadmap

**Tracking:** Issue #1836 · [PR #1837](https://github.com/45s/coinzilla/pull/1837) (merged foundation) · Initial adapter: RS · Strategy-neutral core

## Current status — 2026-11-28

### GitHub `develop` catalogue preview

Dashboard issue [#1986](https://github.com/45s/coinzilla/issues/1986) adds an opt-in checkbox that reads the RS scenario declarations from two source files at a single pinned `develop` commit and displays their IDs, names, layer and mapping status without restarting Harvester. This is a metadata preview only: downloaded JavaScript is never evaluated, all remote entries are forced non-executable, and scenario submission remains disabled until the operator switches back to the live Harvester catalogue. The live `/catalog` endpoint remains authoritative for execution. A refresh failure preserves the previously displayed catalogue and reports the error.

## Current status — 2026-11-27

The Scenario Runner foundation is merged. PR #1887 added the under-target fully FILLED SELL, STOP-persistence failure and BUY-only STOP admission runtime scenarios. PR #1913 adds six infrastructure-failure scenarios: SELL-intent persistence failure before broker placement, acknowledged-outcome persistence failure, combined outcome/STOP persistence failure, ambiguous broker placement classified as durable UNKNOWN with STOP/reservation retention, sole-SELL reservation callback failure, and terminal-reconciliation persistence failure that preserves the FILLED status/reservation while latching STOP.

The primary functional development and acceptance path is local **Windows**: start the Dashboard and Harvester, connect them through the local REST/WebSocket API, execute scenarios with simulation-only adapters, and inspect results, assertions, trace and diagnostics. No Linux server or separately purchased machine is required for this workflow. The Linux Bubblewrap/prlimit adapter (`HARVESTER_SCENARIO_SANDBOX=linux-bubblewrap`) is an optional, platform-specific OS-hardening path; its self-hosted Linux E2E is not a prerequisite for Windows scenario authoring, functional execution, or ordinary development acceptance. If the current host composition prevents the documented Windows local workflow, that is an implementation gap to fix—not a requirement for the user to provision Linux. Exact replay remains separately fail-closed until trusted artifact verification exists.

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
Dedicated worker per run, separate from the live trading process; fresh state and simulation-only broker/order gateway, market/event source, clock and persistence as needed. The supported local developer workflow must run on Windows with Dashboard + Harvester and must not require Linux, WSL2, a remote host, or purchased infrastructure. Prove that scenario execution uses simulation-only dependencies and cannot fall back to real broker calls, credentials, live account state or production persistence. Linux Bubblewrap/cgroup isolation is optional additional OS hardening, not a functional-development gate. Trading-service refactoring is permitted within this task branch and scope when required for faithful production reuse.

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
Framework-neutral client core and typed API/WS adapters; Angular presentation only. Setup, run, evidence-linked visual lifecycle, independent outcomes, selected-step evidence inspection, history and complete source JSON tree/search/copy/export. Test the Windows local Dashboard + Harvester workflow, simulation-only production-flow reuse, validation, cancellation, timeout, reconnect, report completeness and framework-swap invariance. Keep Linux OS-hardening acceptance separate and optional.

## Phase 10 — Hardening/future adapters
Security/resource/redaction/retention/race audit. Add GC Conservative/Aggressive, futures, grid or other adapters only when executable scenarios/contracts exist. Arbitrary event timeline, saving Playground changes, newer-version comparisons and remote/shared execution remain deferred.

## MVP gates

- Production-flow reuse demonstrated with necessary refactoring documented and regression-tested.
- Windows local Dashboard + Harvester workflow executes scenarios end-to-end using simulation-only adapters and produces inspectable results/assertions/trace.
- Scenario execution cannot reach live trading infrastructure or fall back to real broker/account/persistence dependencies.
- Linux Bubblewrap/cgroup adversarial E2E is optional platform-specific hardening; it is not a prerequisite for local Windows functional acceptance.
- Existing RS scenarios run and produce real assertions/results/trace.
- Temporary inputs pass production validation and cannot alter source scenario.
- REST/WS lifecycle, cancel/timeout, bounded history and complete debug JSON tested. Current WebSocket updates refresh the selected run or background-run history, and reconnect performs REST recovery; cursor-based event replay and end-to-end outage/race acceptance remain open.
- Docs/issue/PR accurately reflect implementation and verified evidence.

## Agent preflight and branch safety (mandatory)

Read repository-root `AGENTS.md` and every applicable nested `AGENTS.md` before exploration or edits. Repeat this rule in the issue, PR and roadmap. All work stays on the task branch and PR; no direct `develop`/`main` commits, merge or auto-merge. Trading logic/services refactors are permitted for this task where required to reuse production flows, with regression tests and behavior preservation.

## Implementation progress (2026-11-25)

- [x] Strategy-neutral lifecycle orchestration, bounded in-memory run history, two-worker concurrency cap, ten-run FIFO queue and lifecycle notifications.
- [x] Dedicated process-worker adapter, minimal worker environment, IPC, bounded termination and fail-closed unsupported dispatch.
- [x] RS-004-011 is a provisional PRELIMINARY candidate derived from the helper-only profitability calculation; it invokes only production `calculateRecoverySellerProfitability`, not the full strategy lifecycle. The RS test-coverage registry and mapped records from PR #1852 are merged into `develop`, but remain test-only and are not a production runtime catalogue.
- [x] The deterministic production SELL dispatch integration fixture was moved to `apps/harvester/test/scenarios/recovery-seller/rs-runtime-dispatch-fixture.js`. It exercises production runtime dispatch/accounting/authorization/submission with a run-local simulated broker, but has no scenario ID and is not part of the public catalogue.
- [x] The public catalogue excludes synthetic runtime fixture IDs. The host requires an explicitly simulation-only adapter and a matching OS-level sandbox attestation; no production launcher supplies one, so no RS scenario is executable.
- [x] Harvester sanitizes run inputs, outputs and diagnostics recursively before exposing snapshots; raw validated input is kept private only until adapter execution begins. Dashboard debug-package redaction provides a second layer.
- [x] Adapter promise rejections are normalized into terminal failure results. If worker cleanup cannot be confirmed, the runner retains the execution slot, reports the cleanup failure, and rejects shutdown rather than silently releasing capacity.
- [x] Local REST run/catalog/history/status/cancel routes and WebSocket lifecycle hints.
- [x] Framework-independent Dashboard application orchestration for catalog/history, executable-scenario gating, JSON/schema validation, submit/refresh/cancel/history retrieval, trace graph and debug-package preparation; Angular is limited to presentation state and transport adaptation.
- [ ] The supported production runtime catalogue/export boundary remains separate from the merged test-only PR #1852 registry. The RS catalogue now includes authorized submission, rejected submission, profitable partial CANCELED reconciliation and under-target fully FILLED STOP runtime scenarios; all remain PARTIAL/non-executable without trusted OS isolation. STOP-persistence failure and BUY-only STOP admission coverage are implemented in PR #1887; other infrastructure-failure scenarios, production configuration readiness, schema-driven config/Playground, complete original-revision replay, complete report provenance, resource/concurrency limits and end-to-end OS isolation remain incomplete. In-memory run history is accepted for this MVP.

## Execution-first/no-fake-blocker commitment

Implementation agents must complete all approved phases autonomously. No routine local environment/tooling absence may be reported as a blocker or used to stop work; use remote GitHub operations and Actions where supported. Blockers must be genuine, evidenced and narrowly described. Continue independent work, never ask the user to perform coding or routine verification, and never claim unverified results. This is a durable workflow requirement, not a reason to weaken safety or CI.

## 2026-11-25 — Runner lifecycle and CI corrections

The Harvester lifecycle now keeps a run in `Cancelling` until the adapter execution settles, rather than treating delivery of an abort signal as proof that its worker has exited. Adapter cancellation is required by the runner contract. The Dashboard API and component source also require real line breaks in object literals and declarations; escaped source-text sequences are not valid TypeScript syntax.

## Dashboard integration corrections

The current Dashboard integration is a local-development client for the Harvester REST/WS adapter. History browsing loads a prior run's recorded inputs; the separate same-revision replay action creates a linked run only when the original and active full source SHAs match, and blocks when provenance is unknown or mismatched. It does not fetch historical commits or reconstruct original dependencies/effective configuration/events. The debug JSON display is a selectable-text fallback, and clipboard success is shown only after the clipboard promise resolves. Recursive redaction currently covers API/access/private keys, secrets, passwords/passphrases, tokens, credentials, authorization/bearer values, cookies, sessions, JWTs and signatures; this does not establish complete package provenance or replace a full security review. In-memory history is accepted for this MVP. A test-only host-to-process-worker acceptance slice now exercises the ZRO runtime-dispatch fixture with simulated broker infrastructure; it does not make the RS adapter production-complete or establish OS isolation. Remaining gates are full replay provenance, production RS flow, a production-safe catalogue/export boundary, trusted OS isolation and full production end-to-end acceptance.

## Workflow-policy correction — 2026-11-25

A cross-document audit found that the Dashboard agent instructions still required a Task Preflight run when scope crossed into another domain, contradicting the root policy and the merged Task Preflight retirement. The nested instruction now requires reading the affected domain's instructions, roadmap, source, consumers and tests; Task Preflight remains optional and is not a gate. The same correction removes an obsolete approval requirement: the approved Scenario Runner task explicitly permits necessary trading-service/domain refactoring on its task branch, with behavior preservation, regression tests and no real exchange operations. This does not authorize unrelated trading changes.

## Current branch synchronization checkpoint — 2026-11-25

- Task branch: `docs/dashboard/gc-strategy-lab-spec`.
- The task branch is synchronized with current `develop` (0 commits behind); exact head and CI evidence are maintained in [issue #1836](https://github.com/45s/coinzilla/issues/1836) and [PR #1837](https://github.com/45s/coinzilla/pull/1837).
- PR #1837 is merged. The full approved MVP is not complete; production-flow, production-safe catalogue, OS isolation, replay provenance, trace/report, configuration and E2E gates remain applicable. The production catalogue is still non-executable without a trusted OS sandbox and matching attestation. Durable history is deferred and is not an MVP blocker.
- Do not claim CI success from a superseded head; all required checks must pass on the final exact head.

## Strategy-neutral Harvester registration — 2026-11-25

The Harvester host now accepts explicit strategy registrations and builds its catalog/execution policy from registered strategy IDs rather than a hardcoded RS-only catalog branch. The default composition still supplies the provisional RS catalogue, which remains non-executable without a verified OS sandbox and full production-flow adapter. A RED regression on test-only head `0b3a3fe9d10c844f4a7bd89fb94c66342fcdb561` reproduced the RS-only catalog; the implementation restores strategy-neutral registration without enabling any additional strategy.

### Cleanup capacity and retry — 2026-11-25

- Unconfirmed worker cleanup retains both the execution slot and history record; terminal status alone does not make it prunable.
- The cancel API awaits cleanup retry and reports acceptance only after the adapter confirms termination.
- Capacity is released only after explicit cleanup confirmation. Shutdown remains fail-closed when cleanup cannot be confirmed.

## Harvester Scenario Runner Linux sandbox — 2026-11-27

The Harvester API has an explicit opt-in Linux Bubblewrap/prlimit process adapter backed by a per-run delegated cgroup v2 hard memory/CPU/pids boundary. It is unavailable on hosts that do not pass the root-owned executable, namespace, seccomp, and cgroup-controller checks. This enables simulation-only runtime scenarios; production acceptance remains PARTIAL pending adversarial end-to-end isolation acceptance and trusted replay/build provenance.

## Linux sandbox adversarial acceptance — 2026-11-27

The Harvester Scenario Runner has a manual self-hosted E2E workflow that exercises the real Linux Bubblewrap/prlimit/cgroup sandbox. It checks namespace separation, secret omission, read-only source, no outbound connection, no child process, and enforced cgroup limits. The workflow requires the `scenario-sandbox` runner label and delegated cgroup v2; it also asserts that the real per-run cgroup directory is removed after child exit. Acceptance remains pending until the trusted workflow passes.

## Replay provenance trust boundary — 2026-11-27

The runner now rejects a caller-supplied `replayProvenance.verified: true` claim even when all identity fields contain syntactically valid hashes. The runner records the supplied identity for diagnostics but forces replay provenance to remain unverified until a trusted build-artifact verifier is integrated into trusted runtime composition. Exact replay remains blocked; no claim of artifact attestation or replay acceptance is made.

## Windows-first local scenario acceptance — 2026-11-27

The supported developer workflow is to run the Dashboard client and Harvester server locally on Windows. That is the expected environment for functional scenario development and acceptance: configure a scenario, submit it through the local API, execute the production-flow simulation with simulated infrastructure, and inspect the resulting status, assertions, trace, diagnostics and report.

No Linux server, WSL2 environment, self-hosted runner, or purchased machine is required to perform this functional check. The Linux Bubblewrap/prlimit/cgroup workflow validates an additional OS-isolation boundary only. Keep it as optional security-hardening evidence; do not make its availability or queued status block Windows development, scenario execution, or functional acceptance.

A platform-specific limitation in the current host composition that prevents this Windows workflow is an implementation defect to resolve in the runner—not a requirement to change the user's operating system or provision infrastructure. Exact replay's trusted-artifact verification remains a separate security capability and must remain fail-closed until implemented.

## Windows local worker implementation — 2026-11-27

Harvester now composes a dedicated Node child-process worker by default on Windows; no `HARVESTER_SCENARIO_SANDBOX` setting, WSL2, Linux tools or remote host is required for local functional simulation. The worker receives a minimal environment and installs the existing Node module, network API and filesystem mutation guards before accepting execution. The host recognizes this as a **guarded simulation boundary**, not as verified OS isolation. It is intended only for repository-owned scenario adapters and simulated ports; it is not a sandbox for arbitrary user-supplied JavaScript and does not provide OS-enforced memory/CPU/network/filesystem limits. Linux Bubblewrap/cgroup remains optional OS-hardening evidence. Scenario status remains PARTIAL, and trusted exact replay remains blocked.

A Windows-specific GitHub Actions job now runs the local API composition test on `windows-latest`. Its result must be checked on the exact final PR head before claiming Windows acceptance.

The dedicated Linux sandbox E2E workflow is manual-dispatch only. It does not run on pull requests and is not a required functional-development gate. Use it only when deliberately validating the optional Linux OS-isolation layer; its self-hosted runner availability must not block Windows local scenario work.

## Superseding Windows acceptance status — 2026-11-27

This section supersedes earlier checklist/history statements in this file that said no RS scenario was executable without a trusted OS sandbox. The Windows composition now uses a factory-created Node child-process worker and exposes all twelve current RS production-flow scenarios as executable for local simulation through simulated broker/order and run-local dependencies. All twelve were exercised through the real local Harvester HTTP API on Windows and passed on code-identical checkpoint `14f36a075ed4320b9f6f5fadb8b302db58c7651f`. This is functional acceptance only: scenarios remain PARTIAL, the Node guards are not OS isolation, and exact replay remains blocked pending independent trusted artifact verification.

Dashboard gateway tests now cover catalogue, submit, history, run detail, cancel and replay HTTP methods/routes/payloads. Framework-independent application tests cover validation, authoritative status refresh, WebSocket update handling, cancellation, replay, trace graph, history and debug-package generation. The selectable debug JSON remains the fallback when clipboard access is unavailable. Exact-head CI is pending after these final test/documentation updates.

## 2026-11-28 — Dashboard visual run details (#1982 / PR #1983)

- Added a framework-independent, strategy-neutral presentation adapter over source run/debug evidence.
- The Dashboard renders execution, assertions, trading lifecycle, accounting/cycle, safety and provenance as independent outcomes.
- The ordered trace timeline is selectable; explicit source graph edges are shown as branches. Unknown event kinds and missing evidence remain inspectable.
- Multiple submitted/terminal orders correlate by canonical broker or client order identity; multiple cycle states remain distinct, including an unresolved latest cycle.
- Assertion records expose expected/actual values and original evidence. Provenance inspection includes source/tree/dependency/registry identities and artifact verification status.
- Orders correlate submission and terminal evidence only by matching order identity. Partial CANCELED execution is displayed separately from run completion and cycle state.
- Added expandable JSON tree inspection, per-value/branch copying, text search, full-source copy and JSON download; retained the separate generated AI debug-package action.
- Added the complete supplied RS partial-CANCELED debug report as a regression fixture plus adapter, JSON-tree and run-details UI tests.
- The fixture does not contain enough fill price/commission evidence to calculate realized P/L; the UI must show no invented financial result.
- Implementation and exact-head verification state are tracked in issue #1982 and PR #1983. Do not treat this section as a production-readiness or replay-provenance attestation.
