---
title: Strategy extensibility architecture discussion and audit roadmap
status: draft
type: architecture-plan
owner: harvester
created: 2026-11-19
last_verified: 2026-11-20
---

# Strategy extensibility architecture discussion and audit roadmap

## 1. Purpose

Preserve the architecture discussion and agreed direction for making Harvester extensible across trading strategies without breaking the existing Coin Grabber (CG / Conservative) behavior or the proposed Recovery Seller (RS) behavior.

This document preserves the strategy architecture discussion and audit plan. The owner-approved implementation direction for RS-4 / PR #1476 is recorded in §5.2 and is authoritative for that work. The RS-4 shared-engine runtime composition and scoped RS-5 offline acceptance are complete in PR #1515. The runtime acceptance gate is open; RS remains disabled by default in its strategy configuration. This roadmap preserves the historical architecture discussion and must be read with the current Harvester implementation roadmap.

The goal is not to add a framework for hypothetical strategies. The goal is to make the existing strategy boundaries and shared trading capabilities clear, and to determine whether and how the current CG and RS work can fit a safe, maintainable architecture.

## 2. Scope and non-goals

### In scope

- Audit existing strategy/domain and application code, including CG, RS, execution routing, Portfolio, accounting, configuration, lifecycle, tests and simulation.
- Identify duplicated responsibilities, strategy-specific coupling and genuine common capabilities.
- Define a minimal strategy contract and ownership boundaries based on evidence from current source.
- Determine how strategy configuration is loaded, validated and injected.
- Prove the proposed architecture using CG and RS only, without changing their financial behavior.
- Preserve the work as an incremental roadmap.

### Explicitly out of scope

- Implementing a new trading strategy.
- Spot Grid, Futures, or other speculative strategies.
- Rewriting CG or RS merely to make folder structures symmetrical.
- Creating a large inheritance hierarchy or a universal `BaseStrategy`.
- Changing approved trading, accounting, order ownership, reconciliation, recovery, shutdown or safety behavior as part of architecture work.
- Treating the roadmap as permission to refactor before the source audit and contract discussion are complete.

## 3. Roadmap agreed for discussion

The agreed sequence is:

1. **S-1 — Existing strategy audit.** Map CG, RS, execution routing, Portfolio, accounting, configuration, lifecycle, tests and simulation. Identify duplication and strategy-specific coupling. Deliver source-backed findings and a map of current responsibilities.
2. **S-2 — Strategy contract design.** Define the minimum common policy/runtime boundary, state ownership, configuration, events and decision format. Discuss and agree on the design before implementation.
3. **S-3 — Strategy onboarding template.** Document the steps and requirements for adding a strategy, including configuration, domain policy, runtime/lifecycle integration, execution, ownership, accounting, tests, simulation and safety.
4. **S-4 — Prove the framework with existing CG and RS.** Demonstrate that the design accommodates the existing strategies and their different lifecycle/accounting requirements. No new strategy is introduced.

S-1 source mapping remains necessary to keep implementation evidence-based, but it is not a reason to pause the explicitly approved RS-4 work in PR #1476. The owner has approved the architectural direction in §5.2; derive only the concrete contracts required by the existing CG/RS source and acceptance tests. Do not create generalized interfaces speculatively.

## 4. Architectural principles

### 4.1 Strategy decides WHAT; application coordinates HOW; infrastructure performs external work

- **Strategy/domain policy:** determines the trading intent or decision from domain inputs. It owns strategy rules and strategy-specific invariants.
- **Application/runtime:** coordinates the trading workflow, state transitions, lifecycle, use cases and shared capabilities. It owns orchestration, not the strategy's financial rules.
- **Execution/infrastructure:** validates and executes application-approved requests through ports/adapters, communicates with providers, and returns normalized facts/results.

A strategy should not directly call a broker, exchange SDK, or infrastructure adapter. Application code should not reproduce the strategy's financial decision rules.

### 4.2 Composition and small explicit contracts

Prefer composition and explicit dependencies. Avoid:

- a giant `BaseStrategy` class with hooks for every conceivable behavior;
- a universal interface that assumes all strategies are market-price evaluators with identical state and lifecycle;
- inheritance solely to make CG and RS appear structurally identical;
- moving code into new layers without a demonstrated ownership or testability benefit;
- abstractions for strategies that do not exist.

A shared contract is justified only where CG and RS source demonstrates a real common responsibility and stable semantics.

### 4.3 Preserve financial and operational invariants

Any architecture must preserve, at minimum:

- actual-fill-driven accounting;
- canonical order/fill identity and attribution;
- strategy and market ownership boundaries;
- Portfolio consistency and shared Spot custody constraints;
- quote/base reservation and no double-spending or double-selling;
- fail-closed handling of uncertain exchange outcomes;
- cancellation, replacement, reconciliation and recovery ordering;
- pause/disable behavior and existing safety gates;
- shutdown and recovery safety;
- explicit provider/account routing and immutable order provenance;
- deterministic tests and offline verification.

These are constraints, not opportunities to redesign behavior in the strategy audit.

## 5. Strategy policy is not the same thing as a runtime/engine

A key discussion point was whether every strategy should have its own engine. **That is not the proposed target.**

The concepts must be separated:

- **Strategy policy** answers what action is appropriate under its domain rules.
- **Strategy-specific lifecycle/workflow** owns behavior that genuinely differs, such as a strategy's cycle state, pending-order handling, repricing rules, terminal-order resolution or accounting workflow.
- **Shared application runtime/coordinator** may coordinate common lifecycle and capabilities, if the audit proves the responsibilities are genuinely common.
- **Shared execution pipeline** provides common validation, routing, submission safety and provider interaction where the existing contracts support it.

The owner has approved a shared account-level application/runtime foundation with composed strategy-specific policy and lifecycle components—not a complete duplicated engine for every strategy. CG and RS may have materially different lifecycle semantics. The shared coordinator must not flatten those differences into generic hooks or force RS into Conservative's lifecycle. A specialized workflow may remain where source and tests prove the behavior is genuinely strategy-specific; it must still participate in the shared account-level coordination and safety boundaries.

### 5.1 Current versus possible future shape

Current implementation (high-level, source paths are evidence and should be re-verified during S-1):

```text
Bootstrap: apps/harvester/src/bootstrap/start-harvester.js
  └─ constructs/configures Conservative Trading Engine
       ├─ Conservative strategy policy
       │    └─ domain decision calculation
       ├─ CG-specific lifecycle and orchestration
       │    ├─ order workflow
       │    ├─ recovery/replacement behavior
       │    ├─ repricing/protection
       │    └─ pause/shutdown/reconciliation boundaries
       └─ shared application/execution capabilities
```

Possible target shape for discussion only:

```text
Bootstrap / composition root
  └─ compose runtime + strategy policy + strategy lifecycle + shared ports
       ├─ shared runtime/coordinator (only proven common responsibilities)
       ├─ strategy policy (WHAT)
       ├─ strategy lifecycle/workflow (strategy-specific where required)
       ├─ shared execution/safety pipeline
       ├─ shared Portfolio and canonical order/fill facts
       └─ provider adapters (HOW external operations happen)
```

This diagram is conceptual. It does not prescribe new files, rename current modules, or assert that a generic runtime already exists.

### 5.2 Approved implementation direction — 2026-11-19 (PR #1476 / issue #1475)

The strategy owner approved the following direction. It is the architecture decision for the current RS-4 integration; it is not merely a proposal awaiting another discussion.

1. **One account-level execution coordinator.** CG and RS participate in one provider-account runtime and one shared execution coordination path. Do not create competing independent engines for each strategy.
2. **Explicit strategy routing.** Preserve and dispatch each assignment by the pair `{ strategyId, symbol }` from provider startup through policy evaluation, decision handling, order ownership and canonical fill attribution. Deduplicate market-data subscriptions without discarding strategy ownership.
3. **Policy and lifecycle remain strategy-owned.** Each strategy decides WHAT under its own domain rules and retains its own cycle state, lifecycle semantics, accounting and budget. The application coordinates HOW; infrastructure performs provider operations.
4. **Shared account resources and safeguards.** Reuse the account Portfolio, canonical order/fill facts, OrderRegistry, broker submission path and account-wide quote/base reservation controls. Keep strategy Positions, attribution and configured investment budgets independent. A fill updates the shared aggregate exactly once and the owning strategy projection exactly once.
5. **One serialized account-level decision/order-transition path.** Serialize competing strategy decisions, intent allocation, order submission/acknowledgement transitions and canonical order/fill processing through the shared account coordinator. A shared accounting-update queue alone is insufficient if decisions and order transitions can still race in separate queues.
6. **Preserve Conservative behavior.** CG is the regression baseline. Do not change its approved financial rules or lifecycle behavior merely to make the two strategies symmetrical. Reuse only capabilities with demonstrated common semantics.
7. **Fail closed and keep RS gated.** Unknown or ambiguous exchange outcomes retain ownership and reservations and require reconciliation; no blind retries or speculative replacement. Third-asset commission valuation is deferred and remains fail-closed, never zero. RS-4 integration and scoped RS-5 offline lifecycle acceptance are complete; the runtime acceptance gate is open, while RS remains disabled by default in configuration.

This approval does not authorize a universal `BaseStrategy`, a speculative strategy framework, a second broker/execution implementation, broker-package changes, exchange TESTNET/LIVE mutations, or early RS enablement. Exact DTOs, module boundaries and queue APIs are implementation details to derive from the existing source and prove with deterministic offline tests—not new architecture decisions to reopen the approved direction.

## 6. Configuration ownership: app root loads and composes; domain receives validated inputs

Configuration should not be owned or loaded by the strategy domain.

### 6.1 Responsibilities

- **Application configuration/composition root:** reads configuration files/environment-specific settings, chooses enabled strategies, resolves strategy configuration, and injects dependencies.
- **Configuration validation:** validates shape, types, deployment/environment constraints and business constraints at the appropriate boundary. Existing `domain/app-config.js` is a validation module; it is not the configuration loader.
- **Strategy domain:** receives the relevant validated strategy settings as inputs. It should not read files, environment variables, or global application configuration.
- **Infrastructure:** owns configuration details for concrete external integrations (credentials, provider endpoints, adapter construction), while application composition supplies the necessary values.

### 6.2 Current source examples

The current configuration composition is located at:

- `apps/harvester/config/index.js` — named `appConfig` composition.
- `apps/harvester/config/strategies/cg-coin-grabber.js` — CG strategy configuration.
- `apps/harvester/cg-coin-grabber.js` — operator-owned trading-pair configuration imported by the CG config module.
- `apps/harvester/src/domain/app-config.js` — validation, not file loading.
- `apps/harvester/src/bootstrap/start-harvester.js` — composition/bootstrap boundary.

These paths and details are a snapshot of the source inspected during this discussion; S-1 must re-check them against the current `develop` revision.

### 6.3 Illustrative configuration flow

```text
Config files / environment
        ↓
apps/harvester/config/index.js
        ↓
appConfig.strategies.<strategyId>
        ↓
configuration validation
        ↓
bootstrap/start-harvester.js
        ↓
strategy policy + strategy workflow/runtime + shared dependencies
```

Illustrative code (not a proposed exact API):

```js
const strategyConfig = appConfig.strategies[StrategyId.COIN_GRABBER];

const runtime = createStrategyRuntime({
  strategyPolicy: conservativeStrategyPolicy,
  strategyConfig,
  lifecycle: conservativeLifecycle,
  portfolio,
  execution,
});
```

This example demonstrates dependency injection and composition only. It does not authorize creating `createStrategyRuntime`, `conservativeLifecycle`, or changing the current bootstrap signature. Exact APIs should be derived in S-2 after S-1.

Business rules belong in domain validation/policy where appropriate; deployment and file-loading concerns do not.

## 7. Source observations captured during discussion

The following observations were made by inspecting files on `develop`. They are a discussion snapshot, not a completed S-1 audit.

### 7.1 Conservative / CG

- `apps/harvester/src/domain/strategies/conservative/strategy.js` contains broker-independent strategy decision logic.
- Its inputs include market price, pair configuration, settings, Portfolio, market metadata and active orders; it derives exchange constraints and strategy-owned position/accounting context and produces decisions.
- `apps/harvester/src/domain/strategies/conservative/strategy-policy.js` provides the Conservative policy boundary, including evaluation and trailing BUY repricing behavior.
- `apps/harvester/src/use-cases/conservative-trading-engine.js` remains a substantial strategy-specific application workflow coordinating lifecycle and safety-related processes.
- `apps/harvester/src/bootstrap/start-harvester.js` composes the runtime and dependencies.
- Current policy injection is a useful boundary, but it does **not** prove the entire CG lifecycle is generic or that the engine can be shared with RS without changes.

### 7.2 Recovery Seller / RS

- RS domain components exist, including `apps/harvester/src/domain/strategies/recovery-seller/cycle-state.js`.
- RS accounting workflow code exists, including `apps/harvester/src/use-cases/create-recovery-seller-accounting-workflow.js`.
- RS has different cycle/accounting and legacy-inventory semantics from CG.
- The source/runtime integration status must be verified against current code and the Recovery Seller roadmap. RS runtime composition is implemented through the shared Trading Engine, not an independent engine. RS remains disabled by default in configuration.

### 7.3 Shared capabilities that must be audited

Potential common responsibilities include, but are not presumed to be universally shareable:

- provider/account and market-data/execution routing;
- canonical Orders and Fills;
- Portfolio and strategy-owned Positions;
- reservations/commitment coordination;
- execution validation and submission;
- broker event handling and fill accounting coordination;
- order ownership/registry;
- operator controls and pause;
- reconciliation and readiness;
- shutdown and recovery;
- simulation and test harnesses.

S-1 must document actual call paths, ownership and dependencies for these capabilities, not merely list their names.

## 8. Questions that S-1/S-2 must answer

1. What exact work is CG policy, CG lifecycle, generic application workflow, shared execution, and infrastructure?
2. Which RS responsibilities are pure policy, cycle-state/domain invariants, accounting workflow, and application orchestration?
3. Which behaviors are genuinely common between CG and RS—and do they have identical semantics?
4. Where does each strategy's state live? Which state is domain-owned, application-owned, Portfolio-owned, or derived?
5. How are strategy decisions represented, validated, routed, correlated with orders, and attributed to fills?
6. What are the common and strategy-specific event/command contracts?
7. How do configuration loading, validation, enabled-strategy selection and dependency injection currently work?
8. How are strategy lifecycle controls (enable, pause, stop, shutdown, recovery) applied without affecting another strategy?
9. What execution, reservation, order ownership and reconciliation safeguards are shared and which are strategy-specific?
10. What tests prove current behavior and what missing tests would be needed to prove the proposed boundary?
11. Does a shared runtime reduce duplication without making strategy-specific lifecycle behavior opaque or unsafe?
12. What is the smallest incremental change that demonstrates the design while preserving current CG behavior?

## 9. Required S-1 audit output

The audit should produce a source-backed inventory—not an implementation proposal prematurely disguised as an audit.

For each relevant module, record:

- file/path and responsibility;
- domain, application, configuration, or infrastructure ownership;
- inputs, outputs and state it owns;
- direct dependencies and important consumers;
- strategy-specific versus shared responsibility;
- existing tests/simulation evidence;
- coupling/duplication or safety risk;
- whether it should remain, be extracted, be composed, or is only a candidate for sharing;
- evidence reference (source path, test path, commit/revision where appropriate).

The audit must cover:

- CG decision policy and lifecycle;
- RS decision policy, cycle state and accounting;
- configuration and bootstrap;
- Portfolio, Position, canonical Orders/Fills and attribution;
- execution routing and broker-facing operations;
- order registry, reservations and safety gates;
- operator controls, pause and shutdown;
- reconciliation/recovery;
- unit/integration/offline simulation tests and gaps.

## 10. S-2 contract design requirements

The contract discussion must be grounded in S-1 and should explicitly decide:

- whether a common policy contract is useful and its minimal inputs/outputs;
- what belongs in strategy domain state versus application workflow state;
- how strategy-specific lifecycle/workflows are composed;
- what the runtime/coordinator is responsible for (and what it is not);
- how decisions/intentions are validated and transformed into execution requests;
- configuration shape, identity and validation;
- event/fact contracts and ownership attribution;
- shared execution, reservation and accounting coordination;
- test boundaries and proving strategy isolation.

Avoid making every strategy implement irrelevant methods just to satisfy an interface. Prefer capability-specific contracts if evidence supports them, and do not introduce them speculatively.

## 11. S-3 strategy onboarding template

A future onboarding guide should provide a checklist that covers:

1. strategy identity and domain vocabulary;
2. specification and explicit behavior/invariants;
3. configuration shape, defaults, validation and environment;
4. pure policy inputs/outputs and decision types;
5. strategy state/cycle ownership;
6. application workflow/lifecycle composition;
7. execution request contract and shared safety gates;
8. order ownership and correlation;
9. actual-fill accounting and Portfolio integration;
10. reservation/commitment behavior for shared Spot custody;
11. operator control/pause/shutdown semantics;
12. reconciliation/recovery and uncertain outcomes;
13. tests: pure policy, lifecycle, execution integration, failure paths, isolation and offline simulation;
14. bootstrap/config registration;
15. documentation, roadmap and acceptance evidence.

This is a future template deliverable, not a mandatory interface to implement now.

## 12. S-4 proof criteria using CG and RS

S-4 must demonstrate the design using only the existing CG and RS strategies. No new strategy should be added.

Proof should show:

- CG decision behavior is unchanged, with tests demonstrating parity against the existing approved behavior.
- RS-specific cycle/accounting semantics remain explicit and are not forced into CG assumptions.
- Shared execution capabilities are reused where they already have common semantics.
- Strategy ownership and attribution remain unambiguous.
- Concurrent strategies cannot double-spend quote, reserve/sell the same base inventory twice, or attribute a fill more than once.
- Pausing/stopping one strategy does not unintentionally stop or mutate another.
- Unknown/ambiguous exchange outcomes fail closed and do not produce unsafe retries or replacements.
- Lifecycle, reconciliation, recovery and shutdown behavior remains correct.
- Tests are deterministic and offline by default; any exchange verification remains explicitly opt-in and TESTNET-only.

S-4 is an architecture proof and safety verification, not a feature expansion.

## 13. Decision status

### Owner-approved direction — 2026-11-19

- Keep the strategy/domain boundary: **strategy decides WHAT; application orchestrates HOW; infrastructure performs external operations**.
- Keep configuration loading/composition at the application root/bootstrap boundary; inject validated settings into strategy/domain components.
- Prefer composition and small explicit contracts over a giant base class or speculative framework.
- Do not assume each strategy needs a complete independent engine.
- Prefer a shared runtime/coordinator for responsibilities proven common, composed with strategy-specific policy and lifecycle/workflow components where behavior differs.
- Do not force CG and RS into identical lifecycle semantics.
- Current CG engine may remain specialized during the audit; any extraction must be evidence-based and incremental.
- The approved RS-4 direction is one shared account-level execution coordinator with explicit `{ strategyId, symbol }` dispatch and a single serialized decision/order-transition path across strategies.
- Strategy policy, cycle/lifecycle semantics, accounting attribution and investment budgets remain strategy-specific; shared account custody, Portfolio aggregate, order/fill facts, execution submission and quote/base reservations remain coordinated account-wide.
- Preserve CG behavior; do not add a parallel engine, universal base class or speculative framework.
- Source audit and implementation decomposition must remain evidence-based, but they do not reopen the approved direction or block the explicitly authorized PR #1476 work.
- RS-4 integration and RS-5 offline acceptance are complete; the runtime gate is open, while RS remains disabled by default in configuration.

### Implementation details still to derive from source

- Exact strategy decision/intent DTO shape and minimal capability contracts.
- Exact module boundaries and how existing CG engine responsibilities are decomposed or retained.
- Exact account coordinator and queue API, provided it serializes the full decision/order-transition path rather than accounting alone.
- Exact event/decision wiring and configuration API, consistent with existing validated configuration.

These are implementation details, not unresolved approval questions. Resolve them from current source, tests and #1475 acceptance criteria; do not reopen the approved architecture direction.

## 14. Continuation instructions

When continuing this work:

1. Re-read repository and Harvester agent instructions and the applicable documentation preflight.
2. Verify the current `develop` source and current CG/RS roadmap/status; do not rely solely on this discussion snapshot.
3. Continue the owner-approved RS-4 implementation in PR #1515 against issue #1475. Use S-1 source mapping as an implementation aid, not as a gate that suspends the approved task.
4. Implement the shared account-level coordinator and explicit strategy routing incrementally, with RED → GREEN offline tests and source-backed module boundaries.
5. Preserve CG behavior and RS-specific lifecycle/accounting. Keep RS disabled by default in configuration; RS-4 and RS-5 acceptance are complete.
6. Do not change broker packages or perform TESTNET/LIVE exchange mutations as part of this work.
7. Keep the user's review/merge ownership: task PRs target `develop`; leave PRs open for user review.

## RS-4 implementation checkpoint — PR #1515 (2026-11-20)

- The production RS policy/lifecycle dispatch path is implemented for the existing shared Trading Engine and account-owned serialized transition queue; no parallel strategy engine is introduced. The runtime acceptance gate is open; RS remains disabled by default in configuration.
- RS actions use the engine-owned submitter and an account-wide authorization step backed by the shared Portfolio, AccountSnapshot, OrderRegistry and `allocateStrategyOrderCommitments`. Pair budgets and Position ownership remain strategy-specific.
- Terminal RS SELL processing stages canonical fills until complete terminal reconciliation can atomically commit recovery and legacy accounting. Missing or failed reconciliation remains a durable global STOP.
- The production composition is protected by `RECOVERY_SELLER_RUNTIME_ACCEPTANCE_COMPLETE = true` after RS-4/RS-5 offline acceptance. `RS_RECOVERY_SELLER_CONFIG.enabled` remains false by default.
- Restart/replay and third-asset commission valuation are deferred. STOP is terminal with read-only CC-operator status and no clear/resume transport. Offline same-/different-market concurrency, lifecycle and failure proofs are complete. No TESTNET/LIVE exchange operations were authorized or performed.
