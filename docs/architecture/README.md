# Coinzilla Architecture

This directory records cross-cutting architecture principles and decisions for the Coinzilla workspace.

## Start here

- [ADR-0001: Clean and Hexagonal Architecture](./decisions/ADR-0001-clean-hexagonal-architecture.md) — the accepted architectural style and dependency boundaries.

## Authority and change policy

- [Free-Roll strategy specification](../../apps/bot-free-roll/README.md) is authoritative for the currently documented Free-Roll behavior.
- [Free-Roll engineering roadmap](../../apps/bot-free-roll/ROADMAP.md) is authoritative for that application's engineering invariants and backlog.
- Each application owns its strategy-specific rules, workflows, configuration, and runtime composition.
- Shared entities, broker contracts, event delivery, journal behavior, and utilities remain owned by their respective packages.
- Repository-wide engineering standards and the AI-agent workflow remain mandatory.
- This architecture guidance does not silently approve changes to trading policy, package ownership, or public APIs.
- If documents conflict, stop and identify the conflict rather than resolving it by assumption.
- Record material architectural changes as new ADRs; preserve the historical decision record for decisions that remain applicable.

## Status

- Clean/Hexagonal architecture direction: accepted as the repository-wide structural approach.
- Application-specific strategy and runtime decisions remain with their owning application.
