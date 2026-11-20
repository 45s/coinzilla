---
title: Engineering standards and enforcement matrix
status: active
type: engineering-audit
owner: repository engineering
created: 2026-11-20
last_verified: 2026-11-20
---

# Engineering standards and enforcement matrix

This matrix is the evidence-based S-0 inventory for [issue #1568](https://github.com/45s/coinzilla/issues/1568). It identifies the current canonical source, repository examples, actual enforcement, and the next action for each engineering concern.

**Authority:** this is an inventory and navigation aid, not a second policy source. The linked canonical document owns each rule. Where a row says a standard is missing or incomplete, later phases must extend or create one canonical source and link to it from other documents.

## Audit baseline and scope

- **Repository:** `45s/coinzilla`
- **Target:** `develop`
- **Verified baseline:** `b0124efdbc4e130ee677692fc24d525118c5d710`
- **Audit date:** 2026-11-20
- **Scope:** repository-wide engineering policies, package ownership/instructions, workspace manifests, documented source architecture, quality workflows, and overlapping engineering/documentation initiatives.
- **No runtime changes:** this phase is documentation and repository-state audit only. No exchange, account, TESTNET, or LIVE operations were performed.
- **Evidence limitation:** workspace dependency declarations and documented module boundaries were inspected. A complete source-level relative-import graph was not generated in S-0; do not treat the manifest graph as proof that no internal import cycles or boundary violations exist. Live GitHub ruleset readback was not available through the current repository connection; ruleset details below are identified as the last documented verification, not a new live verification.

## Standards matrix

Disposition meanings:

- **KEEP** — current canonical source is clear and should remain authoritative.
- **REVISE** — source exists but needs evidence-based additions or clarification in its planned phase.
- **CONSOLIDATE** — avoid duplicate rules; link to the existing canonical source or coordinate overlapping initiatives.
- **MISSING** — no adequate canonical repository-wide standard was found.
- **OBSOLETE** — confirmed superseded guidance that should be retired through a safe, reference-traced migration. No obsolete canonical standard was confirmed in this S-0 scan.

| Rule / concern | Canonical source | Repository example / evidence | Enforcement today | Status | Gap / next action | Related work |
|---|---|---|---|---|---|---|
| Architecture and dependency direction | [Domain ownership](DOMAIN_OWNERSHIP.md), [Modularity Standard](MODULARITY_STANDARD.md), [Workspace package map](../workspace-package-map.md), package `AGENTS.md` files | Actual workspace manifests declare: Harvester → Brokers, Entities, Event Bus, Indicators, Journal, Notifiers, Utils, DB; Brokers → Entities, Utils; Entities → Utils; DB → Utils; Event Bus → Utils; Journal → Event Bus, Utils; Indicators → Utils; Notifiers and Utils have no workspace-package dependencies. | Manifest/workspace structure is explicit. Brokers has its own dependency-direction work and tests; package-local architecture tests are not yet a single repository-wide boundary contract. | REVISE | S-1 must map actual module layers and representative imports, define allowed/forbidden dependencies, inspect existing package-specific checks, and add only narrow deterministic enforcement where reliable. Do not claim the manifest graph proves the absence of internal cycles. | #1264 architecture enforcement; #1565 helper purity |
| Module responsibility and helper purity | [Modularity Standard](MODULARITY_STANDARD.md), [Shared Utilities Policy](SHARED_UTILITIES_POLICY.md) | Harvester documents domain/use-case/infrastructure/composition responsibilities; Brokers and DB define local domain/application/port/infrastructure boundaries; helpers are intended to be pure. | Modularity is review guidance. A repository-wide helper scanner is proposed in the open draft [PR #1566](https://github.com/45s/coinzilla/pull/1566), not yet merged into this baseline. | CONSOLIDATE | Reuse #1565 and PR #1566. Do not create a second helper scanner or duplicate the helper-purity rules in S-1. The PR's reported 39-helper inventory and zero missing colocated tests are branch evidence, not merged-`develop` enforcement. | #1565 / PR #1566 |
| Naming conventions | [Engineering Standards](../../ENGINEERING_STANDARDS.md), [JavaScript and JSDoc Standard](JAVASCRIPT_JSDOC_STANDARD.md), [Modularity Standard](MODULARITY_STANDARD.md) | Existing standards require intention-revealing names, predicate-style booleans, action-oriented helper names, and meaningful test names. | Review and ESLint enforce selected syntax/quality rules; no complete repository naming taxonomy/checker was identified. | REVISE | S-7 should define only conventions that solve demonstrated ambiguity, using real repository examples. Avoid a naming rule-count exercise or a brittle universal filename checker. | #1568 S-7 |
| File-tree and directory responsibility | [Modularity Standard](MODULARITY_STANDARD.md), [Domain ownership](DOMAIN_OWNERSHIP.md), package `AGENTS.md` files | Feature roots keep primary runtime components; `helpers/` is for pure supporting functions; packages use different structures according to their responsibilities. | Ownership/entry-point policy is checked by `check:agent-policy`; deeper module responsibility is primarily review-enforced. | REVISE | S-7 should document responsibility-based placement and when not to create folders/files. Preserve the explicit rule that illustrative trees are not mandatory templates. | #1568 S-7; #1565 |
| Testing and test design | [Engineering Standards](../../ENGINEERING_STANDARDS.md), [Task Workflows](TASK_WORKFLOWS.md), package `AGENTS.md` / roadmaps | Native Node.js `node:test`; strict RED → GREEN → REFACTOR; tests for observable contracts, failures, boundaries, lifecycle and cleanup. | Unit-test workflow includes all nine workspace packages. Coverage workflow also includes all nine; package threshold scripts exist for Harvester, Brokers, DB, Indicators, Event Bus, Journal, Notifiers and Utils. Entities runs workspace coverage but has no package-specific threshold script. | REVISE | S-2 should define test expectations by module/layer and clarify deterministic vs opt-in integration tests. Coordinate package-matrix and fail-closed CI changes with #1264; evaluate Entities threshold from measured coverage rather than inventing one. | #1264; Entities roadmap |
| Configuration | No repository-wide configuration standard found. Relevant current sources: [Harvester AGENTS](../../apps/harvester/AGENTS.md), [ADR-0002](../../docs/architecture/decisions/ADR-0002-explicit-binance-trading-environment.md), and each package's configuration contract | Harvester uses one validated `appConfig` composition boundary and operator-owned pair files; Binance routing requires explicit `TRADING_MODE`; package settings are owned locally. | Runtime-specific validation and tests exist; no single cross-workspace standard for config ownership, schema validation, defaults, immutability, environment access, and migration was identified. | MISSING | S-3 should establish a concise repository-wide minimum contract and link to domain-specific guides. Do not centralize application-specific settings or create a generic config framework. | #1568 S-3 |
| Error handling | [Structured Error Handling Standard](structured-error-handling.md) | One Utils-owned `SystemCustomError` base; component-owned subclasses/codes; native `cause`; bounded safe context; incremental adoption. | Standard is mandatory through AGENTS/Engineering Standards and package tests; adoption is incremental. No repository-wide scanner enforcing every legacy error path was identified. | KEEP | Preserve the standard as the sole source. S-4 should audit adoption gaps and define review/test expectations without creating another error taxonomy or launching a mass migration. | #1028; #1208 |
| Logging and observability | [Shared Utilities Policy](SHARED_UTILITIES_POLICY.md), [Engineering Standards](../../ENGINEERING_STANDARDS.md), [Structured Error Handling Standard](structured-error-handling.md) | Public `@coinzilla/utils` Logger/defaultLogger; structured context; redaction; no routine direct console use; domain-owned operational events. | Root ESLint makes `no-console` an error and strict `pnpm lint` runs in required CI. Logger and error contracts have deterministic package tests. | KEEP | S-5 should clarify log-level meanings, correlation/context fields, operational vs diagnostic events, and remaining exception handling. Reuse Utils Logger; do not introduce per-app logger wrappers. | #1568 S-5; Utils roadmap |
| Security and secrets | [Engineering Standards](../../ENGINEERING_STANDARDS.md), [Shared Utilities Policy](SHARED_UTILITIES_POLICY.md), [Dependency Audit Playbook](../dependency-audit-playbook.md), domain security instructions | Secret redaction, safe diagnostic context, explicit exchange environment, pinned GitHub Actions, least-privilege workflow permissions. | ESLint blocks selected unsafe APIs and console use; production dependency audit runs at high severity in required CI. External-link checker uses DNS-pinned requests but remains advisory. | REVISE | #1264 owns evaluation of secret scanning and additional static analysis. S-5 should document existing protections and link to that work; do not add overlapping scanners or claim dev-dependency coverage from the production-only audit. | #1264 P3; #1568 S-5 |
| Public APIs and contracts | Package READMEs, public `src/index.js` exports, domain specifications, [Engineering Standards](../../ENGINEERING_STANDARDS.md) | Entities financial values; Brokers API and conformance tests; Event Bus and Journal record contracts; Utils public API and shared helper contracts. | Package-level contract/unit tests exist, but compatibility review and API documentation are primarily governed by task workflow and owning-package guidance. | REVISE | S-1/S-2 should specify how public contracts, consumer impact, compatibility and migration evidence are recorded. Keep each domain's contract with its owner. | #1264; package roadmaps |
| Documentation governance | [Documentation Governance](../DOCUMENTATION_GOVERNANCE.md), [Markdown Style](../MARKDOWN_STYLE.md), [docs index](../README.md) | Canonical-source ownership, historical evidence preservation, metadata/index rules, freshness sweeps, root/domain roadmap synchronization. | Required CI checks agent policy/local links, maintained Markdown style, and maintained-source anchors. External URL checks are advisory. Last documented inventory: 160 paths (132 maintained, 28 historical); this count is not re-certified at the S-0 baseline. | CONSOLIDATE | Do not recreate documentation inventory, factual review, or reference migration work. #1401 owns maintained-document factual/source verification; #1403 owns reference tracing and safe consolidation; #795 remains their parent. | #795; #1401; #1402; #1403 |
| AI-agent workflow | [Root AGENTS](../../AGENTS.md), [AI Agent Workflow](../../AI_AGENT_WORKFLOW.md), [Task Workflows](TASK_WORKFLOWS.md) | Mandatory documentation preflight, task branch, one task/one PR, incremental commits, issue/PR/roadmap checkpoints, exact-head verification and handoff. | `check:agent-policy` checks required documentation/ownership paths, local links and balanced fences. Helper-policy enforcement is pending PR #1566. | REVISE | S-6 should reconcile overlapping instructions, make one source authoritative per workflow topic, and ensure handoffs remain resumable. Preserve issue #1568's explicit user-review/no-merge boundary for this initiative. | #1565; #1264; #1568 S-6 |
| CI and quality gates | [CI workflow reference](../ci-workflows.md), workflow YAML under `.github/workflows/`, root/package manifests | Unit-test and coverage matrices enumerate all nine workspace packages; quality workflow runs ESLint, syntax, agent policy, Markdown gates, actionlint and offline checker tests. | `develop-core` is documented as requiring six contexts: package tests, workspace coverage, JavaScript syntax, Utils tests, production dependency audit, and actionlint. This was last documented as live-verified on 2026-11-18; it was not re-read live during S-0. | CONSOLIDATE | #1264 owns ruleset, matrix-completeness and fail-closed CI hardening. S-9 should define architecture-policy enforcement only after coordination; do not add duplicate jobs or assume a workflow run is a required ruleset context. | #1264; #1565 |
| Git, PR and review governance | [AI Agent Workflow](../../AI_AGENT_WORKFLOW.md), [Root AGENTS](../../AGENTS.md), GitHub issue/PR templates | Task PRs target `develop`; task branches start from latest `develop`; issue/branch/PR/roadmap checkpoints are required; release PR is `develop` → `main`. | Repository instructions and CI enforce some workflow behavior; branch freshness and live ruleset settings require GitHub state verification. | KEEP | Preserve the single workflow source. For #1568, do not merge; the issue explicitly reserves review/merge to the user. Verify current branch/ruleset state before future policy changes. | #1568; #1264 |
| Dependency management | [Dependency Audit Playbook](../dependency-audit-playbook.md), root `package.json`, `pnpm-lock.yaml`, `.github/dependabot.yml` | Workspace package dependencies use `workspace:*`; pnpm lockfile is authoritative for resolved dependencies; Dependabot version updates target `develop`. | Required production dependency audit uses `pnpm audit --prod --audit-level high`; actionlint validates workflows; Dependabot policy is documented. | REVISE | #1264 should decide whether and how to cover development/tooling dependencies and lockfile integrity. S-3/S-9 must not duplicate dependency security policy. | #1264 P3 |
| Templates and practical examples | [Task Workflows](TASK_WORKFLOWS.md), [Engineering Standards](../../ENGINEERING_STANDARDS.md), existing GitHub templates | A repository PR template exists; package READMEs and standards contain illustrative examples. | PR template is manually reviewed; no complete set of optional pure-module, domain-policy, handler, adapter, config or checker templates was identified in this scan. | MISSING | S-8 should create only templates that encode an accepted standard and are grounded in real repository modules. Templates must remain optional where boilerplate would hurt. | #1568 S-8 |

## Verified workspace dependency declarations

The following graph is derived from the current package manifests, not inferred from directory names:

```text
@coinzilla/harvester
  ├── @coinzilla/brokers
  ├── @coinzilla/entities
  ├── @coinzilla/event-bus
  ├── @coinzilla/indicators
  ├── @coinzilla/journal
  ├── @coinzilla/notifiers
  ├── @coinzilla/utils
  └── @coinzilla/db

@coinzilla/brokers ──> @coinzilla/entities ──> @coinzilla/utils
@coinzilla/db ───────────────────────────────> @coinzilla/utils
@coinzilla/event-bus ────────────────────────> @coinzilla/utils
@coinzilla/indicators ──────────────────────> @coinzilla/utils
@coinzilla/journal ──> @coinzilla/event-bus ─> @coinzilla/utils
@coinzilla/notifiers: no workspace-package dependency
@coinzilla/utils: no workspace-package dependency
```

No cycle appears in the declared workspace dependency graph. This statement is limited to package-manifest dependencies; internal relative-import cycles and forbidden deep imports require a separate source-level scan.

## Existing work and overlap decisions

| Initiative | Current evidence | Ownership decision for #1568 |
|---|---|---|
| [#1264 — repository quality, CI and GitHub governance](https://github.com/45s/coinzilla/issues/1264) | Open umbrella; ESLint baseline and required lint gate are complete. Remaining work includes review/ownership policy, package test/coverage matrix, fail-closed CI, security/static analysis, JSDoc and architecture enforcement, and continuous governance. | #1264 owns implementation of repository quality gates and CI/ruleset hardening. #1568 owns the durable standards/architecture guidance and must coordinate S-1/S-2/S-9 rather than build duplicate enforcement. |
| [#1565 — helper purity policy](https://github.com/45s/coinzilla/issues/1565) / [PR #1566](https://github.com/45s/coinzilla/pull/1566) | Open issue; PR #1566 is draft. Its branch reports a recursive helper inventory and a proposed deterministic scanner/test gate. | #1565 owns helper purity and colocated-test enforcement. S-1 links to its accepted result; do not create a second helper policy/checker. |
| [#795 — documentation governance](https://github.com/45s/coinzilla/issues/795) | Governance foundation and Markdown enforcement are complete; #1401 and #1403 remain open. | #795 remains the documentation-governance parent. #1568 does not repeat its inventory, factual-document audit or migration tasks. |
| [#1401 — maintained-document factual/source audit](https://github.com/45s/coinzilla/issues/1401) | Open; verifies living-document claims against source, tests, configuration and merged GitHub state. | #1401 owns document-by-document factual verification. S-0 uses its current canonical sources and records only the standards-level inventory. |
| [#1403 — reference tracing and safe consolidation](https://github.com/45s/coinzilla/issues/1403) | Open; traces Markdown/source/GitHub/workflow references before document migration. | #1403 owns reference maps and safe document moves/consolidation. #1568 must not move or archive documents without that process. |

## S-0 findings and decisions

1. **The repository already has a strong canonical foundation.** Engineering, documentation, modularity, shared utilities, JavaScript/JSDoc, ESLint, structured errors, task workflow and domain ownership each have an identifiable source. Keep these sources; do not create replacement policy documents.
2. **Configuration is the clearest missing repository-wide standard.** Domain-specific configuration guidance exists, but a shared minimum for ownership, validation, defaults, environment access, immutability and migration is not established.
3. **Naming and file-tree guidance is partial, not absent.** The Modularity Standard covers feature placement and helper boundaries; S-7 should fill only the responsibility/naming gaps demonstrated by source.
4. **Architecture enforcement must be coordinated.** Package manifests provide a clear declared dependency graph; package-specific checks and #1565 already exist or are in progress. S-1/S-9 must inspect and reuse them before proposing a repository-wide checker.
5. **Testing CI covers all nine workspace packages, but package-specific thresholds are not uniform.** Entities has no dedicated threshold script. S-2 should define the standard; #1264 owns matrix/CI enforcement and package owners own their thresholds.
6. **Documentation work is already decomposed.** #1401 and #1403 are the factual and reference-tracing workstreams. The last recorded 160-path documentation inventory is historical relative to this baseline and must not be repeated as a current count without a fresh complete tree scan.
7. **No obsolete canonical standard was confirmed in the S-0 scope.** Any retirement or consolidation must be supported by the reference-tracing process in #1403.

## Recommended phase sequencing

Keep the issue's S-0 through S-10 structure, with these coordination adjustments:

1. **S-0 — complete the matrix and record source evidence.** This document is the deliverable; no source/CI changes belong in this phase.
2. **S-1 — architecture and dependency boundaries.** Reuse Modularity Standard, Domain Ownership, package architecture checks and #1565. Add a single allowed/forbidden matrix only after source-level import inspection.
3. **S-2 — testing standard.** Define the module/layer test expectations and deterministic/offline boundary. Coordinate package matrices and coverage enforcement with #1264.
4. **S-3 — configuration standard.** Establish the missing repository-wide minimum while leaving configuration ownership in each domain.
5. **S-4 and S-5 — error handling and logging.** Treat the existing structured-error and shared-logging documents as canonical; focus on gaps, examples and adoption rather than creating parallel standards.
6. **S-6 — AI-agent workflow reconciliation.** Keep root AGENTS concise and resolve any duplicated or inconsistent workflow guidance by reference tracing.
7. **S-7 — file-tree and naming.** Extend the existing Modularity Standard instead of creating a competing tree template.
8. **S-8 — templates.** Build optional templates only after the standards they encode are accepted.
9. **S-9 — CI enforcement.** Coordinate architecture and package-matrix checks with #1264 and #1565; add only deterministic, high-confidence gates.
10. **S-10 — documentation governance closeout.** Reconcile with #795, #1401 and #1403; do not absorb their independent scopes.

## Verification record

S-0 was a source/documentation inspection using GitHub repository files, manifests, workflow definitions, issue and PR state, and commit comparisons.

- Inspected root `AGENTS.md`, `AI_AGENT_WORKFLOW.md`, `ENGINEERING_STANDARDS.md`, task workflows, documentation governance, Markdown style, domain ownership, modularity, shared utilities, JavaScript/JSDoc, ESLint, structured errors, cross-domain requests, dependency audit guidance, repository docs index, workspace package map and CI workflow reference.
- Inspected applicable local instructions for Harvester and the workspace packages, plus current root and package roadmap status/ownership.
- Inspected root and package manifests, workspace definition, root ESLint configuration, quality/unit-test/coverage/dependency-audit workflows, agent-policy implementation/tests and the existing repository documentation inventory.
- Inspected issue/PR state for #1264, #1565/#1566, #795, #1401 and #1403.
- Confirmed `develop` equals baseline `b0124efdbc4e130ee677692fc24d525118c5d710` at the time of the audit.
- **Not run:** local Markdown/style/policy commands. This GitHub-only inspection session has no local checkout/runner. Exact-head GitHub Actions on the resulting PR is the required verification path.
- **Not performed:** a complete source-level import graph, a fresh recursive Markdown/MDX path count, or live GitHub ruleset readback. These are explicitly not claimed as completed.

## Next action

Proceed to S-1 only after this matrix is reviewed in its PR. Keep S-1 narrow: inspect actual source imports and existing architecture checks, then define the smallest useful dependency-boundary contract. Do not start S-2 through S-10 in parallel.
