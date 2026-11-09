# Harvester documentation

This is the entry point for Harvester-specific documentation. Repository-wide rules remain authoritative where applicable; see [Coinzilla Documentation Governance](../../../docs/DOCUMENTATION_GOVERNANCE.md).

## Start here

- [Harvester README](../README.md) — setup, runtime, configuration and operational overview
- [Harvester agent instructions](../AGENTS.md) — mandatory preflight and domain-specific constraints
- [Harvester roadmap](../ROADMAP.md) — current domain work and status
- [Trading First](TRADING_FIRST.md) — authoritative trading priority and exchange-safety requirements

## Current architecture and domain contracts

- [Architecture Decision Records](decisions/README.md) — durable Harvester decisions and rationale

- [Application architecture](architecture.md) and [architecture index](architecture/README.md)
- [Conservative Domain Specification](domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md) — sole current authority for Conservative behavior
- [Domain glossary](domain/DOMAIN_GLOSSARY.md)
- [Accounting invariants](domain/ACCOUNTING_INVARIANTS.md)
- [Portfolio domain](domain/portfolio.md)
- [Broker port and adapter](infrastructure/broker-port-and-adapter.md)
- [Trading strategies overview](trading-strategies.md) — Conservative rules remain in the canonical specification; Aggressive material is exploratory discussion, not an approved executable contract

## Operations and safety

- [Operations index](operations/README.md) — Journal, logging, TESTNET procedures and safety boundaries

- [Controlled TESTNET validation runbook](TESTNET_VALIDATION_RUNBOOK.md) — requires all documented safety gates and explicit authorization
- [Journal operations](JOURNAL_OPERATIONS.md)
- [Journal evidence contract](JOURNAL_EVIDENCE_CONTRACT.md)
- [Journal integration roadmap](JOURNAL_INTEGRATION_ROADMAP.md)
- [Logging](LOGGING.md)
- [TESTNET order tools](testnet-order-tools.md) — includes destructive examples; verify authorization and current command behavior before use
- [Incident audit playbook](INCIDENT_AUDIT_PLAYBOOK.md)
- [Conservative session audit checklist](CONSERVATIVE_SESSION_AUDIT.md)

## Historical records and evidence

- [Harvester audit index](audits/README.md)
- [Harvester roadmap history](audits/ROADMAP_HISTORY.md) — historical progress/evidence; current priorities remain in `../ROADMAP.md`.
- [Historical DDD/Clean Architecture audit](DDD_CLEAN_ARCHITECTURE_AUDIT.md)
- [Incident records](incidents/README.md)
- [Historical task briefs](tasks/README.md)

Historical reports are snapshots, not current implementation authority. Use their own observation date, baseline commit, evidence sources and limitations. Do not silently rewrite or delete them.

## Plans and inventories

- [Documentation plans index](plans/README.md)
- [Documentation migration plan](plans/DOCUMENTATION_MIGRATION.md)
- [Harvester documentation inventory](plans/HARVESTER_DOCUMENTATION_INVENTORY.md)
- [Domain-first delivery plan](DOMAIN_FIRST_DELIVERY_PLAN.md) — review current relevance before reusing

## Maintenance

- Every new or moved document must be added to the appropriate local index.
- Current behavior belongs in the canonical specification, architecture or runbook; task status belongs in the roadmap and GitHub Issues/PRs.
- Preserve historical evidence, timestamps, source commit SHAs and uncertainty during migrations.
