# Coinzilla Architecture

This directory records cross-cutting architecture principles and decisions for the Coinzilla workspace.

## Start here

- [ADR-0001: Clean and Hexagonal Architecture](./decisions/ADR-0001-clean-hexagonal-architecture.md) — the accepted architectural style and dependency boundaries.

## Templates

- [ADR template](./decisions/ADR_TEMPLATE.md) — use for durable architectural decisions.

## Authority and change policy

- [Harvester Conservative Domain Specification](../../apps/harvester/docs/domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md) is the sole authority for Conservative trading behavior.
- [Harvester Roadmap](../../apps/harvester/ROADMAP.md) tracks implementation status and planned improvements.
- Each application owns its strategy-specific rules, workflows, configuration, and runtime composition.
- Shared entities, broker contracts, event delivery, journal behavior, and utilities remain owned by their respective packages.
- Repository-wide engineering standards and the AI-agent workflow remain mandatory.
- This architecture guidance does not silently approve changes to trading policy, package ownership, or public APIs.
- If documents conflict, stop and identify the conflict rather than resolving it by assumption.
- Record material architectural changes as new ADRs; preserve the historical decision record for decisions that remain applicable.

## Status

- Clean/Hexagonal architecture direction: accepted as the repository-wide structural approach.
- Application-specific strategy and runtime decisions remain with their owning application.
