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

### Important: do not force application use cases into a broker adapter

`@coinzilla/brokers` is an integration package, not a trading application. A public method that performs one Binance RPC and maps its response is normally an infrastructure-adapter operation; it does not become an application use case merely because it has a business-sounding name.

The Application layer is justified where the package owns a genuine workflow across capabilities or lifecycle boundaries. The existing user-data session is such a case: it coordinates multiple local subscribers, one remote subscription, reconnect/recovery, and acknowledgements across an injected client port.

Consequently:
- Do not create `application/use-cases/` wrappers for every `get*`, `createOrder`, or `cancelOrder` method.
- Do not create `domain/orders/`, `domain/market/`, or `domain/account/` just because those folders appear in the illustrative tree. First establish a Brokers-owned invariant or policy that is not already owned by `@coinzilla/entities` or the consuming application.
- Keep simple Binance request construction, response mapping, and protocol validation in infrastructure adapters.
- If the audit shows no meaningful application workflow beyond user-data session coordination, a small Application layer is the correct DDD outcome. Architectural completeness is not measured by equal folder sizes.

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

## Current implementation snapshot (develop baseline)

**Code baseline before this slice:** `2d46172d65e309bf40029b9accec561c4b1ab9ea` (after PR #692). The tree below reflects this PR's intended result: Binance DTO/Entity mapping is placed under `src/infrastructure/binance/adapters/`; adapter logic and tests remain unchanged.

The package is **partially layered already**:

```text
src/
├── application/
│   ├── ports/
│   │   └── user-data-client-port.js
│   └── user-data-session.js
├── domain/
│   └── user-data-recovery-policy.js
├── infrastructure/
│   └── binance/
│       ├── adapters/
│       │   ├── adapt-canonical-fill.js
│       │   ├── adapt-canonical-order.js
│       │   ├── adapt-fill.js
│       │   ├── adapt-order.js
│       │   ├── adapt-spot-asset.js
│       │   ├── adapt-spot-balance.js
│       │   └── normalize-binance-id.js
│       └── user-data-client-adapter.js
├── binance/
│   └── broker-websocket/
│       ├── broker.js
│       ├── config/
│       ├── constants/
│       ├── helpers/
│       ├── methods/
│       └── utils/
├── broker.core.js
└── index.js
```

### Existing test and coverage baseline

The package already has a deterministic test suite for the partial vertical slice:

- `domain/user-data-recovery-policy.test.js`
- `application/ports/user-data-client-port.test.js`
- `infrastructure/binance/user-data-client-adapter.test.js`
- `binance/broker-websocket/methods/user-data-session.{setup,recovery,reconciliation,cleanup}.test.js` cover the application session even though these lifecycle suites remain under the older Binance-oriented test tree; their shared fixtures live in `binance/broker-websocket/test-helpers/user-data-session-fixtures.js`.

The package scripts on the audited baseline are:

```sh
pnpm --filter @coinzilla/brokers test
pnpm --filter @coinzilla/brokers test:coverage
```

The coverage gate currently enforces **90% lines, 80% branches, and 80% functions** across the broker WebSocket runtime and domain/application/infrastructure paths; Binance DTO adapters are included through the infrastructure glob. Test-only fixtures and opt-in integration suites are excluded. Preserve these gates during the migration; do not treat a percentage as a substitute for meaningful failure-path and contract assertions.

No local test run was performed as part of this source/documentation audit. PR #689's repository CI passed the broker unit-test and coverage jobs; the opt-in TESTNET job was skipped by its safety gate, as intended.

### Verified workspace consumers

A manifest scan of the current `develop` workspace found two production consumers of `@coinzilla/brokers`:

| Consumer | How it uses Brokers | Compatibility implication |
| --- | --- | --- |
| `apps/harvester` | Wraps `BinanceWebSocketBroker` in Harvester's own infrastructure adapter, implementing the application-owned `BrokerPort`. | Preserve the public Binance broker methods, normalized results/events, exact decimal strings, and recovery acknowledgement behavior. |
| `packages/market-simulator` | Imports `CoreBroker`; `HistoricalMarketBroker` extends it, and `SimulatedExecutionBroker` extends the historical broker. | Preserve `CoreBroker` construction, inherited state/maps, and unsupported-method behavior unless a separate consumer migration is planned. |

This makes `CoreBroker` more than an unused legacy base class: it is a live shared extension point for the simulator. Its ownership and long-term contract need an explicit decision before any redesign. The Brokers refactor must not change the Market Simulator domain or implementation as incidental cleanup; use it as a read-only compatibility consumer and add broker-owned contract tests where appropriate.

### Consumer boundary: Harvester owns the broker application port

The current Harvester implementation confirms an important ownership rule:

- `apps/harvester/src/application/ports/broker.port.js` owns Harvester's application-facing `BrokerPort` contract.
- `apps/harvester/src/infrastructure/brokers/binance-broker-adapter.js` implements that port by composing `BinanceWebSocketBroker` and translating Harvester's normalized order/workflow contracts to the package's public API.
- Harvester bootstrap composes the concrete adapter. The broker package must not import Harvester or own Harvester's trading workflow. The separate Market Simulator consumer also proves that `CoreBroker` is a live public extension point, not merely an internal implementation detail.

Therefore, do **not** add a duplicate package-level `application/ports/broker.port.js` that mirrors the entire public Binance broker API. The existing `src/application/ports/user-data-client-port.js` is a different, internal port: it abstracts the RPC/user-data client needed by the Brokers package's own user-data session coordinator.

This is the intended hexagonal boundary: the consuming application owns the port it needs; the package's Binance implementation is an infrastructure detail from the application's perspective. Within the Brokers package, use an Application port only where an internal application workflow (currently user-data session) needs to invert a dependency.

### Existing vertical slice: user-data recovery

This is the strongest existing example of the intended architecture:

- `domain/user-data-recovery-policy.js` exports the pure `canCompleteUserDataRecovery` policy. It has no imports and decides whether recovery is complete from explicit facts.
- `application/user-data-session.js` owns subscriber lifecycle, remote subscription coordination, reconnect attempts, timers, recovery acknowledgements, and event delivery. It depends on the domain policy and an injected port contract/factory, not directly on Binance RPC classes.
- `application/ports/user-data-client-port.js` defines and validates the application-facing user-data client capability. It lives under `src/application/ports/`, making its Application ownership explicit.
- `infrastructure/binance/user-data-client-adapter.js` adapts the Binance RPC client to the exchange-neutral port, including Binance event-envelope normalization, subscription methods, and event identity.

This is a real, working vertical slice—not just empty architectural folders. Preserve it as the pattern to study when extending boundaries. It also shows that application code can own a lifecycle coordinator without importing a concrete Binance client.

### Observed dependency direction

The current import edges for the new vertical slice are already pointing inward:

```text
application/user-data-session.js
    ├──> domain/user-data-recovery-policy.js
    └──> application/ports/user-data-client-port.js

infrastructure/binance/user-data-client-adapter.js
    └──> Binance protocol helpers (adapt-msg, event identity)

binance/broker-websocket/broker.js
    ├──> application/user-data-session.js
    ├──> infrastructure/binance/user-data-client-adapter.js
    ├──> Binance RPC / Streams / transport / protocol helpers
    └──> Binance response adapters
```

The inspected `domain/` policy and `application/ports/` contract have no imports. The Application module imports only the domain policy and port assertion; it does not import Binance infrastructure. The user-data adapter implements the port. Binance DTO/Entity adapters live under `infrastructure/binance/adapters/`; the broker facade imports them as part of its infrastructure composition. The remaining `binance/broker-websocket/` tree is also infrastructure, though it has not yet been relocated under the infrastructure folder.

### Current gaps and boundary pressure

- `binance/broker-websocket/broker.js` is 782 lines and imports both `application/user-data-session.js` and the concrete `infrastructure/binance/user-data-client-adapter.js`, as well as RPC, Streams, transport, Binance request builders, and Binance response adapters. It is the public facade and current composition boundary. The existing roadmap justifies keeping simple RPC methods cohesive; extract only a demonstrated composition seam or a cohesive stateful/application responsibility.
- The user-data client port is now nested under `application/ports/`, matching the application-owned port placement used by Harvester. The infrastructure adapter implements this contract; application session code owns its use.
- There is no `bootstrap/` folder or dedicated `create-binance-broker.js` composition root yet. Client construction currently starts in module-local factories in `broker.js`.
- There is no general `application/use-cases/` area. Do not assume every public broker method needs a use case; identify real application workflows first.
- The only current `domain/` module is the user-data recovery completion policy. The package has not yet established broader domain modules for orders, market, account, or events.
- `infrastructure/binance/adapters/adapt-canonical-fill.js` and `adapt-canonical-order.js` consume Binance DTOs and Binance identifier normalization. Their Binance DTO and identifier dependencies make them Infrastructure adapters, not exchange-neutral domain modules.
- `binance/broker-websocket/utils/rpc-client.js`, `streams-client.js`, `streams-protocol.js`, `transport.js`, `runtime.js`, and `signature.js` are clearly Binance/protocol/runtime infrastructure. Their lifecycle and protocol tests are valuable and should remain with those components during migration.
- `broker.core.js` is a compatibility base class with default unsupported-method behavior and shared maps. Its long-term ownership is unresolved; do not automatically treat a base class as a domain entity or port.

### Verified ownership map

| Current path | Verified responsibility | Architectural status / likely destination |
| --- | --- | --- |
| `domain/user-data-recovery-policy.js` | Pure recovery-completion policy | Correctly placed in Domain |
| `application/user-data-session.js` | Subscriber/session lifecycle and recovery coordination | Application coordinator; retain state ownership and test behavior |
| `application/ports/user-data-client-port.js` | Exchange-neutral user-data client contract and runtime assertion | Correctly placed under Application; infrastructure implements it |
| `infrastructure/binance/user-data-client-adapter.js` | Binance RPC/event adaptation to user-data port | Correctly placed in Infrastructure |
| `binance/broker-websocket/broker.js` | Public broker facade and current composition boundary; simple RPC operations plus client/session wiring | Keep simple RPC methods cohesive; extract only demonstrated composition or cohesive responsibilities |
| `binance/broker-websocket/utils/*` | RPC, Streams, transport, signing, runtime, stream protocol | Infrastructure; move/group under `infrastructure/binance/` incrementally |
| `binance/broker-websocket/helpers/adapters/*` | Binance request/response/event DTO mapping | Infrastructure adapters |
| `infrastructure/binance/adapters/adapt-canonical-*.js` | Binance DTO to canonical Entities conversion | Infrastructure adapters; preserve exact decimal contracts |
| `infrastructure/binance/adapters/adapt-*.js` | Legacy broker DTO and Binance asset/balance adaptation | Infrastructure; preserve legacy API shape until consumer migration is explicit |
| `broker.core.js` | Shared base class and contract used by Market Simulator | Public compatibility extension point; preserve construction, state, and default methods |

The 658-line `application/user-data-session.js` is a cohesive stateful lifecycle coordinator with private state, injected client/port factories, and controlled timer dependencies. Its size triggers a modularity review under repository standards, but it must not be fragmented mechanically: first determine whether its state transitions can be separated without splitting ownership of the recovery state machine.

The 782-line broker facade warrants review because its constructor and imports reveal both composition and exchange-operation responsibilities. The existing package roadmap records a concrete reason to keep simple RPC methods cohesive there. No code movement is authorized by this snapshot alone; identify a genuine dependency inversion or cohesive responsibility before extracting anything.

## Existing code: initial responsibility map

This map is a starting hypothesis based on the current tree. Validate each module and its import graph before moving it.

| Existing module / area | Primary responsibility | Target owner |
| --- | --- | --- |
| `src/broker.core.js` | Shared broker base class and contract used by Market Simulator | Public compatibility extension point; preserve constructor/state/default-method behavior until consumers are migrated |
| `src/binance/broker-websocket/broker.js` | 782-line public facade and current composition boundary; simple RPC methods plus client/session wiring | Retain simple RPC operations; extract only a demonstrated composition seam or cohesive responsibility, never one wrapper per RPC |
| `utils/rpc-client.js` | WebSocket API RPC mechanics | Infrastructure / Binance API |
| `utils/streams-client.js`, `utils/streams-protocol.js` | Public stream protocol and subscription lifecycle | Infrastructure / Binance Streams |
| `utils/transport.js`, `utils/runtime.js` | Native socket and runtime mechanics | Infrastructure / transport |
| `application/user-data-session.js` | User-data subscriber/recovery lifecycle coordinator | Existing Application layer; injected port and domain policy already separate |
| `utils/signature.js`, `helpers/history-query-params.js`, endpoint/config modules | Binance signing, request construction, protocol configuration | Infrastructure / Binance API |
| `shared/adapt-canonical-*.js` | Binance DTO to canonical Entities adaptation | Infrastructure / Binance adapters; canonical output does not make Binance mapping domain logic |
| `shared/adapt-*.js`, `helpers/adapters/*` | External response/event mapping | Infrastructure adapters unless proven protocol-neutral |
| `helpers/user-data-event-deduplicator.js` | Binance user-data event identity/deduplication | Infrastructure adapter/session support until a protocol-neutral policy is demonstrated |
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
- [x] Inventory all source modules, exports, import edges, side effects, state ownership, and consumers.
- [x] Map each responsibility to Domain, Application, Infrastructure, Bootstrap, or compatibility surface.
- [x] Identify existing canonical Entities contracts and avoid parallel models.
- [x] Record current test/coverage baseline and commands.
- [x] Record unresolved design questions and decisions in the roadmap.
- **Exit:** reviewed responsibility map and dependency graph; completed before the next extraction slice.

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
- [ ] Evaluate whether a dedicated bootstrap factory removes a real coupling or clarifies ownership without changing the public constructor. Keep composition in the concrete infrastructure facade if that remains the simplest correct boundary; document the decision either way. Keep public exports thin.
- [ ] Verify reconnect, cleanup, recovery acknowledgement, and uncertain mutation outcomes remain safe.
- **Exit:** concrete Binance dependencies are constructed only at infrastructure/composition boundaries; a separate bootstrap module exists only if it provides a demonstrated benefit.

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
