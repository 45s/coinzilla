---
title: Harvester source-file audit
status: active
type: audit
owner: harvester
created: 2026-11-13
source_commit: 9989fea9f77f9ce4b506d4658f2ff1ddef516d83
---

# Harvester source-file audit

## Executive summary

This is a source-driven follow-up audit of the complete Harvester file inventory on 2026-11-13. It extends the earlier JavaScript quality audit delivered by [PR #1091](https://github.com/45s/coinzilla/pull/1091); it does not replace that audit, the historical trading-session reports, the Conservative Domain Specification, or the ADR-0001 recovery workstream.

The application has a clear high-level DDD/Clean Architecture shape: configuration is composed once, the domain owns strategy/accounting rules, use cases coordinate workflows, bootstrap owns lifecycle wiring, and infrastructure adapts Binance, Journal, filesystem, process locks and Telegram. Exact decimal strings and canonical entities are used across the trading path. The principal risks found in this follow-up are not a demonstrated strategy-calculation defect; they are a mismatch between documented and actual restart fencing, stale enabled-market lists in operating documents, a few large orchestration/contract modules, incomplete one-to-one unit-test pairing, and an already-tracked lint backlog.

**No trading code, exchange configuration, strategy economics, shared package, credential, or runtime behavior was changed.** The documentation corrections in the accompanying PR only make current safety and configuration statements accurate. No TESTNET/LIVE connection, order placement, cancellation, or account mutation was performed.

## 1. Baseline and scope

- Repository: 45s/coinzilla
- Branch: develop
- Exact source baseline: 9989fea9f77f9ce4b506d4658f2ff1ddef516d83
- Baseline commit: docs(repo): publish AI refactoring and code audit standard (#1095)
- Audit date: 2026-11-13 UTC
- Primary scope: all tracked files under apps/harvester/
- Supporting scope: repository-wide agent, engineering, documentation, testing and audit requirements needed to assess Harvester.

The review read the root and Harvester agent instructions, AI workflow, Engineering Standards, Documentation Governance, Markdown Style, AI Refactoring and Code Audit Standard, Task Workflows, Modularity Standard, JavaScript/JSDoc Standard, Structured Error Handling Standard, Shared Utilities Policy, Harvester README, roadmap, documentation indexes, Trading First, architecture, Conservative Domain Specification, Accounting Invariants, domain test inventory, BrokerPort contract, Journal operations/evidence contract, ADR-0001, operator-control ADRs, recovery guide and controlled TESTNET runbook. Historical audit records were treated as dated evidence, not current implementation authority.

The source review traced the production composition root, bootstrap, process locks, account/open-order preflight, Conservative policy, trading engine, order/fill lifecycle, Portfolio/RecoveryLedger accounting, durable-facts store/projector, Journal projector/history reader, Binance adapter, Telegram adapter and operator-control composition. The tracked tree and test pairing were measured from the exact baseline. The supplied runtime logs were parsed separately and are explicitly treated as evidence from a different, dirty runtime tree.

## 2. Complete file inventory

The recursive Git tree contains **380 tracked Harvester files**:

| Area | Files | Audit disposition |
| --- | ---: | --- |
| JavaScript files | 309 | Full tracked-JavaScript inventory measured |
| JavaScript test files | 147 | Test inventory measured; high-risk lifecycle tests sampled |
| Markdown files | 68 | Living indexes/contracts and historical evidence distinguished |
| Production JavaScript under src | 124 | All production source paths inventoried; high-risk flows inspected in detail |
| JavaScript under scripts | 51 | 31 operator/runtime scripts and 20 script tests |
| JavaScript under config | 4 | Single appConfig composition and focused config modules |
| JavaScript under test-support | 2 | Shared deterministic test fixtures/helpers |
| JavaScript under test | 14 | 13 test files plus one support module |

The 124 production source modules are distributed as follows:

| Source layer | Files | Responsibility |
| --- | ---: | --- |
| application | 11 | Event contracts/publishers, operator authorization, ports and safe log summaries |
| bootstrap | 16 | Process startup, broker/user-data/market subscriptions, account snapshots, notifications, operator control and shutdown |
| domain | 33 | Configuration validation, markets, orders, account snapshots, Portfolio, fills and strategy policy |
| infrastructure | 18 | Binance adapter, config loading, durable facts, Journal, logging, process identity/locks and Telegram transport |
| use-cases | 45 | Strategy execution, order/fill workflows, accounting, audits, reconciliation, durable-fact recorders and operator queries |
| index.js | 1 | Production composition root |

### Test pairing

There are 114 JavaScript test files under src and 147 test files across the Harvester tree. Twenty-five of the 124 production source modules do not have a same-basename sibling test file:

- application: event-names.js, trading-state-log-summary.js, authorize-operator-actor.js, durable-facts.port.js
- bootstrap: subscribe-harvester-telegram-notifications.js, prepare-telegram-operator-control.js
- domain: assert-account-snapshot-covers-markets.js, external-orders-policy.js, validate-fill-commissions.js, unvalidated-market-exchange-constraints-error.js, position-accounting.js, strategy-policy.js
- infrastructure: load-app-config.js
- use-cases: operator-query-error.js, pause-market.js, resume-market.js, record-configuration-baseline.js, record-order-cancellation-intent.js, record-order-cancellation-outcome.js, record-process-started.js, record-process-stopped.js, record-recovery-cycle-completed.js, record-recovery-cycle-not-completed.js, recovery-failure.js, restore-harvester-journal-state.js

This is a **test-pairing review list, not 25 confirmed coverage defects**. Several are exercised through integration tests or broader behavior suites. For example, startup tests cover process/configuration facts and operator-control lifecycle; the domain test inventory maps shared policy and accounting behavior to other focused tests. The next test-quality pass should verify the actual assertion coverage for each module before adding tests mechanically.

## 3. Architecture and file-level assessment

### Configuration and process composition

- **config/index.js** is the single application-wide configuration composition point. Focused modules hold operator-control, notification-profile and strategy-pair settings. This matches the local architecture rule.
- **src/index.js** owns process identity, host process locks, optional durable-facts construction, Journal lifecycle, notification composition and production startup/shutdown. It is a large but appropriate composition boundary; keep business decisions out of it.
- **src/bootstrap/start-harvester.js** coordinates broker connection, in-memory initial state, account snapshots, user-data recovery, market subscriptions and shutdown. The code deliberately starts with fresh Portfolio, RecoveryLedger and OrderRegistry state; runtime Journal replay/restoration is not enabled.
- **config/strategies/cg-coin-grabber.js** currently enables LINKFDUSD, ZROFDUSD and WLDFDUSD. ADAFDUSD is disabled. All three enabled pairs currently use the IGNORE external-order policy. This list is not an approved TESTNET session scope.

### Domain and strategy

- **src/domain/strategies/conservative/strategy.js** is broker-independent and creates intents; it does not place orders. It validates canonical Market metadata, uses exact decimal-string operations, checks Portfolio/RecoveryLedger consistency, preserves recovery SELL priority and suppresses unsafe BUY decisions when a recovery SELL is pending, unknown or filter-blocked.
- **src/domain/portfolio/** owns Position/Portfolio accounting and immutable fill application. The domain test inventory covers multi-market isolation, fee identity, retained inventory and recovery-basis behavior.
- **src/domain/orders/** owns canonical order identity, registry transitions, cancellation eligibility, exchange-rule validation and account-wide order commitment allocation.
- **src/domain/account/** owns snapshot coverage, baseline capture and exact snapshot-relative reconciliation.
- Domain decisions use canonical entities and shared exact-decimal primitives. Exchange DTO conversion and broker calls remain in infrastructure/use cases.

### Application, use cases and infrastructure

- **src/application/** owns event names, allowlisted lifecycle DTOs, event publication, operator authorization and ports. The event DTO file is large but remains a cohesive mapping boundary.
- **src/use-cases/** owns the workflow boundary. Order execution, order-event processing, Portfolio accounting, recovered-state audits and durable-fact recorders are separate modules. The Conservative engine is the main remaining orchestration hotspot.
- **src/infrastructure/brokers/binance-broker-adapter.js** adapts the application BrokerPort to the shared Binance broker. The domain does not import the exchange SDK.
- **src/infrastructure/durable-facts/** owns the application-specific append-only fact stream, canonical serialization, digesting, verification and candidate projection. PR #1091 extracted the pure canonical JSON/timestamp/digest boundary into durable-facts-canonical.js and added direct tests.
- **src/infrastructure/journal/** remains a separate operational observer and forensic projection. It is not runtime trading-state authority.
- **src/infrastructure/process-lock/** protects concurrent process ownership. It is not a substitute for a durable sequential-restart fence.
- **src/infrastructure/telegram/** owns Telegram transport adaptation; Harvester owns command semantics and event formatting.
- **src/bootstrap/shutdown/** and **src/bootstrap/user-data/** contain explicit queue-drain, reconciliation and cleanup ordering. Preserve those lifecycle barriers during any refactor.

## 4. Confirmed findings

### F-01 — P1: The documented second-start fence is inactive under the committed default configuration

**Locations**

- **src/index.js:222-223, 341**
- **src/index.test.js:51-66**
- **src/bootstrap/start-harvester.js:211 onward and 456**
- **config/strategies/cg-coin-grabber.js** recovery setting
- **config/operator-control.js:7**

**Evidence**

Production main creates and verifies the durable-facts store only when strategies.CG_coinGrabber.settings.recovery.enabled is true. The committed recovery setting is false. Inbound operator control is also disabled by default. The existing index regression explicitly asserts that with recovery disabled the store is not created and is not injected into startHarvester. startHarvester only records CONFIGURATION_BASELINE and PROCESS_STARTED, and only projects/rejects prior process sessions, when a durable-facts store is supplied. Its current runtime state starts with a new Portfolio, empty recovery-ledger map and empty OrderRegistry; Journal replay/restoration is explicitly disabled.

The host process lock prevents two concurrent writers on the same host. Once a process exits and releases its lock, that lock alone does not prevent a later sequential start.

**Impact**

Several living documents say that every second process start is blocked before broker connection. That is not true for the committed default configuration. An operator could rely on a fence that is not active, then restart into fresh in-memory trading state without ADR-0001 history verification. The operational rule not to restart remains essential until issue #654 Steps 8–9 are accepted.

**Recommendation**

Keep restart restoration disabled. Before enabling unattended or manual restart, make the intended startup fence explicit and test it against the exact production configuration. Either require a verified durable-facts store for every broker-connected production start, or clearly retain an operator-enforced stop/no-restart procedure and never describe the default runtime as automatically blocking sequential restarts. Add a regression for the selected policy. This audit PR corrects the inaccurate documentation; it does not change runtime behavior.

### F-02 — P2: The documented default market list is stale

**Locations**

- **config/strategies/cg-coin-grabber.js:32, 88, 102, 116**
- **apps/harvester/README.md**
- **docs/TESTNET_VALIDATION_RUNBOOK.md**
- **docs/operations/README.md**

**Evidence**

The current committed enabled set is LINKFDUSD, ZROFDUSD and WLDFDUSD. ADAFDUSD is configured but disabled. Several README/runbook/operations statements list only LINKFDUSD and ZROFDUSD.

**Impact**

The mismatch can produce an incomplete preflight, fee review or future session scope. The controlled TESTNET runbook remains CLOSED / PAUSED; the corrected list is descriptive configuration evidence, not permission to start, modify pairs or perform exchange writes.

**Recommendation**

Keep the runbook closed until the operator explicitly approves a new pair scope and limits. Make every living config summary list all three enabled pairs and preserve the distinction between committed configuration and approved exchange-session scope. This audit PR updates the affected documents only; it does not change pair configuration.

### F-03 — P2: Large modules remain review hotspots

The largest production source files include:

| File | Size | Review assessment |
| --- | ---: | --- |
| **use-cases/conservative-trading-engine.js** | 106,752 bytes; 2,343 lines | Coordinates market transitions, state, order submission/cancellation, fills, recovery and volatility. Several workflows have already been extracted, but this remains the main coupling hotspot. |
| **infrastructure/durable-facts/create-file-durable-facts-store.js** | 72,785 bytes; 1,283 lines | Owns filesystem lifecycle, integrity verification, append ordering, fsync/manifest commit and fail-closed write behavior. Canonicalization was extracted in PR #1091. |
| **application/events/lifecycle-event-dtos.js** | 47,556 bytes; 937 lines | Contains many allowlisted event mappers in one file. |
| **infrastructure/journal/project-harvester-journal-recovery.js** | 45,331 bytes | Large forensic projection with many event-specific invariants. |
| **infrastructure/durable-facts/project-harvester-durable-facts.js** | 26,477 bytes | Large deterministic candidate projection. |
| **use-cases/audit-recovered-account-state.js** | 26,014 bytes | Account-wide reconciliation policy and diagnostics. |
| **infrastructure/telegram/telegram-operator-adapter.js** | 25,632 bytes | Telegram transport lifecycle and update handling. |
| **bootstrap/start-harvester.js** | 25,499 bytes | Application lifecycle composition. |

**Impact**

Large files increase review cost and make unrelated lifecycle rules easier to couple accidentally. Size alone does not prove a design defect; several files are cohesive adapters or projections.

**Recommendation**

Do not run a broad split or line-count cleanup. Use the Modularity Standard: extract only a responsibility with an independent contract and meaningful tests. Start with a focused Conservative engine responsibility map; preserve serialized transition ordering, durable-before-side-effect barriers and fill/cancellation race behavior. Keep store filesystem ownership and append protocol cohesive.

## 5. Known quality backlog and operational risks

### Existing ESLint baseline — tracked follow-up

PR #1091 audited 307 JavaScript files at its baseline and recorded 359 findings across 73 files:

| Rule | Findings |
| --- | ---: |
| curly | 295 |
| no-nested-ternary | 38 |
| no-unused-vars | 7 |
| prefer-const | 5 |
| no-useless-escape | 4 |
| no-control-regex | 7 |
| no-empty-pattern | 2 |
| preserve-caught-error | 1 |

Issue [#1092](https://github.com/45s/coinzilla/issues/1092) is open for the cleanup. Treat this as a historical measurement from PR #1091, not a fresh lint run on this audit baseline. Do not bulk-rewrite files or weaken lint rules.

### Destructive TESTNET helper

**scripts/cancel-testnet-open-orders.js** invokes cancelAllOpenOrders. The workflow cancels every open Spot TESTNET order across all listed symbols, including manually created/external orders, and proceeds automatically after logging a warning. It then verifies the account-wide open-order set. The package command is testnet:cancel-orders.

This is a documented destructive operator tool, not part of normal Harvester runtime. The controlled runbook explicitly prohibits using it. Keep it out of automated recovery and routine preflight. No invocation occurred during this audit.

### External-order policy — expected behavior, not a defect

Enabled pair configuration currently selects EXTERNAL_ORDERS_POLICIES.IGNORE. Account-wide open-order audit can therefore report BLOCKED/unowned orders while the engine still starts; unmatched orders are not adopted or canceled. Same-symbol blocking is controlled separately by each pair's policy. This is an explicit ownership policy, not evidence that account-wide readiness means the strategy is globally blocked. Manual orders can still change free balances and make a Harvester submission fail. Controlled validation remains paused and the runbook requires pre-existing orders to be classified; do not change this policy as part of a documentation audit.

## 6. Supplied runtime evidence — limited provenance

The supplied JSONL and two structured logs were parsed as supplemental evidence:

- The JSONL contained 1,150 valid JSON records.
- The two log files contained 7,360 and 8,605 lines respectively; no malformed JSON lines were observed.
- The two log files contained no WARN or ERROR level records.
- The session ran from 2026-11-12 19:27 UTC to 2026-11-13 03:55 UTC and reported production/LIVE mode.
- The startup account-wide open-orders snapshot recorded five unowned orders across WLDFDUSD and ZROFDUSD with readiness BLOCKED; startup then logged Conservative LIVE engine activation.
- The session logs contain 110 successful submitted orders, 236 execution-accounting events and 10 completed recovery cycles.
- The runtime process metadata identifies commit 2238e3f8 and reports a dirty working tree. It also reports four enabled symbols, including ADAFDUSD, while the current committed develop configuration disables ADAFDUSD and enables WLDFDUSD.

**Limitations:** this runtime session is not the audited source baseline. Its dirty working tree and different enabled-market list prevent attributing every observed behavior to the current develop commit. The log parse is not a checksum/integrity audit, and absence of WARN/ERROR entries is not proof of correctness. These files were not committed to the repository.

## 7. Prioritized follow-up

1. **P1 — ADR-0001 startup policy:** decide and test whether every broker-connected production process must have a verified durable-facts store, or whether restart prevention remains an explicit operator procedure. Do not enable restart restoration or unattended restart before #654 Steps 8–9 are accepted.
2. **P2 — Conservative engine modularity:** map responsibilities and identify one independently testable extraction at a time. Preserve exact behavior and transition serialization.
3. **P2 — Error contract consistency:** review generic Error instances at domain/application boundaries against the Structured Error Handling Standard and Harvester AGENTS actionable-error rules. Introduce stable typed errors only where they improve caller handling and operator diagnostics; do not mechanically replace every Error.
4. **P2 — Test pairing:** review the 25 source modules listed above against existing integration/domain tests. Add focused tests only for demonstrated unprotected contracts.
5. **P2 — ESLint cleanup:** continue issue #1092 in small ownership-based changes, retaining tests and reviewing every autofix diff.
6. **P2 — TESTNET destructive helper:** retain the explicit runbook prohibition; consider an interactive confirmation boundary in a separate task if this helper remains supported.
7. **P2 — Pair-scope reconciliation:** keep the runbook CLOSED / PAUSED until LINKFDUSD, ZROFDUSD, WLDFDUSD (or a different explicitly agreed set), limits, fee assumptions and authorization are reconciled.

## 8. Verification and completion boundary

- Reviewed the exact develop tree and the source/test/configuration/documentation paths listed in this report.
- Parsed the supplied runtime logs; no exchange or account calls were made.
- No Harvester production source or tests changed in this audit.
- The PR changes documentation only. Per Task Workflows, broad application test suites are not required for prose-only edits; changed-file Markdown/style, local-link, agent-policy and exact-head required GitHub checks remain the authoritative verification.
- This report does not certify LIVE/TESTNET safety, approve any pair scope, prove exchange reconciliation, or make ADR-0001 restart recovery complete.

## 9. References

- [Harvester source quality audit PR #1091](https://github.com/45s/coinzilla/pull/1091)
- [Harvester ESLint cleanup issue #1092](https://github.com/45s/coinzilla/issues/1092)
- [ADR-0001 process-restart reconciliation issue #654](https://github.com/45s/coinzilla/issues/654)
- [Harvester roadmap](../../../ROADMAP.md)
- [Conservative Domain Specification](../../domain/CONSERVATIVE_DOMAIN_SPECIFICATION.md)
- [Accounting Invariants](../../domain/ACCOUNTING_INVARIANTS.md)
- [Domain Test Inventory](../../domain/DOMAIN_TEST_INVENTORY.md)
- [AI Refactoring and Code Audit Standard](../../../../../docs/engineering/AI_REFACTORING_AUDIT_STANDARD.md)
