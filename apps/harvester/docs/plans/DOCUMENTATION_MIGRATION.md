# Documentation inventory and migration plan — Harvester

- Status: In progress
- Type: Documentation migration plan
- Tracking issue: [#795](https://github.com/45s/coinzilla/issues/795)
- Owner: Harvester
- Created: 2026-11-09
- Governance: [Repository documentation governance](../../../../docs/DOCUMENTATION_GOVERNANCE.md)
- Scope: `apps/harvester/` and its documentation references
- Safety: Documentation-only; no runtime, test behavior or trading policy changes

## Objective

Bring Harvester documentation into a predictable, discoverable and maintainable structure while preserving historical evidence and existing GitHub references. This plan is intentionally staged: establish governance and indexes first, complete a verified per-file inventory second, then migrate in small batches.

## Initial verified observations

The initial review of `develop` identified:

- Application entry point and operational overview at `apps/harvester/README.md`.
- Domain roadmap at `apps/harvester/ROADMAP.md`.
- Historical audit/evidence records formerly mixed into `apps/harvester/` root; these are now grouped under `apps/harvester/docs/audits/{reports,sessions,evidence}/`.
- Application-specific agent instructions at `apps/harvester/AGENTS.md`.
- A nested `apps/harvester/docs/` tree containing architecture, domain, infrastructure, operational, strategy and audit-related material.
- Documentation links embedded throughout READMEs, roadmaps, specifications, tests, issues and PRs.

This is an initial structural observation, not a complete file-by-file inventory. File counts, sizes and dispositions must be generated from a complete recursive tree and verified against content before migration decisions are finalized.

## Target ownership

| Content | Target home | Rule |
| --- | --- | --- |
| Application setup and short operational overview | `apps/harvester/README.md` | Keep concise; link to details |
| Harvester agent constraints | `apps/harvester/AGENTS.md` | Domain-specific rules only; link to repository policy |
| Current Harvester priorities | `apps/harvester/ROADMAP.md` | Concise work/status view; link to issues |
| Current architecture | `apps/harvester/docs/architecture/` and established architecture specification | One canonical current description per subject |
| Domain rules/specifications | `apps/harvester/docs/domain/` | Canonical current behavioral contracts |
| Operational runbooks | `apps/harvester/docs/operations/` or established runbook location | Current executable procedures |
| Broker/infrastructure contracts | `apps/harvester/docs/infrastructure/` | Adapter and integration behavior |
| Test guidance | `apps/harvester/docs/testing/` when justified | Test strategy and reusable instructions |
| ADRs | `apps/harvester/docs/decisions/` | Significant decisions and rationale |
| Historical audits and investigations | `apps/harvester/docs/audits/` | Immutable-in-meaning evidence snapshots |
| GitHub task status | GitHub Issues/PRs linked from roadmap | Operational task state |

Do not create empty directories. Use established locations where the content already has a clear owner.

## File disposition vocabulary

Every discovered Markdown/documentation file must receive one disposition:

- **KEEP** — already in the right location and authoritative.
- **MOVE** — relocate without changing substantive content; update all references and preserve history.
- **MERGE** — consolidate genuinely duplicate living guidance after proving equivalence; retain provenance and links.
- **SPLIT** — separate mixed living guidance from historical evidence or unrelated topics, preserving all original facts and citations.
- **SUPERSEDE** — identify a new canonical source; mark the old document with successor and rationale.
- **ARCHIVE** — preserve a historical/outdated record outside active navigation, with an explanatory index entry.
- **REVIEW** — insufficient evidence to choose safely; no destructive action.

No file may be deleted solely because it is old, large, similarly named or apparently duplicated.

## Migration phases

### Phase 0 — Governance and discoverability

- [x] Publish repository-wide documentation governance.
- [x] Add repository documentation index.
- [x] Add Harvester documentation index.
- [x] Make documentation policy part of mandatory AI-agent instructions.
- [x] Extend existing CI policy/link validation to cover canonical indexes.
- [x] Verify policy checks and repository-wide internal links on exact PR heads: PR #801 head `e4e5977fc8bff546221677be39262d26590463bb` passed all six workflows, including JavaScript Syntax / `check:agent-policy`.

### Phase 1 — Complete inventory and evidence map

- [x] Enumerate all 97 tracked Markdown files recursively at the baseline commit (42 Harvester files and 55 repository/root/package files); see the [repository inventory](../../../../docs/REPOSITORY_DOCUMENTATION_INVENTORY.md).
- [x] Record file paths, byte sizes, categories and conservative initial dispositions for all Harvester and non-Harvester Markdown files.
- [ ] Complete content-level review, ownership/source-of-truth mapping, inbound/outbound reference mapping and last-relevant-commit analysis for each migration candidate.
- [ ] Read and verify all relevant Harvester documents in full before any final MOVE/MERGE/SPLIT/SUPERSEDE/ARCHIVE decision.
- [ ] Identify duplicated or conflicting claims by subject, not just filename.
- [ ] Identify oversized mixed-purpose documents and propose safe splits.
- [ ] Record all issue/PR links and external evidence provenance.
- [ ] Publish a timestamped inventory report and disposition matrix.

### Phase 2 — Harvester living-document consolidation

- [ ] Identify one canonical current document for each architecture/domain/operations/configuration/testing subject.
- [ ] Move only when ownership/navigation materially improves; preserve Git history where practical.
- [ ] Replace repeated rules with links to the canonical document.
- [x] Separate the Harvester roadmap's historical audit/implementation narrative into `docs/audits/ROADMAP_HISTORY.md`; retain original headings as compatibility anchors.
- [ ] Further reduce the active roadmap to concise priorities and links without breaking preserved section anchors or losing current acceptance criteria.
- [x] Reduce the Harvester README to an entry point with links to authoritative architecture, domain, operations, TESTNET and historical records; preserve old section anchors and archive the historical README notes.
- [ ] Add ADRs only for decisions with durable rationale that is not already captured.
- [ ] Update all indexes, README references, AGENTS instructions and roadmap links.

### Phase 3 — Historical evidence organization

- [x] Relocate the nine root-level audit reports, session reports and supporting evidence into indexed `docs/audits/reports/`, `sessions/` and `evidence/` directories in [merged PR #951](https://github.com/45s/coinzilla/pull/951); preserve content, filenames, provenance and distinct session boundaries.
- [ ] Complete the remaining audit/evidence classification across all Harvester documentation and verify every inbound reference.
- [ ] Preserve original timestamps, source commit SHAs, evidence identifiers, limitations and unknowns.
- [ ] Introduce UTC timestamped filenames for newly created snapshots.
- [ ] Add dated addenda or successor assessments rather than rewriting historical conclusions.
- [x] Archive the root-level records only after destination indexes existed and known inbound/outbound references were updated; recursive agent-policy link/anchor validation, changed-maintained-document Markdown style checks, and the advisory external documentation-link check all passed on the exact PR #951 head.
- [ ] Review any additional historical records still outside `docs/audits/` and move only when ownership and references are verified.

### Phase 4 — Repository-wide adoption

- [ ] Inventory root-level and `docs/` Markdown files.
- [ ] Identify duplicate repository-wide policy documents and assign one owner per subject.
- [ ] Add/verify indexes for architecture and engineering documentation.
- [ ] Align other active applications/packages with the same ownership and index pattern.
- [ ] Update root README and local READMEs to direct readers to their indexes.

### Phase 5 — Enforcement and maintenance

- [x] Verify the active `develop-core` ruleset requires the `Check JavaScript syntax` context, which runs `check:agent-policy` and repository-wide Markdown relative-link validation. This is enforced inside that required context, not as a standalone documentation status. The ruleset API evidence is recorded in [Documentation Governance](../../../../docs/DOCUMENTATION_GOVERNANCE.md).
- [ ] Establish Markdown linting only after selecting a tool, defining a baseline and validating compatibility.
- [ ] Evaluate external-link checking separately from deterministic internal-link validation.
- [ ] Add metadata/index validation where it can be deterministic and low-maintenance.
- [ ] Add documentation impact review to PR templates/checklists if not already present.
- [ ] Reassess whether a documentation website is warranted; Markdown remains the canonical source.

## Acceptance criteria

- Every active documentation area has an obvious entry point.
- Every substantial document has a clear owner, category and lifecycle status.
- Every important subject has one explicitly authoritative living document.
- All migration candidates have a documented disposition and verified inbound-reference handling.
- Historical evidence is preserved with provenance and is not silently rewritten.
- Root and domain AI instructions require the same governance behavior.
- CI validates the canonical policy/index links and existing agent policy.
- PRs identify documentation impact.
- No claim of CI enforcement or successful verification is made without exact-head evidence.
- Harvester runtime, tests, configuration and trading behavior remain unchanged by this documentation-only initiative.

## Current status and remaining boundaries

The root-level Harvester audit cleanup is complete in merged [PR #951](https://github.com/45s/coinzilla/pull/951) at `86f9c1d4d7a012e628dcd1b7b68b2354e4073045`. The recursive `develop` tree now contains 57 Harvester Markdown/MDX files (42 frozen baseline plus 15 additions), with only `README.md`, `AGENTS.md`, and `ROADMAP.md` at the application root. Nine historical records are grouped under `docs/audits/reports/`, `sessions/`, and `evidence/`; their contents and original filenames are preserved.

A source-based documentation consistency review also found and corrected a material process-lock discrepancy: the README incorrectly said stale locks are never reclaimed, while the source and tests permit narrowly guarded same-host dead-PID reclamation; Journal Operations described only the directory lock and omitted the broker-wide host lock. Both documents are now aligned with `acquire-harvester-process-lock.js`, `acquire-harvester-process-locks.js` and their deterministic tests. The Journal integration roadmap's Step 8 branch status was also refreshed against merged PR #473; Step 8 remains open rather than being falsely marked complete.

A complete recursive Git tree is available for the baseline commit. The repository inventory covers all 97 Markdown files: 42 Harvester files and 55 other repository/root/package files. All four initial Harvester REVIEW candidates now have evidence-based dispositions: the domain-first plan is SUPERSEDED; the Journal integration roadmap and strategy overview are KEEP with stale status/authority clarified; and `testnet-order-tools.md` is KEEP as the canonical TESTNET operator guide. Its dated ownership findings now point to `ROADMAP_HISTORY.md`, while live troubleshooting instructions are aligned with the current event handler and order registry. Inbound links from the Harvester README and documentation index were verified in merged PR #813. Both initial Brokers REVIEW candidates were resolved as KEEP in merged PR #812: `packages/brokers/ARCHITECTURE.md` is an explicit target architecture/migration contract, while `packages/brokers/ROADMAP.md` has a clear current priority/status section followed by explicitly historical phase and dated evidence records. The current status of the remaining substantial package roadmaps was reconciled with merged work and lifecycle metadata was added in PR #814. No initial Harvester or Brokers REVIEW candidates remain. This is not proof that every factual statement in every file is current or every reference has been traced.

The inventory phase has established a complete path/size/category baseline. The remaining work is content-level authority review, inbound/outbound link and GitHub issue/PR reference mapping, source verification, and final disposition of REVIEW candidates. No move, merge, split, supersede or archive operation is authorized by the initial inventories alone.

No runtime or TESTNET activity is part of this work. Any discovered behavior discrepancy must be recorded and routed to its owning engineering issue, not fixed as part of this documentation migration.
