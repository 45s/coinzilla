# Harvester Architecture Decision Records

This directory records durable Harvester architecture decisions and their rationale. It does not replace current implementation documentation:

- [Application architecture](../architecture.md) describes current boundaries and runtime composition.
- [Conservative Domain Specification](../domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md) is the sole current Conservative behavior contract.
- [Journal Operations](../JOURNAL_OPERATIONS.md) describes operational behavior and safety procedures.
- [Documentation Governance](../../../../docs/DOCUMENTATION_GOVERNANCE.md) defines ADR lifecycle and maintenance rules.

## Accepted decisions

- [ADR-0001 — Journal is evidence, not trading-state authority](0001-journal-is-evidence-not-trading-state-authority.md)
- [ADR-0002 — Dual local process-ownership locks](0002-dual-local-process-ownership-locks.md)

A decision is superseded only by a new ADR that explicitly links to it. Do not rewrite an accepted ADR to erase the original rationale.
