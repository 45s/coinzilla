# Repository documentation inventory

- Status: Initial recursive inventory complete; all 6 initial REVIEW candidates now have evidence-based dispositions; content-level review of KEEP documents remains in progress
- Type: Repository documentation inventory
- Owner: Repository engineering
- Baseline: `develop` at `cea27e580f9f9bf3d7fa109b9e6353f68aef9ff2`
- Date: 2026-11-09
- Tracking: [#795](https://github.com/45s/coinzilla/issues/795)
- Policy: [Documentation Governance](DOCUMENTATION_GOVERNANCE.md)
- Harvester detail: [Harvester documentation inventory](../apps/harvester/docs/plans/HARVESTER_DOCUMENTATION_INVENTORY.md)

## Scope and method

A complete recursive Git tree was retrieved for the baseline commit (`truncated: false`). It contains **97 tracked Markdown files**:

- 42 under `apps/harvester/` — individually listed with initial dispositions in the Harvester inventory.
- 55 elsewhere — listed below (repository root policy/entry files, `docs/`, `.github/` and package documentation).

The table records path, byte size, category and a conservative first-pass disposition. It is not a claim that every statement in every file has been revalidated against source code. All KEEP files remain at their current paths; REVIEW files must not be moved or rewritten until content and inbound references are checked.

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
| `README.md` | 4326 | Repository entry point | **KEEP** | Source-checked against the Brokers package manifest and README; removes obsolete Binance SDK/`test:sdk` instructions and documents the current native-WebSocket integration scripts and safety gates. |
| `ROADMAP.md` | 8232 | Repository roadmap | **KEEP** | Current work/status authority for the owning scope; reconcile status against GitHub issues/PRs. |
| `docs/DOCUMENTATION_GOVERNANCE.md` | 16440 | Operational/reference guide | **KEEP** | Canonical repository-wide documentation policy; source review corrected a freshness-sweep cross-reference that incorrectly pointed to Section 9 (roadmap discipline) instead of the explicit requirement below in Section 11. |
| `docs/README.md` | 2223 | Operational/reference guide | **KEEP** | Repository-wide documentation entry point. |
| `docs/ai-agent/repository-engineering-audit.md` | 15755 | Historical task brief | **KEEP** | Historical audit task brief; separate from the actual audit report in docs/audits/ and not current agent policy. |
| `docs/architecture/README.md` | 1595 | Architecture/ADR | **KEEP** | Scope entry point and setup/public contract guide. |
| `docs/architecture/decisions/ADR-0001-clean-hexagonal-architecture.md` | 5629 | Architecture/ADR | **KEEP** | Cross-reference audit found a reference to nonexistent ADR-0002; the application-specific architecture reference now points to the existing Harvester architecture guide. |
| `docs/architecture/decisions/ADR_TEMPLATE.md` | 631 | Architecture/ADR | **KEEP** | KEEP pending normal source-of-truth and reference review; no move/archive is proposed by this inventory. |
| `docs/audits/README.md` | 649 | Historical audit | **KEEP** | Scope entry point and setup/public contract guide. |
| `docs/audits/repository-engineering-audit.md` | 16323 | Historical audit | **KEEP** | Historical repository assessment; preserve baseline, date and limitations. |
| `docs/brokers-websocket-contract.md` | 30152 | Operational/reference guide | **KEEP** | KEEP pending normal source-of-truth and reference review; no move/archive is proposed by this inventory. |
| `docs/ci-workflows.md` | 3292 | Operational/reference guide | **KEEP** | Source-checked against root `package.json` and `.github/workflows/`; PR #816 corrects the JavaScript Syntax workflow's actual steps and missing `develop` push trigger. |
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
| `docs/release-and-rollback.md` | 2504 | Operational/reference guide | **KEEP** | KEEP pending normal source-of-truth and reference review; no move/archive is proposed by this inventory. |
| `docs/workspace-package-map.md` | 4790 | Operational/reference guide | **KEEP** | KEEP pending normal source-of-truth and reference review; no move/archive is proposed by this inventory. |
| `packages/brokers/AGENTS.md` | 8605 | Package agent instructions | **KEEP** | Mandatory contributor/AI-agent instructions; local rules supplement central policy. |
| `packages/brokers/ARCHITECTURE.md` | 35221 | Package architecture | **KEEP** | Explicitly labels itself as target architecture/migration contract, distinguishes its dated implementation snapshot from current source, and documents verified consumer boundaries and enforced dependency direction. Linked by the package README and roadmap; no move/split is warranted. |
| `packages/brokers/README.md` | 19671 | Package entry point | **KEEP** | Scope entry point and setup/public contract guide. |
| `packages/brokers/ROADMAP.md` | 109813 | Package roadmap | **KEEP** | Active priority execution plan and Section 2 current status are authoritative; later phases and dated investigation notes are explicitly historical evidence. The 2026-11-08 #702 note records the pre-approval state, while the current section records the accepted contract and merged PRs #732/#735/#740. The package AGENTS/README designate this detailed roadmap as the primary work entry point; keep its current/history boundary and do not rewrite dated notes. |
| `packages/db/AGENTS.md` | 2897 | Package agent instructions | **KEEP** | Mandatory contributor/AI-agent instructions; local rules supplement central policy. |
| `packages/db/README.md` | 5933 | Package entry point | **KEEP** | Source-checked against package exports and runtime constraints; PR corrects the unmatched closing Markdown fence in the Development section. |
| `packages/db/ROADMAP.md` | 7652 | Package roadmap | **KEEP** | Current work/status authority for the owning scope; reconcile status against GitHub issues/PRs. |
| `packages/entities/AGENTS.md` | 2139 | Package agent instructions | **KEEP** | Mandatory contributor/AI-agent instructions; local rules supplement central policy. |
| `packages/entities/ROADMAP.md` | 14256 | Package roadmap | **KEEP** | Current work/status authority for the owning scope; reconcile status against GitHub issues/PRs. |
| `packages/event-bus/AGENTS.md` | 2072 | Package agent instructions | **KEEP** | Mandatory contributor/AI-agent instructions; local rules supplement central policy. |
| `packages/event-bus/README.md` | 6406 | Package entry point | **KEEP** | Scope entry point and setup/public contract guide. |
| `packages/event-bus/ROADMAP.md` | 25883 | Package roadmap | **KEEP** | Current work/status authority for the owning scope; reconcile status against GitHub issues/PRs. |
| `packages/journal/AGENTS.md` | 1668 | Package agent instructions | **KEEP** | Mandatory contributor/AI-agent instructions; local rules supplement central policy. |
| `packages/journal/README.md` | 19624 | Package entry point | **KEEP** | Scope entry point and setup/public contract guide. |
| `packages/journal/ROADMAP.md` | 39476 | Package roadmap | **KEEP** | Current work/status authority for the owning scope; reconcile status against GitHub issues/PRs. |
| `packages/market-simulator/AGENTS.md` | 1953 | Package agent instructions | **KEEP** | Mandatory contributor/AI-agent instructions; local rules supplement central policy. |
| `packages/market-simulator/README.md` | 13568 | Package entry point | **KEEP** | Scope entry point and setup/public contract guide. |
| `packages/market-simulator/ROADMAP.md` | 8682 | Package roadmap | **KEEP** | Current work/status authority for the owning scope; reconcile status against GitHub issues/PRs. |
| `packages/notifiers/AGENTS.md` | 4694 | Package agent instructions | **KEEP** | Mandatory contributor/AI-agent instructions; local rules supplement central policy. |
| `packages/notifiers/README.md` | 12254 | Package entry point | **KEEP** | Scope entry point and setup/public contract guide. |
| `packages/notifiers/ROADMAP.md` | 15672 | Package roadmap | **KEEP** | Current work/status authority for the owning scope; reconcile status against GitHub issues/PRs. |
| `packages/utils/AGENTS.md` | 2271 | Package agent instructions | **KEEP** | Mandatory contributor/AI-agent instructions; local rules supplement central policy. |
| `packages/utils/README.md` | 19711 | Package entry point | **KEEP** | Scope entry point and setup/public contract guide. |
| `packages/utils/ROADMAP.md` | 11241 | Package roadmap | **KEEP** | Current work/status authority for the owning scope; reconcile status against GitHub issues/PRs. |

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
- [ ] Continue source/behavior/reference review of KEEP documents; KEEP is a preservation disposition, not proof that every statement has been revalidated.
- [x] Review `packages/brokers/ARCHITECTURE.md`: KEEP at its current path; it is an explicit target architecture and migration contract.
- [x] Review `packages/brokers/ROADMAP.md`: KEEP at its current path; the current priority/status sections are authoritative and historical phases/dated investigation notes are explicitly identified as evidence.
- [ ] Inspect all other package/app README, AGENTS and ROADMAP combinations for stale links, competing rules and status drift.
- [ ] Trace inbound references from Markdown, source comments, GitHub Issues/PRs and workflows before any migration.
- [ ] Add/verify local indexes wherever a substantial documentation subdirectory exists.
- [x] Verify policy/index checks are required by the live `develop-core` ruleset; the required `Check JavaScript syntax` context runs `check:agent-policy` and recursive Markdown link validation. See [Documentation Governance](DOCUMENTATION_GOVERNANCE.md) and PR #799.
- [ ] Evaluate Markdown linting and external-link checks with a baseline before adding new CI dependencies.
- [x] Record evidence-based dispositions and rationale for all six initial REVIEW entries; no initial Harvester or Brokers REVIEW candidates remain.
- [ ] Record any new REVIEW findings discovered during continued content-level review and update indexes after each approved migration.

