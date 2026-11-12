# Harvester documentation

This is the entry point for Harvester-specific documentation. Repository-wide rules remain authoritative where applicable; see [Coinzilla Documentation Governance](../../../docs/DOCUMENTATION_GOVERNANCE.md).

## Start here

- [Application configuration and Telegram notification profiles](../README.md#optional-telegram-notifications) — the single `config.json`, profile behavior, event overrides, and environment-only credentials.

- [Harvester README](../README.md) — setup, runtime, configuration and operational overview
- [Interactive pair configuration generator](../README.md#generate-a-new-trading-pair) — create a validated, disabled-by-default Binance Spot pair through `pnpm run config:symbol`
- [Harvester agent instructions](../AGENTS.md) — mandatory preflight and domain-specific constraints
- [Harvester roadmap](../ROADMAP.md) — current domain work and status
- [Trading First](TRADING_FIRST.md) — authoritative trading priority and exchange-safety requirements

## Current architecture and domain contracts

- [Application architecture](architecture.md) and [architecture index](architecture/README.md)
- [Operator control](operator-control/README.md) — accepted `/pause <SYMBOL>` contract; engine, application and offline Telegram adapter implemented in PR #1045; inbound runtime remains disabled pending recovery/readiness gates
- [Volatility Protection](volatility-protection.md) — per-market protection, required explicit pair-level policy and order gate; provisional thresholds still require offline historical calibration
- [Exchange trading constraints](exchange-trading-constraints.md) — canonical exchange-neutral constraint contract, Binance's non-blocking diagnostic policy, and local-versus-venue enforcement boundary
- [Process-restart recovery contract (ADR-0001)](architecture/decisions/0001-application-owned-recovery-facts.md) — accepted target design; runtime recovery remains disabled.
- [One-market recovery reconciliation](recovery/README.md) — Step 7 offline evidence bundle, audit-only CLI and guarded coverage confirmation.
- [Conservative Domain Specification](domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md) — sole current authority for Conservative behavior
- [Domain glossary](domain/DOMAIN_GLOSSARY.md)
- [Accounting invariants](domain/ACCOUNTING_INVARIANTS.md)
- [Portfolio domain](domain/portfolio.md)
- [Broker port and adapter](infrastructure/broker-port-and-adapter.md)
- [Trading strategies overview](trading-strategies.md) — Conservative rules remain in the canonical specification; Aggressive material is exploratory discussion, not an approved executable contract

## Operations and safety

- [Operations index](operations/README.md) — Journal, logging, TESTNET procedures and safety boundaries

- [Controlled TESTNET validation runbook](TESTNET_VALIDATION_RUNBOOK.md) — CLOSED / PAUSED; its earlier DOGEUSDT/ZROUSDT plan no longer matches the LINKFDUSD-only default config. Reconcile scope before any future session.
- [Journal operations](JOURNAL_OPERATIONS.md)
- [Error vocabulary](error-vocabulary.md) — stable operator-facing diagnostic identifiers and recovery procedures.
- [Journal evidence contract](JOURNAL_EVIDENCE_CONTRACT.md)
- [Journal integration roadmap](JOURNAL_INTEGRATION_ROADMAP.md)
- [Logging](LOGGING.md)
- [TESTNET order tools](testnet-order-tools.md) — includes a legacy ZROUSDT MARKET SELL and account-wide cancel command; neither is authorized by the CLOSED / PAUSED validation runbook. The cancel command has no interactive confirmation; the menu adds no confirmation layer. Its account and Journal audit actions are documented in the TESTNET runbook and Journal Operations.
- [Incident audit playbook](INCIDENT_AUDIT_PLAYBOOK.md)
- [Conservative session audit checklist](CONSERVATIVE_SESSION_AUDIT.md)

## Audit process

- [Harvester audit working rules](AUDIT_WORKING_RULES.md) — scope pointer to the repository-wide agent workflow and Harvester-specific audit boundaries.
- [Harvester audit records index](audits/README.md) — historical evidence and investigation records.

## Historical records and evidence

- [Harvester roadmap history](audits/ROADMAP_HISTORY.md) — historical progress/evidence; current priorities remain in `../ROADMAP.md`.
- [Historical audit reports](audits/reports/README.md)
- [Historical audit sessions](audits/sessions/README.md)
- [Historical audit evidence](audits/evidence/README.md)
- [Historical DDD/Clean Architecture audit](DDD_CLEAN_ARCHITECTURE_AUDIT.md)
- [Incident records](incidents/README.md)
- [Historical task briefs](tasks/README.md)

Historical reports are snapshots, not current implementation authority. Use their own observation date, baseline commit, evidence sources and limitations. Do not silently rewrite or delete them.

## Plans and inventories

- [Documentation plans index](plans/README.md)
- [Documentation migration plan](plans/DOCUMENTATION_MIGRATION.md)
- [Harvester documentation inventory](plans/HARVESTER_DOCUMENTATION_INVENTORY.md)
- [Domain-first delivery plan](DOMAIN_FIRST_DELIVERY_PLAN.md) — superseded historical plan; current priorities are in the Harvester roadmap

## Maintenance

- Every new or moved document must be added to the appropriate local index.
- Current behavior belongs in the canonical specification, architecture or runbook; task status belongs in the roadmap and GitHub Issues/PRs.
- Preserve historical evidence, timestamps, source commit SHAs and uncertainty during migrations.
