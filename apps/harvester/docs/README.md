# Harvester documentation

This is the entry point for Harvester-specific documentation. Repository-wide rules remain authoritative where applicable; see [Coinzilla Documentation Governance](../../../docs/DOCUMENTATION_GOVERNANCE.md).

## Current Harvester priority

**Multi-provider execution and independent market-data routing (#1339): Phases 1–6 are complete and merged.** Harvester now supports multiple configured Binance account runtimes, explicit per-symbol market-data source routing, and explicit `(strategyId, symbol)` execution routing with immutable provider/account provenance. See the [migration plan](../../../docs/architecture/multi-provider-migration-plan.md), [provider-instance registry](infrastructure/provider-instance-registry.md), and [execution-routing contract](infrastructure/execution-routing.md). The production adapter catalog remains Binance-only: Bitunix is not registered until [#1185](https://github.com/45s/coinzilla/issues/1185) is resolved and the complete standard provider contract is satisfied. Recovery Seller RS-4 production runtime composition and scoped RS-5 offline lifecycle/failure/concurrency acceptance are complete in PR #1515. The runtime acceptance gate is open, but RS remains disabled by default (`enabled: false`, no configured pairs). Restart/replay and third-asset commission valuation are deferred; STOP is terminal and CC-operator exposes read-only status only. Exact-head CI is the final merge check.

## Start here

- [Application configuration and Telegram notification profiles](../README.md#configuration) — the named `appConfig` export composed from named modules, including `config/operator-control.js` and `config/notifications-tg-profiles.js`; profile behavior, event overrides, and environment-only credentials.
- [Repository Configuration Standard](../../../docs/engineering/CONFIGURATION_STANDARD.md) — shared ownership, validation, defaults, environment access, secrets and migration rules.

- [Harvester README](../README.md) — setup, runtime, configuration and operational overview
- [Shared token specification generator](../README.md#generate-or-refresh-market-metadata) — retrieve and maintain exchange-derived market precision through `pnpm run config:symbol`; strategy pairs remain operator-owned
- [Harvester agent instructions](../AGENTS.md) — mandatory preflight and domain-specific constraints
- [Harvester roadmap](../ROADMAP.md) — current domain work and status
- [Startup open-order ownership (ADR-0004)](architecture/decisions/0004-startup-open-orders-are-external.md) — accepted and implemented ownership rule for startup-snapshot orders
- [Emergency BUY pause (ADR-0005)](architecture/decisions/0005-emergency-buy-pause.md) — global BUY controls and owned-BUY cancellation workflow; market command split is superseded by ADR-0006
- [Market Pause cancels owned BUYs (ADR-0006)](architecture/decisions/0006-market-pause-cancels-owned-buys.md) — current market Pause/Resume behavior, cancellation ordering, ownership boundary and recovery SELL continuity
- [Startup open-order boundary plan](plans/STARTUP_EXTERNAL_ORDER_BOUNDARY.md) — completed design and implementation record for #1157
- [Trading First](TRADING_FIRST.md) — authoritative trading priority and exchange-safety requirements

## Reliability acceptance — issue #1639

The machine-readable [critical behavior inventory](critical-behaviors.json) maps each critical Harvester behavior to authoritative domain invariants, owning production modules, named normal/failure regression tests, integration/replay evidence where required, runtime status, and measured per-module coverage floors. The required Unit Tests workflow validates the inventory and test ownership before running the complete Harvester package suite. Run the same guard locally with `pnpm --filter @coinzilla/harvester check:reliability`.

The required Test Coverage workflow runs the full Harvester coverage suite and checks every critical module against its measured minimum with `pnpm --filter @coinzilla/harvester check:critical-coverage -- <coverage-report>`. The focused Harvester Targeted Tests suite also runs both guard regression files. The floors are derived from the exact `develop` source baseline, not arbitrary package-wide averages. The inventory is a traceability and regression gate, not a substitute for passing tests, runtime evidence, or exchange acceptance. The persistence entry explicitly records that runtime restart restoration remains offline-only/disabled pending issue #654; this initiative does not enable replay or restoration. See the dated [Harvester reliability baseline report](./RELIABILITY_BASELINE_2026-11-21.md) for the coverage provenance, current runtime scope, test evidence, and unresolved audit questions.

## Current architecture and domain contracts

- [Application architecture](architecture.md) and [architecture index](architecture/README.md)
- [Strategy extensibility architecture discussion and audit roadmap](architecture/strategy-extensibility-audit-roadmap.md) — current source observations, agreed design direction, open decisions and S-1 through S-4 audit roadmap.
- [SQLite integration blueprint](persistence/sqlite-integration-blueprint.md) — historical source-verified design/audit snapshot; current implementation is governed by the Harvester persistence README.
- [Harvester ordinary persistence](persistence/README.md) — current relational orders/fills, live-fill, startup history-sync, backup and full JSON export commands and safety contract.
- [Trading-history persistence roadmap](persistence/trading-history-roadmap.md) — completed Phases 1–3 and planned attribution, analytics and remaining operational hardening.
- [Trading-history API v1 (in-process Harvester HTTP lifecycle)](api/trading-history-api.md) — versioned HTTP contract for browsing persisted orders, individual fills, and commission facts from independent clients.
- [ADR-0003: Multi-provider execution and market-data routing](../../../docs/architecture/decisions/ADR-0003-multi-provider-routing.md) — accepted target architecture; implementation is tracked by [#1339](https://github.com/45s/coinzilla/issues/1339).
- [ADR-0004: Complete Bitunix provider integration](../../../docs/architecture/decisions/ADR-0004-complete-bitunix-provider-integration.md) — Bitunix admission requires a complete Brokers and Harvester provider contract; no interim partial facade.
- [Multi-provider migration audit and implementation plan](../../../docs/architecture/multi-provider-migration-plan.md) — source-verified Harvester composition, order provenance, account isolation, recovery prerequisites and phased implementation plan.
- [Operator control](operator-control/README.md) — Telegram Command Center commands, authorized read-only queries, confirmed controls and process-lifetime pause boundary
- [Telegram Command Center runbook](operations/telegram-command-center.md) — safe menu navigation, refresh, confirmations, authorization and troubleshooting
- [Volatility Protection](volatility-protection.md) — per-market protection, required explicit pair-level policy and order gate; provisional thresholds still require offline historical calibration
- [Exchange trading constraints](exchange-trading-constraints.md) — canonical exchange-neutral constraint contract, Binance's non-blocking diagnostic policy, and local-versus-venue enforcement boundary
- [Process-restart recovery contract (ADR-0001)](architecture/decisions/0001-application-owned-recovery-facts.md) — accepted target design; runtime recovery remains disabled.
- [One-market recovery reconciliation](recovery/README.md) — Step 7 offline evidence bundle, audit-only CLI and guarded coverage confirmation.
- [Conservative Domain Specification](domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md) — sole current authority for Conservative behavior
- [Domain glossary](domain/DOMAIN_GLOSSARY.md)
- [Accounting invariants](domain/ACCOUNTING_INVARIANTS.md)
- [Portfolio domain](domain/portfolio.md)
- [Broker port and adapter](infrastructure/broker-port-and-adapter.md)
- [Provider-instance identity and registry](infrastructure/provider-instance-registry.md) — explicit non-secret identity, capability validation, account isolation, independent market-data and execution routes, and lifecycle behavior.
- [Multi-provider execution routing](infrastructure/execution-routing.md) — exact strategy/market execution routes, independent market-data source selection, provenance, and no-fallback safety rules.
- [Trading strategies overview](trading-strategies.md) — Conservative rules remain in the canonical specification; Aggressive material is exploratory discussion, not an approved executable contract
- [Recovery Seller Domain Specification](domain/recovery-seller-domain-specification.md) — draft RS accounting, legacy authorization, independent profitability gates, and concurrent CG/RS invariants
- [Recovery Seller Implementation Roadmap](domain/recovery-seller-implementation-roadmap.md) — six delivery phases from Conservative source audit to concurrent integration and offline lifecycle proof

## Operations and safety

- [Operations index](operations/README.md) — Journal, logging, TESTNET procedures and safety boundaries
- [Submission deferrals and missing-order diagnostics](operations/submission-deferrals.md) — stable reasons for withheld broker submissions and safe LIMIT_MAKER diagnosis.
- [Relational trading-history backup runbook](operations/trading-history-backups.md) — routine online backups, explicit TESTNET/LIVE selection, restore checks and retention.

- [Controlled TESTNET validation runbook](TESTNET_VALIDATION_RUNBOOK.md) — CLOSED / PAUSED; its earlier two-pair DOGEUSDT/ZROUSDT plan is superseded: the committed CG configuration enables four TESTNET markets (LINKUSDT, ZROUSDT, DOGEUSDT and ADAUSDT) and three LIVE markets (LINKFDUSD, ZROFDUSD and WLDFDUSD). The runbook remains CLOSED / PAUSED; no replacement session scope is approved.
- [Journal operations](JOURNAL_OPERATIONS.md)
- [Error vocabulary](error-vocabulary.md) — stable operator-facing diagnostic identifiers and recovery procedures.
- [Journal evidence contract](JOURNAL_EVIDENCE_CONTRACT.md)
- [Journal integration roadmap](JOURNAL_INTEGRATION_ROADMAP.md)
- [Logging](LOGGING.md)
- [TESTNET order tools](testnet-order-tools.md) — includes a legacy ZROUSDT MARKET SELL and account-wide cancel command; neither is authorized by the CLOSED / PAUSED validation runbook. The cancel command has no interactive confirmation; the menu adds no confirmation layer. Its account and Journal audit actions are documented in the TESTNET runbook and Journal Operations.
- [Incident audit playbook](INCIDENT_AUDIT_PLAYBOOK.md)
- [Conservative session audit checklist](CONSERVATIVE_SESSION_AUDIT.md)

## Audit process

- [2026-11-19 TESTNET Conservative session audit](audits/sessions/AUDIT_SESSION_2026-11-19_02-16-31Z.md) — latest historical session record: runbook gate conflict, external orders, failed shutdown safety proof and missing final evidence; no acceptance or exchange authorization.

- [Conservative Recovery Lifecycle Audit](CONSERVATIVE_RECOVERY_LIFECYCLE_AUDIT.md) — acceptance evidence, confirmed outcomes, and the remaining recovery-SELL filter-freshness gap for #1359/#1362.

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
