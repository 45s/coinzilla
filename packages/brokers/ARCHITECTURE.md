# Brokers Package Architecture

> Status: **target architecture and migration contract**. This document describes the intended internal structure of `@coinzilla/brokers`; it is not a claim that the current source tree already has this structure. The migration is incremental and must preserve the working broker.

## Purpose and scope

The Brokers package is an exchange-integration domain. Its responsibility is to expose stable, normalized broker capabilities while hiding Binance protocol details. It is not the owner of trading strategy, portfolio policy, or application workflows.

The architectural reference is [Harvester Architecture](../../apps/harvester/docs/architecture.md), especially its separation of domain behavior, injected use cases, infrastructure adapters, and bootstrap composition. Reuse the principles, not Harvester's business model or every folder name.

The package already contains valuable boundaries (RPC, Streams, transport, user-data session, canonical adapters, and deterministic tests). DDD modernization should clarify ownership and dependency direction around those capabilities—not replace working WebSocket code or reorganize files merely for appearance.

## Target dependency direction

```text
                 Public package API
                         |
                         v
                  Bootstrap / Factory
                         |
             +-----------+-----------+
             |                       |
             v                       v
       Application              Infrastructure
       use cases                Binance adapters
       application ports        WebSocket API / Streams
             |                       |
             v                       v
           Domain <------------- translates external facts
       broker concepts
       invariants
       pure policies
       value construction
```

The allowed compile-time dependency direction is:

```text
Infrastructure  --->  Application  --->  Domain
       ^                    ^
       |                    |
       +---- Bootstrap -----+
```

More precisely:
- **Domain** has no dependency on application workflows, infrastructure, Binance protocol modules, sockets, environment variables, clocks, or network clients.
- **Application** depends on domain behavior and application-owned ports. It coordinates broker use cases but does not know Binance request/response schemas.
- **Infrastructure** implements application ports and translates Binance protocol messages into application/domain contracts. It may depend inward, never the reverse.
- **Bootstrap** is the composition root. It selects concrete adapters, constructs clients/use cases, and exposes the public broker facade.
- **Public entry points** remain thin and preserve the existing package exports and consumer contract.

Do not introduce a layer solely to satisfy this diagram. A responsibility can remain in a cohesive module where it is until there is a concrete extraction boundary.

## Proposed source layout

This is the desired direction, not a mandate to create empty directories or move every existing file immediately.

```text
packages/brokers/src/
├── domain/
│   ├── orders/
│   ├── market/
│   ├── account/
│   └── events/
├── application/
│   ├── ports/
│   └── use-cases/
├── infrastructure/
│   └── binance/
│       ├── adapters/
│       ├── api/
│       ├── streams/
│       ├── transport/
│       └── sessions/
├── bootstrap/
│   └── create-binance-broker.js
└── index.js
```

Folder and module names must follow actual domain language discovered during the audit. The proposed subdomains are hypotheses to validate, not a reason to create speculative models.

### Domain

Owns broker-domain concepts and deterministic rules that are meaningful independently of Binance:
- normalized order, fill, balance, market, account, and broker-event facts where the package genuinely owns their semantics;
- validation and invariants for broker-facing canonical values;
- deterministic parsing/normalization/mapping that is not protocol-specific;
- pure functions for calculations, predicates, and transformations.

Use existing canonical contracts from `@coinzilla/entities` where they already express the concept. Do not create parallel Order, Fill, Market, Balance, Money, or Quantity models just to populate `domain/`. A Binance-specific field or status must not leak into a supposedly exchange-neutral domain contract.

Use classes only when an object owns state and protects lifecycle invariants. Prefer plain pure functions for deterministic logic.

### Application

Owns the broker capabilities as seen by callers and the workflows that coordinate them:
- narrow application-owned ports/contracts for required external capabilities;
- focused injected use cases for meaningful broker operations or workflows;
- orchestration, sequencing, and application-level error/result semantics.

A use case is justified when it represents an application goal and coordinates collaborators. Do not wrap every existing method in a one-line use case or create an interface for every class. Ports should describe the capability the application needs, not mirror the entire Binance API.

### Infrastructure

Owns all Binance-specific and technical details:
- Binance WebSocket API request/response protocol, signing, endpoint configuration, and API error translation;
- public WebSocket Streams protocol, subscription commands, batching, pacing, reconnect and rotation;
- socket transport and low-level lifecycle;
- user-data subscription session mechanics and recovery signaling;
- Binance response/event adapters and exchange-specific request construction.

RPC, Streams, transport, and session modules are infrastructure components. They are not domain entities or application use cases simply because they contain state machines or have extensive tests. Their current good lifecycle tests remain valuable and should stay close to the infrastructure implementation.

### Bootstrap and public API

Bootstrap constructs concrete Binance infrastructure, injects it into application use cases/ports, and returns the public broker facade. The public `index.js` exports intentional contracts and factories; it should not own implementation logic.

Keep the current public broker API stable during this internal migration. Any proposed public API change requires a separate compatibility analysis and consumer migration plan.

## Existing code: initial responsibility map

This map is a starting hypothesis based on the current tree. Validate each module and its import graph before moving it.

| Existing module / area | Primary responsibility | Target owner |
| --- | --- | --- |
| `src/broker.core.js` | Shared broker base contract and compatibility behavior | Application-facing contract (or retained compatibility surface); review before redesign |
| `src/binance/broker-websocket/broker.js` | Public broker facade, request construction, orchestration, adaptation | Split by responsibility across application, infrastructure, and bootstrap |
| `utils/rpc-client.js` | WebSocket API RPC mechanics | Infrastructure / Binance API |
| `utils/streams-client.js`, `utils/streams-protocol.js` | Public stream protocol and subscription lifecycle | Infrastructure / Binance Streams |
| `utils/transport.js`, `utils/runtime.js` | Native socket and runtime mechanics | Infrastructure / transport |
| `methods/user-data-session.js` | User-data subscription/recovery lifecycle | Infrastructure session; application-facing recovery contract stays inward |
| `utils/signature.js`, `helpers/history-query-params.js`, endpoint/config modules | Binance signing, request construction, protocol configuration | Infrastructure / Binance API |
| `shared/adapt-canonical-*.js` | Canonical order/fill adaptation | Inspect field semantics: exchange-neutral transformations may belong in domain; Binance-specific mappings stay in infrastructure adapters |
| `shared/adapt-*.js`, `helpers/adapters/*` | External response/event mapping | Infrastructure adapters unless proven protocol-neutral |
| `helpers/user-data-event-deduplicator.js` | Event identity/deduplication policy | Determine whether this is generic domain behavior or Binance-session lifecycle; keep ownership explicit |
| `test-helpers/*`, `*.test.js`, `tests/*` | Deterministic fixtures and behavioral specifications | Stay near the unit under test; shared fixtures remain test-only |

Do not move a file based on its name alone. Inspect imports, callers, state ownership, side effects, and the meaning of each exported function. A single current file may contain responsibilities for more than one target layer.

## Architectural rules

1. **Dependency rule:** dependencies point inward. Domain never imports application or infrastructure. Application never imports Binance modules or transport. Infrastructure implements inward-facing ports.
2. **Pure-function default:** meaningful deterministic calculations, validation, normalization, parsing, and decisions are plain pure functions in cohesive modules, consistent with Harvester and repository engineering standards.
3. **State ownership:** classes are appropriate for owned state and lifecycle invariants (for example, RPC pending-request correlation or subscription state), not as containers for unrelated logic.
4. **Injected workflows:** application use cases receive explicit dependencies. Avoid hidden imports of concrete clients, environment, global clocks, or sockets.
5. **Ports are application-owned:** define a port only when an application workflow needs an external capability. Infrastructure implements it.
6. **Adapters translate:** Binance names, payloads, statuses, error codes, signatures, and protocol quirks terminate at infrastructure boundaries.
7. **Canonical contracts are reused:** prefer `@coinzilla/entities` and existing package contracts. Do not fork shared models or convert financial decimal strings through JavaScript `Number`.
8. **No speculative abstractions:** no empty folders, generic repository layers, service locators, dependency-injection frameworks, or one-line wrappers for their own sake.
9. **Public compatibility:** preserve exports, method signatures, result shapes, event callbacks, error behavior, exact decimal fidelity, and uncertain-outcome safety.
10. **Tests follow responsibility:** tests are the safety net and executable characterization of the migration, not the architectural goal. Keep deterministic offline tests as the default; keep TESTNET suites opt-in.

## TDD migration method

Every architectural change follows a small, reviewable RED → GREEN → REFACTOR cycle:

1. **RED — characterize:** write or extend a test for externally observable behavior or a newly explicit boundary. The test should fail for the intended reason.
2. **GREEN — preserve behavior:** make the smallest code change that satisfies the test without changing the public contract.
3. **REFACTOR — move ownership:** extract the responsibility into its target layer, keeping the tests green. Add dependency-direction checks or focused tests where useful.
4. Run the affected test file, the full broker suite, and the coverage gate. Run applicable workspace checks before opening the PR.
5. Update this architecture document and `ROADMAP.md` when ownership, decisions, or phase status changes.

Tests should be selected by architectural risk:
- Domain: pure invariant, value construction, validation, and deterministic transformation tests.
- Application: use-case behavior with injected fake ports; verify decisions, calls, sequencing, and propagated errors.
- Infrastructure: Binance protocol translation, RPC/Streams/transport/session lifecycle, malformed responses, reconnect, cleanup, and uncertain outcomes.
- Contract: public exports and consumer-observable method/result/event compatibility across the facade and adapters.

Do not duplicate the same scenario in every layer. A focused test at the owning boundary plus a smaller contract test is preferable to a large set of brittle implementation tests.

## Migration phases and exit criteria

### Phase A — Architecture discovery and baseline
- [ ] Inventory all source modules, exports, import edges, side effects, state ownership, and consumers.
- [ ] Map each responsibility to Domain, Application, Infrastructure, Bootstrap, or compatibility surface.
- [ ] Identify existing canonical Entities contracts and avoid parallel models.
- [ ] Record current test/coverage baseline and commands.
- [ ] Record unresolved design questions and decisions in the roadmap.
- **Exit:** reviewed responsibility map and dependency graph; no code moved.

### Phase B — Characterization and test preparation
- [ ] Identify public behaviors and safety-critical edge cases not already characterized.
- [ ] Add only missing characterization tests; do not inflate test count for its own sake.
- [ ] Capture public exports, result/error shapes, callback semantics, decimal fidelity, and state-changing RPC uncertainty.
- [ ] Ensure deterministic fakes control clocks, timers, sockets, and concurrency without arbitrary sleeps.
- **Exit:** a trustworthy offline safety net exists for the first extraction slice.

### Phase C — Domain extraction
- [ ] Extract genuinely domain-owned canonical value construction, invariants, and pure transformations from mixed modules.
- [ ] Reuse Entities contracts; do not fork existing domain types.
- [ ] Keep Binance protocol field mapping in infrastructure.
- [ ] Add domain tests at the pure-function/value boundary.
- **Exit:** extracted domain modules have no application/infrastructure imports and are tested independently.

### Phase D — Application boundary and use cases
- [ ] Identify actual caller goals and the minimal broker capabilities each workflow needs.
- [ ] Define application-owned ports only for those required capabilities.
- [ ] Extract focused injected workflows where orchestration is currently mixed with protocol work.
- [ ] Keep domain independent of application ports and workflow code.
- **Exit:** application workflows can be tested with fake ports and do not instantiate Binance clients.

### Phase E — Infrastructure adapters and composition
- [ ] Group Binance API, Streams, transport, sessions, signing/configuration, and response adapters under infrastructure by responsibility.
- [ ] Implement application ports through adapters without changing the public facade.
- [ ] Add a bootstrap factory/composition root and keep public exports thin.
- [ ] Verify reconnect, cleanup, recovery acknowledgement, and uncertain mutation outcomes remain safe.
- **Exit:** concrete Binance dependencies are constructed only at bootstrap/infrastructure boundaries.

### Phase F — Dependency and compatibility verification
- [ ] Verify dependency direction (static import audit or focused architecture tests where practical).
- [ ] Run public export and broker contract tests.
- [ ] Run full package tests and coverage; run workspace quality gates.
- [ ] Run opt-in TESTNET verification only when explicitly configured and safe.
- [ ] Update package README, architecture, roadmap, and any consumer-facing docs.
- **Exit:** migration is integrated into `develop`, all required CI checks pass, and the roadmap records the final tree and verified evidence.

## Per-PR delivery checklist

- [ ] One coherent architectural slice; no unrelated cleanup.
- [ ] RED → GREEN → REFACTOR evidence is clear in tests and PR description.
- [ ] Public behavior and consumer compatibility are unchanged, or a separately approved compatibility plan exists.
- [ ] New/changed behavior has deterministic tests; no weakened or deleted assertions.
- [ ] Package coverage remains above its enforced thresholds.
- [ ] Dependency direction is preserved; no domain-to-infrastructure imports.
- [ ] Architecture/roadmap/docs updated when the slice changes ownership or status.
- [ ] Exact commands and outcomes reported; never claim an unrun check passed.
- [ ] PR targets latest `develop`; CI passes on the exact current head before merge.

## Explicitly out of scope

- Rewriting or replacing the native WebSocket implementation.
- Adding another transport abstraction without a demonstrated need.
- Moving trading strategies, Portfolio, Position, or Trading Engine behavior from Harvester into Brokers.
- Introducing a new domain model where `@coinzilla/entities` already owns the concept.
- Changing public APIs as incidental cleanup.
- Adding speculative generic infrastructure or a dependency-injection framework.
