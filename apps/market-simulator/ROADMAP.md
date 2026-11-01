# Market Simulator Engineering Roadmap

**Application:** `apps/market-simulator`  
**Package:** `@coinzilla/market-simulator`  
**Target branch:** `develop`  
**Status:** Scaffold created; implementation not started.

This roadmap is the source of truth for the simulator's scope, architecture, implementation sequence, and acceptance criteria. Read it with the root `ENGINEERING_STANDARDS.md`, `AI_AGENT_WORKFLOW.md`, this application's `AGENTS.md`, and the current broker implementation/tests.

## 1. Mission

Build a deterministic market simulator for testing Coinzilla strategies against replayed or generated market movement. Strategies must interact with it through the existing broker contracts, not simulator-specific message formats.

The first intended data source is the DOGE history previously associated with Free-Roll. The expected source path, `apps/bot-free-roll/doge-history.json`, is present on `develop` but is an empty committed file. Fixture migration is blocked until the original data is recovered from an authoritative source. Do not fabricate, infer, or silently regenerate historical prices.

## 2. Architecture and ownership

```text
Strategy under test
       |
       | existing Coinzilla broker contract / normalized messages
       v
Simulated broker adapter  ---- implements ----> CoreBroker
       |
       v
Market simulation engine
       |
       v
Fixture replay / deterministic scenario source
```

Optional WebSocket transport is a later boundary around the simulator. It must not leak transport-specific message shapes into the strategy or market engine.

### Contract rules

- `packages/brokers/src/broker.core.js` is the current `CoreBroker` source of truth.
- Reuse existing entities, event/message names, result objects, order and fill models, and method signatures.
- Inspect the real Binance implementation and broker tests before implementing each method.
- Do not copy broker types or define parallel simulator-only equivalents.
- The simulator must not weaken, alter, or expand the shared broker contract. Required contract changes must be implemented by the Brokers domain through a separate coordinated task.
- Do not assume every `CoreBroker` method is needed in the first vertical slice. Implement only the minimum complete behavior required by a documented test use case, while preserving contract-compatible behavior for implemented methods.
- Keep the engine independent of broker contracts, exchange protocols, strategy rules, and network I/O.

## 3. Implementation phases

### MS-001 — Scaffold and engineering baseline
- [x] Create the `apps/market-simulator` workspace package.
- [x] Document mission, architecture constraints, and implementation roadmap.
- [x] Register the new application in repository domain ownership and workspace documentation.
- [ ] Add package-level test and coverage gates when the first executable behavior is introduced.
- [ ] Verify package discovery and workspace installation in CI.

**Exit gate:** package is discoverable by pnpm and its ownership/docs are clear.

### MS-002 — Recover and migrate the DOGE fixture
- [ ] Locate the authoritative original DOGE price history.
- [ ] Confirm its schema, timestamp units/time zone, ordering, duplicate policy, and numeric precision.
- [ ] Move the unchanged historical records into this application's fixture directory.
- [ ] Remove the old Free-Roll-owned copy only as part of a coordinated, reviewed migration; do not leave two competing sources of truth.
- [ ] Add fixture integrity tests: valid structure, chronological ordering, supported timestamp range, exact price representation, and malformed-record rejection.

**Current blocker:** the committed `apps/bot-free-roll/doge-history.json` on `develop` is zero bytes. The original data must be recovered before this phase can be completed.

**Exit gate:** one authoritative fixture is owned by Market Simulator and is validated by deterministic tests.

### MS-003 — Fixture model and deterministic replay engine
- [ ] Define and document a minimal fixture format based on the recovered source data, preserving source precision and timestamp semantics.
- [ ] Validate input at the filesystem boundary; reject malformed, unsorted, duplicate, or unsupported records according to an explicit policy.
- [ ] Implement pure replay-step and cursor calculations in focused modules.
- [ ] Inject the simulation clock; never depend on arbitrary wall-clock sleeps for deterministic unit tests.
- [ ] Define behavior at start/end of history, pause/resume, repeated start, speed changes, and invalid speed values.
- [ ] Prove that identical fixture/configuration yields identical output sequences.

**Exit gate:** engine tests cover normal, boundary, invalid-input, deterministic-repeat, and lifecycle behavior without network access.

### MS-004 — Existing-contract simulated broker
- [ ] Implement a simulated broker adapter using the existing `CoreBroker` contract.
- [ ] Reuse established broker result conventions, event names, entities, order/fill models, and normalized market-data messages.
- [ ] Support the smallest complete strategy-testing path first: market-data subscription and price retrieval, followed by the order/account operations required by the chosen strategy.
- [ ] Model order acknowledgements, fills, partial fills, cancellations, and open-order state only using established contracts.
- [ ] Define deterministic execution rules explicitly; never imply that a simulated fill proves real exchange execution behavior.
- [ ] Add broker contract tests that can be run against both the real adapter (offline/mocked boundary) and simulator where the contract permits.

**Exit gate:** a strategy can use the simulator without branching on simulator-specific broker messages or data structures.

### MS-005 — Optional WebSocket transport
- [ ] Decide the external client use case and protocol boundary before implementing a server.
- [ ] If Binance wire compatibility is required, document the exact supported subset and test it independently from the internal Coinzilla broker contract.
- [ ] Ensure transport events are translated into the same established Coinzilla contracts before reaching strategy code.
- [ ] Test connection lifecycle, subscriptions, malformed frames, backpressure, disconnect cleanup, and deterministic replay behavior.

**Exit gate:** external WebSocket clients can consume the documented subset without changing internal broker contracts.

### MS-006 — Scenario controls and strategy integration
- [ ] Add explicit pair selection and fixture selection.
- [ ] Add deterministic playback controls: start, pause, resume, stop, and speed.
- [ ] Add configurable synthetic scenarios only after replay is stable (for example, flat, trend, range, spike, and gap).
- [ ] Add end-to-end tests running a representative strategy against a fixed scenario.
- [ ] Verify that test failures are reproducible from the fixture and configuration alone.

**Exit gate:** repeatable strategy regression tests run offline and produce diagnosable results.

## 4. Quality gates

- Node.js and pnpm versions must follow the repository root manifest.
- Default tests are deterministic, offline, credential-free, and use Node's built-in test runner unless the repository adopts another standard.
- Test successful behavior, invalid inputs, boundaries, failures, lifecycle cleanup, and concurrency/race behavior where relevant.
- No hidden real-time sleeps in engine tests; inject clocks/schedulers.
- Preserve exact decimal strings for prices and quantities at broker/domain boundaries; do not introduce floating-point financial decisions.
- Do not add dependencies without a demonstrated need.
- Run the package tests and coverage, relevant workspace tests, syntax checks, and required CI checks. Report only checks actually executed.
- Update this roadmap when scope, decisions, or completion status changes. Mark an item complete only after implementation is merged into `develop` and required checks pass.

## 5. Out of scope

- Replacing or modifying the shared broker interface to accommodate the simulator.
- Changing Free-Roll strategy behavior or its production runtime.
- Connecting to a live exchange by default.
- Treating simulated fills as evidence of real-world liquidity, latency, queue position, or execution quality.
- Building a general-purpose exchange matching engine before a concrete strategy test requires it.

## 6. Decision log

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-11-01 | Name the application `market-simulator` and place it under `apps/market-simulator`. | It is an executable test application, not a shared broker library. |
| 2026-11-01 | Reuse the existing `CoreBroker` contract and normalized Coinzilla messages. | Strategies must not need simulator-specific code paths. |
| 2026-11-01 | DOGE history is the first intended fixture, but migration is blocked until the original data is recovered. | The committed Free-Roll file is empty; inventing historical prices would invalidate replay tests. |
