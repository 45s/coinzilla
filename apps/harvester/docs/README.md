# Harvester documentation

This is the entry point for Harvester-specific documentation. Repository-wide rules remain authoritative where applicable; see [Coinzilla Documentation Governance](../../../docs/DOCUMENTATION_GOVERNANCE.md).

## Current Harvester priority — P0 trading reliability

**The only P0 is a working, correct trading application.** When the trading runtime fails, investigate and fix that failure first. Recovery/restart restoration, durable facts/ledger expansion, SQLite/relational history, history APIs/projections, observability, architecture, and roadmap cleanup are secondary; none may delay trading repair or be represented as trading progress. Existing safeguards remain in force, but do not expand secondary systems while core trading is broken. See [TRADING_FIRST.md](./TRADING_FIRST.md) and the active [2026-11-27 trading incident #1962](https://github.com/45s/coinzilla/issues/1962).

**Multi-provider execution and independent market-data routing (#1339): Phases 1–6 are complete and merged.** Harvester supports multiple configured Binance account runtimes, explicit per-symbol market-data source routing, and explicit `(strategyId, symbol)` execution routing with immutable provider/account provenance. See the [migration plan](../../../docs/architecture/multi-provider-migration-plan.md), [provider-instance registry](infrastructure/provider-instance-registry.md), and [execution-routing contract](infrastructure/execution-routing.md). The production adapter catalog remains Binance-only: Bitunix is not registered until [#1185](https://github.com/45s/coinzilla/issues/1185) is resolved and the complete standard provider contract is satisfied.

**Recovery Seller activation:** RS runtime integration and offline lifecycle acceptance are complete in merged PR #1515; legacy single-provider route inference and RS-only startup are complete in merged PR #1696; default enablement and per-market TESTNET/LIVE routing are complete in merged [PR #1711](https://github.com/45s/coinzilla/pull/1711). RS is globally enabled and LINEAUSDT is enabled for TESTNET; LIVE excludes it through the existing per-market `tradingEnvironment` filter. Post-merge startup testing exposed a missing process-owned Operational State Store wiring condition; [PR #1718](https://github.com/45s/coinzilla/pull/1718) fixes store preparation for enabled RS while creating genesis automatically only for a missing or empty ledger directory, and keeping disabled restart restoration. The controlled TESTNET runbook remains CLOSED / PAUSED pending a separate bounded LINEAUSDT session, account/open-order baseline, fee verification and explicit joint start. Restart/replay and third-asset commission valuation remain deferred. STOP blocks additional BUY spending only; eligible recovery SELL and existing-order reconciliation/accounting continue under independent safety gates. Authorized resolution requires cause correction, authoritative reconciliation, verified accounting/reservations and durable acknowledgement; no automatic clear or self-resume. The operator facade still needs the authorized resolution command.

## Start here

- [Repository test scenario catalog](../../../docs/testing/SCENARIO_CATALOG.md) — cross-workspace human-readable scenarios with business inputs/outputs, subcases, implementation links, and named test mappings.
- [Recovery Seller scenario testing playbook](domain/recovery-seller-scenario-testing.md) — implementation contract for RS scenario design, registry, test mapping, evidence and coverage gaps. RS entries intentionally start without scenario-coverage credit from existing tests; see [#1780](https://github.com/45s/coinzilla/issues/1780).

- [Application configuration and Telegram notification profiles](../README.md#configuration) — the named `appConfig` export composed from named modules, including `config/operator-control.js` and `config/notifications-tg-profiles.js`; profile behavior, event overrides, and environment-only credentials.
- [Repository Configuration Standard](../../../docs/engineering/CONFIGURATION_STANDARD.md) — shared ownership, validation, defaults, environment access, secrets and migration rules.
- [Harvester README](../README.md) — setup, runtime, configuration and operational overview
- [Shared token specification generator](../README.md#generate-or-refresh-market-metadata) — retrieve and maintain exchange-derived market precision through `pnpm run config:symbol`; strategy pairs remain operator-owned
- [Harvester agent instructions](../AGENTS.md) — task-relevant documentation review, domain constraints and concise communication
- [Harvester roadmap](../ROADMAP.md) — current domain work and status
- [Operational State Store first-start initialization (ADR-0007)](architecture/decisions/0007-initialize-empty-operational-state-ledger.md) — startup creates the directory, both JSONL streams and genesis only when the directory is missing or empty; existing partial/corrupt data is never repaired.
- [Operational State Store diagnostics and recovery boundaries](operations/operational-state-store-diagnostics.md) — default path, override, automatic first-start setup and safe handling of missing ledger files.
- [Startup open-order ownership (ADR-0004)](architecture/decisions/0004-startup-open-orders-are-external.md) — accepted and implemented ownership rule for startup-snapshot orders
- [Emergency BUY pause (ADR-0005)](architecture/decisions/0005-emergency-buy-pause.md) — global BUY controls and owned-BUY cancellation workflow; market command split is superseded by ADR-0006
- [Market Pause cancels owned BUYs (ADR-0006)](architecture/decisions/0006-market-pause-cancels-owned-buys.md) — current operator market Pause/Resume behavior, cancellation ordering, ownership boundary and recovery SELL continuity
- [Strategy safety pause cancels owned BUYs (ADR-0008)](architecture/decisions/0008-strategy-safety-pause-cancels-owned-buys.md) — Conservative strategy-originated pause, current-process BUY cancellation, durable incomplete blocker, and the narrow RECOVERY_SELL exception
- [Startup open-order boundary plan](plans/STARTUP_EXTERNAL_ORDER_BOUNDARY.md) — completed design and implementation record for #1157
- [Trading First](TRADING_FIRST.md) — authoritative trading priority and exchange-safety requirements

## Recent forensic evidence — 2026-11-26 TESTNET

- [2026-11-26 Conservative TESTNET recovery forensic report](audits/reports/2026-11-26-testnet-recovery-forensic-audit.md) — self-contained 97-fact ledger audit, per-market order/fill chronology, residual inventory, startup-runtime mismatch, shutdown evidence boundaries and issue ownership. This report intentionally contains no private-evidence repository links.

## Reliability acceptance — issue #1639

The machine-readable [critical behavior inventory](critical-behaviors.json) maps each critical Harvester behavior to authoritative domain invariants, owning production modules, named normal/failure regression tests, integration/replay evidence where required, runtime status, and measured per-module coverage floors. The required Unit Tests workflow validates the inventory and test ownership before running the complete Harvester package suite. Run the same guard locally with `pnpm --filter @coinzilla/harvester check:reliability`.

The required Test Coverage workflow runs the full Harvester coverage suite and checks every critical module against its measured minimum with `pnpm --filter @coinzilla/harvester check:critical-coverage <coverage-report>`.

The focused Harvester Targeted Tests suite runs both reliability-guard regression files, the remaining startup-composition tests, and the responsibility-focused bootstrap suites:

- `account-preflight.test.js` and `account-snapshot-history.test.js`
- `broker-boundaries.test.js`, `external-order-ownership.test.js`, and `shutdown-lifecycle.test.js`
- `market-subscriptions.test.js` and `market-evaluation.test.js`
- `operator-control.test.js` and `trading-safety.test.js`
- `process-lifecycle-recovery.test.js`
- `user-data-event-reconciliation.test.js`, `user-data-recovery.test.js`, and `user-data-stream-safety.test.js`

Shared deterministic broker/runtime fixtures live in `test/bootstrap/start-harvester-test-support.js`. The floors are derived from the exact `develop` source baseline, not arbitrary package-wide averages. The contract validator rejects an empty coverage matrix and any critical source module without a measured floor. The inventory is a traceability and regression gate, not a substitute for passing tests, runtime evidence, or exchange acceptance. The persistence entry explicitly records that runtime restart restoration remains offline-only/disabled pending issue #654; this initiative does not enable replay or restoration. See the dated [Harvester reliability baseline report](./RELIABILITY_BASELINE_2026-11-21.md) for the coverage provenance, current runtime scope, test evidence, and unresolved audit questions.

## Reliability engineering

- [Harvester Reliability Engineering Baseline](audits/reports/2026-11-26_harvester-reliability-engineering-baseline.md) — source-backed baseline and open verification work for issue #1639.

- [Harvester Reliability Engineering Baseline](audits/reports/2026-11-26_harvester-reliability-engineering-baseline.md) — source-backed baseline, active incident evidence, fault-domain model, audit gaps and next verification steps; tracked by [issue #1639](https://github.com/45s/coinzilla/issues/1639). The report is dated evidence, not a runtime behavior contract.

## Current architecture and domain contracts

- [Application architecture](architecture.md) and [architecture index](architecture/README.md)
- [Strategy extensibility architecture discussion](architecture/strategy-extensibility-audit-roadmap.md) — historical pointer only; the owner-approved direction was implemented in merged PRs #1476 and #1515, and issue #1475 is closed. The full discussion is preserved in the dated archive; use the current Harvester and Recovery Seller roadmaps for active priorities.
- [SQLite integration blueprint](persistence/sqlite-integration-blueprint.md) — historical source-verified design/audit snapshot; current implementation is governed by the Harvester persistence README.
- [Harvester ordinary persistence](persistence/README.md) — current relational orders/fills, live-fill, startup history-sync, backup and full JSON export commands and safety contract.
- [Trading-history persistence roadmap](persistence/trading-history-roadmap.md) — completed Phases 1–3 and planned attribution, analytics and remaining operational hardening.
- [Trading-history API v1 and public market data (in-process Harvester HTTP lifecycle)](api/trading-history-api.md) — versioned HTTP contract for browsing persisted orders, individual fills, commission facts, and read-only Bitunix Futures market snapshots from independent clients.
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
- [Conservative domain scenario testing guide](domain/CONSERVATIVE_DOMAIN_SCENARIO_TESTS.md) — test-layer responsibilities, deterministic scenario conventions and complete state-machine assertions for issue #1763
- [Domain test inventory](domain/DOMAIN_TEST_INVENTORY.md) — source-driven Conservative and Recovery Seller behavior-to-test matrix, current evidence and remaining gaps
- [Domain glossary](domain/DOMAIN_GLOSSARY.md)
- [Accounting invariants](domain/ACCOUNTING_INVARIANTS.md)
- [Portfolio domain](domain/portfolio.md)
- [Broker port and adapter](infrastructure/broker-port-and-adapter.md)
- [Provider-instance identity and registry](infrastructure/provider-instance-registry.md) — explicit non-secret identity, capability validation, account isolation, independent market-data and execution routes, and lifecycle behavior.
- [Multi-provider execution routing](infrastructure/execution-routing.md) — exact strategy/market execution routes, independent market-data source selection, provenance, and no-fallback safety rules.
- [Trading strategies overview](trading-strategies.md) — Conservative rules remain in the canonical specification; Aggressive material is exploratory discussion, not an approved executable contract
- [Recovery Seller Domain Specification](domain/recovery-seller-domain-specification.md) — draft RS accounting, legacy authorization, independent profitability gates, and concurrent CG/RS invariants
- [Recovery Seller Implementation Roadmap](domain/recovery-seller-implementation-roadmap.md) — RS-1–RS-5 implementation and offline acceptance are complete; the roadmap tracks remaining scenario-coverage, terminal-SELL/STOP and operator-resolution gates. It does not authorize exchange sessions.

## Operations and safety

- [Operations index](operations/README.md) — Journal, logging, TESTNET procedures and safety boundaries
- [Submission deferrals and missing-order diagnostics](operations/submission-deferrals.md) — stable reasons for withheld broker submissions and safe LIMIT_MAKER diagnosis.
- [Relational trading-history backup runbook](operations/trading-history-backups.md) — routine online backups, explicit TESTNET/LIVE selection, restore checks and retention.
- [Controlled TESTNET validation runbook](TESTNET_VALIDATION_RUNBOOK.md) — CLOSED / PAUSED; its earlier two-pair DOGEUSDT/ZROUSDT plan is superseded: the committed CG configuration enables four TESTNET markets (LINKUSDT, ZROUSDT, DOGEUSDT and ADAUSDT) and three LIVE markets (LINKFDUSD, ZROFDUSD and WLDFDUSD). The runbook remains CLOSED / PAUSED; no replacement session scope is approved.
- [Journal operations](JOURNAL_OPERATIONS.md) — includes the read-only `operational-state:diagnose` command for separating store-integrity failures from recovery-projection failures.
- [Error vocabulary](error-vocabulary.md) — stable operator-facing diagnostic identifiers and recovery procedures.
- [Journal evidence contract](JOURNAL_EVIDENCE_CONTRACT.md)
- [Journal integration roadmap](JOURNAL_INTEGRATION_ROADMAP.md)
- [Logging](LOGGING.md)
- [TESTNET order tools](testnet-order-tools.md) — includes a legacy ZROUSDT MARKET SELL and account-wide cancel command; neither is authorized by the CLOSED / PAUSED validation runbook. The cancel command has no interactive confirmation; the menu adds no confirmation layer. Its account and Journal audit actions are documented in the TESTNET runbook and Journal Operations.
- [Incident audit playbook](INCIDENT_AUDIT_PLAYBOOK.md)
- [Conservative session audit checklist](CONSERVATIVE_SESSION_AUDIT.md)

## Audit process

- [2026-11-19 TESTNET Conservative session audit](audits/sessions/AUDIT_SESSION_2026-11-19_02-16-31Z.md) — latest historical session record: runbook gate conflict, external orders, failed shutdown safety proof and missing final evidence; no acceptance or exchange authorization.
- [Conservative Recovery Lifecycle Audit](CONSERVATIVE_RECOVERY_LIFECYCLE_AUDIT.md) — #1359/#1362 lifecycle evidence map, including sanitized archive reconstruction, exact fill accounting, late-fill safety and serialized shutdown proof.
- [Conservative recovery archive review](CONSERVATIVE_RECOVERY_ARCHIVE_REVIEW_2026-11-23.md) — immutable 2026-11-22 source evidence, replay details and explicit historical unknowns.
- [Issue #1789](https://github.com/45s/coinzilla/issues/1789) — separately tracks the 28 historical order-history projection failures.
- [Harvester audit working rules](AUDIT_WORKING_RULES.md) — scope pointer to the repository-wide agent workflow and Harvester-specific audit boundaries.
- [Harvester audit records index](audits/README.md) — historical evidence and investigation records.

## Historical records and evidence

- [Harvester roadmap history](audits/ROADMAP_HISTORY.md) — historical progress/evidence; current priorities remain in `../ROADMAP.md`.
- [Historical audit reports](audits/reports/README.md)
- [Historical audit sessions](audits/sessions/README.md)
- [Historical audit evidence](audits/evidence/README.md)
- [DDD/Clean Architecture audit](DDD_CLEAN_ARCHITECTURE_AUDIT.md) — historical 2026-11-03 assessment plus current strategy/runtime consistency review
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

**Scenario Runner:** [Architecture](features/scenario-runner-architecture.md) documents the Harvester-side process worker, simulation boundary, replay provenance and fail-closed isolation contract. The production RS adapter and trusted OS sandbox remain incomplete; this is not authorization for exchange execution.
