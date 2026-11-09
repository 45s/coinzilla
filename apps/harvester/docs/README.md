# Harvester documentation

This is the entry point for Harvester-specific documentation. Repository-wide rules remain authoritative where applicable; see [Coinzilla Documentation Governance](../../../docs/DOCUMENTATION_GOVERNANCE.md).

## Start here

- [Harvester README](../README.md) — setup, runtime, configuration and operational overview
- [Harvester agent instructions](../AGENTS.md) — mandatory preflight and domain-specific constraints
- [Harvester roadmap](../ROADMAP.md) — current domain work and status
- [Trading First](TRADING_FIRST.md) — authoritative trading priority and exchange-safety requirements

## Architecture and domain

- [Architecture](architecture.md) — application architecture and implementation patterns
- [Domain specifications](domain/) — domain-owned specifications and invariants
- [Infrastructure documentation](infrastructure/) — adapters and integration contracts

- [Harvester audit index](audits/README.md)
- [Documentation migration plan](plans/DOCUMENTATION_MIGRATION.md) — phased, evidence-preserving consolidation.

## Operations and reliability

- [Journal operations](JOURNAL_OPERATIONS.md) — operational Journal lifecycle and procedures
- [Journal integration roadmap](JOURNAL_INTEGRATION_ROADMAP.md) — staged Journal work

## Audits and historical evidence

Harvester contains historical audits and investigation records at the application root and in its documentation tree. Until the inventory/migration phase is complete, treat each report's own date, baseline commit, scope and evidence status as authoritative for that snapshot. Do not assume similarly named reports are duplicates or delete/overwrite them.

- [Application audit](../AUDIT.md)
- [Audit findings register](../AUDIT_FINDINGS.md)
- [Audit execution history](../AUDIT_EXECUTION_HISTORY.md)

## Maintenance rules

- Current behavior belongs in the closest authoritative architecture, domain, configuration or runbook document.
- Historical observations belong in dated audit/investigation records and are not silently rewritten.
- Current task status belongs in the Harvester roadmap and linked GitHub Issues/PRs.
- Add new documents to this index; update it when documents move, are superseded or archived.
- Preserve evidence, timestamps, source commit SHAs and uncertainty during any migration.
