# Repository documentation inventory

- Status: Initial recursive inventory complete; one of two Brokers REVIEW candidates resolved as KEEP; the Brokers roadmap remains REVIEW
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
| `README.md` | 4326 | Repository entry point | **KEEP** | Scope entry point and setup/public contract guide. |
| `ROADMAP.md` | 8232 | Repository roadmap | **KEEP** | Current work/status authority for the owning scope; reconcile status against GitHub issues/PRs. |
| `docs/DOCUMENTATION_GOVERNANCE.md` | 16440 | Operational/reference guide | **KEEP** | Canonical repository-wide documentation policy. |
| `docs/README.md` | 2223 | Operational/reference guide | **KEEP** | Repository-wide documentation entry point. |
| `docs/ai-agent/repository-engineering-audit.md` | 15755 | Historical task brief | **KEEP** | Historical audit task brief; separate from the actual audit report in docs/audits/ and not current agent policy. |
| `docs/architecture/README.md` | 1595 | Architecture/ADR | **KEEP** | Scope entry point and setup/public contract guide. |
| `docs/architecture/decisions/ADR-0001-clean-hexagonal-architecture.md` | 5629 | Architecture/ADR | **KEEP** | KEEP pending normal source-of-truth and reference review; no move/archive is proposed by this inventory. |
| `docs/architecture/decisions/ADR_TEMPLATE.md` | 631 | Architecture/ADR | **KEEP** | KEEP pending normal source-of-truth and reference review; no move/archive is proposed by this inventory. |
| `docs/audits/README.md` | 649 | Historical audit | **KEEP** | Scope entry point and setup/public contract guide. |
| `docs/audits/repository-engineering-audit.md` | 16323 | Historical audit | **KEEP** | Historical repository assessment; preserve baseline, date and limitations. |
| `docs/brokers-websocket-contract.md` | 30152 | Operational/reference guide | **KEEP** | KEEP pending normal source-of-truth and reference review; no move/archive is proposed by this inventory. |
| `docs/ci-workflows.md` | 3292 | Operational/reference guide | **KEEP** | KEEP pending normal source-of-truth and reference review; no move/archive is proposed by this inventory. |
| `docs/contributing.md` | 2622 | Operational/reference guide | **KEEP** | KEEP pending normal source-of-truth and reference review; no move/archive is proposed by this inventory. |
| `docs/dependency-audit-playbook.md` | 2931 | Operational/reference guide | **KEEP** | KEEP pending normal source-of-truth and reference review; no move/archive is proposed by this inventory. |
| `docs/engineering/BRANCH_AND_RELEASE_POLICY.md` | 349 | Engineering policy | **KEEP** | KEEP pending normal source-of-truth and reference review; no move/archive is proposed by this inventory. |
| `docs/engineering/CROSS_DOMAIN_REQUESTS.md` | 2462 | Engineering policy | **KEEP** | KEEP pending normal source-of-truth and reference review; no move/archive is proposed by this inventory. |
| `docs/engineering/DEFINITION_OF_DONE.md` | 554 | Engineering policy | **KEEP** | KEEP pending normal source-of-truth and reference review; no move/archive is proposed by this inventory. |
| `docs/engineering/DOMAIN_OWNERSHIP.md` | 2648 | Engineering policy | **KEEP** | KEEP pending normal source-of-truth and reference review; no move/archive is proposed by this inventory. |
| `docs/engineering/JAVASCRIPT_JSDOC_STANDARD.md` | 6385 | Engineering policy | **KEEP** | KEEP pending normal source-of-truth and reference review; no move/archive is proposed by this inventory. |
| `docs/engineering/MODULARITY_STANDARD.md` | 2727 | Engineering policy | **KEEP** | KEEP pending normal source-of-truth and reference review; no move/archive is proposed by this inventory. |
| `docs/engineering/README.md` | 852 | Engineering policy | **KEEP** | Scope entry point and setup/public contract guide. |
| `docs/engineering/SHARED_UTILITIES_POLICY.md` | 17500 | Engineering policy | **KEEP** | KEEP pending normal source-of-truth and reference review; no move/archive is proposed by this inventory. |
| `docs/engineering/TASK_WORKFLOWS.md` | 3268 | Engineering policy | **KEEP** | KEEP pending normal source-of-truth and reference review; no move/archive is proposed by this inventory. |
| `docs/release-and-rollback.md` | 2504 | Operational/reference guide | **KEEP** | KEEP pending normal source-of-truth and reference review; no move/archive is proposed by this inventory. |
| `docs/workspace-package-map.md` | 4790 | Operational/reference guide | **KEEP** | KEEP pending normal source-of-truth and reference review; no move/archive is proposed by this inventory. |
| `packages/brokers/AGENTS.md` | 8605 | Package agent instructions | **KEEP** | Mandatory contributor/AI-agent instructions; local rules supplement central policy. |
| `packages/brokers/ARCHITECTURE.md` | 35221 | Package architecture | **KEEP** | Explicitly labels itself as target architecture/migration contract, distinguishes its dated implementation snapshot from current source, and documents verified consumer boundaries and enforced dependency direction. Linked by the package README and roadmap; no move/split is warranted. |
| `packages/brokers/README.md` | 19671 | Package entry point | **KEEP** | Scope entry point and setup/public contract guide. |
| `packages/brokers/ROADMAP.md` | 109813 | Package roadmap | **REVIEW** | Current priority plan is useful, but the historical 2026-11-08 multi-subscriber note still says the #702 result-shape proposal awaits owner agreement even though issue #702 is closed and PRs #732/#735/#740 merged. Requires a full status/history sweep and dated addendum; do not silently rewrite the historical note. |
| `packages/db/AGENTS.md` | 2897 | Package agent instructions | **KEEP** | Mandatory contributor/AI-agent instructions; local rules supplement central policy. |
| `packages/db/README.md` | 5933 | Package entry point | **KEEP** | Scope entry point and setup/public contract guide. |
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
4. `packages/brokers/ROADMAP.md` is very large and has a current-priority section followed by historical phases. Its 2026-11-08 multi-subscriber history contains a stale pending-owner-agreement sentence: issue #702 is closed and PRs #732, #735 and #740 merged. Preserve the original observation and add a dated correction only after the full roadmap/status review.
5. `packages/entities` previously had agent instructions and a roadmap but no README entry point; a package README has now been added.
6. Package README/AGENTS/ROADMAP files are domain-owned. Root policy should define common standards; package instructions should add only genuinely local constraints.

## Remaining work

- [ ] Complete the 42-file Harvester content/reference review and resolve its REVIEW candidates.
- [x] Review `packages/brokers/ARCHITECTURE.md`: KEEP at its current path; it is an explicit target architecture and migration contract.
- [ ] Complete the remaining `packages/brokers/ROADMAP.md` review, including its historical/current status boundary and the stale #702 note.
- [ ] Inspect all other package/app README, AGENTS and ROADMAP combinations for stale links, competing rules and status drift.
- [ ] Trace inbound references from Markdown, source comments, GitHub Issues/PRs and workflows before any migration.
- [ ] Add/verify local indexes wherever a substantial documentation subdirectory exists.
- [ ] Verify the policy/index checks are required by live branch rulesets; a passing workflow alone does not prove enforcement.
- [ ] Evaluate Markdown linting and external-link checks with a baseline before adding new CI dependencies.
- [ ] Record final dispositions and rationale for each REVIEW entry; update indexes after every migration.

