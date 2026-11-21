# Repository documentation inventory

- Status: Initial recursive inventory complete; all 6 initial REVIEW candidates have evidence-based dispositions; current package/app entry-point audit is complete; source-level review and full-tree enforcement are tracked by [#1401](https://github.com/45s/coinzilla/issues/1401) and [#1402](https://github.com/45s/coinzilla/issues/1402); reference/consolidation work is tracked by [#1403](https://github.com/45s/coinzilla/issues/1403)
- Type: Repository documentation inventory
- Owner: Repository engineering
- Baseline: `develop` at `cea27e580f9f9bf3d7fa109b9e6353f68aef9ff2`
- Date: 2026-11-09 (baseline); latest verification: 2026-11-18 (160-file checkpoint below)
- Tracking: [#795](https://github.com/45s/coinzilla/issues/795)
- Policy: [Documentation Governance](DOCUMENTATION_GOVERNANCE.md)
- Harvester detail: [Harvester documentation inventory](../apps/harvester/docs/plans/HARVESTER_DOCUMENTATION_INVENTORY.md)

## Scope and method

A complete recursive Git tree was retrieved for the baseline commit (`truncated: false`). It contains **97 tracked Markdown files**:

- 42 under `apps/harvester/` — individually listed with initial dispositions in the Harvester inventory.
- 55 elsewhere — listed below (repository root policy/entry files, `docs/`, `.github/` and package documentation).

The table records path, byte size, category and a conservative first-pass disposition. It is not a claim that every statement in every file has been revalidated against source code. All KEEP files remain at their current paths; REVIEW files must not be moved or rewritten until content and inbound references are checked.

## Post-baseline additions — 110-file checkpoint

The 97-file inventory above is a frozen baseline at `cea27e580f9f9bf3d7fa109b9e6353f68aef9ff2`, not a live file count. A complete recursive tree comparison against `develop` at `ae5c61abbee8e48162989c470f690221bd9ec712` found **13 added Markdown/MDX files and no removed paths**. The current tree therefore contains **110 tracked Markdown/MDX files** at that checkpoint. The original 97-file baseline table remains unchanged; the additions are recorded separately:

| Added path | Purpose |
| --- | --- |
| `apps/harvester/docs/architecture/README.md` | Local index for Harvester architecture documentation. |
| `apps/harvester/docs/audits/README_HISTORY.md` | Preserved historical README material and its navigation. |
| `apps/harvester/docs/audits/ROADMAP_HISTORY.md` | Preserved historical Harvester roadmap material, provenance and compatibility anchors. |
| `apps/harvester/docs/domain/README.md` | Local index for Harvester domain documentation. |
| `apps/harvester/docs/incidents/README.md` | Local index for Harvester incident records. |
| `apps/harvester/docs/infrastructure/README.md` | Local index for Harvester infrastructure documentation. |
| `apps/harvester/docs/operations/README.md` | Local index for Harvester operating procedures; surfaces the current LINKFDUSD/ZROFDUSD config versus historical runbook scope mismatch, CLOSED / PAUSED status, and legacy ZROUSDT market-sell/account-wide-cancel write boundaries and the interactive menu wrapper, its audit links, and the no-confirmation account-wide cancel boundary. |
| `apps/harvester/docs/plans/HARVESTER_DOCUMENTATION_INVENTORY.md` | Detailed file-by-file Harvester documentation inventory. |
| `apps/harvester/docs/plans/README.md` | Local index for Harvester plans and migration tracking. |
| `apps/harvester/docs/tasks/README.md` | Local index for Harvester task records. |
| `docs/REPOSITORY_DOCUMENTATION_INVENTORY.md` | This repository-wide baseline and post-baseline inventory. |
| `docs/ai-agent/README.md` | Entry point for AI-agent policy and workflow references. |
| `packages/entities/README.md` | Entities package public-contract and development entry point. |

These files were added deliberately as indexes, historical evidence, inventories or package guidance. Their addition does not alter the original baseline dispositions above.

## Subsequent recursive tree checkpoints

The original 110-file checkpoint above remains a historical snapshot. Complete recursive tree comparisons found these later additions, with no removals:

| Develop checkpoint | Added Markdown/MDX path | Total files |
| --- | --- | ---: |
| `ec13d3b30b901b809cb20839b02da2f25b161c97` | `docs/architecture/decisions/ADR-0002-explicit-binance-trading-environment.md` | 111 |
| `dd18f2280fdc885211e678bf8218f59c3362a2ea` | `docs/MARKDOWN_STYLE.md` (merged in [PR #853](https://github.com/45s/coinzilla/pull/853)) | 112 |
| `2bc9f6f2593e12626ff8c01358a2ea792b63b631` | `apps/harvester/docs/error-vocabulary.md` (added in [PR #866](https://github.com/45s/coinzilla/pull/866)); current develop checkpoint | 113 |
| `96065e86851aac1c99314d0aa7fb0b2f2a5ca19c` | Historical checkpoint after [PR #879](https://github.com/45s/coinzilla/pull/879); 113 tracked Markdown/MDX files | 113 |
| `97b6a503d3392a6aba019553de6698d267d4c81f` | Historical checkpoint after [PR #903](https://github.com/45s/coinzilla/pull/903); complete recursive tree comparison confirmed 113 tracked Markdown/MDX files | 113 |
| `9fd14d12408586467bb50127845b16f0d2600ca6` | Historical develop checkpoint after [PR #904](https://github.com/45s/coinzilla/pull/904); complete recursive tree comparison confirms 113 tracked Markdown/MDX files | 113 |
| `9a9653789880573f1f1c7ba39bc9e50b581fd733` | Historical develop checkpoint after [PR #910](https://github.com/45s/coinzilla/pull/910); complete recursive tree comparison confirms 113 tracked Markdown/MDX files and no additions/removals since `9fd14d1` | 113 |
| `661c06412bd1548ef8fb92342522745efac804b3` | Historical checkpoint after [PR #911](https://github.com/45s/coinzilla/pull/911); complete recursive tree comparison confirms 113 tracked Markdown/MDX files | 113 |
| `40cb4c89b7d71d331e07957d6f53fa7177dfcdb0` | Historical checkpoint after [PR #912](https://github.com/45s/coinzilla/pull/912); complete recursive tree comparison confirms 113 tracked Markdown/MDX files and no additions/removals since `661c064` | 113 |
| `dc17f1f2c1fa6e45c08035ae6ae736eb821b90a5` | Historical checkpoint after [PR #909](https://github.com/45s/coinzilla/pull/909); complete recursive tree comparison confirms 113 tracked Markdown/MDX files and no additions/removals since `40cb4c8` | 113 |
| `6dc664fe48a635a0db757aec116c950e751ef30f` | Historical checkpoint after [PR #914](https://github.com/45s/coinzilla/pull/914); complete recursive tree comparison confirms 113 tracked Markdown/MDX files and no additions/removals since `dc17f1f` | 113 |
| `631e82c4630f7b57d47fd6fd43adfdbb8656bd95` | Last source-verified develop checkpoint after [PR #915](https://github.com/45s/coinzilla/pull/915); complete recursive tree comparison confirms 113 tracked Markdown/MDX files and no additions/removals since `6dc664f` | 113 |
| `c2742b8343c99dfdfab40078809ead189d668fa7` | Historical checkpoint after [PR #916](https://github.com/45s/coinzilla/pull/916); complete recursive tree comparison confirms 113 tracked Markdown/MDX files and no additions/removals since `631e82c` | 113 |
| `467031c3101ca7e77ceb8e4e06f94aa7721cbefe` | Current source-verified develop checkpoint after [PR #918](https://github.com/45s/coinzilla/pull/918); complete recursive tree comparison confirms 113 tracked Markdown/MDX files and no additions/removals since `c2742b` | 113 |
| `f4fd2ab8f2cd40b497aa3b931c12f0bb9513f015` | Current develop checkpoint after [PR #924](https://github.com/45s/coinzilla/pull/924); the only new path since the 113-file checkpoint is `apps/harvester/docs/domain/DOMAIN_TEST_INVENTORY.md`, created in [PR #917](https://github.com/45s/coinzilla/pull/917) | 114 |
| `31754f7f207ae42556f9c0032e8e5b25cddeb02d` | Current develop checkpoint after [PR #925](https://github.com/45s/coinzilla/pull/925); 114 tracked Markdown/MDX files remain unchanged from the prior checkpoint (zero path additions/removals) | 114 |
| `186ac3066ba515ead2eae8dbfcc4dc25d6e594bb` | Current develop checkpoint after [PR #934](https://github.com/45s/coinzilla/pull/934); 114 tracked Markdown/MDX files remain unchanged (zero path additions/removals) | 114 |
| `f98c4e02be5707c550bde5c63e223b0f160bb406` | Current develop checkpoint after [PR #938](https://github.com/45s/coinzilla/pull/938); 114 tracked Markdown/MDX files remain unchanged (zero path additions/removals) | 114 |
| `752f0a7a6f2f4acaa0be461980f4853220805f3b` | Current source-verified develop checkpoint after [PR #951](https://github.com/45s/coinzilla/pull/951); three new audit indexes and nine evidence-path relocations; 117 tracked Markdown/MDX files | 117 |
| `86f9c1d4d7a012e628dcd1b7b68b2354e4073045` | Current source-verified develop checkpoint after [PR #950](https://github.com/45s/coinzilla/pull/950); 117 tracked Markdown/MDX files remain unchanged after the audit archive relocation | 117 |
| `210648d62026bb212f9ed88b6d2257e2d1b3fc72` | Current source-verified develop checkpoint after [PR #964](https://github.com/45s/coinzilla/pull/964); complete recursive tree confirms 117 tracked Markdown/MDX paths with no additions/removals since PR #951 | 117 |
| `dcb0b64ece84ea2f3a41f5a110e559a01797ac6d` | Historical source-verified develop checkpoint after [PR #968](https://github.com/45s/coinzilla/pull/968); complete recursive tree contained 117 tracked Markdown/MDX paths (57 Harvester, 60 elsewhere) | 117 |
| `515324a6b1cb872b99593bdf448d1914b005bfcb` | Current source-verified develop checkpoint after PR #1002; complete recursive tree contains 118 tracked Markdown/MDX paths (58 Harvester, 60 elsewhere), including the 2026-11-10 restart-recovery audit report | 118 |
| `bbd80b93cc0b8ab09172119c0d2d87617257a159` | Current source-verified develop checkpoint after merged PR #1003; complete recursive tree contains 119 tracked Markdown/MDX paths (59 Harvester, 60 elsewhere) | 119 |
| `e753f9f07a201802814f4019ec2222fc7df7d798` | Current source-verified develop checkpoint after merged PR #1017; complete recursive tree contains 124 tracked Markdown/MDX paths (61 Harvester, 63 elsewhere) | 124 |
| `452b19bbb13ee4bbe86df23c3d1da6f4566039d6` | Historical source-verified develop checkpoint after merged PR #1018; complete recursive tree still contains 124 tracked Markdown/MDX paths (61 Harvester, 63 elsewhere) | 124 |
| `b5fc236987833da4374258da876b412be3c48759` | Current source-verified develop checkpoint after merged PR #1012; complete recursive tree still contains 124 tracked Markdown/MDX paths (61 Harvester, 63 elsewhere) | 124 |
| `7590d332a307c7ef7bea37f0ba8721b399bd96e8` | Historical source-verified develop checkpoint before merged PR #1269; complete recursive tree contains 147 tracked Markdown/MDX paths (81 Harvester, 66 elsewhere) | 147 |
| `0a51d6034a6ff6473d9a9005b74744fd048c9135` | Historical source-verified develop checkpoint after merged PR #1269; no Markdown/MDX path additions or removals since `7590d33`; 147 tracked Markdown/MDX paths (81 Harvester, 66 elsewhere) | 147 |
| `37aa07ec4c6421bd6c8b10084d734dc4ad9ed47c` | Historical source-verified develop checkpoint after merged PRs #1267, #1353 and #1383; nine Markdown/MDX additions and no removals since `0a51d60`; 156 tracked paths (85 Harvester, 71 elsewhere) | 156 |
| `80f1fe6551e8f08ea791fc7860a1274825a924e5` | Historical source-verified develop checkpoint after merged PR #1397; complete recursive tree remained 156 Markdown/MDX paths (85 Harvester, 71 elsewhere), with zero path additions/removals since `37aa07e` | 156 |
| `8843bd1e42dea7b47a7af5c464b921e54dd16c0d` | Historical source-verified develop checkpoint after merged PR #1407; complete recursive tree remains 156 Markdown/MDX paths (85 Harvester, 71 elsewhere), with zero path additions/removals since `80f1fe` | 156 |
| `81669ce2be6794b9bd03067f89b57f8fdb55f957` | Historical source-verified develop checkpoint after merged PR #1396; complete recursive tree contains 157 Markdown/MDX paths (86 Harvester, 71 elsewhere), one Harvester audit document added and zero removals since `8843bd1` | 157 |
| `c3337a5d7a716334e2751b83bcf121ae1ebaa508` | Source-verified develop checkpoint after merged PR #1412; complete recursive tree remained at 157 Markdown/MDX paths (86 Harvester, 71 elsewhere), with zero path changes since `81669ce` | 157 |
| `ea6110fb39c1c86acfbf9673910965e7f698d511` | Historical source-verified develop checkpoint after merged PR #1419; complete recursive tree remains at 157 Markdown/MDX paths (86 Harvester, 71 elsewhere), with zero path changes since `c3337a5` | 157 |
| `007f631a3db04b1a2d1ca3d21bb9af65123bd014` | Last complete recursive inventory checkpoint after merged PR #1415; 157 Markdown/MDX paths (86 Harvester, 71 elsewhere), with zero path changes since `ea6110f` | 157 |

The previous source-verified develop checkpoint `b5fc236987833da4374258da876b412be3c48759` (after merged PR #1012) contained 124 tracked Markdown/MDX files: 61 under Harvester and 63 elsewhere. The complete recursive tree at `7590d332a307c7ef7bea37f0ba8721b399bd96e8` contained **147 tracked Markdown/MDX files**: 81 under Harvester and 66 elsewhere (97 frozen baseline files plus 50 additions, zero net removals). The subsequent checkpoint `0a51d6034a6ff6473d9a9005b74744fd048c9135`, after merged PR #1269, remained at 147 paths. The previous source-verified `develop` checkpoint `8843bd1e42dea7b47a7af5c464b921e54dd16c0d` contained **156 tracked Markdown/MDX files**: 85 under Harvester and 71 elsewhere. The checkpoint `81669ce2be6794b9bd03067f89b57f8fdb55f957` increased this to **157 tracked Markdown/MDX files**: 86 under Harvester and 71 elsewhere, by adding `apps/harvester/docs/domain/RECOVERY_SELLER_POLICY_BLOCKERS.md` with no removals. The checkpoint `ea6110fb39c1c86acfbf9673910965e7f698d511` remained at **157 tracked Markdown/MDX files**: 86 under Harvester and 71 elsewhere. The last complete recursive inventory checkpoint `007f631a3db04b1a2d1ca3d21bb9af65123bd014` contained **157 tracked Markdown/MDX files**: 86 under Harvester and 71 elsewhere. Complete recursive comparison at that checkpoint confirmed zero path changes since `ea6110f` (PR #1415 modified existing documents only). This paragraph describes the historical 157-file checkpoint only. It is superseded by the complete 160-file checkpoint at `543753da5938eba2d95ad19d74c3f98a991e6461` and the current 179-file checkpoint recorded below. Earlier counts remain valid historical snapshots.

## Historical recursive additions — develop checkpoint 0a51d603

A complete recursive tree comparison from the 124-file checkpoint `b5fc236987833da4374258da876b412be3c48759` to historical `develop` checkpoint `7590d332a307c7ef7bea37f0ba8721b399bd96e8` found 23 added Markdown/MDX paths and no removed paths:

| Added path | Purpose |
| --- | --- |
| `apps/harvester/docs/SHUTDOWN_LOGGING_REDESIGN.md` | Accepted shutdown phase logging design and implementation contract. |
| `apps/harvester/docs/architecture/OPERATOR_CONTROL_DESIGN.md` | Current transport-independent operator-control architecture and Command Center contract. |
| `apps/harvester/docs/architecture/decisions/0002-transport-independent-operator-control.md` | Accepted application/engine/Telegram ownership and market-pause ADR. |
| `apps/harvester/docs/architecture/decisions/0003-process-lifetime-operator-pause.md` | Accepted process-lifetime operator-pause scope. |
| `apps/harvester/docs/architecture/decisions/0004-startup-open-orders-are-external.md` | Accepted startup open-order ownership boundary. |
| `apps/harvester/docs/audits/reports/2026-11-13_source-domain-correctness-audit.md` | Dated source/domain correctness audit evidence. |
| `apps/harvester/docs/audits/reports/2026-11-15_f055-shutdown-recovery.md` | Dated shutdown recovery finding evidence. |
| `apps/harvester/docs/audits/sessions/AUDIT_SESSION_2026-11-12_19-27-13Z.md` | Preserved session audit evidence. |
| `apps/harvester/docs/audits/sessions/AUDIT_SESSION_2026-11-12_19-27-13Z_ORDER_FILL_LEDGER.md` | Matching session order/fill ledger evidence. |
| `apps/harvester/docs/audits/sessions/AUDIT_SESSION_2026-11-13_15-50-59Z.md` | Preserved session audit evidence. |
| `apps/harvester/docs/audits/sessions/AUDIT_SESSION_2026-11-13_15-50-59Z_ORDER_FILL_LEDGER.md` | Matching session order/fill ledger evidence. |
| `apps/harvester/docs/audits/sessions/AUDIT_SESSION_2026-11-14_23-41-12Z.md` | Preserved session audit evidence. |
| `apps/harvester/docs/domain/recovery-seller-domain-specification.md` | Proposed Recovery Seller domain contract. |
| `apps/harvester/docs/domain/recovery-seller-implementation-roadmap.md` | Proposed Recovery Seller implementation roadmap. |
| `apps/harvester/docs/operations/submission-deferrals.md` | Operational explanation of order-submission deferral evidence. |
| `apps/harvester/docs/operations/telegram-command-center.md` | Telegram Command Center operator runbook. |
| `apps/harvester/docs/operator-control/README.md` | Operator-control capability index and implementation status. |
| `apps/harvester/docs/plans/STARTUP_EXTERNAL_ORDER_BOUNDARY.md` | Design and implementation record for startup order ownership. |
| `apps/harvester/docs/plans/WORKFLOW_PIPELINE_MIGRATION.md` | Harvester workflow-pipeline migration plan. |
| `apps/harvester/docs/recovery/README.md` | Recovery documentation entry point. |
| `docs/engineering/AI_REFACTORING_AUDIT_STANDARD.md` | Repository AI refactoring audit standard. |
| `docs/engineering/ESLINT_STANDARD.md` | Repository ESLint policy and verification standard. |
| `docs/engineering/structured-error-handling.md` | Repository structured error-handling standard. |

## Historical recursive additions — develop checkpoint 37aa07ec

A complete recursive tree comparison from `0a51d6034a6ff6473d9a9005b74744fd048c9135` to current `develop` `37aa07ec4c6421bd6c8b10084d734dc4ad9ed47c` found nine added Markdown/MDX paths and no removals:

| Added path | Purpose |
| --- | --- |
| `apps/harvester/docs/architecture/decisions/0005-emergency-buy-pause.md` | Accepted global/per-market emergency BUY pause, current-process-owned cancellation and recovery SELL continuity decision (merged PR #1267). |
| `apps/harvester/docs/audits/sessions/AUDIT_SESSION_2026-11-17_08-48-56Z.md` | Preserved 2026-11-17 Harvester session audit evidence. |
| `apps/harvester/docs/infrastructure/provider-instance-registry.md` | Harvester-owned provider identity/registry architecture and lifecycle contract (merged PR #1383). |
| `apps/harvester/docs/persistence/README.md` | Harvester-owned persistence architecture and database integration boundary. |
| `docs/architecture/decisions/ADR-0003-multi-provider-routing.md` | Accepted provider-neutral execution and independent market-data routing architecture. |
| `docs/architecture/multi-provider-migration-plan.md` | Source-based migration audit, phases, blockers and delivery sequence. |
| `packages/brokers/BITUNIX_REFERENCE_AUDIT.md` (historical path) | Source/reference audit; the current living document is `packages/brokers/docs/BITUNIX_REFERENCE_AUDIT.md`, linked by the Brokers docs index. The old path is retained here only as historical inventory provenance. |
| `packages/db/docs/README.md` | Database package architecture and decision index. |
| `packages/db/docs/decisions/0001-provider-neutral-record-crud-api.md` | Accepted provider-neutral record CRUD API decision. |

## Merged documentation additions — PR #1013 and follow-up work

[PR #1013](https://github.com/45s/coinzilla/pull/1013) merged the five maintained design/proposal documents below. They are included in the current 124-file recursive inventory.

| Added path | Purpose |
| --- | --- |
| `packages/indicators/README.md` | Defines the exchange-neutral indicator package boundary and public API; records Harvester as its first runtime consumer of ATR/NATR measurements in merged PR #1037 (data collection only). |
| `packages/indicators/AGENTS.md` | Defines Indicators domain ownership and implementation constraints. |
| `packages/indicators/ROADMAP.md` | Tracks the delivered ATR/NATR/ratio capability, Harvester candle-data consumer and remaining protection/adaptive-price-step work. |
| `apps/harvester/docs/volatility-protection.md` | Defines per-market protection, candle data, the recovery-SELL exception and Harvester implementation/test plan; PR #1037 delivers candle data and merged PR #1041 delivers the runtime protection gate and owned-BUY cancellation. Historical threshold calibration remains open. |
| `apps/harvester/docs/exchange-trading-constraints.md` | Records exchange trading constraints and their application-level handling. |

The subsequent Brokers candle contract documentation is an update to an existing file and does not change the Markdown/MDX path count. PR #1018 added runtime JavaScript and package metadata without adding new Markdown paths. PR #1019 updates existing Harvester port, architecture, roadmap and safety documents without adding new Markdown paths. PR #1037 updates existing Harvester/Indicators documentation and test support without adding Markdown/MDX paths; the 124-file count remained unchanged at that historical checkpoint.

## Source-verified content reviews (post-baseline)

The original 97-file inventory table above is a frozen baseline: its recorded byte sizes and first-pass dispositions are not current file metadata. Source-review findings and later document changes are recorded separately here rather than rewriting baseline rows.

| Document(s) | Source-verified review | Delivery |
| --- | --- | --- |
| `apps/harvester/docs/audits/README.md`; `reports/`, `sessions/`, and `evidence/` archive indexes; Harvester entry points and inventory | Moved nine historical records out of the application root, preserved their contents/provenance, repaired internal links, and retained only README/AGENTS/ROADMAP at the Harvester root. Exact-head required checks and advisory external documentation links passed. | [PR #951](https://github.com/45s/coinzilla/pull/951) |
| `packages/notifiers/AGENTS.md`; `packages/notifiers/README.md` | Verified the formatter's caller-owned free-form `message`/`reason` boundary, EventBus error-reporter fallback, delivery-queue recovery and smoke-test confirmation output against source and tests. | [PR #873](https://github.com/45s/coinzilla/pull/873) |
| `packages/utils/README.md` | At the #876 checkpoint, verified the exported per-key serialized queue and non-null/non-array object assertion against implementation, tests, public exports and consumers; the Validator configuration limitation was then tracked in #892, hardened in #918, and the deprecated facade was subsequently removed in #1509. | [PR #876](https://github.com/45s/coinzilla/pull/876), [PR #918](https://github.com/45s/coinzilla/pull/918), [PR #1509](https://github.com/45s/coinzilla/pull/1509) |
| `apps/harvester/docs/TRADING_FIRST.md` | Verified current WebSocket API/Streams and CLOSING-audit transport terminology against the broker adapter, source-verified Architecture and Journal Operations; dated November 4 incident terminology remains historical and unchanged. | [PR #883](https://github.com/45s/coinzilla/pull/883) |
| `apps/harvester/docs/domain/DOMAIN_TEST_INVENTORY.md` | Added the source-driven behavior-to-test inventory and maintained its evidence through the Portfolio/RecoveryLedger commission-conflict and Conservative investment-cap regression additions. | [PR #917](https://github.com/45s/coinzilla/pull/917), [PR #921](https://github.com/45s/coinzilla/pull/921), [PR #922](https://github.com/45s/coinzilla/pull/922) |
| `apps/harvester/docs/JOURNAL_EVIDENCE_CONTRACT.md`; Harvester Journal architecture/domain/operations indexes | Reconciled the Harvester consumer contract with Journal JSONL serialization: persisted payloads must be JSON-safe, while the broader EventBus payload type is not a promise of durable representability. Updated navigation and roadmap evidence without changing runtime behavior. | [PR #895](https://github.com/45s/coinzilla/pull/895) |
| `packages/brokers/ARCHITECTURE.md`; `packages/brokers/README.md`; `packages/brokers/ROADMAP.md` | Reconciled architecture completion claims with current implementation and tests; retained the target-architecture versus current-source boundary and corrected the active roadmap status. | [PR #896](https://github.com/45s/coinzilla/pull/896) |
| `packages/db/AGENTS.md`; `packages/db/README.md` | Corrected public API guidance to match factory-based runtime exports and clarified that `DatabaseProvider` is a JSDoc-only port rather than a runtime export. | [PR #897](https://github.com/45s/coinzilla/pull/897) |
| `packages/journal/README.md`; `packages/journal/ROADMAP.md`; Journal record/serialization JSDoc | Documented JSONL serialization and durability limitations, the temporary JSON-safe consumer constraint, and the still-open Journal-owned defect in #889. | [PR #898](https://github.com/45s/coinzilla/pull/898) |
| `packages/market-simulator/README.md` | Corrected both broker examples to provide caller-owned market history and documented optional custom repository injection and precedence. The package was later retired in PR #1482. | [PR #900](https://github.com/45s/coinzilla/pull/900) |
| `packages/brokers/AGENTS.md`; `packages/journal/AGENTS.md`; `packages/utils/AGENTS.md`; `packages/market-simulator/AGENTS.md` | Aligned package agent instructions with actual coverage scripts and thresholds; the Market Simulator package was later retired in PR #1482. | [PR #911](https://github.com/45s/coinzilla/pull/911) |
| `docs/MARKDOWN_STYLE.md`; `docs/DOCUMENTATION_GOVERNANCE.md`; `docs/ci-workflows.md`; external-link checker and tests | Added a dependency-free external-link checker, retry/rate-limit/redirect handling, conservative classifications, query-credential rejection/redaction, and DNS-pinned HTTP(S) transport with redirect revalidation. The suite now has 31 deterministic DNS-injected tests; External Documentation Links is active as a non-required advisory workflow, #901 is resolved, and required CI remains network-free. | [PR #899](https://github.com/45s/coinzilla/pull/899), [PR #902](https://github.com/45s/coinzilla/pull/902), [PR #903](https://github.com/45s/coinzilla/pull/903), [PR #908](https://github.com/45s/coinzilla/pull/908) |
| `docs/REPOSITORY_DOCUMENTATION_INVENTORY.md`; `ROADMAP.md` | Synchronized the frozen 97-file baseline, post-baseline additions, 113-file recursive checkpoint, source-review evidence and remaining-work status after the latest audit. | [PR #904](https://github.com/45s/coinzilla/pull/904) |
| `apps/harvester/ROADMAP.md`; `apps/harvester/docs/JOURNAL_OPERATIONS.md`; Harvester entrypoint/tests | Verified PR #906's same-process Journal flush-failure classification and conservative process-ownership lock retention; this does not claim process-restart recovery. | [PR #906](https://github.com/45s/coinzilla/pull/906) |
| `apps/harvester/docs/architecture.md`; recovery handler and tests | Verified same-process generation fencing: stale asynchronous recovery-stage failures retain their original error/generation context and cannot mutate a replacement generation or terminal accounting latch. This does not implement process-restart reconciliation; #654 remains open. | [PR #909](https://github.com/45s/coinzilla/pull/909) |
| `apps/harvester/docs/audits/reports/2026-11-10_18-44-49_restart-recovery-audit.md` | Preserved the source-based restart-recovery findings and implementation gates at their stated develop baseline; no runtime changes or exchange operations. | Develop checkpoint `515324a6b1cb872b99593bdf448d1914b005bfcb` |
| `apps/harvester/docs/architecture/decisions/0001-application-owned-recovery-facts.md`; Harvester/root roadmaps; Journal and CI workflow docs; `.github/workflows/unit-tests.yml` | Froze the target process-restart recovery contract: a separate application-owned append-only fact stream with a committed-head integrity manifest, explicit durability acknowledgement, Journal observer separation, derived accounting projections, and a closed startup reconciliation gate. Also removed the unconditional PR-only TESTNET endpoint probe so package-test workflows remain offline; manual TESTNET integration stays opt-in. No runtime recovery behavior changed. | PR #1003 |
| `apps/harvester/README.md`; `apps/harvester/docs/architecture.md`; `apps/harvester/docs/architecture/BROKER_HARVESTER_TRADING_FLOW.md`; `apps/harvester/docs/error-vocabulary.md` | Corrected Journal flush scope, verification-only final reconciliation, market-metadata cache ownership/scope, and per-session Journal lock recovery paths against source and tests. | [PR #910](https://github.com/45s/coinzilla/pull/910) |
| `README.md`; `ROADMAP.md`; `docs/README.md`; `docs/ci-workflows.md`; inventory | Reconciled the root navigation, 113-file checkpoint, and live `core`/`develop-core` ruleset evidence while preserving the frozen 97-file baseline. | [PR #912](https://github.com/45s/coinzilla/pull/912) |
| `ROADMAP.md`; `apps/harvester/ROADMAP.md` | Reconciled recovery roadmap closeout and kept process-restart reconciliation explicitly open under #654. | [PR #914](https://github.com/45s/coinzilla/pull/914) |
| `docs/MARKDOWN_STYLE.md`; Markdown baseline/checker scripts and tests | Added six report-only list/table metrics, objective conventions, and positive/negative/fenced-code/historical test coverage; changed-file enforcement remains unchanged. The 113-file baseline reports 41 files / 156 list-spacing findings and one table-column mismatch. | [PR #915](https://github.com/45s/coinzilla/pull/915) |
| `packages/brokers/ROADMAP.md`; `ROADMAP.md`; inventory | Corrected the Brokers roadmap table-column mismatch and synchronized the 113-file recursive checkpoint, inventory, and root roadmap without adding or removing Markdown/MDX paths. | [PR #916](https://github.com/45s/coinzilla/pull/916) |
| `packages/utils/src/validation.js`; `packages/utils/src/validator.js`; `packages/utils/README.md`; `packages/utils/ROADMAP.md`; root `README.md`/`ROADMAP.md`; `.github/workflows/utils-unit-tests.yml` | Source-verified and hardened the public Validator rule/mode contract; corrected required test discovery; 198/198 Utils tests passed with 98.53% line and 96.33% branch coverage. | [PR #918](https://github.com/45s/coinzilla/pull/918) |
| `packages/utils/src/validator.js`; `packages/utils/src/validation.js`; `validator.test.js`; `validation.test.js`; `packages/utils/src/index.js`; `packages/utils/src/ensure/`; `packages/entities/src/coins/coin.js`; `packages/entities/src/orders/order.js`; focused tests; Utils/Entities roadmaps; shared-utilities policy; root README/ROADMAP; CI workflow/docs | Removed the Validator/VR facade, declarative rule implementation/tests and public exports; migrated Coin ticker and Order price/ID checks with domain Error/message preservation; added custom `ensure.errMsg` coverage; fixed recursive Utils test discovery; synchronized maintained documentation. Exact-head verification passed: Utils 225 (223 passed, 0 failed, 2 skipped), Entities 145/145, workspace tests/coverage, JS syntax/strict lint/Markdown, dependency audit, Harvester targeted tests and external links. Merged as `ab77568acfcd286560270aaac325bf65301efb0c`. | [PR #1509](https://github.com/45s/coinzilla/pull/1509) |
| `packages/brokers/README.md`; `packages/brokers/ROADMAP.md` | Verified canonical order placement explicitly requests Binance `RESULT` rather than relying on the minimal default `ACK` for `LIMIT_MAKER`; the compatibility `createOrder()` contract is unchanged and uncertain placement is not retried. | [PR #961](https://github.com/45s/coinzilla/pull/961) |
| `apps/harvester/docs/JOURNAL_OPERATIONS.md`; `apps/harvester/docs/TRADING_FIRST.md`; Harvester/root roadmaps | Verified authoritative `NEW` user-data identity recovery (`UNKNOWN → OPEN`), duplicate/conflicting identity handling, shutdown cancellation boundaries, and propagation of validated `TRADING_MODE` into startup status against source/tests. | [PR #964](https://github.com/45s/coinzilla/pull/964) |
| `apps/harvester/docs/README.md`; `docs/README.md`; `docs/REPOSITORY_DOCUMENTATION_INVENTORY.md`; `packages/brokers/ROADMAP.md`; `ROADMAP.md` | Removed duplicate Harvester archive navigation, reconciled the 117-file count/checkpoints, and closed the stale Brokers `RESULT` acknowledgement roadmap item against merged PR #961 and issue #960. | [PR #967](https://github.com/45s/coinzilla/pull/967) |
| `apps/harvester/ROADMAP.md`; `apps/harvester/docs/domain/ACCOUNTING_INVARIANTS.md`; `DOMAIN_TEST_INVENTORY.md`; `portfolio.md` | Recorded the merged snapshot-relative account balance/commitment baseline, its eight scenario families, fail-closed invalid-order handling, and exact-head offline verification. | [PR #968](https://github.com/45s/coinzilla/pull/968) |
| `apps/harvester/docs/volatility-protection.md`; Harvester architecture/flow and BrokerPort guidance; `packages/indicators/README.md` and `ROADMAP.md` | Verified the per-market candle-history service, ATR/NATR measurements, freshness/gap behavior, and unsubscribe drain guarantees; the runtime protection state machine, central order gate, recovery-SELL exception and owned-BUY cancellation were subsequently merged in PR #1041. Historical threshold calibration remains open. | [PR #1037](https://github.com/45s/coinzilla/pull/1037), [PR #1041](https://github.com/45s/coinzilla/pull/1041) |

## Disposition vocabulary

- **KEEP** — preserve at the current path; maintain authority boundaries and index links.
- **REVIEW** — investigate content, status and references before deciding whether to keep, merge, split, supersede or archive.
- No deletion or bulk move is authorized by this inventory.

## File-by-file inventory outside Harvester

| Path | Size (bytes) | Category | Current disposition | Rationale / next review |
| --- | ---: | --- | --- | --- |
| `.github/ISSUE_TEMPLATE/cross-domain-request.md` | 816 | GitHub workflow/template | **KEEP** | KEEP; field set matches CROSS_DOMAIN_REQUESTS (owner, consumer, current/expected behavior, acceptance, impact, compatibility/safety and links); no process mismatch. |
| `.github/PULL_REQUEST_TEMPLATE.md` | 2773 | GitHub workflow/template | **KEEP** | KEEP; verification, exact-head CI, documentation impact, provenance, handoff and target-branch fields match ENGINEERING_STANDARDS and AI_AGENT_WORKFLOW. One extra blank line is tracked for normalization in #1432. |
| `.github/copilot-instructions.md` | 265 | GitHub workflow/template | **KEEP** | KEEP; intentionally delegates to root AGENTS.md and does not duplicate or override repository policy. |
| `AGENTS.md` | 10703 | Repository governance | **KEEP** | Mandatory contributor/AI-agent instructions; local rules supplement central policy. |
| `AI_AGENT_WORKFLOW.md` | 22580 | Repository governance | **KEEP** | KEEP; canonical branch, freshness, test-first, exact-head CI, merge/release and resumable-handoff policy; checked against current develop-only task-PR rules and required workflow contexts. |
| `ENGINEERING_STANDARDS.md` | 29505 | Repository governance | **KEEP** | KEEP; canonical engineering/testing/security/reliability/DoD standard; reviewed with root scripts, ESLint policy and current required CI model; no confirmed defect. |
| `README.md` | 4326 | Repository entry point | **KEEP** | Source-checked against the Brokers package manifest and README; removes obsolete Binance SDK/`test:sdk` instructions, documents native-WebSocket integration scripts and safety gates, and points to the active `core`/`develop-core` six-context rulesets. |
| `ROADMAP.md` | 8232 | Repository roadmap | **KEEP** | Current work/status authority for the owning scope; reconcile status against GitHub issues/PRs. |
| `docs/DOCUMENTATION_GOVERNANCE.md` | 16440 | Operational/reference guide | **KEEP** | Canonical repository-wide documentation policy; source review corrected the Section 11 freshness-sweep reference, records deterministic Markdown checks, and now documents the DNS-pinned external-link policy and active non-required advisory workflow after #901 was resolved. |
| `docs/README.md` | 2223 | Operational/reference guide | **KEEP** | Repository-wide documentation entry point. |
| `docs/ai-agent/repository-engineering-audit.md` | 15755 | Historical task brief | **KEEP** | Historical audit task brief; separate from the actual audit report in docs/audits/ and not current agent policy. |
| `docs/architecture/README.md` | 1595 | Architecture/ADR | **KEEP** | Scope entry point and setup/public contract guide. |
| `docs/architecture/decisions/ADR-0001-clean-hexagonal-architecture.md` | 5629 | Architecture/ADR | **KEEP** | Cross-reference audit found a reference to nonexistent ADR-0002; the application-specific architecture reference now points to the existing Harvester architecture guide. |
| `docs/architecture/decisions/ADR_TEMPLATE.md` | 631 | Architecture/ADR | **KEEP** | KEEP; template-only structure with status, owner, supersession, decision, alternatives, consequences and verification; no current implementation claim. |
| `docs/audits/README.md` | 649 | Repository audit archive index | **KEEP** | Maintained navigation index for historical audit records; the index itself is not historical evidence and remains subject to normal style/link enforcement. |
| `docs/audits/repository-engineering-audit.md` | 16323 | Historical audit | **KEEP** | Historical repository assessment; preserve baseline, date and limitations. |
| `docs/brokers-websocket-contract.md` | 30152 | Operational/reference guide | **KEEP** | KEEP; source-verified against packages/brokers/src/index.js, README and index.contract.test.js. Stale four-export claim corrected to the exact eight-name public allow-list in #1431. |
| `docs/ci-workflows.md` | 3292 | Operational/reference guide | **KEEP** | Source-checked against root `package.json` and `.github/workflows/`; documents the six required contexts on both active rulesets, the 31-test DNS-pinned external-link checker, and the non-required network advisory workflow. PR #1431 removes the stale claim that Test Coverage writes a custom Actions step summary. |
| `docs/contributing.md` | 2622 | Operational/reference guide | **KEEP** | Source-checked against root/package manifests and workflows; removes a nonexistent Brokers `test:sdk` command and lists the three scripts actually defined by `packages/brokers/package.json`. |
| `docs/dependency-audit-playbook.md` | 2931 | Operational/reference guide | **KEEP** | KEEP; triggers, pnpm audit command, Dependabot cadence/target and security-update exception match .github/workflows/dependency-audit.yml and .github/dependabot.yml. |
| `docs/engineering/BRANCH_AND_RELEASE_POLICY.md` | 349 | Engineering policy | **KEEP** | KEEP; intentionally a stable pointer to AI_AGENT_WORKFLOW.md, avoiding a second branch/release policy. |
| `docs/engineering/CROSS_DOMAIN_REQUESTS.md` | 2462 | Engineering policy | **KEEP** | KEEP; request types, required evidence, owner decision and implementation sequence match the GitHub cross-domain issue template. |
| `docs/engineering/DEFINITION_OF_DONE.md` | 554 | Engineering policy | **KEEP** | KEEP; intentionally links ENGINEERING_STANDARDS.md, TASK_WORKFLOWS.md and AI_AGENT_WORKFLOW.md instead of duplicating checklists. |
| `docs/engineering/DOMAIN_OWNERSHIP.md` | 2648 | Engineering policy | **KEEP** | KEEP; owned paths and responsibilities match current workspace packages and local AGENTS.md ownership declarations; shared infrastructure boundary is explicit. |
| `docs/engineering/JAVASCRIPT_JSDOC_STANDARD.md` | 6385 | Engineering policy | **KEEP** | KEEP; source-verified against effective root eslint.config.js and the ESLint Standard; no conflicting rule found. |
| `docs/engineering/MODULARITY_STANDARD.md` | 2727 | Engineering policy | **KEEP** | KEEP; source-verified against current package layouts and effective ESLint architecture rules; no conflicting boundary rule found. |
| `docs/engineering/SHARED_UTILITIES_POLICY.md` | 19699 | Engineering policy | **KEEP** | Current shared-utility ownership and reuse policy; source review verified current package paths and keeps the removed Coin Farmer application explicitly historical. |
| `docs/engineering/README.md` | 852 | Engineering policy | **KEEP** | Scope entry point and setup/public contract guide. |
| `docs/engineering/TASK_WORKFLOWS.md` | 3268 | Engineering policy | **KEEP** | KEEP; task checklists and required evidence align with root AGENTS.md and AI_AGENT_WORKFLOW.md; no conflicting completion rule found. |
| `docs/MARKDOWN_STYLE.md` | 13921 | Markdown style standard | **KEEP** | Canonical maintained-document authoring standard; documents changed-file enforcement, report-only full-tree metrics, tested exclusions and the historical migration boundary. |
| `docs/release-and-rollback.md` | 2504 | Operational/reference guide | **KEEP** | KEEP; accurately states that no automated deployment workflow exists; current workflow tree contains CI/test/audit workflows only. |
| `docs/workspace-package-map.md` | 4790 | Operational/reference guide | **KEEP** | KEEP; package paths match pnpm-workspace.yaml and manifests. Harvester DB/Indicators dependencies and the read-only Bitunix broker boundary are corrected in #1431. |
| `packages/brokers/AGENTS.md` | 8605 | Package agent instructions | **KEEP** | Mandatory contributor/AI-agent instructions; PR #911 requires `test:coverage` and documents the 90% line / 80% branch / 80% function thresholds. |
| `packages/brokers/ARCHITECTURE.md` | 35221 | Package architecture | **KEEP** | Explicitly labels itself as target architecture/migration contract, distinguishes its dated implementation snapshot from current source, and documents verified consumer boundaries and enforced dependency direction. Linked by the package README and roadmap; no move/split is warranted. |
| `packages/brokers/README.md` | 19671 | Package entry point | **KEEP** | Scope entry point and setup/public contract guide; records the standalone Node floor separately from the exact patched Undici major-version floors enforced by `runtime.js`. |
| `packages/brokers/ROADMAP.md` | 109813 | Package roadmap | **KEEP** | Active priority execution plan and Section 2 current status are authoritative; later phases and dated investigation notes are explicitly historical evidence. The 2026-11-08 #702 note records the pre-approval state, while the current section records the accepted contract and merged PRs #732/#735/#740. PR #896 reconciled the architecture completion status against current implementation/tests. The package AGENTS/README designate this detailed roadmap as the primary work entry point; keep its current/history boundary and do not rewrite dated notes. |
| `packages/db/AGENTS.md` | 2897 | Package agent instructions | **KEEP** | Mandatory contributor/AI-agent instructions; local rules supplement central policy; PR #897 aligns factory-based runtime API guidance with exports and tests. |
| `packages/db/README.md` | 5933 | Package entry point | **KEEP** | Source-checked against package exports and runtime constraints; the earlier unmatched closing Markdown fence in Development was corrected, and PR #897 clarifies factory-based public APIs and the JSDoc-only `DatabaseProvider` port. |
| `packages/db/ROADMAP.md` | 7652 | Package roadmap | **KEEP** | Current work/status authority for the owning scope; reconcile status against GitHub issues/PRs. |
| `packages/entities/AGENTS.md` | 2139 | Package agent instructions | **KEEP** | Mandatory contributor/AI-agent instructions; local rules supplement central policy. |
| `packages/entities/ROADMAP.md` | 14256 | Package roadmap | **KEEP** | Current work/status authority for the owning scope; reconcile status against GitHub issues/PRs. |
| `packages/event-bus/AGENTS.md` | 2072 | Package agent instructions | **KEEP** | Mandatory contributor/AI-agent instructions; local rules supplement central policy. |
| `packages/event-bus/README.md` | 6406 | Package entry point | **KEEP** | Source-checked against package engine, root workspace engine and Node 24 CI workflows; removes the stale claim that repository CI runs Node 22. |
| `packages/event-bus/ROADMAP.md` | 25883 | Package roadmap | **KEEP** | Current work/status authority for the owning scope; source review corrected an outdated constructor-options summary that omitted `maxPending`; the implementation and README agree on `logger`, `onError`, and `maxPending` (default 1,000). |
| `packages/journal/AGENTS.md` | 1668 | Package agent instructions | **KEEP** | Mandatory contributor/AI-agent instructions; PR #911 aligns the required `test:coverage` command and its 85% line / 80% branch thresholds with the package manifest. |
| `packages/journal/README.md` | 19624 | Package entry point | **KEEP** | Scope entry point and setup/public contract guide; PR #898 documents JSONL serialization/durability limits and the temporary JSON-safe consumer contract tracked by #889. |
| `packages/journal/ROADMAP.md` | 39476 | Package roadmap | **KEEP** | Current work/status authority for the owning scope; reconcile status against GitHub issues/PRs. |
| `packages/notifiers/AGENTS.md` | 4694 | Package agent instructions | **KEEP** | Mandatory contributor/AI-agent instructions; local rules supplement central policy. |
| `packages/notifiers/README.md` | 12254 | Package entry point | **KEEP** | Scope entry point and setup/public contract guide. |
| `packages/notifiers/ROADMAP.md` | 15672 | Package roadmap | **KEEP** | Current work/status authority for the owning scope; reconcile status against GitHub issues/PRs. |
| `packages/utils/AGENTS.md` | 2271 | Package agent instructions | **KEEP** | Mandatory contributor/AI-agent instructions; PR #911 requires `test:coverage` and documents the 90% line / 85% branch thresholds. |
| `packages/utils/README.md` | 19711 | Package entry point | **KEEP** | Scope entry point and setup/public contract guide; public helper/queue contracts were source-verified in PR #876, and the Validator configuration contract was hardened in merged PR #918. |
| `packages/utils/ROADMAP.md` | 11241 | Package roadmap | **KEEP** | Current work/status authority; PRs #767/#770 and closed issue #763 establish build-provenance/Logger rollout as complete, while the repository-wide helper inventory, direct console/stderr audit, and guard remain open. Historical PR #383 closeout wording is explicitly labeled as a dated snapshot. |

## Initial findings

1. `docs/ai-agent/repository-engineering-audit.md` is an AI-agent task brief, while `docs/audits/repository-engineering-audit.md` is an actual historical repository assessment. They are distinct documents, not duplicate copies.
2. Repository policy is now centralized in `docs/DOCUMENTATION_GOVERNANCE.md`; root `AGENTS.md`, `AI_AGENT_WORKFLOW.md` and `ENGINEERING_STANDARDS.md` are mandatory entry points that link to the canonical policy.
3. `packages/brokers/ARCHITECTURE.md` explicitly describes a target architecture, not a claim that the current source tree already matches it. Its current-snapshot baseline and target dependency rules are useful; KEEP it in place and preserve that distinction.
4. `packages/brokers/ROADMAP.md` is intentionally detailed, as stated by its package instructions. Its current priority plan and Section 2 status govern active work; later phases and dated investigation notes are explicitly historical implementation evidence. The 2026-11-08 #702 note records the pre-approval snapshot, not current status. Keep the file in place; do not split its history without a demonstrated navigation/maintenance benefit.
5. `packages/entities` previously had agent instructions and a roadmap but no README entry point; a package README has now been added.
6. Package README/AGENTS/ROADMAP files are domain-owned. Root policy should define common standards; package instructions should add only genuinely local constraints.
7. `docs/ci-workflows.md` had drifted from `.github/workflows/quality-gate.yml`: it incorrectly described the workflow as running `pnpm run quality` and omitted the `develop` push trigger. PR #816 aligns the guide with the actual actionlint, JavaScript syntax, and agent-policy steps.
8. `docs/contributing.md` advertised a nonexistent `@coinzilla/brokers` `test:sdk` script. The package currently defines `test:integration`, `test:websocket`, and `test:user-data-integration`; the contributor guide now lists the actual commands.
9. `docs/DOCUMENTATION_GOVERNANCE.md` pointed agents to Section 9 for the living-document freshness sweep, but Section 9 is roadmap discipline. This cross-reference now points to the explicit freshness-sweep requirement below in Section 11.
10. `ADR-0001-clean-hexagonal-architecture.md` referred to ADR-0002 for the application architecture transition, but a recursive tree and code search found no ADR-0002 in the repository. The text now links to the existing Harvester architecture guide and states that application-specific architecture is owned by each application.

## Remaining work

- [x] Complete first-pass dispositions for all 42 Harvester files and resolve all four initial Harvester REVIEW candidates (see the Harvester inventory for evidence).
- [ ] Continue source/behavior/reference review of KEEP documents; KEEP is a preservation disposition, not proof that every statement in every historical document has been revalidated.
- [x] Review current package/app README, AGENTS and ROADMAP entry points for the maintained workspace areas; source-level review findings and open defects are recorded above and in their owning package roadmaps.
- [x] Verify local indexes for substantial documentation subdirectories in root docs and Harvester; preserve any historical index/navigation distinctions.
- [ ] Trace inbound references from Markdown, source comments, GitHub Issues/PRs and workflows before any future migration.
- [x] Implement safe external-link checking: dependency-free CLI, DNS-pinned HTTP(S) transport, validation of every A/AAAA answer, redirect revalidation, credential redaction, conservative authentication classification, 31 deterministic DNS-injected tests, and a documented reliability policy. External Documentation Links is active as a non-required advisory workflow; #901 is resolved and required CI remains network-free.
- [ ] Evaluate full-repository Markdown linting and enforcement beyond the current changed-file rules; preserve historical documents and do not mass-reformat without a reviewed baseline.
- [x] Verify the required policy/link/heading-anchor baseline remains in CI; heading-anchor validation is report-only, not an enforcement gate.
- [x] Record evidence-based dispositions and rationale for all six initial REVIEW entries; no initial Harvester or Brokers REVIEW candidates remain.
- [ ] Record new REVIEW findings discovered during continued content-level review and update indexes after each approved migration.

## Post-baseline additions — startup open-order boundary

PR #1166 added two maintained Harvester documents outside the frozen 97-file baseline. They must be included in the next complete recursive tree verification.

| Added path | Purpose |
| --- | --- |
| `apps/harvester/docs/architecture/decisions/0004-startup-open-orders-are-external.md` | Accepted and implemented startup order ownership decision. |
| `apps/harvester/docs/plans/STARTUP_EXTERNAL_ORDER_BOUNDARY.md` | Completed design and implementation record for #1157. |

## Latest recursive inventory checkpoint — develop `543753da5938eba2d95ad19d74c3f98a991e6461`

The complete recursive Git tree at this checkpoint returned `truncated: false` and contains **160 tracked Markdown/MDX files**: **89 under `apps/harvester/` and 71 elsewhere**. A direct path comparison against the previous 159-file checkpoint `88b89995a4f9e62a6fe4b0451ea675ce0495b539` found exactly one addition and zero removals. The frozen 97-file baseline and all intervening historical checkpoints above remain unchanged.

The current checker classifies **132 paths as maintained** and **28 as historical evidence/archive records**. GitHub templates and maintained README indexes remain in the maintained set; exclusions are limited to explicit historical audit, evidence, incident, session, task and dated-audit path families. PR #1429 adds regression tests proving that adjacent living indexes and reusable templates are not swept into historical exclusions.

| Added path | Purpose and disposition |
| --- | --- |
| `apps/harvester/docs/persistence/sqlite-integration-blueprint.md` | Source-verified Harvester persistence inventory, ownership boundaries, Production/Testnet isolation, operational constraints and phased migration plan; KEEP as the design/audit authority, with current implementation status delegated to the persistence README and #1327. |

The Harvester documentation index and persistence index link the new blueprint. This is a path-completeness update only; it does not claim that all 160 documents have passed the maintained-document factual audit tracked by #1401, the full-tree Markdown classification/enforcement work tracked by #1402, or the reference-tracing work tracked by #1403.

## User-data delivery architecture addition (2026-11-19)

| Added path | Purpose |
| --- | --- |
| `docs/architecture/decisions/ADR-0005-generic-user-data-observation-channel.md` | Defines the provider-neutral distinction between native user-data events and non-authoritative polling observations, while preserving Bitunix provider-admission and trading-readiness barriers. |


## Current recursive inventory checkpoint — develop `0f827ba7551be61a1be58f8dced191fb0a090870` (2026-11-21)

A fresh recursive Git tree request returned `truncated: false` and contains **179 tracked Markdown/MDX files**: **94 under `apps/harvester/` and 85 elsewhere**. This is 19 more paths than the prior 160-file checkpoint at `543753da5938eba2d95ad19d74c3f98a991e6461`. A direct path-set comparison found 24 additions and 5 removals (net +19); no file-content or factual-accuracy claim is implied by this inventory update.

### Added paths since the 160-file checkpoint

The following 24 path additions have been classified and source-checked. One is historical evidence, one is a superseded decision record, and the remaining current documents are retained with the source evidence below. The relocated Brokers audit is a path move, not a duplicate document.

| Path | Disposition | Source / status evidence |
| --- | --- | --- |
| `apps/harvester/docs/architecture/decisions/0006-market-pause-cancels-owned-buys.md` | **KEEP — accepted decision** | Matches the owned-BUY pause/cancel contract delivered by merged [PR #1436](https://github.com/45s/coinzilla/pull/1436); exact-head tests and required CI passed. |
| `apps/harvester/docs/architecture/strategy-extensibility-audit-roadmap.md` | **KEEP — draft architecture discussion, not a runtime contract** | Owner-approved direction and RS-4/RS-5 completion state match merged [PR #1515](https://github.com/45s/coinzilla/pull/1515); referenced source paths exist. Last verified 2026-11-20. |
| `apps/harvester/docs/audits/sessions/AUDIT_SESSION_2026-11-19_02-16-31Z.md` | **HISTORICAL — preserve unchanged** | Timestamped audit-session evidence; no current behavior authority is assigned to it. |
| `apps/harvester/docs/infrastructure/execution-routing.md` | **KEEP — current infrastructure contract** | Routing/account-isolation boundary matches merged [PR #1455](https://github.com/45s/coinzilla/pull/1455), source and targeted tests; Binance remains the only registered Harvester execution provider. |
| `apps/harvester/docs/operations/trading-history-backups.md` | **KEEP — current operational runbook** | Commands, environment selection, online/WAL-safe backup, restore-check, manifest, retention and permissions match merged [PR #1567](https://github.com/45s/coinzilla/pull/1567), implementation and exact-head CI. No exchange operation is involved. |
| `apps/harvester/docs/persistence/trading-history-roadmap.md` | **KEEP — current persistence roadmap** | Phases 1–3 match merged [PR #1555](https://github.com/45s/coinzilla/pull/1555), [#1557](https://github.com/45s/coinzilla/pull/1557) and [#1559](https://github.com/45s/coinzilla/pull/1559); Phase 6 correctly marks only the backup slice complete in [#1567](https://github.com/45s/coinzilla/pull/1567). |
| `docs/architecture/decisions/ADR-0004-complete-bitunix-provider-integration.md` | **SUPERSEDED — preserve decision history** | Its own status metadata marks it superseded; PR #1455 removed the interim observer-only runtime. Do not treat it as current admission authorization. |
| `docs/architecture/decisions/ADR-0005-generic-user-data-observation-channel.md` | **KEEP — accepted delivery contract** | Native event delivery and non-authoritative polling are distinct in current Brokers Application session and Bitunix polling source/tests; does not relax #1185. |
| `docs/engineering/AI_TASK_COMPLIANCE_STANDARD.md` | **KEEP — canonical mandatory policy** | Cross-linked by root agent instructions, AI workflow, task workflows, engineering index and PR template; used as the S-10 implementation preflight. |
| `docs/engineering/APPLICATION_HANDLER_TEMPLATE.md` | **KEEP — optional reusable template** | Its DB provider-neutral composition example and source/test paths exist; it is guidance, not a required abstraction. |
| `docs/engineering/CONFIGURATION_STANDARD.md` | **KEEP — canonical configuration policy** | Matches Harvester's named `appConfig`, bootstrap resolver, explicit `TRADING_MODE` and colocated validation tests; no speculative environment scanner is claimed. |
| `docs/engineering/DOMAIN_POLICY_TEMPLATE.md` | **KEEP — optional reusable template** | Source-backed domain-policy/decision-matrix example; no runtime behavior is asserted by the template. |
| `docs/engineering/ENGINEERING_STANDARDS_MATRIX.md` | **KEEP — governance inventory** | S-9 merged state and S-10 current checkpoint corrected; current tree/classifier counts recorded. |
| `docs/engineering/INFRASTRUCTURE_ADAPTER_TEMPLATE.md` | **KEEP — optional reusable template** | DB provider-port, SQLite adapter and conformance-test examples exist in the current tree. |
| `docs/engineering/LOGGING_OBSERVABILITY_STANDARD.md` | **KEEP — canonical logging policy** | Shared Logger implementation and tests exist at `packages/utils/src/logger.js` and colocated test files; policy remains transport- and application-neutral. |
| `docs/engineering/PURE_MODULE_TEMPLATE.md` | **KEEP — optional reusable template** | Source-backed pure-module/direct-test example; no generator or new dependency is introduced. |
| `docs/engineering/STATEFUL_LIFECYCLE_TEMPLATE.md` | **KEEP — optional reusable template** | DB lifecycle aggregate and transition-test example paths exist; template remains optional. |
| `packages/brokers/BROKER_API.md` | **KEEP — canonical public Broker contract** | Structural method catalog and mutation outcomes match `src/broker/broker-contract.js`, its contract tests, and Binance/Bitunix implementations. |
| `packages/brokers/docs/BITUNIX_REFERENCE_AUDIT.md` | **KEEP — current external/source audit** | Current Brokers index and cross-repository Broker contract link to this relocated path; section numbering corrected. It remains evidence, not official specification or production-readiness approval. |
| `packages/brokers/docs/BITUNIX_SPOT_POLLING.md` | **KEEP — current private read-only contract** | Source path corrected to `src/infrastructure/bitunix/spot/reconciler.js`; implementation/tests and merged [PR #1516](https://github.com/45s/coinzilla/pull/1516) verify failure recovery. Polling remains non-authoritative and cannot synthesize fills. |
| `packages/brokers/docs/BITUNIX_WORKFLOW.md` | **KEEP — mandatory operator/developer workflow** | One CLI entry point and package command match merged [PR #1616](https://github.com/45s/coinzilla/pull/1616); exact-head required and advisory workflows passed. Default/local modes are read-only; the LIVE mode is human-only and was not invoked. |
| `packages/brokers/docs/README.md` | **KEEP — current package documentation index** | Links to the current Bitunix audit, polling contract, workflow, readiness matrix, roadmap and package-wide references. |
| `packages/brokers/docs/ROADMAP.md` | **KEEP — current Bitunix subdomain roadmap** | Current implementation status and issue/PR references are reconciled against merged #1516/#1616; #1185 remains the production-readiness blocker. |
| `packages/brokers/docs/bitunix-production-readiness-gap-matrix.md` | **KEEP — current evidence/gap matrix** | Distinguishes implemented offline behavior from unverified exchange guarantees; polling recovery does not satisfy authoritative event/fill or Harvester readiness requirements. |

### Removed paths since the 160-file checkpoint

These paths are absent from the current recursive tree. Their inbound-reference and Git-history dispositions remain part of #1403; absence alone is not proof that they were safely superseded or that references were updated.

- `apps/harvester/docs/infrastructure/bitunix-read-only-observer.md` — **RETIRED** with the interim observer runtime/configuration/adapter in merged [PR #1455](https://github.com/45s/coinzilla/pull/1455); Bitunix remains unregistered until #1185 and the complete-provider gate in ADR-0004. Current Harvester infrastructure indexes point to the general execution-routing contract, not a replacement observer surface.
- `packages/brokers/BITUNIX_REFERENCE_AUDIT.md` — **MOVED** to `packages/brokers/docs/BITUNIX_REFERENCE_AUDIT.md`; the current Brokers docs index and `docs/brokers-websocket-contract.md` link to the new location. The old path remains here only as historical inventory provenance.
- `packages/market-simulator/AGENTS.md` — **RETIRED** with the unused Market Simulator workspace package in merged [PR #1482](https://github.com/45s/coinzilla/pull/1482). PR #1482 removed the package and cleaned active workspace documentation, ownership maps, roadmaps and CI matrices; no successor package/document is maintained. Earlier PR #900/#911 inventory rows remain historical provenance.
- `packages/market-simulator/README.md` — **RETIRED** with the unused Market Simulator workspace package in merged [PR #1482](https://github.com/45s/coinzilla/pull/1482). PR #1482 removed the package and cleaned active workspace documentation, ownership maps, roadmaps and CI matrices; no successor package/document is maintained. Earlier PR #900/#911 inventory rows remain historical provenance.
- `packages/market-simulator/ROADMAP.md` — **RETIRED** with the unused Market Simulator workspace package in merged [PR #1482](https://github.com/45s/coinzilla/pull/1482). PR #1482 removed the package and cleaned active workspace documentation, ownership maps, roadmaps and CI matrices; no successor package/document is maintained. Earlier PR #900/#911 inventory rows remain historical provenance.

### Audit boundary

- The current path count and Harvester/non-Harvester split are verified against the complete recursive Git tree at the exact commit above.
- The prior 160-path checkpoint and its historical evidence remain unchanged.
- This checkpoint records path additions/removals only. It does **not** mark the 179 documents as factually verified. #1401 owns the complete maintained-document source audit; #1403 owns reference tracing and migration decisions.
- Historical session/audit/evidence records remain preserved. No historical conclusion or timestamp was rewritten.


### Current maintained/historical classification — develop `0f827ba7551be61a1be58f8dced191fb0a090870`

The complete recursive tree contains 179 Markdown/MDX files. Applying the current `scripts/markdown-path-policy.js` classification yields **150 maintained paths and 29 historical paths**. This supersedes the prior 160-file / 132-maintained / 28-historical checkpoint for current counts only; all older checkpoint rows remain historical evidence. The classification is a path policy, not a claim that every maintained document has passed factual source review.


### Current maintained/historical classification — develop `0f827ba7551be61a1be58f8dced191fb0a090870`

The complete recursive tree contains 179 Markdown/MDX files. Applying the current `scripts/markdown-path-policy.js` classification yields **150 maintained paths and 29 historical paths**. This supersedes the prior 160-file / 132-maintained / 28-historical checkpoint for current counts only; all older checkpoint rows remain historical evidence. The classification is a path policy, not a claim that every maintained document has passed factual source review.
