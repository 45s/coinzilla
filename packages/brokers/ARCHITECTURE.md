# Brokers Package Architecture

---

status: active
type: architecture
owner: brokers
---

> Status: **target architecture and migration contract**. This document describes the intended internal structure of `@coinzilla/brokers`; it is not a claim that the current source tree already has this structure. The migration is incremental and must preserve the working broker.

## Purpose and scope

The Brokers package is an exchange-integration domain. Its responsibility is to expose stable, normalized broker capabilities while hiding exchange-specific protocols and behavior. Binance remains the fully integrated reference implementation; Bitunix Spot is being added incrementally behind its own infrastructure adapter. The package is not the owner of trading strategy, portfolio policy, or application workflows.

The architectural reference is [Harvester Architecture](../../apps/harvester/docs/architecture.md), especially its separation of domain behavior, injected use cases, infrastructure adapters, and bootstrap composition. Reuse the principles, not Harvester's business model or every folder name.

The package already contains valuable boundaries (RPC, Streams, transport, user-data session, canonical adapters, and deterministic tests). DDD modernization should clarify ownership and dependency direction around those capabilities—not replace working WebSocket code or reorganize files merely for appearance.

## Exchange infrastructure boundaries

Each exchange owns its own infrastructure adapter and protocol details:

- `infrastructure/binance/` owns Binance WebSocket API/Streams, signing, endpoint configuration, user-data lifecycle, and Binance DTO adaptation.
- `infrastructure/bitunix/` owns Bitunix Spot REST signing, HTTP transport, configuration, API DTO adaptation, and Bitunix-to-entity mapping.

The exchange adapters may share canonical `@coinzilla/entities` and exact decimal utilities. They must not import one another's protocol code. A common broker method name does not imply that an exchange supports the same capability or lifecycle guarantee. Unsupported capabilities must return explicit structured errors or reject according to the existing method contract; never synthesize exchange facts or silently downgrade safety.

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
       use cases                Exchange adapters
       application ports        Binance / Bitunix APIs
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

- **Domain** has no dependency on application workflows, infrastructure, exchange protocol modules, sockets, environment variables, clocks, or network clients.
- **Application** depends on domain behavior and application-owned ports. It coordinates broker use cases but does not know exchange request/response schemas.
- **Infrastructure** implements application ports and translates exchange protocol messages into application/domain contracts. It may depend inward, never the reverse.
- **Bootstrap** is the composition root. It selects concrete adapters, constructs clients/use cases, and returns the public broker facade.
- **Public entry points** remain thin and preserve existing exports and consumer contracts.

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
│   ├── binance/
│   │   ├── adapters/
│   │   ├── api/
│   │   ├── streams/
│   │   ├── transport/
│   │   └── sessions/
│   └── bitunix/
│       ├── adapters/
│       ├── api/
│       ├── auth/
│       └── config/
├── bootstrap/
└── index.js
```

Folder and module names must follow actual domain language discovered during the audit. The proposed subdomains are hypotheses to validate, not a reason to create speculative models.

### Domain

Owns broker-domain concepts and deterministic rules that are meaningful independently of an exchange:

- normalized order, fill, balance, market, account, and broker-event facts where the package genuinely owns their semantics;
- validation and invariants for broker-facing canonical values;
- deterministic parsing/normalization/mapping that is not protocol-specific;
- pure functions for calculations, predicates, and transformations.

Use existing canonical contracts from `@coinzilla/entities` where they already express the concept. Do not create parallel Order, Fill, Market, Balance, Money, or Quantity models just to populate `domain/`. An exchange-specific field or status must not leak into a supposedly exchange-neutral domain contract.

Use classes only when an object owns state and protects lifecycle invariants. Prefer plain pure functions for deterministic logic.

### Application

Owns the broker capabilities as seen by callers and the workflows that coordinate them:

- narrow application-owned ports/contracts for required external capabilities;
- focused injected use cases for meaningful broker operations or workflows;
- orchestration, sequencing, and application-level error/result semantics.

A use case is justified when it represents an application goal and coordinates collaborators. Do not wrap every existing method in a one-line use case or create an interface for every class. Ports should describe the capability the application needs, not mirror the entire exchange API.

### Infrastructure

Owns exchange-specific and technical details:

- exchange API protocol, signing, endpoint configuration, and API error translation;
- public/private streams, polling, batching, pacing, reconnect and rotation;
- socket/HTTP transport and low-level lifecycle;
- user-data subscription session mechanics and recovery signaling;
- exchange response/event adapters and request construction.

RPC, Streams, transport, and session modules are infrastructure components. They are not domain entities or application use cases simply because they contain state machines or have extensive tests. Keep focused tests close to their implementation.

### Bootstrap and public API

Bootstrap constructs concrete exchange infrastructure, injects it into application use cases/ports, and returns the public broker facade. The public `index.js` exports intentional contracts and factories; it should not own implementation logic.

Keep existing public broker APIs stable during internal migration. Any proposed public API change requires a separate compatibility analysis and consumer migration plan.

## Phase 9 implementation snapshot (after PR #697)

**Structural baseline:** merge commit `ae5d1a8a9c474cff46a6db72f4258787bb071669` (PR #697). This is the historical starting snapshot for the remaining Phase 9 DDD slices, not the current `develop` commit. The later dependency-direction enforcement and public-contract verification are recorded in [Enforced dependency direction (PR #704)](#enforced-dependency-direction-pr-704) and the [package roadmap](./ROADMAP.md#14-mandatory-autonomous-ddd-refactoring-execution). The tree below is a selective architecture map, not an exhaustive file listing.

The package now has a physical Domain / Application / Infrastructure split. The existing `broker-websocket` implementation remains internally organized as before; this slice relocates it under Infrastructure without redesigning protocol clients or decomposing folders for their own sake.

```text
src/
├── application/
│   ├── ports/
│   │   └── user-data-client-port.js
│   ├── user-data-session.js
│   └── user-data-session.test.js
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
│       ├── broker-websocket/
│       │   ├── broker.js
│       │   ├── config/
│       │   ├── constants/
│       │   ├── helpers/
│       │   ├── tests/
│       │   ├── test-helpers/
│       │   └── utils/
│       ├── index.js
│       └── user-data-client-adapter.js
├── broker.core.js
└── index.js
```
