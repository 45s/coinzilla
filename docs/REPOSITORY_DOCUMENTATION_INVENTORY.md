# Repository documentation inventory

- Status: Initial recursive inventory complete; all 6 initial REVIEW candidates have evidence-based dispositions; current package/app entry-point audit is complete; source-level review of maintained content and deferred governance work remain in progress
- Type: Repository documentation inventory
- Owner: Repository engineering
- Baseline: `develop` at `cea27e580f9f9bf3d7fa109b9e6353f68aef9ff2`
- Date: 2026-11-09 (baseline); latest verification: 2026-11-10
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
| `apps/harvester/docs/operations/README.md` | Local index for Harvester operating procedures; surfaces the current ZROFDUSD-only config versus historical runbook scope mismatch, CLOSED / PAUSED status, and legacy ZROUSDT market-sell/account-wide-cancel write boundaries and the interactive menu wrapper, its audit links, and the no-confirmation account-wide cancel boundary. |
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

At the current source-verified develop checkpoint `bbd80b93cc0b8ab09172119c0d2d87617257a159` (after merged PR #1003), the repository contains **119 tracked Markdown/MDX files**: 97 frozen baseline files plus 22 additions, zero net file removals. The complete recursive tree is not truncated: 59 files are under Harvester and 60 are elsewhere. The 113-to-114 increase was `apps/harvester/docs/domain/DOMAIN_TEST_INVENTORY.md` in PR #917; PR #951 added three audit-category indexes and relocated nine existing evidence files without deleting their contents. The 118-file increase since the 117-file PR #968 checkpoint is the 2026-11-10 restart-recovery audit report; PR #1003 adds the recovery ADR. `docs/MARKDOWN_STYLE.md` remains in the outside-Harvester inventory. Earlier 110-, 112-, 113-, 114-, 117- and 118-file counts remain valid historical snapshots.

## Pending documentation additions — PR #1013

The open [PR #1013](https://github.com/45s/coinzilla/pull/1013) adds four maintained documents: three for the proposed Indicators domain and one for Harvester volatility protection. None are part of the current develop inventory until the PR is merged.

| Proposed path | Purpose |
| --- | --- |
| packages/indicators/README.md | Defines the proposed package purpose, ownership boundary, exchange-neutral inputs and non-goals. |
| packages/indicators/AGENTS.md | Defines proposal-only domain scope and implementation constraints for the future package. |
| packages/indicators/ROADMAP.md | Tracks the staged proposal and implementation gates; no package implementation is claimed. |
| apps/harvester/docs/volatility-protection.md | Accepted per-market high-volatility safety design, candle-data contract, recovery-SELL exception and implementation/test plan for issue #1016. |

If merged, these four additions will increase the current 119-file Markdown/MDX inventory to 123 (60 Harvester files and 63 elsewhere). Update the recursive-tree checkpoint with the actual merge commit during PR closeout; do not pre-record an unverified tree SHA.

## Source-verified content reviews (post-baseline)

The original 97-file inventory table above is a frozen baseline: its recorded byte sizes and first-pass dispositions are not current file metadata. Source-review findings and later document changes are recorded separately here rather than rewriting baseline rows.

| Document(s) | Source-verified review | Delivery |
| --- | --- | --- |
| `apps/harvester/docs/audits/README.md`; `reports/`, `sessions/`, and `evidence/` archive indexes; Harvester entry points and inventory | Moved nine historical records out of the application root, preserved their contents/provenance, repaired internal links, and retained only README/AGENTS/ROADMAP at the Harvester root. Exact-head required checks and advisory external documentation links passed. | [PR #951](https://github.com/45s/coinzilla/pull/951) |
| `packages/notifiers/AGENTS.md`; `packages/notifiers/README.md` | Verified the formatter's caller-owned free-form `message`/`reason` boundary, EventBus error-reporter fallback, delivery-queue recovery and smoke-test confirmation output against source and tests. | [PR #873](https://github.com/45s/coinzilla/pull/873) |
| `packages/utils/README.md` | Verified the exported per-key serialized queue and non-null/non-array object assertion against implementation, tests, public exports and consumers; the Validator configuration limitation remains tracked in #892. | [PR #876](https://github.com/45s/coinzilla/pull/876) |
| `apps/harvester/docs/TRADING_FIRST.md` | Verified current WebSocket API/Streams and CLOSING-audit transport terminology against the broker adapter, source-verified Architecture and Journal Operations; dated November 4 incident terminology remains historical and unchanged. | [PR #883](https://github.com/45s/coinzilla/pull/883) |
| `apps/harvester/docs/domain/DOMAIN_TEST_INVENTORY.md` | Added the source-driven behavior-to-test inventory and maintained its evidence through the Portfolio/RecoveryLedger commission-conflict and Conservative investment-cap regression additions. | [PR #917](https://github.com/45s/coinzilla/pull/917), [PR #921](https://github.com/45s/coinzilla/pull/921), [PR #922](https://github.com/45s/coinzilla/pull/922) |
| `apps/harvester/docs/JOURNAL_EVIDENCE_CONTRACT.md`; Harvester Journal architecture/domain/operations indexes | Reconciled the Harvester consumer contract with Journal JSONL serialization: persisted payloads must be JSON-safe, while the broader EventBus payload type is not a promise of durable representability. Updated navigation and roadmap evidence without changing runtime behavior. | [PR #895](https://github.com/45s/coinzilla/pull/895) |
| `packages/brokers/ARCHITECTURE.md`; `packages/brokers/README.md`; `packages/brokers/ROADMAP.md` | Reconciled architecture completion claims with current implementation and tests; retained the target-architecture versus current-source boundary and corrected the active roadmap status. | [PR #896](https://github.com/45s/coinzilla/pull/896) |
| `packages/db/AGENTS.md`; `packages/db/README.md` | Corrected public API guidance to match factory-based runtime exports and clarified that `DatabaseProvider` is a JSDoc-only port rather than a runtime export. | [PR #897](https://github.com/45s/coinzilla/pull/897) |
| `packages/journal/README.md`; `packages/journal/ROADMAP.md`; Journal record/serialization JSDoc | Documented JSONL serialization and durability limitations, the temporary JSON-safe consumer constraint, and the still-open Journal-owned defect in #889. | [PR #898](https://github.com/45s/coinzilla/pull/898) |
| `docs/MARKDOWN_STYLE.md`; `docs/DOCUMENTATION_GOVERNANCE.md`; `docs/ci-workflows.md`; external-link checker and tests | Added a dependency-free external-link checker, retry/rate-limit/redirect handling, conservative classifications, query-credential rejection/redaction, and DNS-pinned HTTP(S) transport with redirect revalidation. The suite now has 31 deterministic DNS-injected tests; External Documentation Links is active as a non-required advisory workflow, #901 is resolved, and required CI remains network-free. | [PR #899](https://github.com/45s/coinzilla/pull/899), [PR #902](https://github.com/45s/coinzilla/pull/902), [PR #903](https://github.com/45s/coinzilla/pull/903), [PR #908](https://github.com/45s/coinzilla/pull/908) |
| `packages/market-simulator/README.md` | Corrected both broker examples to provide caller-owned market history and documented the optional custom repository injection and precedence. | [PR #900](https://github.com/45s/coinzilla/pull/900) |
| `docs/REPOSITORY_DOCUMENTATION_INVENTORY.md`; `ROADMAP.md` | Synchronized the frozen 97-file baseline, post-baseline additions, 113-file recursive checkpoint, source-review evidence and remaining-work status after the latest audit. | [PR #904](https://github.com/45s/coinzilla/pull/904) |
| `apps/harvester/ROADMAP.md`; `apps/harvester/docs/JOURNAL_OPERATIONS.md`; Harvester entrypoint/tests | Verified PR #906's same-process Journal flush-failure classification and conservative process-ownership lock retention; this does not claim process-restart recovery. | [PR #906](https://github.com/45s/coinzilla/pull/906) |
| `apps/harvester/docs/architecture.md`; recovery handler and tests | Verified same-process generation fencing: stale asynchronous recovery-stage failures retain their original error/generation context and cannot mutate a replacement generation or terminal accounting latch. This does not implement process-restart reconciliation; #654 remains open. | [PR #909](https://github.com/45s/coinzilla/pull/909) |
| `apps/harvester/docs/audits/reports/2026-11-10_18-44-49_restart-recovery-audit.md` | Preserved the source-based restart-recovery findings and implementation gates at their stated develop baseline; no runtime changes or exchange operations. | Develop checkpoint `515324a6b1cb872b99593bdf448d1914b005bfcb` |
| `apps/harvester/docs/architecture/decisions/0001-application-owned-recovery-facts.md`; Harvester/root roadmaps; Journal and CI workflow docs; `.github/workflows/unit-tests.yml` | Froze the target process-restart recovery contract: a separate application-owned append-only fact stream with a committed-head integrity manifest, explicit durability acknowledgement, Journal observer separation, derived accounting projections, and a closed startup reconciliation gate. Also removed the unconditional PR-only TESTNET endpoint probe so package-test workflows remain offline; manual TESTNET integration stays opt-in. No runtime recovery behavior changed. | PR #1003 |
| `apps/harvester/README.md`; `apps/harvester/docs/architecture.md`; `apps/harvester/docs/architecture/BROKER_HARVESTER_TRADING_FLOW.md`; `apps/harvester/docs/error-vocabulary.md` | Corrected Journal flush scope, verification-only final reconciliation, market-metadata cache ownership/scope, and per-session Journal lock recovery paths against source and tests. | [PR #910](https://github.com/45s/coinzilla/pull/910) |
| `packages/brokers/AGENTS.md`; `packages/journal/AGENTS.md`; `packages/utils/AGENTS.md`; `packages/market-simulator/AGENTS.md` | Aligned local AI-agent required checks with package coverage scripts and actual thresholds; explicitly records that Market Simulator currently enforces no coverage percentage. | [PR #911](https://github.com/45s/coinzilla/pull/911) |
| `README.md`; `ROADMAP.md`; `docs/README.md`; `docs/ci-workflows.md`; inventory | Reconciled the root navigation, 113-file checkpoint, and live `core`/`develop-core` ruleset evidence while preserving the frozen 97-file baseline. | [PR #912](https://github.com/45s/coinzilla/pull/912) |
| `ROADMAP.md`; `apps/harvester/ROADMAP.md` | Reconciled recovery roadmap closeout and kept process-restart reconciliation explicitly open under #654. | [PR #914](https://github.com/45s/coinzilla/pull/914) |
| `docs/MARKDOWN_STYLE.md`; Markdown baseline/checker scripts and tests | Added six report-only list/table metrics, objective conventions, and positive/negative/fenced-code/historical test coverage; changed-file enforcement remains unchanged. The 113-file baseline reports 41 files / 156 list-spacing findings and one table-column mismatch. | [PR #915](https://github.com/45s/coinzilla/pull/915) |
| `packages/brokers/ROADMAP.md`; `ROADMAP.md`; inventory | Corrected the Brokers roadmap table-column mismatch and synchronized the 113-file recursive checkpoint, inventory, and root roadmap without adding or removing Markdown/MDX paths. | [PR #916](https://github.com/45s/coinzilla/pull/916) |
| `packages/utils/src/validation.js`; `packages/utils/src/validator.js`; `packages/utils/README.md`; `packages/utils/ROADMAP.md`; root `README.md`/`ROADMAP.md`; `.github/workflows/utils-unit-tests.yml` | Source-verified and hardened the public Validator rule/mode contract; corrected required test discovery; 198/198 Utils tests passed with 98.53% line and 96.33% branch coverage. | [PR #918](https://github.com/45s/coinzilla/pull/918) |
| `packages/brokers/README.md`; `packages/brokers/ROADMAP.md` | Verified canonical order placement explicitly requests Binance `RESULT` rather than relying on the minimal default `ACK` for `LIMIT_MAKER`; the compatibility `createOrder()` contract is unchanged and uncertain placement is not retried. | [PR #961](https://github.com/45s/coinzilla/pull/961) |
| `apps/harvester/docs/JOURNAL_OPERATIONS.md`; `apps/harvester/docs/TRADING_FIRST.md`; Harvester/root roadmaps | Verified authoritative `NEW` user-data identity recovery (`UNKNOWN → OPEN`), duplicate/conflicting identity handling, shutdown cancellation boundaries, and propagation of validated `TRADING_MODE` into startup status against source/tests. | [PR #964](https://github.com/45s/coinzilla/pull/964) |
| `apps/harvester/docs/README.md`; `docs/README.md`; `docs/REPOSITORY_DOCUMENTATION_INVENTORY.md`; `packages/brokers/ROADMAP.md`; `ROADMAP.md` | Removed duplicate Harvester archive navigation, reconciled the 117-file count/checkpoints, and closed the stale Brokers `RESULT` acknowledgement roadmap item against merged PR #961 and issue #960. | [PR #967](https://github.com/45s/coinzilla/pull/967) |
| `apps/harvester/ROADMAP.md`; `apps/harvester/docs/domain/ACCOUNTING_INVARIANTS.md`; `DOMAIN_TEST_INVENTORY.md`; `portfolio.md` | Recorded the merged snapshot-relative account balance/commitment baseline, its eight scenario families, fail-closed invalid-order handling, and exact-head offline verification. | [PR #968](https://github.com/45s/coinzilla/pull/968) |

## Disposition vocabulary

- **KEEP** — preserve at the current path; maintain authority boundaries and index links.
- **REVIEW** — investigate content, status and references before deciding whether to keep, merge, split, supersede or archive.
- No deletion or bulk move is authorized by this inventory.

## File-by-file inventory outside Harvester

| Path | Size (bytes) | Category | Current disposition | Rationale / next review |
| --- | ---: | --- | --- | --- |
| `.github/ISSUE_TEMPLATE/cross-domain-request.md` | 816 | GitHub workflow/template | **KEEP** | KEEP pending normal source-of-truth and reference review; no move/archive is proposed by this inventory. |
| `.github/PULL_REQUEST_TEMPLATE.md` | 2773 | GitHub workflow/template | **KEEP** | KEEP pending normal source-of-truth and reference review; no move/archive is proposed by this inventory. |
| `.github/copilot-instructions.md` | 265 | GitHub workflow/template | **KEEP** | KEEP pending normal source-of-truth and reference review; no move/archive is proposed by this inventory. |
| `AGENTS.md` | 10703 | Repository governance | **KEEP** | Mandatory contributor/AI-agent instructions; local rules supplement central policy. |
| `AI_AGENT_WORKFLOW.md` | 22580 | Repository governance | **KEEP** | KEEP pending normal source-of-truth and reference review; no move/archive is proposed by this inventory. |
| `ENGINEERING_STANDARDS.md` | 29505 | Repository governance | **KEEP** | KEEP pending normal source-of-truth and reference review; no move/archive is proposed by this inventory. |
| `README.md` | 4326 | Repository entry point | **KEEP** | Source-checked against the Brokers package manifest and README; removes obsolete Binance SDK/`test:sdk` instructions, documents native-WebSocket integration scripts and safety gates, and points to the active `core`/`develop-core` six-context rulesets. |
| `ROADMAP.md` | 8232 | Repository roadmap | **KEEP** | Current work/status authority for the owning scope; reconcile status against GitHub issues/PRs. |
| `docs/DOCUMENTATION_GOVERNANCE.md` | 16440 | Operational/reference guide | **KEEP** | Canonical repository-wide documentation policy; source review corrected the Section 11 freshness-sweep reference, records deterministic Markdown checks, and now documents the DNS-pinned external-link policy and active non-required advisory workflow after #901 was resolved. |
| `docs/README.md` | 2223 | Operational/reference guide | **KEEP** | Repository-wide documentation entry point. |
| `docs/ai-agent/repository-engineering-audit.md` | 15755 | Historical task brief | **KEEP** | Historical audit task brief; separate from the actual audit report in docs/audits/ and not current agent policy. |
| `docs/architecture/README.md` | 1595 | Architecture/ADR | **KEEP** | Scope entry point and setup/public contract guide. |
| `docs/architecture/decisions/ADR-0001-clean-hexagonal-architecture.md` | 5629 | Architecture/ADR | **KEEP** | Cross-reference audit found a reference to nonexistent ADR-0002; the application-specific architecture reference now points to the existing Harvester architecture guide. |
| `docs/architecture/decisions/ADR_TEMPLATE.md` | 631 | Architecture/ADR | **KEEP** | KEEP pending normal source-of-truth and reference review; no move/archive is proposed by this inventory. |
| `docs/audits/README.md` | 649 | Historical audit | **KEEP** | Scope entry point and setup/public contract guide. |
| `docs/audits/repository-engineering-audit.md` | 16323 | Historical audit | **KEEP** | Historical repository assessment; preserve baseline, date and limitations. |
| `docs/brokers-websocket-contract.md` | 30152 | Operational/reference guide | **KEEP** | KEEP pending normal source-of-truth and reference review; no move/archive is proposed by this inventory. |
| `docs/ci-workflows.md` | 3292 | Operational/reference guide | **KEEP** | Source-checked against root `package.json` and `.github/workflows/`; documents the six required contexts on both active rulesets, the 31-test DNS-pinned external-link checker, and the non-required network advisory workflow. |
| `docs/contributing.md` | 2622 | Operational/reference guide | **KEEP** | Source-checked against root/package manifests and workflows; removes a nonexistent Brokers `test:sdk` command and lists the three scripts actually defined by `packages/brokers/package.json`. |
| `docs/dependency-audit-playbook.md` | 2931 | Operational/reference guide | **KEEP** | KEEP pending normal source-of-truth and reference review; no move/archive is proposed by this inventory. |
| `docs/engineering/BRANCH_AND_RELEASE_POLICY.md` | 349 | Engineering policy | **KEEP** | KEEP pending normal source-of-truth and reference review; no move/archive is proposed by this inventory. |
| `docs/engineering/CROSS_DOMAIN_REQUESTS.md` | 2462 | Engineering policy | **KEEP** | KEEP pending normal source-of-truth and reference review; no move/archive is proposed by this inventory. |
| `docs/engineering/DEFINITION_OF_DONE.md` | 554 | Engineering policy | **KEEP** | KEEP pending normal source-of-truth and reference review; no move/archive is proposed by this inventory. |
| `docs/engineering/DOMAIN_OWNERSHIP.md` | 2648 | Engineering policy | **KEEP** | KEEP pending normal source-of-truth and reference review; no move/archive is proposed by this inventory. |
| `docs/engineering/JAVASCRIPT_JSDOC_STANDARD.md` | 6385 | Engineering policy | **KEEP** | KEEP pending normal source-of-truth and reference review; no move/archive is proposed by this inventory. |
| `docs/engineering/MODULARITY_STANDARD.md` | 2727 | Engineering policy | **KEEP** | KEEP pending normal source-of-truth and reference review; no move/archive is proposed by this inventory. |
| `docs/engineering/README.md` | 852 | Engineering policy | **KEEP** | Scope entry point and setup/public contract guide. |
| `docs/engineering/SHARED_UTILITIES_POLICY.md` | 17500 | Engineering policy | **KEEP** | Source review corrected stale helper paths: Brokers now lives under `src/infrastructure/binance`, Market Simulator under `packages/market-simulator`, and the removed Coin Farmer app is explicitly historical rather than a current helper candidate. |
| `docs/engineering/TASK_WORKFLOWS.md` | 3268 | Engineering policy | **KEEP** | KEEP pending normal source-of-truth and reference review; no move/archive is proposed by this inventory. |
| `docs/MARKDOWN_STYLE.md` | 13921 | Markdown style standard | **KEEP** | Canonical maintained-document authoring standard; documents changed-file enforcement, report-only full-tree metrics, tested exclusions and the historical migration boundary. |
| `docs/release-and-rollback.md` | 2504 | Operational/reference guide | **KEEP** | KEEP pending normal source-of-truth and reference review; no move/archive is proposed by this inventory. |
| `docs/workspace-package-map.md` | 4790 | Operational/reference guide | **KEEP** | KEEP pending normal source-of-truth and reference review; no move/archive is proposed by this inventory. |
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
| `packages/market-simulator/AGENTS.md` | 1953 | Package agent instructions | **KEEP** | Mandatory contributor/AI-agent instructions; PR #911 names the `test` and `test:coverage` commands and states that no percentage threshold is currently enforced. |
| `packages/market-simulator/README.md` | 13568 | Package entry point | **KEEP** | Clarifies Node 22.23.4 package floor versus Node 24+ workspace/CI; records source-verified lifecycle/snapshot/shutdown limits; PR #900 adds caller-owned history examples and documents custom repository injection. |
| `packages/market-simulator/ROADMAP.md` | 8682 | Package roadmap | **KEEP** | Current work/status authority for the owning scope; reconcile status against GitHub issues/PRs. |
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
11. `docs/engineering/SHARED_UTILITIES_POLICY.md` retained pre-migration paths for Brokers and Market Simulator and described the removed Coin Farmer application as a current consumer. The ownership inventory now uses current `develop` paths and explicitly labels the removed application's reference as historical.

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
