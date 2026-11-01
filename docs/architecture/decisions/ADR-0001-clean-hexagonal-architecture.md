# ADR-0001: Clean and Hexagonal Architecture for Coinzilla

- **Status:** Accepted
- **Date:** 2026-11-01
- **Owners:** Coinzilla architecture (cross-cutting)
- **Related:** [Architecture blueprint](../COINZILLA_ARCHITECTURE.md), [Free-Roll roadmap](../../../apps/bot-free-roll/ROADMAP.md), [Engineering standards](../../../ENGINEERING_STANDARDS.md)

## Context

Coinzilla is a JavaScript pnpm monorepo with shared packages and applications. The Free-Roll application must remain independent of any specific exchange while coordinating market data, orders, executions, commissions, accounting, inventory, recovery, and process lifecycle.

The repository already has useful canonical entities, broker adapters, event and journal packages, and Free-Roll collaborators. It also has an explicit engineering roadmap that requires exact financial arithmetic, canonical fill-level accounting, broker capability contracts, safe reconciliation, deterministic tests, and incremental PRs.

A simple layered architecture is not sufficient if business rules still import concrete adapters or if financial decisions are made in event handlers. A heavyweight framework or microservice decomposition would add complexity without solving the current core problem.

## Decision

Adopt **Clean Architecture with Hexagonal (Ports and Adapters) boundaries and lightweight Domain-Driven Design**.

The decision establishes these rules:

1. Domain policies depend on canonical domain concepts, not application or infrastructure details.
2. Free-Roll-specific strategy rules remain in the Free-Roll application; reusable exact financial/trading concepts remain in the shared entities/contracts package.
3. Application workflows depend on stable capability contracts (ports), not concrete exchange adapter classes.
4. Concrete adapters translate external protocols and payloads into canonical contracts.
5. The runtime composition root selects and injects concrete adapters and owns process lifecycle and resource cleanup.
6. Side effects such as network, filesystem, time, messaging, and persistence are explicit boundaries.
7. Unknown, unsupported, stale, incomplete, or unreconciled facts must not be treated as safe defaults for financial or order decisions.
8. Migrate incrementally; do not rewrite stable modules or introduce frameworks/packages without demonstrated need.

## Why this option

- **Clean Architecture** makes dependency direction explicit and protects strategy/domain rules from infrastructure churn.
- **Hexagonal Architecture** gives external systems named ports and adapters, making broker replacement and deterministic testing practical.
- **Lightweight DDD** preserves domain language and invariants without forcing entities, aggregates, repositories, or classes for every concept.
- The combination directly supports the repository's existing roadmap and test-first engineering standards.

## Alternatives considered

### Traditional layered architecture only

Rejected as insufficiently explicit about dependency inversion. It can still allow service/business code to import SDKs and database clients directly.

### Full microservices

Rejected. Coinzilla is already a monorepo with shared packages, and no demonstrated scaling or deployment boundary requires independent services. Splitting services would add network and operational failure modes.

### CQRS/event sourcing as a default

Rejected. The project has event delivery and a journal, but neither implies that every workflow should use CQRS or that the journal is a durable source of truth. Use specialized event-sourced designs only if a concrete requirement and recovery model justify them.

### Framework-led dependency injection

Rejected for now. Plain JavaScript composition functions and explicit constructor/factory injection are sufficient and easier to inspect. Revisit only if composition complexity materially grows.

### Big-bang rewrite

Rejected. Existing queueing, event handling, reconciliation helpers, entities, adapters, and tests are useful foundations. Replace or move them only as focused tasks demonstrate a correctness or maintainability benefit.

## Consequences

### Positive

- Strategy and accounting can be tested without exchange SDKs or network access.
- Broker adapters can evolve independently while preserving canonical contracts.
- Exact financial representation and fail-closed behavior become explicit cross-layer requirements.
- The composition root becomes the only place that needs concrete adapter selection.
- Incremental PRs can improve architecture without destabilizing the whole application.

### Costs and constraints

- Canonical contracts and adapter contract tests require deliberate design and maintenance.
- Some current modules will temporarily straddle target boundaries during migration.
- The team must keep documentation and implementation status distinct.
- Cross-package changes require coordination under the repository's AI-agent workflow.
- More explicit ports can add small amounts of boilerplate; introduce only the capabilities a real workflow needs.

## Implementation guidance

- Treat the [architecture blueprint](../COINZILLA_ARCHITECTURE.md) as the structural reference.
- Treat the Free-Roll strategy README as authoritative for trading behavior and the Free-Roll roadmap as authoritative for sequencing and acceptance criteria.
- Do not use this ADR to change trading policy, approve unresolved accounting decisions, or declare existing code production-ready.
- Add a new ADR for a material change to this decision; do not silently overwrite the historical rationale.
