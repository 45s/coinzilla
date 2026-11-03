# Harvester DDD and Clean Architecture Audit

> **Audit date:** 2026-11-03  
> **Audited branch:** `develop`  
> **Audited source revision:** `3ad32af9285db23f1f4e587e56f534f7871730aa`  
> **Scope:** source-code and documentation review of Harvester's application/domain boundaries, with emphasis on the Conservative trading workflow.  
> **Overall assessment:** **7.5/10 — sound foundations; application orchestration and domain-boundary clarity need focused improvement.**

This is an architectural assessment, not a production-readiness certification. The audit did not execute the test suite, run a broker simulation, or verify a live/testnet session. Findings describe design visible in the audited source snapshot; verify the current branch before implementing follow-up work.

## 1. Reference and interpretation

The requested reference is [Using Clean Architecture for Microservice APIs in Node.js with MongoDB and Express](https://www.youtube.com/watch?v=CnailTcJV_U).

Use the video as a practical illustration of separation between domain behavior, application use cases, interface adapters, and infrastructure. Harvester should adopt those dependency and testability principles, not copy an HTTP API's Express controllers, MongoDB repositories, or microservice structure. Harvester is an event-driven trading process with exchange adapters and financial state transitions.

This audit distinguishes three related ideas:

- **Clean Architecture** is about dependency direction and keeping business/application policy independent of frameworks and external systems.
- **Hexagonal Architecture** makes external capabilities explicit through ports and adapters.
- **DDD** is about modeling the business domain, its language, invariants, and boundaries. Tactical patterns such as entities and value objects are useful, but package names alone do not establish bounded contexts.

## 2. Executive assessment

Harvester is not merely organized into folders named `domain` and `use-cases`: several important boundaries are real. Domain policies are predominantly deterministic and broker-independent; state-owning objects protect meaningful invariants; broker communication is expressed through a port and adapter; and canonical actual fills, rather than order intentions or acknowledgements, drive accounting.

The main weakness is not the domain model. It is the size and concentration of application orchestration. The Conservative Trading Engine coordinates too many distinct workflows, while bootstrap owns some stateful accounting/recovery workflow behavior that should be composed there rather than implemented there. This makes change impact harder to reason about and increases the chance that unrelated transitions become coupled.

Strategic DDD is also less explicit than tactical DDD. The code has useful domain concepts, but the repository would benefit from a clearer written model of the Harvester context, its relationship to shared Entities and Brokers contracts, and which concepts are owned locally versus shared.

**Recommendation:** do not rewrite Harvester and do not add layers for their own sake. Preserve the working trading path and improve it incrementally after the first end-to-end Conservative TESTNET milestone. Extract cohesive application workflows, make accounting consistency boundaries explicit, and keep the documentation synchronized with executable behavior.

## 3. Scorecard

| Area | Score | Assessment |
| --- | ---: | --- |
| Dependency direction | 8/10 | Domain code is substantially isolated from broker SDK and infrastructure details. |
| Domain model and invariants | 8/10 | Portfolio, Position, Fill, OrderRegistry, and RecoveryLedger have meaningful responsibilities. |
| Pure domain policy | 9/10 | Strategy decisions and financial calculations are largely expressed as deterministic functions. |
| Ports and adapters | 8/10 | Broker capability boundary and exchange normalization are sound architectural choices. |
| Application use-case cohesion | 6/10 | Engine and bootstrap contain too much workflow coordination and mutable lifecycle state. |
| Aggregate/consistency boundaries | 6/10 | Portfolio and RecoveryLedger are separate state projections; their consistency and failure semantics need an explicit contract. |
| Strategic DDD / bounded contexts | 6/10 | Tactical modeling is clearer than context boundaries, ubiquitous language, and shared-model ownership. |
| Testability and verification evidence | 7/10 | The design is testable and has deterministic tests, but this audit did not run tests or verify a real exchange cycle. |
| Documentation fidelity | 6/10 | Some architecture prose describes earlier implementation states and conflicts with later implementation evidence. |

The overall score is a qualitative architectural judgment, not a mathematical average or a release gate.

## 4. What is working well

### 4.1 Dependency inversion is visible in the code

The domain does not need to know which exchange SDK is used. The application-facing broker port separates order and account capabilities from concrete Binance integration. The adapter translates exchange-specific payloads into canonical application/domain facts, and bootstrap selects concrete implementations.

This is the core Clean/Hexagonal Architecture rule: source dependencies point toward policy, while infrastructure implements the contracts required by the application.

**Preserve:** domain modules must not import broker adapters, exchange SDKs, raw exchange payloads, application use cases, or process bootstrap modules.

### 4.2 Domain objects own meaningful state and invariants

The following are substantive domain concepts, not merely data bags:

- `Portfolio` owns portfolio-level position state and delegates or coordinates valid portfolio transitions.
- `Position` represents holdings and quote-currency cash-flow state for its market scope.
- `Fill` represents a canonical execution fact with validated financial attributes.
- `OrderRegistry` protects order identity and lifecycle transitions and rejects unknown/unowned orders rather than silently adopting them.
- `RecoveryLedger` tracks market-specific recovery accounting, duplicate/conflicting fill identity, actual commissions, and cycle state.

These are appropriate places for state ownership and invariant enforcement. Keep them focused; do not move workflow orchestration into entities merely to make the architecture appear more object-oriented.

### 4.3 Functional core is a good fit for financial policy

Pure strategy functions and deterministic calculation/validation modules are particularly appropriate for trading. They can be tested with explicit inputs, avoid hidden clock/network/broker dependencies, and make financial decisions reproducible.

Continue using plain functions for calculations, policy decisions, validation, normalization, and deterministic transformations. Use classes where state and lifecycle invariants genuinely belong to an object.

### 4.4 Actual fills are the accounting facts

The architectural distinction between an order request and an executed fill is essential:

- Market prices inform decisions; they do not mutate holdings.
- An order intent or accepted acknowledgement is not an execution.
- Cancellation/rejection/expiry without execution does not change holdings.
- Canonical actual fills, including partial fills and actual commission facts, drive accounting.

This separation should remain a non-negotiable invariant in future refactoring.

### 4.5 Fail-closed handling is appropriate

Rejecting unknown orders, incomplete execution facts, unsupported commission forms, and inconsistent lifecycle transitions is safer than silently guessing in a financial workflow. Do not weaken those protections as a shortcut to reduce orchestration complexity.

## 5. Main architectural findings

### Finding A — Conservative Trading Engine is an orchestration hotspot

**Severity:** High maintainability risk; not a confirmed runtime defect.

The audited `src/use-cases/conservative-trading-engine.js` is approximately 30 KB and coordinates multiple distinct concerns: strategy evaluation, order submission and acknowledgement, cancellation, fill reconciliation, order lifecycle transitions, trailing BUY behavior, recovery SELL replacement, deferred evaluation, pair pause, event publication, and transition serialization.

The concern is not file length by itself. It is that many workflows and mutable lifecycle concerns change for different reasons but are coordinated in one module. This raises cognitive load and makes it harder to test a workflow without understanding unrelated engine behavior.

**Recommended direction**

Keep a small engine/facade as the application orchestrator, but move cohesive workflows into focused injected functions/modules. Candidate boundaries (names are illustrative; reuse existing contracts and avoid creating a module for every helper):

1. Evaluate strategy and turn decisions into validated order intents.
2. Submit an order and register/verify its acknowledgement.
3. Cancel an acknowledged order and reconcile fills received during cancellation.
4. Apply an order update and validate ownership/lifecycle transition.
5. Process an actual fill and coordinate accounting.
6. Re-evaluate after a completed order transition.
7. Pause a market with a typed, actionable reason.

Keep shared transition serialization at the boundary that owns the consistency requirement. Do not split a workflow so aggressively that every private callback becomes a new abstraction.

**Acceptance criteria**

- Each extracted workflow has explicit inputs and injected side-effect capabilities.
- Domain policies/entities remain independent of the engine and adapters.
- Existing order/fill sequencing and fail-closed behavior are preserved.
- Deterministic tests cover success, duplicate delivery, invalid transition, broker error, and unknown outcome for the affected workflow.
- The engine reads as coordination, not as the implementation home for every business rule.

### Finding B — Bootstrap owns too much business workflow

**Severity:** Medium-high maintainability risk.

The audited `src/bootstrap/start-harvester.js` is a composition root, but it also contains mutable portfolio/recovery-ledger coordination and serialized accounting/recovery workflow behavior. A composition root should wire dependencies, establish process lifecycle, start/stop adapters, and expose the runtime surface. It should not become the natural home for business workflows simply because it has access to every dependency.

**Recommended direction**

Extract cohesive application workflow factories for fill accounting and recovery-cycle completion. Bootstrap should instantiate them, inject the required domain objects/ports, and connect normalized broker events to those workflows.

Keep process-specific concerns in bootstrap: configuration loading, dependency selection, subscription lifecycle, startup/shutdown ordering, and runtime composition. Keep accounting decisions and state-transition coordination in named application workflows.

**Acceptance criteria**

- Bootstrap primarily composes dependencies and manages process resources.
- Fill accounting and recovery completion can be tested without starting the whole Harvester process.
- The same canonical fill cannot be applied twice because of callback interleaving.
- Error/partial-failure behavior is explicit and observable; no workflow reports success if only one required projection was updated.

### Finding C — Portfolio and RecoveryLedger consistency boundary is underspecified

**Severity:** High correctness-design risk; no defect is asserted by this audit.

The audited accounting workflow updates both an immutable Portfolio and an immutable RecoveryLedger. Both track fill identity/fingerprints and protect against duplicate or conflicting facts. The workflow checks that their outcomes agree.

This may be a deliberate design: Portfolio answers holdings/cash-flow questions, while RecoveryLedger answers strategy-specific capital-recovery questions. They do not need to be merged merely because both consume fills.

The missing architectural decision is the consistency contract:

- Which object/workflow owns canonical fill deduplication?
- Are Portfolio and RecoveryLedger independent projections of one canonical fill fact, or is one authoritative for some fields?
- What happens if one transition succeeds and the other fails?
- Is the update atomic in memory from the perspective of all event handlers?
- How will the same guarantee work if state later becomes durable or is reconstructed after restart?
- Which invariants must be checked before the next strategy evaluation?

**Recommended direction**

Document the two models' distinct responsibilities and the application workflow that coordinates them. Decide whether the workflow can calculate both next immutable values before publishing either, or whether it needs a staged/transactional persistence boundary later. Do not introduce a database transaction abstraction or merge the objects until a real persistence requirement justifies it.

**Acceptance criteria**

- A written consistency invariant defines the required relationship between Portfolio and RecoveryLedger after every accepted fill.
- Duplicate and conflicting fills have one documented outcome.
- Tests simulate failure at each transition boundary and prove that the next evaluation cannot observe a silently inconsistent state.
- Future persistence/restart work has an explicit migration path rather than assuming process-local atomicity is durable.

### Finding D — Tactical DDD is stronger than strategic DDD

**Severity:** Medium design clarity risk.

Harvester has useful entities and policies, but folder structure alone does not establish a bounded context. The repository also has shared packages for entities and brokers and separate application domains. Their ownership boundaries should be described in business language.

A useful starting context map is:

- **Harvester context:** strategy execution, market/pair workflow, strategy-specific recovery decisions, process composition, and coordination of trading capabilities.
- **Entities/shared trading model:** exchange-neutral canonical orders, fills, commissions, balances, trading rules, identity, and exact financial value semantics.
- **Brokers context:** exchange connectivity, broker capability contracts, external protocol mapping, and normalization.
- **Journal/EventBus contexts:** operational observation and event delivery. They are not the source of truth for live trading state unless a separate decision explicitly makes them so.
- **Free-Roll application:** behavioral reference for the Conservative strategy where explicitly identified by the roadmap; it is not a reason to share its runtime implementation with Harvester.

**Recommended direction**

Add a short Harvester domain glossary and context map. For each shared concept, state who owns its canonical contract, who may depend on it, and how strategy-specific extensions are represented without leaking them into shared packages.

Do not split the monolith into microservices. Bounded contexts are first a modeling and ownership tool, not a deployment mandate.

### Finding E — Architecture documentation contains stale implementation snapshots

**Severity:** Medium delivery risk.

The architecture guide includes historical descriptions of an earlier Aggressive-first composition and statements that the user-data stream was not normalized/wired to canonical fills. Those statements conflict with the later Conservative engine and canonical execution handling described by the current roadmap and source snapshot.

This is more than editorial polish: stale claims can lead future contributors to implement already-existing behavior, misunderstand current guarantees, or make unsafe changes based on obsolete assumptions.

**Recommended direction**

Mark implementation snapshots with a date/revision and link to the roadmap for current status. Separate:
1. stable architectural rules;
2. verified current implementation;
3. planned/target behavior;
4. explicitly unresolved decisions.

When code changes, update the relevant implementation-status section in the same change. Do not silently rewrite an ADR's historical rationale; record material architecture changes in a new ADR.

### Finding F — Testability is a strength, but verification claims must stay scoped

**Severity:** Release-evidence gap, not necessarily a design defect.

The architecture is conducive to deterministic tests because policies are pure, entities are explicit, and broker I/O is behind an adapter. The roadmap also records fake-broker recovery-cycle coverage and TESTNET evidence. However, a source audit does not establish that CI passes or that a real exchange cycle is currently accepted.

Keep these evidence levels distinct:

- Unit tests prove deterministic rules and invariants for their tested inputs.
- Adapter contract tests prove mapping behavior for the tested payloads.
- Fake-broker integration tests prove application workflow composition under simulated responses.
- A controlled TESTNET run proves the observed exchange path for that run and configuration.
- Restart/reconciliation tests prove recovery only when they actually exercise restart and broker-history reconciliation.

Never infer production readiness, exactly-once processing, durable recovery, or cross-process consistency from an in-memory queue or passing unit tests.

## 6. DDD and Clean Architecture rule set to preserve

1. Domain code imports neither application workflows nor infrastructure adapters.
2. Application workflows depend on ports/contracts, not concrete exchange clients.
3. Bootstrap is the composition root and process-lifecycle owner.
4. Strategy policies are deterministic and broker-independent.
5. Entities own state and enforce domain invariants; do not turn every noun into a class.
6. Canonical actual fills are the source facts for executed holdings and recovery accounting.
7. Order lifecycle and ownership checks fail closed on unknown or conflicting identity.
8. Exact financial values remain exact decimal representations; do not introduce floating-point shortcuts.
9. EventBus/Journal remain optional observers unless a separate architecture decision changes that contract.
10. Add abstractions only to isolate a demonstrated responsibility or side effect.
11. Preserve the trading-first delivery order; architecture refactoring must not block the first verified Conservative TESTNET cycle.
12. Update documentation with implementation changes and distinguish current guarantees from target behavior.

## 7. Recommended roadmap sequence

This sequence is intentionally subordinate to [Trading First](./TRADING_FIRST.md) and the active P0 trading checklist in [ROADMAP.md](../ROADMAP.md). It is not permission to delay the first trading cycle or to begin a broad rewrite.

### DDD-01 — Reconcile architecture documentation with current source

**Priority:** Now; documentation-only, low risk.

- [ ] Add this audit and link it from the Harvester roadmap and architecture guide.
- [ ] Replace or clearly mark stale implementation snapshots in `architecture.md`.
- [ ] Add a current-state summary with source revision/date and links to the relevant implementation modules.
- [ ] Make the video reference explicit and explain which principles are applicable to Harvester.
- [ ] Keep roadmap checkboxes truthful; do not mark code or TESTNET work complete based on this audit.

**Done when:** architecture guide, roadmap, and code no longer make contradictory claims about the implemented strategy, fill normalization/accounting, and current runtime composition.

### DDD-02 — Specify the Harvester domain language and context map

**Priority:** After the first trading-cycle blocker is resolved; can be drafted independently if it does not interrupt that work.

- [ ] Define a concise glossary for Pair/Market, Position, Portfolio, Fill, Order Intent, Canonical Order, Recovery Cycle, Free Inventory, and Strategy Control.
- [ ] Identify which terms are Harvester-specific and which are canonical shared Entities contracts.
- [ ] Document Harvester ↔ Entities ↔ Brokers relationships and allowed dependency direction.
- [ ] State that Journal/EventBus are observational capabilities, not trading-state authority.
- [ ] Identify any ambiguous or overloaded terms and resolve them with code owners before renaming public contracts.

**Done when:** a contributor can tell where a concept belongs and which package owns its contract without inferring ownership from a directory name.

### DDD-03 — Define fill-accounting consistency and failure semantics

**Priority:** High; schedule before durable persistence/restart recovery and before expanding multi-market concurrency.

- [ ] Document Portfolio and RecoveryLedger responsibilities and their shared canonical fill input.
- [ ] Specify deduplication ownership and behavior for duplicate versus conflicting fill identities.
- [ ] Specify whether both next immutable states are computed before either becomes visible.
- [ ] Specify failure behavior if one projection rejects a fill or a workflow step throws.
- [ ] Add tests proving the next strategy evaluation cannot observe a partial accounting transition.
- [ ] Record persistence/restart implications without prematurely introducing storage infrastructure.

**Done when:** the accounting workflow has a written invariant and deterministic tests for duplicate, conflict, invalid input, and partial-failure scenarios.

### DDD-04 — Extract accounting and recovery workflows from bootstrap

**Priority:** Medium-high; after the first TESTNET cycle is accepted, unless a demonstrated correctness issue requires earlier extraction.

- [ ] Move fill-to-Portfolio/RecoveryLedger coordination into a focused injected application workflow.
- [ ] Move recovery completion/free-inventory allocation and ledger reset into a named workflow if it remains embedded in bootstrap.
- [ ] Keep bootstrap responsible for construction, dependency injection, subscriptions, and process lifecycle.
- [ ] Preserve serialized event processing and existing public runtime behavior.
- [ ] Add focused workflow tests and bootstrap composition tests.

**Done when:** accounting/recovery workflows can be tested without starting the process and bootstrap no longer implements their business transitions.

### DDD-05 — Decompose the Conservative Trading Engine by workflow

**Priority:** Medium-high; incremental, after the first TESTNET cycle is accepted unless the active trading blocker directly requires a focused extraction.

- [ ] Map engine state by responsibility (order registry, market state, trailing BUY, replacement intent, deferred evaluation, pause state, transition serialization).
- [ ] Identify which state belongs to an entity, a workflow, or the engine's coordination boundary.
- [ ] Extract one cohesive workflow at a time: submission/acknowledgement, cancellation/reconciliation, order update, fill processing, and post-transition reevaluation.
- [ ] Keep the engine as a thin orchestrator/facade.
- [ ] Avoid class-per-event or one-file-per-callback fragmentation.
- [ ] Add deterministic regression tests before moving each lifecycle path.

**Done when:** the engine coordinates named workflows and no longer owns unrelated implementation details; all order/fill sequencing tests remain green.

### DDD-06 — Strengthen architecture fitness checks

**Priority:** After the workflow boundaries stabilize.

- [ ] Add or extend automated checks that domain modules cannot import infrastructure, broker SDKs, or bootstrap/use-case modules.
- [ ] Add adapter contract tests for normalized order/fill events and broker port behavior.
- [ ] Add focused tests for the accounting consistency invariant and engine transition serialization.
- [ ] Document which guarantees are process-local and which are durable/cross-process.
- [ ] Review test coverage against the failure matrix in the Harvester roadmap.

**Done when:** the most important dependency rules and financial lifecycle invariants are executable checks rather than prose alone.

### DDD-07 — Revisit strategic boundaries only with evidence

**Priority:** Later; no microservice or package split is proposed now.

- [ ] Review whether Harvester, shared Entities, and Brokers ownership still matches actual change patterns.
- [ ] Move a contract only when ownership or coupling evidence demonstrates a benefit and consumers can migrate safely.
- [ ] Use an ADR for material changes to aggregate ownership, persistence authority, or context boundaries.
- [ ] Do not introduce CQRS, event sourcing, repositories, or a DI framework by default.

**Done when:** any boundary change has an explicit rationale, consumer impact analysis, migration plan, and tests.

## 8. Suggested verification matrix

| Concern | Minimum evidence before calling it verified |
| --- | --- |
| Pure strategy policy | Unit tests for decision boundaries, rounding, and invalid inputs. |
| Entity invariants | Unit tests for valid/invalid transitions, immutability, duplicate and conflicting identities. |
| Broker adapter | Contract tests for raw exchange payload → canonical event mapping, including partial fills and commissions. |
| Application use case | Tests with injected fake ports for success, rejection, timeout/unknown outcome, and duplicate delivery. |
| Engine sequencing | Tests for event ordering, cancellation races, fill-during-cancel, deferred intent, and serialized transitions. |
| Accounting consistency | Tests for both projections, duplicate/conflicting fills, and partial-failure visibility. |
| Bootstrap lifecycle | Tests for composition, startup failure cleanup, subscription lifecycle, and shutdown ordering. |
| TESTNET acceptance | Recorded controlled run showing BUY fill → recovery SELL fill → next BUY, with identifiers and accounting evidence. |
| Restart recovery | Explicit restart plus broker-state/history reconciliation test; not inferred from process-local serialization. |

## 9. Non-goals and anti-patterns

This audit does **not** recommend:

- Rewriting Harvester to match the video line for line.
- Introducing Express, MongoDB repositories, microservices, or framework-led dependency injection.
- Creating an aggregate, repository, factory, class, interface, or file for every domain noun.
- Merging Portfolio and RecoveryLedger without a domain/consistency rationale.
- Moving strategy-specific rules into shared Entities.
- Making Journal/EventBus a prerequisite for trading.
- Claiming durable state, exactly-once delivery, or restart recovery from in-memory behavior.
- Refactoring the entire engine before the first Conservative TESTNET cycle is proven.

## 10. Evidence reviewed

The audit focused on the following files in the audited revision:

- `apps/harvester/src/bootstrap/start-harvester.js`
- `apps/harvester/src/use-cases/conservative-trading-engine.js`
- `apps/harvester/src/use-cases/update-trading-accounting.js`
- `apps/harvester/src/domain/strategies/conservative/recovery-ledger.js`
- `apps/harvester/src/domain/orders/order-registry.js`
- `apps/harvester/src/domain/portfolio/portfolio.js`
- `apps/harvester/src/application/ports/broker.port.js`
- `apps/harvester/docs/architecture.md`
- `docs/engineering/DOMAIN_OWNERSHIP.md`
- `docs/architecture/decisions/ADR-0001-clean-hexagonal-architecture.md`

The repository's ADR-0001 already adopts Clean Architecture, Hexagonal boundaries, and lightweight DDD. This audit is an implementation assessment and roadmap refinement; it does not replace or silently amend that ADR.

---

**Final judgment:** Harvester has a credible DDD/Hexagonal foundation and should evolve by extracting cohesive workflows and clarifying consistency/ownership boundaries—not by adding architectural ceremony. Keep the first working trading cycle as the delivery priority.
