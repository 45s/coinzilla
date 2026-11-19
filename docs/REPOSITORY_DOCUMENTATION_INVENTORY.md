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

The previous source-verified develop checkpoint `b5fc236987833da4374258da876b412be3c48759` (after merged PR #1012) contained 124 tracked Markdown/MDX files: 61 under Harvester and 63 elsewhere. The complete recursive tree at `7590d332a307c7ef7bea37f0ba8721b399bd96e8` contained **147 tracked Markdown/MDX files**: 81 under Harvester and 66 elsewhere (97 frozen baseline files plus 50 additions, zero net removals). The subsequent checkpoint `0a51d6034a6ff6473d9a9005b74744fd048c9135`, after merged PR #1269, remained at 147 paths. The previous source-verified `develop` checkpoint `8843bd1e42dea7b47a7af5c464b921e54dd16c0d` contained **156 tracked Markdown/MDX files**: 85 under Harvester and 71 elsewhere. The checkpoint `81669ce2be6794b9bd03067f89b57f8fdb55f957` increased this to **157 tracked Markdown/MDX files**: 86 under Harvester and 71 elsewhere, by adding `apps/harvester/docs/domain/RECOVERY_SELLER_POLICY_BLOCKERS.md` with no removals. The checkpoint `ea6110fb39c1c86acfbf9673910965e7f698d511` remained at **157 tracked Markdown/MDX files**: 86 under Harvester and 71 elsewhere. The last complete recursive inventory checkpoint `007f631a3db04b1a2d1ca3d21bb9af65123bd014` contained **157 tracked Markdown/MDX files**: 86 under Harvester and 71 elsewhere. Complete recursive comparison at that checkpoint confirmed zero path changes since `ea6110f` (PR #1415 modified existing documents only). The `develop` tree after subsequent merges has not yet been fully recounted; the earlier nine additions since `0a51d60` remain part of the current tree: four under Harvester, two under `docs/`, one under Brokers, and two under DB. The PR #1267 ADR is merged and included in this current count. Earlier 110-, 112-, 113-, 114-, 117-, 118-, 119-, 124- and 147-file counts remain valid historical snapshots.

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
| `packages/brokers/BITUNIX_REFERENCE_AUDIT.md` | Source/reference audit for Bitunix Spot API capabilities and unresolved contract gaps. |
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

## Disposition vocabulary

- **KEEP** — preserve at the current path; maintain authority boundaries and index links.
- **REVIEW** — investigate content, status and references before deciding whether to keep, merge, split, supersede or archive.
- No deletion or bulk move is authorized by this inventory.

## File-by-file inventory outside Harvester

## Initial findings

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
